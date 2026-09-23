import { bitWidth, dimsOf, isSizable, normalizeRotation, pinsFor, spec, validBitWidth, validConstant, validSplitterOrder } from "./components.js";

export const SCHEMA_VERSION = 8;
export const DEFAULT_COLS = 64;
export const DEFAULT_ROWS = 44;

// The lattice is conceptually infinite. Grid dimensions are kept in the
// document only as legacy metadata; they no longer restrict placement.
export const COORD_LIMIT = 1e7;

export function createBoard(cols = DEFAULT_COLS, rows = DEFAULT_ROWS) {
  return { grid: { cols, rows }, components: [], wires: new Map() };
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

export function isValidComponent(board, component) {
  const size = dimsOf(component);
  if (!size || !Number.isInteger(component.x) || !Number.isInteger(component.y) ||
      !validBitWidth(bitWidth(component)) ||
      (component.t === "splitter" && !validSplitterOrder(component.order ?? "ascendant")) ||
      (component.t === "constant" && !validConstant(component))) return false;
  for (let y = component.y; y < component.y + size.h; y++) {
    for (let x = component.x; x < component.x + size.w; x++) {
      if (componentAt(board, x, y, component.id)) return false;
    }
  }
  return !pinsFor(component).some((pin) => wiresAtPoint(board, pin.px, pin.py).some((wire) =>
    wireSize(wire) !== pin.size));
}

export function addComponent(board, component) {
  if (!isValidComponent(board, component)) return false;
  board.components.push(component);
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
  if (!edgeInBounds(board, edge) || !Number.isInteger(edge.x) || !Number.isInteger(edge.y) ||
      !validBitWidth(wireSize(edge))) return "Wire size must be 1–32 bits.";
  if (edgeBlocked(board, edge)) return "Wire is blocked by a component.";
  if (board.wires.has(edgeKey(edge))) return "Wire already exists here.";
  const points = edgePoints(edge);
  const touching = points.flatMap(([x, y]) => wiresAtPoint(board, x, y));
  const pins = points.flatMap(([x, y]) => pinsAtPoint(board, x, y));
  if (touching.some((wire) => wireSize(wire) !== wireSize(edge)) ||
      pins.some((size) => size !== wireSize(edge))) return "Bus size mismatch.";
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
  not: (a) => ~a,
};

function bitMask(size) { return size === 32 ? 0xffffffff : (2 ** size - 1); }

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

// solves the board to a fixed point: nets carry a value, each component's
// output (or LED) follows from its inputs. Loops are allowed; they just settle
// on whatever value the final pass produced.
export function evaluateBoard(board) {
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
      source: !!entry.source,
      constant: !!entry.constant,
      constantValue: component.value ?? 0,
      splitter: !!entry.splitter,
      size: bitWidth(component),
      ins: pins.filter((pin) => pin.role === "in").map(netAt),
      outs: pins.filter((pin) => pin.role === "out")
        .sort((a, b) => (a.bit ?? 0) - (b.bit ?? 0)).map(netAt),
    };
  });
  const outputOf = (part, values) => {
    if (part.constant) return part.constantValue;
    if (part.source) return 1;
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
    if (stable) break;
  }

  const states = new Map();
  for (const part of parts) {
    const inputs = part.ins.map((root) => root === null ? 0 : (values.get(root) ?? 0));
    states.set(part.id, {
      inputs,
      value: outputOf(part, values),
      lit: inputs.length === 1 && inputs[0] !== 0,
    });
  }
  for (const net of nets.values()) {
    net.value = values.get(net.id) ?? 0;
    net.on = net.value !== 0;
  }
  return { nets, states };
}

export function computeNets(board) {
  return evaluateBoard(board).nets;
}

export function netContaining(board, key) {
  for (const net of computeNets(board).values()) {
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
  return true;
}

export function netInfoByEdgeKey(board) {
  const info = new Map();
  for (const net of computeNets(board).values()) {
    for (const edge of net.edges) info.set(edgeKey(edge), { on: net.on, value: net.value, size: net.size, netId: net.id });
  }
  return info;
}

export function serialize(board) {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    grid: { ...board.grid },
    components: board.components.map(({ t, x, y, r, size, value, order }) => {
      const q = normalizeRotation(r);
      return { t, x, y, ...(q ? { r: q } : {}), ...(isSizable({ t }) ? { size: size ?? 1 } : {}),
        ...(t === "constant" ? { value: value ?? 0 } : {}),
        ...(t === "splitter" ? { order: order ?? "ascendant" } : {}) };
    }),
    wires: [...board.wires.values()].map(({ o, x, y, size }) => ({ o, x, y, size: size ?? 1 })),
  }, null, 2);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
}

// Parsing builds a new board. Callers replace the visible board only after it succeeds.
export function parseDocument(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.components)) throw new Error("Missing components array.");
  const board = createBoard(
    clampInt(data.grid?.cols, 1, 500, DEFAULT_COLS),
    clampInt(data.grid?.rows, 1, 500, DEFAULT_ROWS),
  );
  const skipped = { components: 0, wires: 0 };
  for (const raw of data.components) {
    if (!raw || !spec(raw.t)) { skipped.components++; continue; }
    const r = normalizeRotation(raw.r);
    const component = {
      id: `c${board.components.length + 1}`, t: raw.t, r,
      ...(isSizable({ t: raw.t }) ? { size: raw.size ?? 1 } : {}),
      ...(raw.t === "splitter" ? { order: raw.order ?? "ascendant" } : {}),
      ...(raw.t === "constant" ? { value: raw.value ?? 0 } : {}),
      x: clampInt(raw.x, -COORD_LIMIT, COORD_LIMIT, 0),
      y: clampInt(raw.y, -COORD_LIMIT, COORD_LIMIT, 0),
    };
    // Power grew from 2x1 to 2x2 in version 8. Keep its old output pin at
    // the same lattice point so existing wires can still connect.
    if (raw.t === "power" && (data.version ?? 0) < 8) {
      if (r === 0) component.y--;
      if (r === 3) component.x--;
    }
    if (!addComponent(board, component)) skipped.components++;
  }
  if (Array.isArray(data.wires)) {
    for (const raw of data.wires) {
      if (!raw || (raw.o !== "H" && raw.o !== "V")) { skipped.wires++; continue; }
      const edge = { o: raw.o, x: Number(raw.x), y: Number(raw.y), size: raw.size ?? 1 };
      if (!addWireEdge(board, edge)) skipped.wires++;
    }
  }
  return { board, skipped };
}
