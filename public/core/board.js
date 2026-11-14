// Board model primitives: lattice keys, component registry lookups, placement
// validity, and the blocked-edge geometry shared by wiring and documents.
import {
  DEFAULT_CLOCK_FREQUENCY, MAX_LABEL_LENGTH, MAX_MODULE_DEPTH, bitWidth, channelCount, dimsOf,
  pinsFor, spec, validBitWidth, validChannelCount, validClockFrequency, validConstant,
  validModuleFaceLayout, validModulePinLayout, validModuleSize, validRam, validRom,
  validSplitterOrder,
} from "./components.js";
import { validValueFormat } from "./value-format.js";
import { parseDocument, parseDocumentData } from "./document.js";
import { shortCircuitError } from "./issues.js";
import { wiresAtPoint } from "./wiring.js";

export function createBoard() {
  return {
    components: [],
    wires: new Map(),
    junctions: new Set(),
    monitor: { ids: [], formats: new Map(), breaks: new Set() },
    program: null,
  };
}

export function edgeKey({ o, x, y }) {
  return `${o}:${x},${y}`;
}

export function edgePoints(edge) {
  const { o, x, y } = edge;
  return o === "H" ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
}

// The four edge keys that meet at a lattice point.
export function edgesAtPoint(x, y) {
  return [`H:${x - 1},${y}`, `H:${x},${y}`, `V:${x},${y - 1}`, `V:${x},${y}`];
}

export function validEdgeOrientation(edge) {
  return edge.o === "H" || edge.o === "V";
}

export function validEdgeCoordinates(edge) {
  return Number.isSafeInteger(edge.x) && Number.isSafeInteger(edge.y) &&
    Number.isSafeInteger(edge.o === "H" ? edge.x + 1 : edge.y + 1);
}

export function wireSize(wire) {
  return wire.size ?? 1;
}

function componentAt(board, x, y, ignoreId) {
  return board.components.find((component) => {
    if (component.id === ignoreId) return false;
    const { w, h } = dimsOf(component);
    return x >= component.x && x < component.x + w && y >= component.y && y < component.y + h;
  });
}

function pointInside(component, x, y) {
  const { w, h } = dimsOf(component);
  return x > component.x && x < component.x + w && y > component.y && y < component.y + h;
}

export function labelAvailable(board, component) {
  return component.t === "portal" || !board.components.some((item) => item.id !== component.id &&
    item.t === component.t && item.label === component.label);
}

export function nextLabel(board, type, base = spec(type)?.label ?? type) {
  const used = new Set(board.components.filter((item) => item.t === type).map((item) => item.label));
  let number = 1;
  while (true) {
    const suffix = ` ${number++}`;
    const label = `${base.slice(0, MAX_LABEL_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(label)) return label;
  }
}

export function validComponentProperties(component, depth = 0, parsedModule = false) {
  const size = dimsOf(component);
  if (!size || !Number.isSafeInteger(component.x) || !Number.isSafeInteger(component.y) ||
      (component.r !== undefined && (!Number.isInteger(component.r) || component.r < 0 || component.r > 3)) ||
      !validBitWidth(bitWidth(component)) ||
      (["constant", "input", "output"].includes(component.t) && ![0, 2].includes(component.r ?? 0)) ||
      ((component.t === "mux" || component.t === "demux") && !validChannelCount(channelCount(component))) ||
      (component.t === "splitter" && !validSplitterOrder(component.order ?? "ascendant")) ||
      (component.t === "clock" && !validClockFrequency(component.frequency ?? DEFAULT_CLOCK_FREQUENCY)) ||
      (component.t === "clock" && component.enable !== undefined && typeof component.enable !== "boolean") ||
      (["constant", "input"].includes(component.t) && !validConstant(component)) ||
      (typeof component.label !== "string" || component.label.length > MAX_LABEL_LENGTH) ||
      (component.t === "rom" && !validRom(component)) ||
      (component.t === "ram" && !validRam(component)) ||
      (component.format !== undefined && (!["constant", "input", "output"].includes(component.t) ||
        !validValueFormat(component.format))) ||
      (component.t === "switch" && ![0, 1].includes(component.value ?? 0))) return false;
  if (component.t === "module") {
    if (!component.module ||
        !validModuleSize(component) || !validModulePinLayout(component) || !validModuleFaceLayout(component)) return false;
    if (depth >= MAX_MODULE_DEPTH) return false;
    try {
      const inner = parsedModule
        ? parseDocumentData(component.module, depth + 1)
        : parseDocument(JSON.stringify(component.module), depth + 1);
      moduleBoardCache.set(component.module, inner.board);
    }
    catch { return false; }
  }
  return true;
}

const moduleBoardCache = new WeakMap();

// Nested module documents parse once and are reused by every evaluation.
export function moduleBoard(document, depth = 0) {
  let board = moduleBoardCache.get(document);
  if (!board) {
    board = parseDocument(JSON.stringify(document), depth).board;
    moduleBoardCache.set(document, board);
  }
  return board;
}

export function isValidComponent(board, component) {
  if (!validComponentProperties(component) || !labelAvailable(board, component)) return false;
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
  component.label ??= nextLabel(board, component.t);
  if (!isValidComponent(board, component)) return false;
  board.components.push(component);
  if (shortCircuitError(board)) {
    board.components.pop();
    return false;
  }
  return true;
}

// A wire is blocked when its midpoint falls strictly inside a component body.
export function edgeBlocked(board, edge) {
  const mx = edge.x + (edge.o === "H" ? 0.5 : 0);
  const my = edge.y + (edge.o === "V" ? 0.5 : 0);
  return board.components.some((component) => pointInside(component, mx, my));
}

// Every edge whose midpoint is inside a component, enumerated from the bodies.
export function blockedEdgeKeys(board) {
  const blocked = new Set();
  for (const component of board.components) {
    const { w, h } = dimsOf(component);
    for (let y = component.y + 1; y < component.y + h; y++)
      for (let x = component.x; x < component.x + w; x++)
        blocked.add(edgeKey({ o: "H", x, y }));
    for (let x = component.x + 1; x < component.x + w; x++)
      for (let y = component.y; y < component.y + h; y++)
        blocked.add(edgeKey({ o: "V", x, y }));
  }
  return blocked;
}

// Bus widths of every pin at a point; used for size-mismatch checks.
export function pinsAtPoint(board, x, y) {
  return board.components.flatMap((component) => pinsFor(component)
    .filter((pin) => pin.px === x && pin.py === y)
    .map((pin) => pin.size));
}
