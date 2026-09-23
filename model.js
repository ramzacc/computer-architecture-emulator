import { dimsFor, dimsOf, pinsFor, spec } from "./components.js";

export const SCHEMA_VERSION = 4;
export const DEFAULT_COLS = 64;
export const DEFAULT_ROWS = 44;

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
  const { cols, rows } = board.grid;
  if (edge.o === "H") return edge.x >= 0 && edge.x < cols && edge.y >= 0 && edge.y <= rows;
  if (edge.o === "V") return edge.x >= 0 && edge.x <= cols && edge.y >= 0 && edge.y < rows;
  return false;
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
  if (!size || !Number.isInteger(component.x) || !Number.isInteger(component.y)) return false;
  if (component.x < 0 || component.y < 0 || component.x + size.w > board.grid.cols || component.y + size.h > board.grid.rows) return false;
  for (let y = component.y; y < component.y + size.h; y++) {
    for (let x = component.x; x < component.x + size.w; x++) {
      if (componentAt(board, x, y, component.id)) return false;
    }
  }
  return true;
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
    return mx >= component.x && mx <= component.x + w && my >= component.y && my <= component.y + h;
  });
}

function endpointOnWall(board, edge) {
  for (const [x, y] of edgePoints(edge)) {
    for (const component of board.components) {
      const { w, h } = dimsOf(component);
      const onContour =
        ((x === component.x || x === component.x + w) && y >= component.y && y <= component.y + h) ||
        ((y === component.y || y === component.y + h) && x >= component.x && x <= component.x + w);
      if (onContour && !pinsFor(component).some((pin) => pin.px === x && pin.py === y)) return true;
    }
  }
  return false;
}

function isPinStub(board, edge) {
  const key = edgeKey(edge);
  return board.components.some((component) => pinsFor(component).some((pin) => edgeKey(pin.edge) === key));
}

function touchesWire(board, edge) {
  const points = new Set(edgePoints(edge).map((point) => point.join(",")));
  return [...board.wires.values()].some((wire) => edgePoints(wire).some((point) => points.has(point.join(","))));
}

export function canPlaceEdge(board, edge) {
  return edgeInBounds(board, edge) && !edgeBlocked(board, edge) && !endpointOnWall(board, edge) &&
    !board.wires.has(edgeKey(edge)) && (isPinStub(board, edge) || touchesWire(board, edge));
}

export function addWireEdge(board, edge) {
  if (!canPlaceEdge(board, edge)) return false;
  board.wires.set(edgeKey(edge), { ...edge });
  return true;
}

export function sanitizeWires(board) {
  for (const [key, edge] of board.wires) {
    if (!edgeInBounds(board, edge) || edgeBlocked(board, edge) || endpointOnWall(board, edge)) {
      board.wires.delete(key);
    }
  }
}

export function computeNets(board) {
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
  const powered = new Set(board.components.filter((component) => spec(component.t).source)
    .flatMap((component) => pinsFor(component).map((pin) => `${pin.px},${pin.py}`)));
  const nets = new Map();
  for (const edge of board.wires.values()) {
    const points = edgePoints(edge).map((point) => point.join(","));
    const root = find(points[0]);
    if (!nets.has(root)) nets.set(root, { id: root, edges: [], on: false });
    const net = nets.get(root);
    net.edges.push(edge);
    if (points.some((point) => powered.has(point))) net.on = true;
  }
  return nets;
}

export function netContaining(board, key) {
  for (const net of computeNets(board).values()) {
    if (net.edges.some((edge) => edgeKey(edge) === key)) return net;
  }
  return null;
}

export function netInfoByEdgeKey(board) {
  const info = new Map();
  for (const net of computeNets(board).values()) {
    for (const edge of net.edges) info.set(edgeKey(edge), { on: net.on, netId: net.id });
  }
  return info;
}

export function serialize(board) {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    grid: { ...board.grid },
    components: board.components.map(({ t, x, y, r }) => r ? { t, x, y, r: 1 } : { t, x, y }),
    wires: [...board.wires.values()].map(({ o, x, y }) => ({ o, x, y })),
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
    const r = raw.r ? 1 : 0;
    const { w, h } = dimsFor(raw.t, r);
    const component = {
      id: `c${board.components.length + 1}`, t: raw.t, r,
      x: clampInt(raw.x, 0, Math.max(0, board.grid.cols - w), 0),
      y: clampInt(raw.y, 0, Math.max(0, board.grid.rows - h), 0),
    };
    if (!addComponent(board, component)) skipped.components++;
  }
  if (Array.isArray(data.wires)) {
    for (const raw of data.wires) {
      if (!raw || (raw.o !== "H" && raw.o !== "V")) { skipped.wires++; continue; }
      const edge = { o: raw.o, x: Number(raw.x), y: Number(raw.y) };
      if (!Number.isInteger(edge.x) || !Number.isInteger(edge.y) || !edgeInBounds(board, edge) ||
          edgeBlocked(board, edge) || endpointOnWall(board, edge)) { skipped.wires++; continue; }
      board.wires.set(edgeKey(edge), edge);
    }
  }
  return { board, skipped };
}
