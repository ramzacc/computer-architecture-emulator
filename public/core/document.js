// Document serialization and parsing. The document format is versionless
// circuit JSON: components, wire runs, junctions, monitor layout, and program
// configuration. Field codecs keep encode, validation, and assignment in one
// table so the written and parsed shapes cannot drift apart.
import {
  DEFAULT_CLOCK_FREQUENCY, MAX_LABEL_LENGTH, addressWidth, bitWidth, dimsOf, documentFields,
  pinsFor, spec, validBitWidth, validChannelCount, validClockFrequency, validRom,
  validRomAddressWidth, validRomWidth,
} from "./components.js";
import { VALUE_FORMATS, validValueFormat } from "./value-format.js";
import {
  blockedEdgeKeys, createBoard, edgeKey, edgePoints, validComponentProperties,
  validEdgeCoordinates, validEdgeOrientation, wireSize,
} from "./board.js";
import { connectedAtPoint, crossingAt, isCrossing } from "./wiring.js";
import { shortCircuitError } from "./issues.js";
import { normalizeIsa, parseIsa } from "./assembly.js";
import { validProgramSource } from "./program-source.js";

const fail = (path, message) => {
  throw new Error(`${path} ${message}`);
};

// One table per direction: document fields encode to a tuple slot and parse
// from it, so the written and parsed shapes cannot drift apart.
const FIELD_ENCODERS = {
  size: (component) => component.size ?? 1,
  value: (component) => component.value ?? 0,
  data: (component) => component.data ?? [],
  addressSize: (component) => addressWidth(component),
  frequency: (component) => component.frequency ?? DEFAULT_CLOCK_FREQUENCY,
  enable: (component) => component.enable !== false,
  order: (component) => (component.order === "descendant" ? 1 : 0),
  channels: (component) => component.channels ?? 2,
  format: (component) => VALUE_FORMATS.indexOf(component.format ?? "decimal"),
  label: (component) => component.label ?? "",
  module: (component) => component.module,
  pinLayout: (component) => component.pinLayout ?? null,
  faceLayout: (component) => component.faceLayout ?? null,
  moduleWidth: (component) => component.moduleWidth ?? 4,
  moduleHeight: (component) => component.moduleHeight ?? 3,
};

const FIELD_PARSERS = {
  size(component, value, path) {
    const powerOfTwo = component.t === "rom" || component.t === "ram";
    if (!(powerOfTwo ? validRomWidth(value) : validBitWidth(value)))
      fail(path, `must be ${powerOfTwo ? "a power of two from 1–32" : "1–32"}.`);
    component.size = value;
  },
  value(component, value, path) {
    if (!Number.isInteger(value)) fail(path, "must be an integer.");
    component.value = value;
  },
  data(component, value, path) {
    if (!validRom({ t: component.t, size: component.size, addressSize: component.addressSize, data: value }))
      fail(path, "must contain unique addresses fitting the address width and values fitting the ROM width.");
    component.data = value;
  },
  addressSize(component, value, path) {
    if (!validRomAddressWidth(value)) fail(path, "must be a power of two from 1–16.");
    component.addressSize = value;
  },
  frequency(component, value, path) {
    if (!validClockFrequency(value)) fail(path, "is an invalid frequency.");
    component.frequency = value;
  },
  enable(component, value, path) {
    if (typeof value !== "boolean") fail(path, "must be a boolean.");
    component.enable = value;
  },
  order(component, value, path) {
    if (value !== 0 && value !== 1) fail(path, "is an invalid order.");
    component.order = value ? "descendant" : "ascendant";
  },
  channels(component, value, path) {
    if (!validChannelCount(value)) fail(path, "is an invalid channel count.");
    component.channels = value;
  },
  format(component, value, path) {
    if (!Number.isInteger(value) || value < 0 || value >= VALUE_FORMATS.length)
      fail(path, "is an invalid value format.");
    if (value) component.format = VALUE_FORMATS[value];
  },
  label(component, value, path) {
    if (typeof value !== "string" || value.length > MAX_LABEL_LENGTH)
      fail(path, `must be a string of at most ${MAX_LABEL_LENGTH} characters.`);
    component.label = value;
  },
  module(component, value, path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be a module document.");
    component.module = value;
  },
  pinLayout(component, value, path) {
    if (value !== null && !Array.isArray(value)) fail(path, "must be a pin layout array or null.");
    if (value !== null) component.pinLayout = value;
  },
  faceLayout(component, value, path) {
    if (value !== null && !Array.isArray(value)) fail(path, "must be a face layout array or null.");
    if (value !== null) component.faceLayout = value;
  },
  moduleWidth(component, value, path) {
    if (!Number.isInteger(value) || value < 4 || value > 20) fail(path, "must be 4–20.");
    component.moduleWidth = value;
  },
  moduleHeight(component, value, path) {
    if (!Number.isInteger(value) || value < 3 || value > 32) fail(path, "must be 3–32.");
    component.moduleHeight = value;
  },
};

function documentValue(component, field) {
  return FIELD_ENCODERS[field](component);
}

export function serialize(board) {
  const labels = new Set();
  const componentIndexes = new Map(board.components.map((component, index) => [component.id, index]));
  const monitor = (board.monitor?.ids ?? []).filter((id) => componentIndexes.has(id)).map((id) => [
    componentIndexes.get(id), board.monitor.formats.get(id) ?? "binary", board.monitor.breaks.has(id),
  ]);
  const program = board.program && {
    ...Object.fromEntries(["rom", "pc", "run", "step", "resetPc", "resetRegisters"]
      .map((key) => [key, componentIndexes.get(board.program[key]) ?? null])),
    ...(board.program.ram ? { ram: componentIndexes.get(board.program.ram) ?? null } : {}),
    registers: (board.program.registers ?? []).map((id) => componentIndexes.get(id)).filter((index) => index !== undefined),
    offset: board.program.offset ?? 0,
    format: board.program.format ?? "hex",
    ...(board.program.isa && Object.keys(board.program.isa).length ? { isa: Object.entries(board.program.isa)
      .filter(([id]) => componentIndexes.has(id)).map(([id, source]) => [componentIndexes.get(id), source]) } : {}),
    ...(board.program.sources && Object.keys(board.program.sources).length ? { sources: Object.entries(board.program.sources)
      .filter(([id]) => componentIndexes.has(id)).map(([id, source]) => [componentIndexes.get(id), source]) } : {}),
  };
  return JSON.stringify({
    components: board.components.map((component) => {
      if (!validComponentProperties(component))
        throw new Error(`Cannot serialize invalid ${String(component.t)} component.`);
      const key = JSON.stringify([component.t, component.label ?? ""]);
      if (component.t !== "portal") {
        if (labels.has(key)) throw new Error(`Duplicate ${component.t} label: ${component.label}.`);
        labels.add(key);
      }
      return [component.t, component.x, component.y, component.r ?? 0,
        ...documentFields(component.t).map((field) => documentValue(component, field))];
    }),
    wires: compactWireRuns(board),
    junctions: [...board.junctions].map((key) => {
      const [x, y] = key.split(",").map(Number);
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !crossingAt(board, x, y))
        throw new Error("Cannot serialize invalid junction.");
      return [x, y];
    }),
    ...(monitor.length ? { monitor } : {}),
    ...(program ? { program } : {}),
  });
}

function compactWireRuns(board) {
  const unvisited = new Map(board.wires);
  const runs = [];
  for (const edge of board.wires.values()) {
    if (!validEdgeOrientation(edge) || !validEdgeCoordinates(edge) ||
        !validBitWidth(wireSize(edge))) throw new Error("Cannot serialize invalid wire.");
  }
  for (const edge of board.wires.values()) {
    if (!unvisited.has(edgeKey(edge))) continue;
    const { o, size } = edge;
    let x = edge.x, y = edge.y;
    const sameSize = (px, py) => {
      const candidate = unvisited.get(edgeKey({ o, x: px, y: py }));
      return candidate && wireSize(candidate) === wireSize(edge);
    };
    while (sameSize(o === "H" ? x - 1 : x, o === "V" ? y - 1 : y)) {
      if (o === "H") x--; else y--;
    }
    let length = 0;
    while (sameSize(o === "H" ? x + length : x, o === "V" ? y + length : y) && length < 256) {
      unvisited.delete(edgeKey({ o, x: o === "H" ? x + length : x, y: o === "V" ? y + length : y }));
      length++;
    }
    runs.push(length === 1 ? [o, x, y, size ?? 1] : [o, x, y, size ?? 1, length]);
  }
  return runs;
}

function object(value, path, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key))
    throw new Error(`${path}.${key} is not supported.`);
}

function coordinate(value, path) {
  if (!Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer.`);
}

// Parsing builds a complete board before callers replace the visible one.
export function parseDocument(text, depth = 0) {
  return parseDocumentData(JSON.parse(text), depth);
}

function parseComponents(board, components, depth) {
  const occupied = new Set();
  const labels = new Set();
  for (const [index, raw] of components.entries()) {
    const path = `components[${index}]`;
    if (!Array.isArray(raw)) throw new Error(`${path} must be a component tuple.`);
    const [t, x, y, r] = raw;
    if (typeof t !== "string" || !spec(t)) throw new Error(`${path}.t is unknown.`);
    const fields = documentFields(t);
    if (raw.length !== 4 + fields.length)
      throw new Error(`${path} must have ${4 + fields.length} entries.`);
    coordinate(x, `${path}[1]`);
    coordinate(y, `${path}[2]`);
    if (!Number.isInteger(r) || r < 0 || r > 3) throw new Error(`${path}[3] must be 0–3.`);
    const component = { id: `c${index + 1}`, t, x, y, r };
    for (const [offset, field] of fields.entries())
      FIELD_PARSERS[field](component, raw[4 + offset], `${path}[${4 + offset}]`);
    if (!validComponentProperties(component, depth, true)) throw new Error(`${path} is invalid.`);
    const labelKey = JSON.stringify([t, component.label]);
    if (t !== "portal" && labels.has(labelKey)) throw new Error(`${path} duplicates a ${t} label.`);
    labels.add(labelKey);
    const { w, h } = dimsOf(component);
    for (let y = component.y; y < component.y + h; y++) for (let x = component.x; x < component.x + w; x++) {
      const key = `${x},${y}`;
      if (occupied.has(key)) throw new Error(`${path} overlaps another component.`);
      occupied.add(key);
    }
    board.components.push(component);
  }
}

function parseMonitor(board, monitor) {
  if (!Array.isArray(monitor)) throw new Error("Document.monitor must be an array.");
  const seen = new Set();
  for (const [index, raw] of monitor.entries()) {
    const path = `monitor[${index}]`;
    if (!Array.isArray(raw) || raw.length !== 3) throw new Error(`${path} must be [component index, format, new row].`);
    const [componentIndex, format, newRow] = raw;
    const component = board.components[componentIndex];
    if (!Number.isInteger(componentIndex) || !component || !["tag", "button", "switch", "clock", "input", "output", "register", "ram"].includes(component.t) || seen.has(componentIndex))
      throw new Error(`${path} must refer to a unique monitorable component.`);
    if (!validValueFormat(format)) throw new Error(`${path} has an invalid value format.`);
    if (typeof newRow !== "boolean") throw new Error(`${path} new row must be a boolean.`);
    seen.add(componentIndex);
    board.monitor.ids.push(component.id);
    board.monitor.formats.set(component.id, format);
    if (newRow) board.monitor.breaks.add(component.id);
  }
}

function parseProgram(board, config) {
  object(config, "Document.program", ["rom", "ram", "pc", "run", "step", "resetPc", "resetRegisters", "registers", "offset", "format", "isa", "sources"]);
  const types = { rom: ["rom"], ram: ["ram"], pc: ["tag"], run: ["clock"], step: ["button"], resetPc: ["button"], resetRegisters: ["button"] };
  const program = {};
  for (const [key, allowed] of Object.entries(types)) {
    if (key === "ram" && !Object.hasOwn(config, key)) continue;
    const index = config[key] ?? null;
    if (index !== null && (!Number.isInteger(index) || !allowed.includes(board.components[index]?.t)))
      throw new Error(`Document.program.${key} must refer to a ${allowed.join(" or ")}.`);
    program[key] = index === null ? null : board.components[index].id;
  }
  if (!Array.isArray(config.registers) || config.registers.some((index) =>
    !Number.isInteger(index) || board.components[index]?.t !== "register") ||
    new Set(config.registers).size !== config.registers.length)
    throw new Error("Document.program.registers must refer to unique registers.");
  if (!Number.isInteger(config.offset) || config.offset < 0 || config.offset > 65535)
    throw new Error("Document.program.offset must be an address from 0 to 65535.");
  if (!["hex", "binary", "decimal"].includes(config.format)) throw new Error("Document.program.format must be hex, binary, or decimal.");
  const isa = {};
  if (config.isa !== undefined) {
    if (!Array.isArray(config.isa)) throw new Error("Document.program.isa must be an array.");
    for (const entry of config.isa) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) ||
          board.components[entry[0]]?.t !== "rom" || typeof entry[1] !== "string" || entry[1].length > 16000)
        throw new Error("Document.program.isa must contain ROM indexes and rule text.");
      const rom = board.components[entry[0]];
      if (Object.hasOwn(isa, rom.id)) throw new Error("Document.program.isa contains a duplicate ROM.");
      const source = normalizeIsa(entry[1], bitWidth(rom));
      parseIsa(source, bitWidth(rom));
      isa[rom.id] = source;
    }
  }
  const sources = {};
  if (config.sources !== undefined) {
    if (!Array.isArray(config.sources)) throw new Error("Document.program.sources must be an array.");
    for (const entry of config.sources) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) ||
          board.components[entry[0]]?.t !== "rom")
        throw new Error("Document.program.sources must contain ROM indexes and annotations.");
      const rom = board.components[entry[0]];
      if (Object.hasOwn(sources, rom.id) || !validProgramSource(entry[1], addressWidth(rom)))
        throw new Error("Document.program.sources contains invalid annotations or a duplicate ROM.");
      sources[rom.id] = entry[1];
    }
  }
  board.program = { ...program, registers: config.registers.map((index) => board.components[index].id), offset: config.offset, format: config.format,
    ...(Object.keys(isa).length ? { isa } : {}), ...(Object.keys(sources).length ? { sources } : {}) };
}

function pinSizesByPoint(board) {
  const pinSizes = new Map();
  for (const component of board.components) for (const pin of pinsFor(component)) {
    const key = `${pin.px},${pin.py}`;
    if (!pinSizes.has(key)) pinSizes.set(key, new Set());
    pinSizes.get(key).add(pin.size);
  }
  return pinSizes;
}

function parseWires(board, wires, blockedEdges) {
  const wireIndexes = new Map();
  const wiresByPoint = new Map();
  for (const [index, raw] of wires.entries()) {
    const path = `wires[${index}]`;
    if (!Array.isArray(raw) || (raw.length !== 4 && raw.length !== 5)) throw new Error(`${path} must be [orientation, x, y, size, optional length].`);
    const [o, x, y, size, length = 1] = raw;
    if (o !== "H" && o !== "V") throw new Error(`${path}[0] must be H or V.`);
    coordinate(x, `${path}[1]`);
    coordinate(y, `${path}[2]`);
    if (!validBitWidth(size)) throw new Error(`${path}[3] must be 1–32.`);
    if (raw.length === 5 && (!Number.isSafeInteger(length) || length < 2 || length > 256))
      throw new Error(`${path}[4] must be a valid length from 2–256.`);
    if (!Number.isSafeInteger((o === "H" ? x : y) + length))
      throw new Error(`${path} endpoint must be a safe integer.`);
    for (let offset = 0; offset < length; offset++) {
      const edge = { o, x: x + (o === "H" ? offset : 0), y: y + (o === "V" ? offset : 0), size };
      const key = edgeKey(edge);
      if (board.wires.has(key)) throw new Error(`${path} duplicates a wire.`);
      if (blockedEdges.has(key)) throw new Error(`${path} is blocked by a component.`);
      board.wires.set(key, edge);
      wireIndexes.set(key, index);
      for (const [px, py] of edgePoints(edge)) {
        const point = `${px},${py}`;
        if (!wiresByPoint.has(point)) wiresByPoint.set(point, []);
        wiresByPoint.get(point).push(edge);
      }
    }
  }
  return { wireIndexes, wiresByPoint };
}

function parseJunctions(board, junctions, wiresByPoint) {
  for (const [index, raw] of junctions.entries()) {
    const path = `junctions[${index}]`;
    if (!Array.isArray(raw) || raw.length !== 2) throw new Error(`${path} must be [x, y].`);
    const [x, y] = raw;
    coordinate(x, `${path}[0]`);
    coordinate(y, `${path}[1]`);
    const key = `${x},${y}`;
    if (!isCrossing(wiresByPoint.get(key) ?? []) || board.junctions.has(key))
      throw new Error(`${path} is not a unique crossing.`);
    board.junctions.add(key);
  }
}

function validateWireSizes(board, { wireIndexes, wiresByPoint }, pinSizes) {
  for (const edge of board.wires.values()) {
    const index = wireIndexes.get(edgeKey(edge));
    for (const [x, y] of edgePoints(edge)) {
      const point = `${x},${y}`;
      const pins = pinSizes.get(point);
      const connected = connectedAtPoint(wiresByPoint.get(point), edge, {
        junction: board.junctions.has(point), pin: !!pins,
      });
      const mismatched = connected.find((wire) => wireSize(wire) !== edge.size);
      if (mismatched) {
        const later = Math.max(index, wireIndexes.get(edgeKey(mismatched)));
        throw new Error(`wires[${later}] has a bus size mismatch.`);
      }
      if (pins && (pins.size !== 1 || !pins.has(edge.size)))
        throw new Error(`wires[${index}] has a bus size mismatch.`);
    }
  }
}

function parseDocumentData(data, depth) {
  object(data, "Document", ["components", "wires", "junctions", "monitor", "program"]);
  if (!Array.isArray(data.components)) throw new Error("Document.components must be an array.");
  if (!Array.isArray(data.wires)) throw new Error("Document.wires must be an array.");
  if (!Array.isArray(data.junctions))
    throw new Error("Document.junctions must be an array.");
  const board = createBoard();
  parseComponents(board, data.components, depth);
  if (data.monitor !== undefined) parseMonitor(board, data.monitor);
  if (data.program !== undefined) parseProgram(board, data.program);
  const blockedEdges = blockedEdgeKeys(board);
  const pinSizes = pinSizesByPoint(board);
  const wireIndex = parseWires(board, data.wires, blockedEdges);
  parseJunctions(board, data.junctions, wireIndex.wiresByPoint);
  validateWireSizes(board, wireIndex, pinSizes);
  const conflict = shortCircuitError(board);
  if (conflict) throw new Error(conflict);
  return { board };
}

// Nested module documents are validated with the same parser.
export { parseDocumentData };
