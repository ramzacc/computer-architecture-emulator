// Fixed component registry. Gate instances may also persist a bit width.
//
// These are real logic-level parts: inputs, an LED, and gates that read
// their inputs and drive an output. Gates use top-to-bottom signal flow;
// bit-row sources and outputs connect from the left or right.
//
// Pins are declared per component in unrotated local lattice coordinates:
//   dir  = outward normal ("N" | "E" | "S" | "W").
//   role = "in" (reads the net) or "out" (drives the net).
// A pin must sit on the interior of one side, never on a corner (a corner has
// no single outward normal). Concretely: N/S pins need 0 < x < w; E/W pins
// need 0 < y < h. So 1-tall parts carry N/S pins and 1-wide parts carry W/E.
export const COMPONENT_TYPES = {
  module: {
    label: "Module", w: 4, h: 3, color: "#aaa8b1", shape: "module", module: true,
    pins: [],
  },
  button: {
    label: "Button", w: 2, h: 2, color: "#b4b1aa", shape: "button", momentary: true,
    pins: [
      { x: 1, y: 2, dir: "S", role: "out" },
    ],
  },
  switch: {
    label: "Toggle switch", w: 2, h: 2, color: "#b4b1aa", shape: "switch", toggle: true,
    pins: [{ x: 1, y: 2, dir: "S", role: "out" }],
  },
  clock: {
    label: "Clock", w: 2, h: 2, color: "#b4b1aa", shape: "clock", clock: true,
    pins: [
      { x: 1, y: 2, dir: "S", role: "out" },
    ],
  },
  register: {
    label: "Register", w: 4, h: 3, color: "#aaa8b1", shape: "register", register: true,
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "D" },
      { x: 3, y: 0, dir: "N", role: "in", name: "CLK", size: 1 },
      { x: 2, y: 3, dir: "S", role: "out", name: "Q" },
      { x: 0, y: 1, dir: "W", role: "in", name: "RESET", size: 1 },
    ],
  },
  rom: {
    label: "ROM", w: 4, h: 3, color: "#aaa8b1", shape: "rom", rom: true,
    pins: [
      { x: 2, y: 0, dir: "N", role: "in", name: "ADDR" },
      { x: 2, y: 3, dir: "S", role: "out", name: "DATA" },
    ],
  },
  ram: {
    label: "RAM", w: 4, h: 3, color: "#aaa8b1", shape: "ram", ram: true,
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "ADDR" },
      { x: 2, y: 0, dir: "N", role: "in", name: "DIN" },
      { x: 3, y: 0, dir: "N", role: "in", name: "WR", size: 1 },
      { x: 2, y: 3, dir: "S", role: "out", name: "DATA" },
    ],
  },
  counter: {
    label: "Counter", w: 4, h: 3, color: "#aaa8b1", shape: "counter", counter: true,
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "CLK", size: 1 },
      { x: 3, y: 0, dir: "N", role: "in", name: "RST", size: 1 },
      { x: 2, y: 3, dir: "S", role: "out", name: "Q" },
    ],
  },
  constant: {
    label: "Constant", w: 2, h: 2, color: "#b4b1aa", shape: "constant", constant: true,
    pins: [{ x: 0, y: 1, dir: "W", role: "out" }],
  },
  input: {
    label: "Input", w: 2, h: 2, color: "#b4b1aa", shape: "input", input: true,
    pins: [{ x: 0, y: 1, dir: "W", role: "out" }],
  },
  output: {
    label: "Output", w: 2, h: 2, color: "#c8b49b", shape: "output", output: true,
    pins: [{ x: 0, y: 1, dir: "W", role: "in" }],
  },
  portal: {
    label: "Portal", w: 3, h: 2, color: "#afb2b9", shape: "portal", portal: true,
    pins: [{ x: 0, y: 1, dir: "W", role: "in" }],
  },
  tag: {
    label: "Tag", w: 4, h: 2, color: "#afb2b9", shape: "tag", tag: true,
    pins: [{ x: 0, y: 1, dir: "W", role: "in" }],
  },
  led: {
    label: "LED", w: 2, h: 2, color: "#c8b49b", shape: "led",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
    ],
  },
  sevenseg: {
    label: "Seven-segment", w: 6, h: 5, color: "#c8b49b", shape: "sevenseg",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "A" },
      { x: 2, y: 0, dir: "N", role: "in", name: "B" },
      { x: 4, y: 0, dir: "N", role: "in", name: "C" },
      { x: 5, y: 0, dir: "N", role: "in", name: "D" },
      { x: 1, y: 5, dir: "S", role: "in", name: "E" },
      { x: 3, y: 5, dir: "S", role: "in", name: "F" },
      { x: 5, y: 5, dir: "S", role: "in", name: "G" },
    ],
  },
  debugdisplay: {
    label: "Debug display", w: 4, h: 4, color: "#c8b49b", shape: "debugdisplay", debug: true,
    pins: [{ x: 2, y: 0, dir: "N", role: "in", name: "HEX", size: 4 }],
  },
  and: {
    label: "AND", w: 4, h: 2, color: "#b9bec8", shape: "and", op: "and",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
  or: {
    label: "OR", w: 4, h: 2, color: "#b9bec8", shape: "or", op: "or",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
  xor: {
    label: "XOR", w: 4, h: 2, color: "#b9bec8", shape: "xor", op: "xor",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
  not: {
    label: "NOT", w: 2, h: 2, color: "#b9bec8", shape: "not", op: "not",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 1, y: 2, dir: "S", role: "out" },
    ],
  },
  splitter: {
    label: "Splitter", w: 2, h: 2, color: "#afb2b9", shape: "splitter", splitter: true,
    pins: [],
  },
  nand: {
    label: "NAND", w: 4, h: 2, color: "#b9bec8", shape: "nand", op: "nand",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
  nor: {
    label: "NOR", w: 4, h: 2, color: "#b9bec8", shape: "nor", op: "nor",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
  xnor: {
    label: "XNOR", w: 4, h: 2, color: "#b9bec8", shape: "xnor", op: "xnor",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
  mux: {
    label: "Multiplexer", w: 6, h: 3, color: "#aaa8b1", shape: "mux", block: "mux",
    pins: [], // Generated from the instance's channel count in pinsFor.
  },
  demux: {
    label: "Demultiplexer", w: 4, h: 3, color: "#aaa8b1", shape: "demux", block: "demux",
    pins: [], // Generated from the instance's channel count in pinsFor.
  },
  adder: {
    label: "Adder", w: 6, h: 3, color: "#aaa8b1", shape: "adder", block: "adder",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "A" },
      { x: 3, y: 0, dir: "N", role: "in", name: "B" },
      { x: 5, y: 0, dir: "N", role: "in", name: "CI", size: 1 },
      { x: 1, y: 3, dir: "S", role: "out", name: "CO", size: 1 },
      { x: 3, y: 3, dir: "S", role: "out", name: "SUM" },
    ],
  },
  sub: {
    label: "Subtractor", w: 6, h: 3, color: "#aaa8b1", shape: "sub", block: "sub",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "A" },
      { x: 3, y: 0, dir: "N", role: "in", name: "B" },
      { x: 5, y: 0, dir: "N", role: "in", name: "BI", size: 1 },
      { x: 1, y: 3, dir: "S", role: "out", name: "BO", size: 1 },
      { x: 3, y: 3, dir: "S", role: "out", name: "DIFF" },
    ],
  },
  twos: {
    label: "Two's complement", w: 2, h: 2, color: "#aaa8b1", shape: "twos", block: "twos",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "A" },
      { x: 1, y: 2, dir: "S", role: "out", name: "−A" },
    ],
  },
  comparator: {
    label: "Comparator", w: 4, h: 3, color: "#aaa8b1", shape: "comparator", block: "comparator",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "A" },
      { x: 3, y: 0, dir: "N", role: "in", name: "B" },
      { x: 1, y: 3, dir: "S", role: "out", name: "LT", size: 1 },
      { x: 2, y: 3, dir: "S", role: "out", name: "EQ", size: 1 },
      { x: 3, y: 3, dir: "S", role: "out", name: "GT", size: 1 },
    ],
  },
  shl: {
    label: "Shift left", w: 4, h: 2, color: "#aaa8b1", shape: "shl", block: "shl",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "A" },
      { x: 3, y: 0, dir: "N", role: "in", name: "N", size: 5 },
      { x: 2, y: 2, dir: "S", role: "out", name: "Y" },
    ],
  },
  shr: {
    label: "Shift right", w: 4, h: 2, color: "#aaa8b1", shape: "shr", block: "shr",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in", name: "A" },
      { x: 3, y: 0, dir: "N", role: "in", name: "N", size: 5 },
      { x: 2, y: 2, dir: "S", role: "out", name: "Y" },
    ],
  },
};

// Orientation is a quarter-turn count: 0 = 0deg, 1 = 90deg CW, 2 = 180deg,
// 3 = 270deg CW. Every component can face all four directions.
const DIRECTIONS = ["N", "E", "S", "W"];

export function normalizeRotation(r) {
  const q = Math.trunc(Number(r) || 0) % 4;
  return q < 0 ? q + 4 : q;
}

export const MAX_BUS_WIDTH = 32;
export const MAX_PLEXER_CHANNELS = 16;
export const DEFAULT_CLOCK_FREQUENCY = 1;

export function validClockFrequency(frequency) {
  return Number.isFinite(frequency) && frequency >= 0.1 && frequency <= 20;
}

export function channelCount(component) {
  return component.channels ?? 2;
}

export function validChannelCount(channels) {
  return Number.isInteger(channels) && channels >= 1 && channels <= MAX_PLEXER_CHANNELS;
}

export function selectWidth(component) {
  return Math.max(1, Math.ceil(Math.log2(channelCount(component))));
}

export function isSizable(component) {
  const entry = spec(component.t);
  return !!(entry?.op || entry?.block || entry?.register || entry?.rom || entry?.ram || entry?.counter || entry?.splitter || entry?.constant || entry?.input || entry?.output || entry?.portal || entry?.tag);
}

const DOCUMENT_FIELDS = {
  constant: ["size", "value", "format"],
  input: ["size", "value", "format"],
  output: ["size", "format"],
  portal: ["size"],
  rom: ["size", "addressSize", "data"],
  ram: ["size", "addressSize"],
  clock: ["frequency", "enable"],
  switch: ["value"],
  splitter: ["size", "order"],
  mux: ["size", "channels"],
  demux: ["size", "channels"],
  module: ["module", "pinLayout", "faceLayout", "moduleWidth", "moduleHeight"],
};

export function documentFields(type) {
  return [...(DOCUMENT_FIELDS[type] ?? (isSizable({ t: type }) ? ["size"] : [])), "label"];
}

function tupleField(tuple, field) {
  const index = documentFields(tuple[0]).indexOf(field);
  return index < 0 ? undefined : tuple[4 + index];
}

// A module's interface follows the order of its Input and Output parts.
export function modulePorts(component) {
  return (component.module?.components ?? []).flatMap((part, index) => {
    if (!Array.isArray(part) || !["input", "output"].includes(part[0])) return [];
    return [{ id: `c${index + 1}`, role: part[0] === "input" ? "in" : "out",
      size: tupleField(part, "size"), name: tupleField(part, "label") }];
  });
}

export const MODULE_FACE_TYPES = new Set(["led", "sevenseg", "debugdisplay", "output", "button"]);

export function moduleFaceParts(component) {
  return (component.module?.components ?? []).flatMap((part, index) =>
    Array.isArray(part) && MODULE_FACE_TYPES.has(part[0])
      ? [{ id: `c${index + 1}`, index, type: part[0],
        label: tupleField(part, "label") }]
      : []);
}

export function validModuleFaceLayout(component) {
  if (component.faceLayout === undefined) return true;
  if (!Array.isArray(component.faceLayout)) return false;
  const parts = new Set(moduleFaceParts(component).map((part) => part.index));
  const usedParts = new Set(), usedCells = new Set();
  return component.faceLayout.every((item) => {
    if (!Array.isArray(item) || item.length !== 3) return false;
    const [index, x, y] = item;
    if (!Number.isInteger(index) || !parts.has(index) || usedParts.has(index) ||
        !Number.isInteger(x) || x < 1 || x > 19 ||
        !Number.isInteger(y) || y < 2 || y > 32 ||
        usedCells.has(`${x}:${y}`)) return false;
    usedParts.add(index);
    usedCells.add(`${x}:${y}`);
    return true;
  });
}

export function validModuleSize(component) {
  return (component.moduleWidth === undefined || Number.isInteger(component.moduleWidth) &&
    component.moduleWidth >= 4 && component.moduleWidth <= 20) &&
    (component.moduleHeight === undefined || Number.isInteger(component.moduleHeight) &&
    component.moduleHeight >= 3 && component.moduleHeight <= 32);
}

export function modulePinLayout(component) {
  let inputs = 0, outputs = 0;
  return modulePorts(component).map((port, index) => {
    const incoming = port.role === "in";
    const defaultPosition = 1 + 2 * (incoming ? inputs++ : outputs++);
    return component.pinLayout?.[index] ?? [incoming ? "W" : "E", defaultPosition];
  });
}

export function validModulePinLayout(component) {
  if (component.pinLayout === undefined) return true;
  const ports = modulePorts(component);
  const layout = component.pinLayout;
  if (!Array.isArray(layout) || layout.length !== ports.length) return false;
  const { w, h } = dimsOf({ ...component, r: 0 });
  const used = new Set();
  return layout.every((item) => {
    if (!Array.isArray(item) || item.length !== 2) return false;
    const [side, position] = item;
    if (!["N", "E", "S", "W"].includes(side) || !Number.isInteger(position) ||
        position < 1 || position >= (["N", "S"].includes(side) ? w : h)) return false;
    const key = `${side}:${position}`;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  });
}

export function bitWidth(component) {
  if (component.t === "debugdisplay") return 4;
  return isSizable(component) ? (component.size ?? 1) : 1;
}

export function addressWidth(component) {
  return component.addressSize ?? 8;
}

export function validBitWidth(size) {
  return Number.isInteger(size) && size >= 1 && size <= MAX_BUS_WIDTH;
}

export function validRomWidth(size) {
  return validBitWidth(size) && (size & (size - 1)) === 0;
}

export function validRomAddressWidth(size) {
  return validRomWidth(size) && size <= 16;
}

export function validSplitterOrder(order) {
  return order === "ascendant" || order === "descendant";
}

export function validConstant(component) {
  const size = bitWidth(component);
  const value = component.value ?? 0;
  return Number.isInteger(size) && size >= 1 && size <= 8 &&
    Number.isInteger(value) && value >= 0 && value < 2 ** size;
}

export function validRom(component) {
  const data = component.data === undefined ? [] : component.data;
  const width = bitWidth(component);
  const addressSize = addressWidth(component);
  if (!validRomWidth(width) || !validRomAddressWidth(addressSize) || !Array.isArray(data)) return false;
  const addresses = new Set();
  for (const entry of data) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [address, value] = entry;
    if (!Number.isInteger(address) || address < 0 || address >= 2 ** addressSize || addresses.has(address) ||
        !Number.isInteger(value) || value < 1 || value >= 2 ** width) return false;
    addresses.add(address);
  }
  return true;
}

export function validRam(component) {
  return validRomWidth(bitWidth(component)) && validRomAddressWidth(addressWidth(component));
}

export function spec(type) {
  return Object.hasOwn(COMPONENT_TYPES, type) ? COMPONENT_TYPES[type] : null;
}

// Maps a point from a w x h local box onto the box rotated r quarter-turns CW.
function rotatePoint(x, y, w, h, r) {
  switch (r) {
    case 1: return [h - y, x];
    case 2: return [w - x, h - y];
    case 3: return [y, w - x];
    default: return [x, y];
  }
}

function rotateDir(dir, r) {
  const i = DIRECTIONS.indexOf(dir);
  return i < 0 ? dir : DIRECTIONS[(i + r) % 4];
}

export function dimsFor(type, r = 0) {
  const component = spec(type);
  if (!component) return null;
  if (component.tag) return { w: component.w, h: component.h };
  return normalizeRotation(r) % 2
    ? { w: component.h, h: component.w }
    : { w: component.w, h: component.h };
}

export function dimsOf(component) {
  if (component.t === "module") {
    const ports = modulePorts(component);
    const pinHeight = 2 * Math.max(ports.filter((p) => p.role === "in").length,
      ports.filter((p) => p.role === "out").length) + 1;
    const face = Array.isArray(component.faceLayout) ? component.faceLayout.filter((item) => Array.isArray(item)) : [];
    const faceWidth = 1 + Math.max(3, ...face.map((item) => Number.isInteger(item[1]) && item[1] <= 19 ? item[1] : 3));
    const faceHeight = 1 + Math.max(2, ...face.map((item) => Number.isInteger(item[2]) && item[2] <= 32 ? item[2] : 2));
    const w = Math.max(4, component.moduleWidth ?? 4, faceWidth);
    const h = Math.max(3, pinHeight, component.moduleHeight ?? 3, faceHeight);
    return normalizeRotation(component.r) % 2 ? { w: h, h: w } : { w, h };
  }
  if (["constant", "input", "output"].includes(component.t)) {
    return { w: bitWidth(component) + 1, h: 2 };
  }
  if (component.t === "mux" || component.t === "demux") {
    const w = component.t === "mux" ? Math.max(4, 2 * (channelCount(component) + 1)) : Math.max(4, 2 * channelCount(component));
    return normalizeRotation(component.r) % 2 ? { w: 3, h: w } : { w, h: 3 };
  }
  if (spec(component.t)?.splitter) {
    const h = bitWidth(component) + 1;
    return normalizeRotation(component.r) % 2 ? { w: h, h: 2 } : { w: 2, h };
  }
  return dimsFor(component.t, component.r);
}

function outwardEdge(px, py, dir) {
  switch (dir) {
    case "N": return { o: "V", x: px, y: py - 1 };
    case "S": return { o: "V", x: px, y: py };
    case "W": return { o: "H", x: px - 1, y: py };
    default: return { o: "H", x: px, y: py };
  }
}

export function pinsFor(component) {
  const entry = spec(component.t);
  if (!entry) return [];
  const r = normalizeRotation(component.r);
  const width = bitWidth(component);
  if (entry.tag) {
    const [x, y, dir] = [[0, 1, "W"], [2, 0, "N"], [4, 1, "E"], [2, 2, "S"]][r];
    const px = component.x + x, py = component.y + y;
    return [{ px, py, dir, role: "in", size: width, edge: outwardEdge(px, py, dir) }];
  }
  const plexer = component.t === "mux" || component.t === "demux";
  if (entry.module) {
    const ports = modulePorts(component);
    const { w: localW, h: localH } = dimsOf({ ...component, r: 0 });
    const layout = modulePinLayout(component);
    let inputs = 0, outputs = 0;
    return ports.map((port, index) => {
      const incoming = port.role === "in";
      const [side, position] = layout[index];
      const x = side === "W" ? 0 : side === "E" ? localW : position;
      const y = side === "N" ? 0 : side === "S" ? localH : position;
      const [lx, ly] = rotatePoint(x, y, localW, localH, r);
      const px = component.x + lx, py = component.y + ly;
      const dir = rotateDir(side, r);
      if (incoming) inputs++; else outputs++;
      return { px, py, dir, role: port.role, name: port.name || (incoming ? `IN${inputs}` : `OUT${outputs}`),
        size: port.size, edge: outwardEdge(px, py, dir) };
    });
  }
  const bitRow = !!(entry.constant || entry.input || entry.output);
  const localW = plexer ? dimsOf({ ...component, r: 0 }).w : entry.w;
  const localH = entry.splitter ? width + 1 : entry.h;
  const channels = plexer ? channelCount(component) : 0;
  const localPins = plexer
    ? component.t === "mux"
      ? [...Array.from({ length: channels }, (_, index) =>
          ({ x: 2 * index + 1, y: 0, dir: "N", role: "in", name: `D${index}` })),
        { x: localW - 1, y: 0, dir: "N", role: "in", name: "S", size: selectWidth(component) },
        { x: Math.floor(localW / 2), y: 3, dir: "S", role: "out", name: "Y" }]
      : [{ x: 1, y: 0, dir: "N", role: "in", name: "D" },
        { x: localW - 1, y: 0, dir: "N", role: "in", name: "S", size: selectWidth(component) },
        ...Array.from({ length: channels }, (_, index) =>
          ({ x: 2 * index + 1, y: 3, dir: "S", role: "out", name: `Y${index}` }))]
    : entry.splitter
    ? [{ x: 1, y: 0, dir: "N", role: "in", size: width },
      ...Array.from({ length: width }, (_, index) =>
        ({ x: 2, y: index + 1, dir: "E", role: "out", size: 1,
          bit: component.order === "descendant" ? width - 1 - index : index }))]
    : bitRow
    ? [{ x: r === 2 ? width + 1 : 0, y: 1, dir: r === 2 ? "E" : "W", role: entry.output ? "in" : "out" }]
    : entry.pins;
  return localPins.map((pin) => {
    const [lx, ly] = bitRow
      ? [pin.x, pin.y] : rotatePoint(pin.x, pin.y, localW, localH, r);
    const px = component.x + lx;
    const py = component.y + ly;
    const dir = bitRow ? pin.dir : rotateDir(pin.dir, r);
    const size = (entry.rom || entry.ram) && pin.name === "ADDR" ? addressWidth(component) : pin.size ?? width;
    return { px, py, dir, role: pin.role, name: pin.name, size, bit: pin.bit, edge: outwardEdge(px, py, dir) };
  });
}
