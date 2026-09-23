// Fixed component registry. Characteristics live here, never in the saved file.
// Instances only persist their type + position (+ orientation when rotated).
//
// Pins are declared per component in unrotated local lattice coordinates:
//   dir = outward normal ("N" | "E" | "S" | "W").
// A pin must sit on the interior of one side, never on a corner (a corner has
// no single outward normal). Concretely: N/S pins need 0 < x < w; E/W pins
// need 0 < y < h. So 1-wide parts carry W/E pins and 1-tall parts carry N/S
// pins. Layouts are irregular on purpose; nothing assumes 4 symmetric pins.
export const COMPONENT_TYPES = {
  cpu: {
    label: "CPU", w: 2, h: 2, color: "#4c8bf5", source: true,
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 2, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 2, y: 1, dir: "E" },
    ],
  },
  gpu: {
    label: "GPU", w: 2, h: 2, color: "#8e4cf5", source: true,
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 2, y: 1, dir: "E" },
      { x: 0, y: 1, dir: "W" },
      { x: 1, y: 2, dir: "S" },
    ],
  },
  reg: {
    label: "Register", w: 1, h: 2, color: "#e5484d",
    pins: [
      { x: 0, y: 1, dir: "W" },
      { x: 1, y: 1, dir: "E" },
    ],
  },
  cache: {
    label: "Cache", w: 1, h: 2, color: "#f5883b",
    pins: [
      { x: 0, y: 1, dir: "W" },
      { x: 1, y: 1, dir: "E" },
    ],
  },
  bus: {
    label: "Bus", w: 2, h: 1, color: "#30a46c",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 1, dir: "S" },
    ],
  },
  clock: {
    label: "Clock", w: 2, h: 1, color: "#e5c84c", source: true,
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 1, dir: "S" },
    ],
  },
  board: {
    label: "Board", w: 3, h: 3, color: "#2f6f4f",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 2, y: 0, dir: "N" },
      { x: 1, y: 3, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 3, y: 2, dir: "E" },
    ],
  },
  fpga: {
    label: "FPGA", w: 3, h: 3, color: "#7a4c2f",
    pins: [
      { x: 2, y: 0, dir: "N" },
      { x: 1, y: 3, dir: "S" },
      { x: 2, y: 3, dir: "S" },
      { x: 0, y: 2, dir: "W" },
      { x: 3, y: 1, dir: "E" },
    ],
  },
  ram: {
    label: "RAM", w: 3, h: 2, color: "#2c6f8f",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 2, y: 0, dir: "N" },
      { x: 1, y: 2, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 3, y: 1, dir: "E" },
    ],
  },
  rom: {
    label: "ROM", w: 3, h: 2, color: "#5a5a7a",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 2, y: 0, dir: "N" },
      { x: 0, y: 1, dir: "W" },
      { x: 3, y: 1, dir: "E" },
    ],
  },
  alu: {
    label: "ALU", w: 2, h: 3, color: "#a03a6b",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 3, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 0, y: 2, dir: "W" },
      { x: 2, y: 2, dir: "E" },
    ],
  },
  cu: {
    label: "Control", w: 2, h: 3, color: "#3a6ba0", source: true,
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 3, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 2, y: 1, dir: "E" },
      { x: 2, y: 2, dir: "E" },
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
    return { px, py, dir, edge: outwardEdge(px, py, dir) };
  });
}
