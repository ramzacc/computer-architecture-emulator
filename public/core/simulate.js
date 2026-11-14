// Fixed-point evaluation of a board: nets carry values, components compute
// outputs, modules evaluate recursively, and oscillating feedback is reported.
import {
  MAX_MODULE_DEPTH, addressWidth, bitMask, bitWidth, channelCount, modulePorts, pinsFor, spec,
  validBitWidth,
} from "./components.js";
import { edgeKey, edgePoints, moduleBoard, pinsAtPoint, wireSize } from "./board.js";
import { connectedGroups } from "./wiring.js";
import { shortCircuitError } from "./issues.js";
import { createUnionFind } from "./union-find.js";

const GATE_OPS = {
  and: (a, b) => a & b,
  or: (a, b) => a | b,
  xor: (a, b) => a ^ b,
  nand: (a, b) => ~(a & b),
  nor: (a, b) => ~(a | b),
  xnor: (a, b) => ~(a ^ b),
  not: (a) => ~a,
};

// Splitter branches are electrically the corresponding bit of their bus.
// Union those bit keys so every driven zero counts as much as a driven one.
function splitterBitGroups(parts) {
  const { parent, find, union } = createUnionFind();
  const key = (net, bit) => `${net}|${bit}`;
  for (const part of parts) {
    if (!part.splitter || part.ins[0] === null) continue;
    part.outs.forEach((net, bit) => {
      if (net !== null) union(key(net, 0), key(part.ins[0], bit));
    });
  }
  const groups = new Map();
  for (const item of parent.keys()) {
    const root = find(item);
    if (!groups.has(root)) groups.set(root, []);
    const separator = item.lastIndexOf("|");
    groups.get(root).push([item.slice(0, separator), Number(item.slice(separator + 1))]);
  }
  return [...groups.values()];
}

// One walker for every kind of part the UI needs to find, including nested
// modules; callers pass a predicate and get a path → component map.
export function partsInBoard(board, matches, prefix = "", depth = 0) {
  const parts = new Map();
  for (const component of board.components) {
    const path = `${prefix}${component.id}`;
    if (matches(component)) parts.set(path, component);
    if (component.t === "module" && depth < MAX_MODULE_DEPTH)
      for (const [id, part] of partsInBoard(moduleBoard(component.module, depth + 1), matches, `${path}/`, depth + 1))
        parts.set(id, part);
  }
  return parts;
}

export function clocksInBoard(board, prefix = "", depth = 0) {
  return partsInBoard(board, (component) => component.t === "clock", prefix, depth);
}

export function buttonsInBoard(board, prefix = "", depth = 0) {
  return partsInBoard(board, (component) => component.t === "button", prefix, depth);
}

const STORED_TYPES = new Set(["register", "counter", "ram"]);

export function storedInBoard(board, prefix = "", depth = 0) {
  return partsInBoard(board, (component) => STORED_TYPES.has(component.t), prefix, depth);
}

function blockOutputs(kind, inputs, size, channels = 2) {
  const mask = bitMask(size) >>> 0;
  const [a = 0, b = 0, control = 0] = inputs;
  const left = (a & mask) >>> 0;
  const right = (b & mask) >>> 0;
  switch (kind) {
    case "mux": {
      const selected = inputs[channels] ?? 0;
      return [selected < channels ? ((inputs[selected] ?? 0) & mask) >>> 0 : 0];
    }
    case "demux": return Array.from({ length: channels }, (_, index) =>
      (b === index ? left : 0));
    case "adder": {
      const sum = left + right + (control & 1);
      return [Number(sum > mask), (sum & mask) >>> 0];
    }
    case "sub": {
      const difference = left - right - (control & 1);
      return [Number(difference < 0), (difference & mask) >>> 0];
    }
    case "twos": return [(-left & mask) >>> 0];
    case "comparator": return [Number(left < right), Number(left === right), Number(left > right)];
    case "shl": return [((left << (b & 31)) & mask) >>> 0];
    case "shr": return [(left >>> (b & 31)) >>> 0];
    default: return [];
  }
}

function buildUnionFind(board) {
  const { find, union } = createUnionFind();
  const atPoint = new Map();
  for (const edge of board.wires.values()) {
    for (const point of edgePoints(edge)) {
      const pointKey = point.join(",");
      if (!atPoint.has(pointKey)) atPoint.set(pointKey, []);
      atPoint.get(pointKey).push(edge);
    }
  }
  for (const [point, edges] of atPoint) {
    const junction = board.junctions?.has(point);
    // A pin only splits the crossing rule, and only a four-way point can cross.
    const pin = !junction && edges.length === 4 &&
      pinsAtPoint(board, ...point.split(",").map(Number)).length > 0;
    for (const group of connectedGroups(edges, { junction, pin }))
      for (const edge of group.slice(1)) union(edgeKey(group[0]), edgeKey(edge));
  }
  // Portals connect their attached wire nets by label, like an invisible wire.
  // Unwired portals do not define a net and may be resized independently.
  const portals = new Map();
  let portalWidthMismatch = false;
  for (const component of board.components) {
    if (component.t !== "portal") continue;
    const pin = pinsFor(component)[0];
    const edge = atPoint.get(`${pin.px},${pin.py}`)?.[0];
    if (!edge) continue;
    const previous = portals.get(component.label);
    if (previous) {
      if (previous.size !== pin.size) portalWidthMismatch = true;
      else union(previous.edge, edgeKey(edge));
    } else portals.set(component.label, { edge: edgeKey(edge), size: pin.size });
  }
  return { find, atPoint, portalWidthMismatch };
}

// Solve the board to a fixed point: nets carry a value, each component's
// output (or LED) follows from its inputs. Oscillating feedback is reported
// to callers so edits can reject it.
export function evaluateBoard(board, pressedButtons = new Set(), highClocks = new Set(), registerValues = new Map(), ramValues = new Map(), injectedInputs = new Map(), depth = 0, path = "") {
  const { find, atPoint, portalWidthMismatch } = buildUnionFind(board);
  const nets = new Map();
  for (const edge of board.wires.values()) {
    const root = find(edgeKey(edge));
    if (!nets.has(root)) nets.set(root, { id: root, edges: [], size: wireSize(edge), value: 0, on: false });
    nets.get(root).edges.push(edge);
  }

  const netAt = (pin) => {
    const edge = atPoint.get(`${pin.px},${pin.py}`)?.[0];
    return edge ? find(edgeKey(edge)) : null;
  };
  const parts = board.components.map((component) => {
    const entry = spec(component.t);
    const pins = pinsFor(component);
    return {
      id: component.id,
      op: entry.op,
      momentary: !!entry.momentary,
      toggle: !!entry.toggle,
      clock: !!entry.clock,
      clockEnabled: component.enable !== false,
      register: !!entry.register,
      counter: !!entry.counter,
      storedValue: (registerValues.get(`${path}${component.id}`) ?? 0) & bitMask(bitWidth(component)),
      constant: !!(entry.constant || entry.input),
      constantValue: component.value ?? 0,
      injectedValue: injectedInputs.get(component.id),
      module: entry.module ? component.module : null,
      rom: !!entry.rom,
      romData: entry.rom ? new Map(component.data ?? []) : null,
      ram: !!entry.ram,
      ramData: entry.ram ? ramValues.get(`${path}${component.id}`) ?? new Map() : null,
      addressSize: entry.rom || entry.ram ? addressWidth(component) : 0,
      output: !!entry.output,
      debug: !!entry.debug,
      tag: !!entry.tag,
      splitter: !!entry.splitter,
      block: entry.block,
      channels: channelCount(component),
      size: bitWidth(component),
      ins: pins.filter((pin) => pin.role === "in").map(netAt),
      outs: pins.filter((pin) => pin.role === "out")
        .sort((a, b) => (a.bit ?? 0) - (b.bit ?? 0)).map(netAt),
    };
  });
  const splitterGroups = splitterBitGroups(parts);
  const outputOf = (part, values) => {
    if (part.constant) return part.injectedValue ?? part.constantValue;
    if (part.rom) {
      const address = part.ins[0] === null ? 0 : (values.get(part.ins[0]) ?? 0);
      return part.romData.get(address % (2 ** part.addressSize)) ?? 0;
    }
    if (part.ram) {
      const address = part.ins[0] === null ? 0 : (values.get(part.ins[0]) ?? 0);
      return part.ramData.get(address % (2 ** part.addressSize)) ?? 0;
    }
    if (part.momentary) return Number(pressedButtons.has(part.id));
    if (part.toggle) return part.constantValue;
    if (part.clock) return Number(part.clockEnabled && highClocks.has(part.id));
    if (part.register || part.counter) return part.storedValue >>> 0;
    if (part.block) {
      const inputs = part.ins.map((root) => root === null ? 0 : (values.get(root) ?? 0));
      const outputs = blockOutputs(part.block, inputs, part.size, part.channels);
      return outputs[part.block === "adder" || part.block === "sub" ? 1 : 0];
    }
    if (part.splitter) {
      const bus = part.ins[0] === null ? 0 : (values.get(part.ins[0]) ?? 0);
      return part.outs.reduce((value, root, bit) =>
        value | (((root === null ? 0 : (values.get(root) ?? 0)) & 1) << bit), bus) >>> 0;
    }
    if (!part.op) return 0;
    const [a, b] = part.ins.map((root) => root === null ? 0 : (values.get(root) ?? 0));
    return (GATE_OPS[part.op](a, b) & bitMask(part.size)) >>> 0;
  };

  const moduleEvaluation = (part, values) => {
    if (!part.module || depth >= MAX_MODULE_DEPTH) return { outputs: [], states: new Map() };
    const inner = moduleBoard(part.module, depth + 1);
    const ports = modulePorts({ module: part.module });
    const inputs = new Map();
    let index = 0;
    for (const port of ports) if (port.role === "in") {
      const root = part.ins[index++];
      inputs.set(port.id, root === null ? 0 : (values.get(root) ?? 0));
    }
    const prefix = `${part.id}/`;
    const innerButtons = new Set([...pressedButtons].filter((id) => id.startsWith(prefix))
      .map((id) => id.slice(prefix.length)));
    const innerClocks = new Set([...highClocks].filter((id) => id.startsWith(prefix))
      .map((id) => id.slice(prefix.length)));
    const result = evaluateBoard(inner, innerButtons, innerClocks, registerValues, ramValues, inputs, depth + 1, `${path}${part.id}/`);
    return { outputs: ports.filter((port) => port.role === "out")
      .map((port) => result.states.get(port.id)?.value ?? 0), states: result.states };
  };

  let values = new Map();
  let settled = false;
  let changingNets = new Set();
  for (let round = 0; round <= board.components.length; round++) {
    const next = new Map();
    const drive = (root, output) => {
      if (root !== null && output) next.set(root, ((next.get(root) ?? 0) | output) >>> 0);
    };
    for (const part of parts) {
      if (part.splitter) continue;
      if (part.module) {
        moduleEvaluation(part, values).outputs.forEach((output, index) => drive(part.outs[index], output));
      } else if (part.block) {
        const inputs = part.ins.map((root) => root === null ? 0 : (values.get(root) ?? 0));
        blockOutputs(part.block, inputs, part.size, part.channels).forEach((output, index) => drive(part.outs[index], output));
      } else {
        const output = outputOf(part, values);
        for (const root of part.outs) drive(root, output);
      }
    }
    // Splitter pins are the same electrical bits. Resolve them in this round;
    // feeding last round's branch values back into the bus can retain stale bits.
    for (const group of splitterGroups) {
      if (group.some(([net, bit]) => ((next.get(net) ?? 0) >>> bit) & 1)) {
        for (const [net, bit] of group) next.set(net, ((next.get(net) ?? 0) | (1 << bit)) >>> 0);
      }
    }
    let stable = next.size === values.size;
    if (stable) for (const [root, value] of next) {
      if (values.get(root) !== value) { stable = false; break; }
    }
    changingNets = new Set([...new Set([...values.keys(), ...next.keys()])]
      .filter((root) => (values.get(root) ?? 0) !== (next.get(root) ?? 0)));
    values = next;
    if (stable) { settled = true; break; }
  }

  const states = new Map();
  for (const part of parts) {
    const inputs = part.ins.map((root) => root === null ? 0 : (values.get(root) ?? 0));
    const moduleResult = part.module ? moduleEvaluation(part, values) : null;
    const outputs = moduleResult?.outputs ?? null;
    const value = part.output || part.debug || part.tag ? inputs[0] : part.module ? (outputs[0] ?? 0) : outputOf(part, values);
    const actualOutputs = outputs ?? (part.block ? blockOutputs(part.block, inputs, part.size, part.channels)
      : part.splitter ? part.outs.map((_, bit) => (value >>> bit) & 1)
      : part.outs.map(() => value));
    states.set(part.id, {
      inputs,
      value,
      outputs: actualOutputs,
      lit: inputs.length === 1 && inputs[0] !== 0,
      faceStates: moduleResult?.states,
    });
  }
  for (const net of nets.values()) {
    net.value = values.get(net.id) ?? 0;
    net.on = net.value !== 0;
  }
  return { nets, states, settled, changingNets, portalWidthMismatch };
}

export function netContaining(board, key, evaluation = evaluateBoard(board)) {
  for (const net of evaluation.nets.values()) {
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
  if (shortCircuitError(board)) {
    for (const edge of net.edges) board.wires.get(edgeKey(edge)).size = net.size;
    return false;
  }
  return true;
}
