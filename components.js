// Fixed component registry. Gate instances may also persist a bit width.
//
// These are real logic-level parts: a power rail, an LED, and gates that read
// their inputs and drive an output. Signal flow runs top-to-bottom (N inputs,
// S outputs) so a two-input gate can sit symmetrically on the lattice.
//
// Pins are declared per component in unrotated local lattice coordinates:
//   dir  = outward normal ("N" | "E" | "S" | "W").
//   role = "in" (reads the net) or "out" (drives the net).
// A pin must sit on the interior of one side, never on a corner (a corner has
// no single outward normal). Concretely: N/S pins need 0 < x < w; E/W pins
// need 0 < y < h. So 1-tall parts carry N/S pins and 1-wide parts carry W/E.
export const COMPONENT_TYPES = {
  power: {
    label: "Power", w: 2, h: 2, color: "#30a46c", shape: "power", source: true,
    pins: [
      { x: 1, y: 2, dir: "S", role: "out" },
    ],
  },
  constant: {
    label: "Constant", w: 2, h: 2, color: "#b68af5", shape: "constant", constant: true,
    pins: [
      { x: 1, y: 2, dir: "S", role: "out" },
    ],
  },
  led: {
    label: "LED", w: 2, h: 2, color: "#5a5a7a", shape: "led",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
    ],
  },
  and: {
    label: "AND", w: 4, h: 2, color: "#4c8bf5", shape: "and", op: "and",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
  or: {
    label: "OR", w: 4, h: 2, color: "#30a46c", shape: "or", op: "or",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
  xor: {
    label: "XOR", w: 4, h: 2, color: "#f5883b", shape: "xor", op: "xor",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
  splitter: {
    label: "Splitter", w: 2, h: 2, color: "#ddb866", shape: "splitter", splitter: true,
    pins: [],
  },
  nand: {
    label: "NAND", w: 4, h: 2, color: "#8e4cf5", shape: "nand", op: "nand",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
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

export function isSizable(component) {
  const entry = spec(component.t);
  return !!(entry?.op || entry?.splitter || entry?.constant);
}

export function bitWidth(component) {
  return isSizable(component) ? (component.size ?? 1) : 1;
}

export function validBitWidth(size) {
  return Number.isInteger(size) && size >= 1 && size <= MAX_BUS_WIDTH;
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
  return normalizeRotation(r) % 2
    ? { w: component.h, h: component.w }
    : { w: component.w, h: component.h };
}

export function dimsOf(component) {
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
  const localH = entry.splitter ? width + 1 : entry.h;
  const localPins = entry.splitter
    ? [{ x: 1, y: 0, dir: "N", role: "in", size: width },
      ...Array.from({ length: width }, (_, index) =>
        ({ x: 2, y: index + 1, dir: "E", role: "out", size: 1,
          bit: component.order === "descendant" ? width - 1 - index : index }))]
    : entry.pins;
  return localPins.map((pin) => {
    const [lx, ly] = rotatePoint(pin.x, pin.y, entry.w, localH, r);
    const px = component.x + lx;
    const py = component.y + ly;
    const dir = rotateDir(pin.dir, r);
    return { px, py, dir, role: pin.role, size: pin.size ?? width, bit: pin.bit, edge: outwardEdge(px, py, dir) };
  });
}
