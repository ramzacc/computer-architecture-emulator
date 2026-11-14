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

// The two-input gates differ only in their operator and artwork name.
const TWO_INPUT_GATE_PINS = [
  { x: 1, y: 0, dir: "N", role: "in" },
  { x: 3, y: 0, dir: "N", role: "in" },
  { x: 2, y: 2, dir: "S", role: "out" },
];

function gate(label, op) {
  return { label, w: 4, h: 2, color: "#b9bec8", shape: op, op, pins: TWO_INPUT_GATE_PINS };
}

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
  and: gate("AND", "and"),
  or: gate("OR", "or"),
  xor: gate("XOR", "xor"),
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
  nand: gate("NAND", "nand"),
  nor: gate("NOR", "nor"),
  xnor: gate("XNOR", "xnor"),
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

const MAX_BUS_WIDTH = 32;
export const MAX_PLEXER_CHANNELS = 16;
export const MAX_LABEL_LENGTH = 80;
export const MAX_MODULE_DEPTH = 8;
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

// Parts whose behaviour depends on a bus width. The rest have fixed geometry.
const UNSIZABLE_TYPES = new Set(["module", "button", "switch", "clock", "led", "sevenseg", "debugdisplay"]);

export function isSizable(component) {
  return !!spec(component.t) && !UNSIZABLE_TYPES.has(component.t);
}

// Parts that never count as independent net drivers: pins-less monitors,
// sinks, and splitters, whose branch bits are already unioned with their bus.
const NON_DRIVING_TYPES = new Set(["output", "portal", "tag", "led", "sevenseg", "debugdisplay", "splitter"]);

export function drivesOutputs(component) {
  return !!spec(component.t) && !NON_DRIVING_TYPES.has(component.t);
}

export function bitMask(size) {
  return size === 32 ? 0xffffffff : 2 ** size - 1;
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

const MODULE_FACE_TYPES = new Set(["led", "sevenseg", "debugdisplay", "output", "button"]);

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

function dimsFor(type, r = 0) {
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

const TAG_PIN_SIDES = [[0, 1, "W"], [2, 0, "N"], [4, 1, "E"], [2, 2, "S"]];

function placePins(component, localPins, { rotate = true, localW, localH, sizeOf } = {}) {
  const r = normalizeRotation(component.r);
  return localPins.map((pin) => {
    const [lx, ly] = rotate ? rotatePoint(pin.x, pin.y, localW, localH, r) : [pin.x, pin.y];
    const px = component.x + lx;
    const py = component.y + ly;
    const dir = rotate ? rotateDir(pin.dir, r) : pin.dir;
    return { px, py, dir, role: pin.role, name: pin.name, size: sizeOf(pin), bit: pin.bit,
      edge: outwardEdge(px, py, dir) };
  });
}

function tagPins(component, width) {
  const [x, y, dir] = TAG_PIN_SIDES[normalizeRotation(component.r)];
  const px = component.x + x;
  const py = component.y + y;
  return [{ px, py, dir, role: "in", size: width, edge: outwardEdge(px, py, dir) }];
}

function modulePins(component) {
  const r = normalizeRotation(component.r);
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
    const px = component.x + lx;
    const py = component.y + ly;
    const dir = rotateDir(side, r);
    if (incoming) inputs++; else outputs++;
    return { px, py, dir, role: port.role, name: port.name || (incoming ? `IN${inputs}` : `OUT${outputs}`),
      size: port.size, edge: outwardEdge(px, py, dir) };
  });
}

function plexerPins(component) {
  const localW = dimsOf({ ...component, r: 0 }).w;
  const channels = channelCount(component);
  const select = { x: localW - 1, y: 0, dir: "N", role: "in", name: "S", size: selectWidth(component) };
  if (component.t === "mux") {
    return [
      ...Array.from({ length: channels }, (_, index) =>
        ({ x: 2 * index + 1, y: 0, dir: "N", role: "in", name: `D${index}` })),
      select,
      { x: Math.floor(localW / 2), y: 3, dir: "S", role: "out", name: "Y" },
    ];
  }
  return [
    { x: 1, y: 0, dir: "N", role: "in", name: "D" },
    select,
    ...Array.from({ length: channels }, (_, index) =>
      ({ x: 2 * index + 1, y: 3, dir: "S", role: "out", name: `Y${index}` })),
  ];
}

function splitterPins(component, width) {
  return [
    { x: 1, y: 0, dir: "N", role: "in", size: width },
    ...Array.from({ length: width }, (_, index) =>
      ({ x: 2, y: index + 1, dir: "E", role: "out", size: 1,
        bit: component.order === "descendant" ? width - 1 - index : index })),
  ];
}

function bitRowPins(component, entry, width) {
  const r = normalizeRotation(component.r);
  return [{ x: r === 2 ? width + 1 : 0, y: 1, dir: r === 2 ? "E" : "W",
    role: entry.output ? "in" : "out" }];
}

export function pinsFor(component) {
  const entry = spec(component.t);
  if (!entry) return [];
  const width = bitWidth(component);
  if (entry.tag) return tagPins(component, width);
  if (entry.module) return modulePins(component);
  const byWidth = (pin) => pin.size ?? width;
  if (component.t === "mux" || component.t === "demux")
    return placePins(component, plexerPins(component), { localW: dimsOf({ ...component, r: 0 }).w, localH: 3, sizeOf: byWidth });
  if (entry.splitter) return placePins(component, splitterPins(component, width), { localW: 2, localH: width + 1, sizeOf: byWidth });
  if (entry.constant || entry.input || entry.output)
    return placePins(component, bitRowPins(component, entry, width), { rotate: false, sizeOf: byWidth });
  const addressPin = entry.rom || entry.ram;
  return placePins(component, entry.pins, {
    localW: entry.w,
    localH: entry.h,
    sizeOf: (pin) => addressPin && pin.name === "ADDR" ? addressWidth(component) : byWidth(pin),
  });
}
