// Circuit issue detection: driver conflicts, splitter bit conflicts, and
// feedback loops that never settle.
import { drivesOutputs, pinsFor, spec } from "./components.js";
import { edgeKey, edgePoints } from "./board.js";
import { evaluateBoard } from "./simulate.js";
import { createUnionFind } from "./union-find.js";

// Real parts drive their pins; sinks and monitors only observe a net.
function driverConflict(previous, entry, level) {
  if (previous.level !== level) return "Short circuit: HIGH and LOW outputs are connected.";
  if (previous.clock || entry.clock) return "Short circuit: a clock output cannot share a driven net.";
  if (previous.register || entry.register) return "Short circuit: a register output cannot share a driven net.";
  if (previous.counter || entry.counter) return "Short circuit: a counter output cannot share a driven net.";
  return null;
}

export function circuitIssue(board, pressedButtons, highClocks, registerValues, ramValues) {
  const { nets, states, settled, changingNets, portalWidthMismatch } = evaluateBoard(board, pressedButtons, highClocks, registerValues, ramValues);
  if (portalWidthMismatch) return { message: "Bus size mismatch.", componentIds: [], wireKeys: [] };
  const wireKeysFor = (netIds) => [...nets.values()].filter((net) => netIds.has(net.id))
    .flatMap((net) => net.edges.map(edgeKey));
  if (!settled) {
    const wireKeys = wireKeysFor(changingNets);
    const points = new Set([...nets.values()].filter((net) => changingNets.has(net.id))
      .flatMap((net) => net.edges.flatMap((edge) => edgePoints(edge).map((point) => point.join(",")))));
    const componentIds = board.components.filter((component) => pinsFor(component)
      .some((pin) => points.has(`${pin.px},${pin.py}`))).map((component) => component.id);
    return { message: "Short circuit: feedback loop does not settle.", componentIds, wireKeys };
  }
  const { find, union } = createUnionFind();
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
    if (!drivesOutputs(component)) continue;
    const entry = spec(component.t);
    const outputs = states.get(component.id).outputs;
    for (const [index, pin] of pinsFor(component).filter((item) => item.role === "out").entries()) {
      const net = netAt(pin);
      if (net === undefined) continue;
      for (let bit = 0; bit < pin.size; bit++) {
        const key = find(bitKey(net, bit));
        const level = (outputs[index] >>> bit) & 1;
        const previous = driven.get(key);
        const message = previous && driverConflict(previous, entry, level);
        if (message) return { message, componentIds: [previous.id, component.id], wireKeys: wireKeysFor(new Set([previous.net, net])) };
        driven.set(key, { id: component.id, net, level, clock: !!entry.clock, register: !!entry.register, counter: !!entry.counter });
      }
    }
  }
  return null;
}

export function shortCircuitError(board, pressedButtons, highClocks, registerValues, ramValues) {
  return circuitIssue(board, pressedButtons, highClocks, registerValues, ramValues)?.message ?? null;
}
