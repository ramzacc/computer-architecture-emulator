import { bitWidth, channelCount, DEFAULT_CLOCK_FREQUENCY, dimsOf, isSizable, pinsFor, spec, validBitWidth, validChannelCount, validClockFrequency, validConstant, validSplitterOrder } from "./components.js";
import { validValueFormat } from "./value-format.js";

export function createBoard() {
  return { components: [], wires: new Map() };
}

export function edgeKey({ o, x, y }) {
  return `${o}:${x},${y}`;
}

export function edgePoints(edge) {
  const { o, x, y } = edge;
  return o === "H" ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
}

export function edgeInBounds(board, edge) {
  // Board coordinates are unbounded; only the orientation must be valid.
  return edge.o === "H" || edge.o === "V";
}

export function componentAt(board, x, y, ignoreId) {
  return board.components.find((component) => {
    if (component.id === ignoreId) return false;
    const { w, h } = dimsOf(component);
    return x >= component.x && x < component.x + w && y >= component.y && y < component.y + h;
  });
}

function validComponentProperties(component) {
  const size = dimsOf(component);
  if (!size || !Number.isSafeInteger(component.x) || !Number.isSafeInteger(component.y) ||
      !validBitWidth(bitWidth(component)) ||
      ((component.t === "mux" || component.t === "demux") && !validChannelCount(channelCount(component))) ||
      (component.t === "splitter" && !validSplitterOrder(component.order ?? "ascendant")) ||
      (component.t === "clock" && !validClockFrequency(component.frequency ?? DEFAULT_CLOCK_FREQUENCY)) ||
      (component.t === "clock" && component.enable !== undefined && typeof component.enable !== "boolean") ||
      (component.t === "constant" && !validConstant(component)) ||
      (component.t === "switch" && ![0, 1].includes(component.value ?? 0))) return false;
  return true;
}

export function isValidComponent(board, component) {
  if (!validComponentProperties(component)) return false;
  const size = dimsOf(component);
  for (let y = component.y; y < component.y + size.h; y++) {
    for (let x = component.x; x < component.x + size.w; x++) {
      if (componentAt(board, x, y, component.id)) return false;
    }
  }
  for (const wire of board.wires.values()) {
    const mx = wire.x + (wire.o === "H" ? 0.5 : 0);
    const my = wire.y + (wire.o === "V" ? 0.5 : 0);
    if (mx > component.x && mx < component.x + size.w &&
        my > component.y && my < component.y + size.h) return false;
  }
  return !pinsFor(component).some((pin) => wiresAtPoint(board, pin.px, pin.py).some((wire) =>
    wireSize(wire) !== pin.size)) && !shortCircuitError(board);
}

export function addComponent(board, component) {
  if (!isValidComponent(board, component)) return false;
  board.components.push(component);
  if (shortCircuitError(board)) {
    board.components.pop();
    return false;
  }
  return true;
}

function edgeBlocked(board, edge) {
  const mx = edge.x + (edge.o === "H" ? 0.5 : 0);
  const my = edge.y + (edge.o === "V" ? 0.5 : 0);
  return board.components.some((component) => {
    const { w, h } = dimsOf(component);
    return mx > component.x && mx < component.x + w && my > component.y && my < component.y + h;
  });
}

export function wireSize(wire) { return wire.size ?? 1; }

function wiresAtPoint(board, x, y) {
  return [...board.wires.values()].filter((wire) => edgePoints(wire).some((p) => p[0] === x && p[1] === y));
}

function pinsAtPoint(board, x, y) {
  return board.components.flatMap((component) => pinsFor(component)
    .filter((pin) => pin.px === x && pin.py === y)
    .map((pin) => pin.size));
}

export function edgePlacementError(board, edge) {
  if (!edgeInBounds(board, edge) || !Number.isSafeInteger(edge.x) || !Number.isSafeInteger(edge.y) ||
      !validBitWidth(wireSize(edge))) return "Wire size must be 1–32 bits.";
  if (edgeBlocked(board, edge)) return "Wire is blocked by a component.";
  if (board.wires.has(edgeKey(edge))) return "Wire already exists here.";
  const points = edgePoints(edge);
  const touching = points.flatMap(([x, y]) => wiresAtPoint(board, x, y));
  const pins = points.flatMap(([x, y]) => pinsAtPoint(board, x, y));
  if (touching.some((wire) => wireSize(wire) !== wireSize(edge)) ||
      pins.some((size) => size !== wireSize(edge))) return "Bus size mismatch.";
  const key = edgeKey(edge);
  board.wires.set(key, { ...edge, size: wireSize(edge) });
  const conflict = shortCircuitError(board);
  board.wires.delete(key);
  if (conflict) return conflict;
  return null;
}

export function canPlaceEdge(board, edge) {
  return edgePlacementError(board, edge) === null;
}

export function addWireEdge(board, edge) {
  if (!canPlaceEdge(board, edge)) return false;
  board.wires.set(edgeKey(edge), { ...edge, size: wireSize(edge) });
  return true;
}

// Build one continuous orthogonal run. Try the other corner when the first
// bend would cross a component or a differently sized net.
export function wireRoute(board, start, end, size) {
  const distance = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  if (!Number.isSafeInteger(start.x) || !Number.isSafeInteger(start.y) ||
      !Number.isSafeInteger(end.x) || !Number.isSafeInteger(end.y) ||
      !validBitWidth(size)) return { edges: [], error: "Invalid wire route." };
  if (distance > 256) return { edges: [], error: "Route is too long; add a corner closer by." };

  const build = (horizontalFirst) => {
    const edges = [];
    let { x, y } = start;
    const step = (axis, target) => {
      while ((axis === "x" ? x : y) !== target) {
        const direction = Math.sign(target - (axis === "x" ? x : y));
        edges.push(axis === "x"
          ? { o: "H", x: direction > 0 ? x : x - 1, y, size }
          : { o: "V", x, y: direction > 0 ? y : y - 1, size });
        if (axis === "x") x += direction;
        else y += direction;
      }
    };
    if (horizontalFirst) { step("x", end.x); step("y", end.y); }
    else { step("y", end.y); step("x", end.x); }
    return edges;
  };

  let firstError = null;
  for (const horizontalFirst of [true, false]) {
    const edges = build(horizontalFirst);
    const trial = { ...board, wires: new Map(board.wires) };
    let error = null;
    for (const edge of edges) {
      const existing = trial.wires.get(edgeKey(edge));
      if (existing) {
        if (wireSize(existing) !== size) { error = "Bus size mismatch."; break; }
      } else {
        error = edgePlacementError(trial, edge);
        if (error) break;
        trial.wires.set(edgeKey(edge), edge);
      }
    }
    if (!error) return { edges, error: null };
    firstError ??= error;
  }
  return { edges: build(true), error: firstError };
}

export function sanitizeWires(board) {
  for (const [key, edge] of board.wires) {
    if (!edgeInBounds(board, edge) || !validBitWidth(wireSize(edge)) ||
        edgeBlocked(board, edge) ||
        edgePoints(edge).some(([x, y]) => pinsAtPoint(board, x, y).some((size) => size !== wireSize(edge)))) {
      board.wires.delete(key);
    }
  }
}

const GATE_OPS = {
  and: (a, b) => a & b,
  or: (a, b) => a | b,
  xor: (a, b) => a ^ b,
  nand: (a, b) => ~(a & b),
  nor: (a, b) => ~(a | b),
  xnor: (a, b) => ~(a ^ b),
  not: (a) => ~a,
};

function bitMask(size) { return size === 32 ? 0xffffffff : (2 ** size - 1); }

function blockOutputs(kind, inputs, size, channels = 2) {
  const mask = bitMask(size) >>> 0;
  const [a = 0, b = 0, control = 0] = inputs;
  const left = (a & mask) >>> 0;
  const right = (b & mask) >>> 0;
  switch (kind) {
    case "mux": {
      const selected = inputs[channels] ?? 0;
      return [selected < channels ? ((inputs[selected] ?? 0) & mask) >>> 0 : 0];
    }
    case "demux": return Array.from({ length: channels }, (_, index) =>
      (b === index ? left : 0));
    case "adder": {
      const sum = left + right + (control & 1);
      return [Number(sum > mask), (sum & mask) >>> 0];
    }
    case "twos": return [(-left & mask) >>> 0];
    case "comparator": return [Number(left < right), Number(left === right), Number(left > right)];
    case "shl": return [((left << (b & 31)) & mask) >>> 0];
    case "shr": return [(left >>> (b & 31)) >>> 0];
    default: return [];
  }
}

function buildUnionFind(board) {
  const parent = new Map();
  const find = (point) => {
    while (parent.get(point) !== point) {
      parent.set(point, parent.get(parent.get(point)));
      point = parent.get(point);
    }
    return point;
  };
  const union = (a, b) => {
    const rootA = find(a), rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  for (const edge of board.wires.values()) {
    const [a, b] = edgePoints(edge).map((point) => point.join(","));
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    union(a, b);
  }
  return { parent, find };
}

// Solve the board to a fixed point: nets carry a value, each component's
// output (or LED) follows from its inputs. Oscillating feedback is reported
// to callers so edits can reject it.
export function evaluateBoard(board, pressedButtons = new Set(), highClocks = new Set(), registerValues = new Map()) {
  const { parent, find } = buildUnionFind(board);
  const nets = new Map();
  for (const edge of board.wires.values()) {
    const root = find(edgePoints(edge)[0].join(","));
    if (!nets.has(root)) nets.set(root, { id: root, edges: [], size: wireSize(edge), value: 0, on: false });
    nets.get(root).edges.push(edge);
  }

  const netAt = (pin) => {
    const point = `${pin.px},${pin.py}`;
    return parent.has(point) ? find(point) : null;
  };
  const parts = board.components.map((component) => {
    const entry = spec(component.t);
    const pins = pinsFor(component);
    return {
      id: component.id,
      op: entry.op,
      momentary: !!entry.momentary,
      toggle: !!entry.toggle,
      clock: !!entry.clock,
      clockEnabled: component.enable !== false,
      register: !!entry.register,
      storedValue: (registerValues.get(component.id) ?? 0) & bitMask(bitWidth(component)),
      constant: !!entry.constant,
      constantValue: component.value ?? 0,
      output: !!entry.output,
      debug: !!entry.debug,
      splitter: !!entry.splitter,
      block: entry.block,
      channels: channelCount(component),
      size: bitWidth(component),
      ins: pins.filter((pin) => pin.role === "in").map(netAt),
      outs: pins.filter((pin) => pin.role === "out")
        .sort((a, b) => (a.bit ?? 0) - (b.bit ?? 0)).map(netAt),
    };
  });
  const outputOf = (part, values) => {
    if (part.constant) return part.constantValue;
    if (part.momentary) return Number(pressedButtons.has(part.id));
    if (part.toggle) return part.constantValue;
    if (part.clock) return Number(part.clockEnabled && highClocks.has(part.id));
    if (part.register) return part.storedValue >>> 0;
    if (part.block) {
      const inputs = part.ins.map((root) => root === null ? 0 : (values.get(root) ?? 0));
      const outputs = blockOutputs(part.block, inputs, part.size, part.channels);
      return outputs[part.block === "adder" ? 1 : 0];
    }
    if (part.splitter) {
      const bus = part.ins[0] === null ? 0 : (values.get(part.ins[0]) ?? 0);
      return part.outs.reduce((value, root, bit) =>
        value | (((root === null ? 0 : (values.get(root) ?? 0)) & 1) << bit), bus) >>> 0;
    }
    if (!part.op) return 0;
    const [a, b] = part.ins.map((root) => root === null ? 0 : (values.get(root) ?? 0));
    return (GATE_OPS[part.op](a, b) & bitMask(part.size)) >>> 0;
  };

  let values = new Map();
  let settled = false;
  for (let round = 0; round <= board.components.length; round++) {
    const next = new Map();
    const drive = (root, output) => {
      if (root !== null && output) next.set(root, ((next.get(root) ?? 0) | output) >>> 0);
    };
    for (const part of parts) {
      if (part.splitter) {
        const bus = part.ins[0] === null ? 0 : (values.get(part.ins[0]) ?? 0);
        let combined = 0;
        part.outs.forEach((root, bit) => {
          const branch = root === null ? 0 : (values.get(root) ?? 0);
          combined |= (branch & 1) << bit;
          drive(root, (bus >>> bit) & 1);
        });
        drive(part.ins[0], combined >>> 0);
      } else if (part.block) {
        const inputs = part.ins.map((root) => root === null ? 0 : (values.get(root) ?? 0));
        blockOutputs(part.block, inputs, part.size, part.channels).forEach((output, index) => drive(part.outs[index], output));
      } else {
        const output = outputOf(part, values);
        for (const root of part.outs) drive(root, output);
      }
    }
    let stable = next.size === values.size;
    if (stable) for (const [root, value] of next) {
      if (values.get(root) !== value) { stable = false; break; }
    }
    values = next;
    if (stable) { settled = true; break; }
  }

  const states = new Map();
  for (const part of parts) {
    const inputs = part.ins.map((root) => root === null ? 0 : (values.get(root) ?? 0));
    const value = part.output || part.debug ? inputs[0] : outputOf(part, values);
    const outputs = part.block ? blockOutputs(part.block, inputs, part.size, part.channels)
      : part.splitter ? part.outs.map((_, bit) => (value >>> bit) & 1)
      : part.outs.map(() => value);
    states.set(part.id, {
      inputs,
      value,
      outputs,
      lit: inputs.length === 1 && inputs[0] !== 0,
    });
  }
  for (const net of nets.values()) {
    net.value = values.get(net.id) ?? 0;
    net.on = net.value !== 0;
  }
  return { nets, states, settled };
}

// Each splitter branch is electrically the corresponding bit of its bus.
// Compare actual output drivers after evaluation, including drivers connected
// through splitters; a driven zero must count just as much as a driven one.
export function shortCircuitError(board, pressedButtons) {
  const { nets, states, settled } = evaluateBoard(board, pressedButtons);
  if (!settled) return "Short circuit: feedback loop does not settle.";
  const parent = new Map();
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key);
    if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
    return parent.get(key);
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  const pointNets = new Map();
  for (const net of nets.values()) for (const edge of net.edges) {
    for (const point of edgePoints(edge)) pointNets.set(point.join(","), net.id);
  }
  const netAt = (pin) => pointNets.get(`${pin.px},${pin.py}`);
  const bitKey = (net, bit) => `${net}:${bit}`;
  for (const component of board.components) {
    if (component.t !== "splitter") continue;
    const [bus, ...branches] = pinsFor(component);
    const busNet = netAt(bus);
    if (busNet === undefined) continue;
    for (const branch of branches) {
      const branchNet = netAt(branch);
      if (branchNet !== undefined) union(bitKey(busNet, branch.bit), bitKey(branchNet, 0));
    }
  }
  const driven = new Map();
  for (const component of board.components) {
    const entry = spec(component.t);
    if (!entry?.momentary && !entry?.toggle && !entry?.clock && !entry?.constant && !entry?.op && !entry?.block && !entry?.register) continue;
    const outputs = states.get(component.id).outputs;
    for (const [index, pin] of pinsFor(component).filter((item) => item.role === "out").entries()) {
      const net = netAt(pin);
      if (net === undefined) continue;
      for (let bit = 0; bit < pin.size; bit++) {
        const key = find(bitKey(net, bit));
        const level = (outputs[index] >>> bit) & 1;
        const previous = driven.get(key);
        if (previous?.level !== undefined && previous.level !== level)
          return "Short circuit: HIGH and LOW outputs are connected.";
        if (previous && (previous.clock || entry.clock))
          return "Short circuit: a clock output cannot share a driven net.";
        if (previous && (previous.register || entry.register))
          return "Short circuit: a register output cannot share a driven net.";
        driven.set(key, { level, clock: !!entry.clock, register: !!entry.register });
      }
    }
  }
  return null;
}

export function computeNets(board) {
  return evaluateBoard(board).nets;
}

export function netContaining(board, key, evaluation = evaluateBoard(board)) {
  for (const net of evaluation.nets.values()) {
    if (net.edges.some((edge) => edgeKey(edge) === key)) return net;
  }
  return null;
}

export function resizeNet(board, key, size) {
  if (!validBitWidth(size)) return false;
  const net = netContaining(board, key);
  if (!net) return false;
  if (net.edges.some((edge) => edgePoints(edge).some(([x, y]) =>
    pinsAtPoint(board, x, y).some((pinSize) => pinSize !== size)))) return false;
  for (const edge of net.edges) board.wires.get(edgeKey(edge)).size = size;
  if (shortCircuitError(board)) {
    for (const edge of net.edges) board.wires.get(edgeKey(edge)).size = net.size;
    return false;
  }
  return true;
}

export function netInfoByEdgeKey(board) {
  const info = new Map();
  for (const net of computeNets(board).values()) {
    for (const edge of net.edges) info.set(edgeKey(edge), { on: net.on, value: net.value, size: net.size, netId: net.id });
  }
  return info;
}

// Numeric values are stored in component tuples; keep this order stable.
const DOCUMENT_FORMATS = ["decimal", "binary", "hex"];
const DOCUMENT_FIELD_CACHE = new Map();

// Every component starts with [type, x, y, rotation]. The remaining fields
// follow this shared layout so adding a component property changes one place.
function documentFields(t) {
  if (DOCUMENT_FIELD_CACHE.has(t)) return DOCUMENT_FIELD_CACHE.get(t);
  const fields = [
    ...(isSizable({ t }) ? ["size"] : []),
    ...(t === "constant" || t === "switch" ? ["value"] : []),
    ...(t === "clock" ? ["frequency", "enable"] : []),
    ...(t === "splitter" ? ["order"] : []),
    ...(t === "mux" || t === "demux" ? ["channels"] : []),
    ...(t === "constant" || t === "output" ? ["format"] : []),
  ];
  DOCUMENT_FIELD_CACHE.set(t, fields);
  return fields;
}

function documentValue(component, field) {
  switch (field) {
    case "size": return component.size ?? 1;
    case "value": return component.value ?? 0;
    case "frequency": return component.frequency ?? DEFAULT_CLOCK_FREQUENCY;
    case "enable": return component.enable !== false;
    case "order": return component.order === "descendant" ? 1 : 0;
    case "channels": return component.channels ?? 2;
    case "format": return DOCUMENT_FORMATS.indexOf(component.format ?? "decimal");
  }
}

export function serialize(board) {
  return JSON.stringify({
    components: board.components.map((component) => {
      const { t, x, y, r, size, value, format, order, channels, frequency, enable } = component;
      if (!spec(t) || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
          (r !== undefined && (!Number.isInteger(r) || r < 0 || r > 3)) ||
          (isSizable({ t }) && !validBitWidth(size ?? 1)) ||
          (t === "constant" && !validConstant({ t, size, value })) ||
          (t === "switch" && ![0, 1].includes(value ?? 0)) ||
          (t === "clock" && !validClockFrequency(frequency ?? DEFAULT_CLOCK_FREQUENCY)) ||
          (t === "clock" && enable !== undefined && typeof enable !== "boolean") ||
          (t === "splitter" && !validSplitterOrder(order ?? "ascendant")) ||
          ((t === "mux" || t === "demux") && !validChannelCount(channels ?? 2)) ||
          (format !== undefined && (!["constant", "output"].includes(t) || !validValueFormat(format))))
        throw new Error(`Cannot serialize invalid ${String(t)} component.`);
      return [t, x, y, r ?? 0, ...documentFields(t).map((field) => documentValue(component, field))];
    }),
    wires: [...board.wires.values()].map(({ o, x, y, size }) => {
      if ((o !== "H" && o !== "V") || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
          !validBitWidth(size ?? 1)) throw new Error("Cannot serialize invalid wire.");
      return [o, x, y, size ?? 1];
    }),
  });
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
export function parseDocument(text) {
  const data = JSON.parse(text);
  object(data, "Document", ["components", "wires"]);
  if (!Array.isArray(data.components)) throw new Error("Document.components must be an array.");
  if (!Array.isArray(data.wires)) throw new Error("Document.wires must be an array.");
  const board = createBoard();
  const occupied = new Set();
  for (const [index, raw] of data.components.entries()) {
    const path = `components[${index}]`;
    if (!Array.isArray(raw)) throw new Error(`${path} must be a component tuple.`);
    const [t, x, y, r] = raw;
    if (typeof t !== "string" || !spec(t)) throw new Error(`${path}.t is unknown.`);
    const fields = documentFields(t);
    const legacyClock = t === "clock" && raw.length === 5;
    if (raw.length !== 4 + fields.length && !legacyClock)
      throw new Error(`${path} must have ${4 + fields.length} entries.`);
    coordinate(x, `${path}[1]`);
    coordinate(y, `${path}[2]`);
    if (!Number.isInteger(r) || r < 0 || r > 3) throw new Error(`${path}[3] must be 0–3.`);
    const component = { id: `c${index + 1}`, t, x, y, r };
    for (const [offset, field] of fields.entries()) {
      const value = raw[4 + offset];
      const fieldPath = `${path}[${4 + offset}]`;
      if (field === "size" && !validBitWidth(value)) throw new Error(`${fieldPath} must be 1–32.`);
      if (field === "value" && !Number.isInteger(value)) throw new Error(`${fieldPath} must be an integer.`);
      if (field === "frequency" && !validClockFrequency(value)) throw new Error(`${fieldPath} is an invalid frequency.`);
      if (field === "enable" && typeof value !== "boolean" && !legacyClock)
        throw new Error(`${fieldPath} must be a boolean.`);
      if (field === "order" && value !== 0 && value !== 1) throw new Error(`${fieldPath} is an invalid order.`);
      if (field === "channels" && !validChannelCount(value)) throw new Error(`${fieldPath} is an invalid channel count.`);
      if (field === "format" && (!Number.isInteger(value) || value < 0 || value >= DOCUMENT_FORMATS.length))
        throw new Error(`${fieldPath} is an invalid value format.`);
      if (field === "order") component.order = value ? "descendant" : "ascendant";
      else if (field === "format") {
        if (value) component.format = DOCUMENT_FORMATS[value];
      } else component[field] = field === "enable" && legacyClock ? true : value;
    }
    if (!validComponentProperties(component)) throw new Error(`${path} is invalid.`);
    const { w, h } = dimsOf(component);
    for (let y = component.y; y < component.y + h; y++) for (let x = component.x; x < component.x + w; x++) {
      const key = `${x},${y}`;
      if (occupied.has(key)) throw new Error(`${path} overlaps another component.`);
      occupied.add(key);
    }
    board.components.push(component);
  }
  const blockedEdges = new Set();
  const pinSizes = new Map();
  for (const component of board.components) {
    const { w, h } = dimsOf(component);
    for (let y = component.y + 1; y < component.y + h; y++)
      for (let x = component.x; x < component.x + w; x++) blockedEdges.add(`H:${x},${y}`);
    for (let x = component.x + 1; x < component.x + w; x++)
      for (let y = component.y; y < component.y + h; y++) blockedEdges.add(`V:${x},${y}`);
    for (const pin of pinsFor(component)) {
      const key = `${pin.px},${pin.py}`;
      if (!pinSizes.has(key)) pinSizes.set(key, new Set());
      pinSizes.get(key).add(pin.size);
    }
  }
  const pointWidths = new Map();
  for (const [index, raw] of data.wires.entries()) {
    const path = `wires[${index}]`;
    if (!Array.isArray(raw) || raw.length !== 4) throw new Error(`${path} must be [orientation, x, y, size].`);
    const [o, x, y, size] = raw;
    if (o !== "H" && o !== "V") throw new Error(`${path}[0] must be H or V.`);
    coordinate(x, `${path}[1]`);
    coordinate(y, `${path}[2]`);
    if (!validBitWidth(size)) throw new Error(`${path}[3] must be 1–32.`);
    const edge = { o, x, y, size };
    const key = edgeKey(edge);
    if (board.wires.has(key)) throw new Error(`${path} duplicates a wire.`);
    if (blockedEdges.has(key)) throw new Error(`${path} is blocked by a component.`);
    for (const point of edgePoints(edge)) {
      const pointKey = point.join(",");
      const pins = pinSizes.get(pointKey);
      if ((pointWidths.has(pointKey) && pointWidths.get(pointKey) !== size) ||
          (pins && (pins.size !== 1 || !pins.has(size))))
        throw new Error(`${path} has a bus size mismatch.`);
      pointWidths.set(pointKey, size);
    }
    board.wires.set(key, edge);
  }
  const conflict = shortCircuitError(board);
  if (conflict) throw new Error(conflict);
  return { board };
}
