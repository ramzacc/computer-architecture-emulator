// Wire placement, connectivity, routing, and layout validation.
import {
  blockedEdgeKeys, edgeBlocked, edgeKey, edgePoints, pinsAtPoint,
  validEdgeCoordinates, validEdgeOrientation, wireSize,
} from "./board.js";
import { pinsFor, validBitWidth } from "./components.js";
import { circuitIssue, shortCircuitError } from "./issues.js";

export function wiresAtPoint(board, x, y) {
  return [...board.wires.values()].filter((wire) => edgePoints(wire).some(([px, py]) => px === x && py === y));
}

export function isCrossing(wires) {
  return wires.length === 4 && wires.filter((wire) => wire.o === "H").length === 2 &&
    wires.filter((wire) => wire.o === "V").length === 2;
}

export function crossingAt(board, x, y) {
  return isCrossing(wiresAtPoint(board, x, y));
}

// The single connectivity rule. Four wires meeting at a point cross without
// connecting unless an explicit junction or a pin joins them; otherwise every
// wire at the point belongs to one net.
export function connectedGroups(wires, { junction = false, pin = false } = {}) {
  if (wires.length === 4 && !junction && !pin) {
    return ["H", "V"].map((o) => wires.filter((wire) => wire.o === o)).filter((group) => group.length);
  }
  return wires.length ? [wires] : [];
}

export function connectedAtPoint(wires, edge, { junction = false, pin = false } = {}) {
  return connectedGroups(wires, { junction, pin }).find((group) => group.includes(edge)) ?? [];
}

// A three-way branch is already connected. Keep it connected if a route adds
// its fourth arm; a fresh wire crossing an existing run remains separate.
function junctionsAtExtendedBranches(board, trial, edges) {
  const junctions = new Set();
  for (const edge of edges) {
    if (board.wires.has(edgeKey(edge))) continue;
    for (const [x, y] of edgePoints(edge)) {
      if (wiresAtPoint(board, x, y).length === 3 && crossingAt(trial, x, y))
        junctions.add(`${x},${y}`);
    }
  }
  return junctions;
}

export function pruneJunctions(board) {
  for (const key of board.junctions ?? []) {
    const [x, y] = key.split(",").map(Number);
    if (!crossingAt(board, x, y)) board.junctions.delete(key);
  }
}

export function edgePlacementError(board, edge) {
  if (!validEdgeOrientation(edge) || !validEdgeCoordinates(edge) ||
      !validBitWidth(wireSize(edge))) return "Wire size must be 1–32 bits.";
  if (edgeBlocked(board, edge)) return "Wire is blocked by a component.";
  if (board.wires.has(edgeKey(edge))) return "Wire already exists here.";
  const points = edgePoints(edge);
  const trial = { ...board, wires: new Map(board.wires) };
  trial.wires.set(edgeKey(edge), edge);
  const touching = points.flatMap(([x, y]) => connectedAtPoint(wiresAtPoint(trial, x, y), edge, {
    junction: trial.junctions?.has(`${x},${y}`),
    pin: pinsAtPoint(board, x, y).length > 0,
  }));
  const pins = points.flatMap(([x, y]) => pinsAtPoint(board, x, y));
  if (touching.some((wire) => wireSize(wire) !== wireSize(edge)) ||
      pins.some((size) => size !== wireSize(edge))) return "Bus size mismatch.";
  const conflict = shortCircuitError(trial);
  if (conflict) return conflict;
  return null;
}

export function addWireEdge(board, edge) {
  if (edgePlacementError(board, edge) !== null) return false;
  board.wires.set(edgeKey(edge), { ...edge, size: wireSize(edge) });
  return true;
}

export function wireLayoutError(board, blocked = blockedEdgeKeys(board)) {
  const atPoint = new Map();
  const pins = new Map();
  const add = (map, x, y, value) => {
    const key = `${x},${y}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const edge of board.wires.values())
    for (const [x, y] of edgePoints(edge)) add(atPoint, x, y, edge);
  for (const component of board.components)
    for (const pin of pinsFor(component)) add(pins, pin.px, pin.py, pin.size);
  for (const edge of board.wires.values()) {
    if (!validEdgeOrientation(edge) || !validEdgeCoordinates(edge) ||
        !validBitWidth(wireSize(edge))) return "Invalid wire route.";
    if (blocked.has(edgeKey(edge))) return "Wire is blocked by a component.";
    for (const [x, y] of edgePoints(edge)) {
      const key = `${x},${y}`;
      const pinSizes = pins.get(key);
      const connected = connectedAtPoint(atPoint.get(key) ?? [], edge, {
        junction: board.junctions?.has(key),
        pin: !!pinSizes,
      });
      if (connected.some((wire) => wireSize(wire) !== wireSize(edge)) ||
          pinSizes?.some((size) => size !== wireSize(edge))) return "Bus size mismatch.";
    }
  }
  return shortCircuitError(board);
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
  let firstIssue = null;
  const blocked = blockedEdgeKeys(board);
  for (const horizontalFirst of [true, false]) {
    const edges = build(horizontalFirst);
    const trial = { ...board, wires: new Map(board.wires), junctions: new Set(board.junctions) };
    let error = null;
    for (const edge of edges) {
      const existing = trial.wires.get(edgeKey(edge));
      if (existing) {
        if (wireSize(existing) !== size) { error = "Bus size mismatch."; break; }
      } else {
        if (blocked.has(edgeKey(edge))) { error = "Wire is blocked by a component."; break; }
        trial.wires.set(edgeKey(edge), edge);
      }
    }
    const junctions = junctionsAtExtendedBranches(board, trial, edges);
    for (const key of junctions) trial.junctions.add(key);
    if (!error) error = wireLayoutError(trial, blocked);
    if (!error) return { edges, junctions: [...junctions], error: null };
    if (!firstError) {
      firstError = error;
      if (error.startsWith("Short circuit:")) firstIssue = circuitIssue(trial);
    }
  }
  return { edges: build(true), error: firstError, issue: firstIssue };
}

export function sanitizeWires(board) {
  for (const [key, edge] of board.wires) {
    if (!validEdgeOrientation(edge) || !validBitWidth(wireSize(edge)) ||
        edgeBlocked(board, edge) ||
        edgePoints(edge).some(([x, y]) => pinsAtPoint(board, x, y).some((size) => size !== wireSize(edge)))) {
      board.wires.delete(key);
    }
  }
  pruneJunctions(board);
}
