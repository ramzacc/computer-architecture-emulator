// Fixed component registry. Characteristics live here, never in the saved file.
// Instances only persist their type + position (+ orientation when rotated).
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
    label: "Power", w: 2, h: 1, color: "#30a46c", shape: "power", source: true,
    pins: [
      { x: 1, y: 1, dir: "S", role: "out" },
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
  nand: {
    label: "NAND", w: 4, h: 2, color: "#8e4cf5", shape: "nand", op: "nand",
    pins: [
      { x: 1, y: 0, dir: "N", role: "in" },
      { x: 3, y: 0, dir: "N", role: "in" },
      { x: 2, y: 2, dir: "S", role: "out" },
    ],
  },
};

const ROTATE_CW = { N: "E", E: "S", S: "W", W: "N" };

export function spec(type) {
  return Object.hasOwn(COMPONENT_TYPES, type) ? COMPONENT_TYPES[type] : null;
}

export function dimsFor(type, rotated = false) {
  const component = spec(type);
  if (!component) return null;
  return rotated ? { w: component.h, h: component.w } : { w: component.w, h: component.h };
}

export function dimsOf(component) {
  return dimsFor(component.t, !!component.r);
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
  return entry.pins.map((pin) => {
    const px = component.x + (component.r ? entry.h - pin.y : pin.x);
    const py = component.y + (component.r ? pin.x : pin.y);
    const dir = component.r ? ROTATE_CW[pin.dir] : pin.dir;
    return { px, py, dir, role: pin.role, edge: outwardEdge(px, py, dir) };
  });
}
