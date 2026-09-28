import { writeFileSync } from 'node:fs';
import { addComponent, createBoard, edgeKey, edgePoints, evaluateBoard, parseDocument, serialize, wireLayoutError, wireRoute } from '../public/model.js';
import { dimsOf, pinsFor } from '../public/components.js';
import { parseProject } from '../public/project-file.js';

const board = createBoard();
const components = new Map();
let nextId = 1;

function part(key, t, x, y, options = {}) {
  const component = { id: `c${nextId++}`, t, x, y, r: 0, label: key, ...options };
  if (!addComponent(board, component)) throw new Error(`Cannot place ${key}`);
  components.set(key, component);
  return component;
}

function pin(key, name) {
  const pins = pinsFor(components.get(key));
  const found = pins.find((p) => p.name === name) ??
    (name === 'out' ? pins.find((p) => p.role === 'out') :
      name === 'in0' ? pins.filter((p) => p.role === 'in')[0] :
      name === 'in1' ? pins.filter((p) => p.role === 'in')[1] :
      name === 'in' ? pins.find((p) => p.role === 'in') : null);
  if (!found) throw new Error(`Missing pin ${key}.${name}`);
  return { x: found.px, y: found.py, size: found.size };
}

// The model permits equal-valued outputs on one net. Reject those routes here:
// two switches that are both low today would conflict as soon as one toggles.
function separateDrivers(trial) {
  const pointNet = new Map();
  for (const net of evaluateBoard(trial).nets.values())
    for (const edge of net.edges)
      for (const point of edgePoints(edge)) pointNet.set(point.join(','), net.id);
  const drivers = new Set();
  for (const component of trial.components) for (const output of pinsFor(component)) {
    if (output.role !== 'out') continue;
    const net = pointNet.get(`${output.px},${output.py}`);
    if (net === undefined) continue;
    if (drivers.has(net)) return false;
    drivers.add(net);
  }
  return true;
}

function attempt(start, end, size, via = []) {
  const trial = { ...board, wires: new Map(board.wires), junctions: new Set(board.junctions) };
  let point = start;
  for (const next of [...via, end]) {
    const route = wireRoute(trial, point, next, size);
    if (route.error) return false;
    for (const edge of route.edges) trial.wires.set(edgeKey(edge), edge);
    for (const key of route.junctions ?? []) trial.junctions.add(key);
    point = next;
  }
  if (!separateDrivers(trial)) return false;
  board.wires = trial.wires;
  board.junctions = trial.junctions;
  return true;
}

function searchRoute(start, end, size, crossings) {
  const occupied = new Map();
  for (const wire of board.wires.values()) for (const [x, y] of edgePoints(wire)) {
    const key = `${x},${y}`;
    if (!occupied.has(key)) occupied.set(key, []);
    occupied.get(key).push(wire);
  }
  const own = new Set();
  for (const net of evaluateBoard(board).nets.values()) {
    if (net.edges.some((edge) => edgePoints(edge).some(([x, y]) => x === start.x && y === start.y))) {
      for (const edge of net.edges) own.add(edgeKey(edge));
      break;
    }
  }
  const blocked = new Set();
  const pins = new Set();
  for (const component of board.components) {
    const { w, h } = dimsOf(component);
    for (let y = component.y + 1; y < component.y + h; y++)
      for (let x = component.x; x < component.x + w; x++) blocked.add(`H:${x},${y}`);
    for (let x = component.x + 1; x < component.x + w; x++)
      for (let y = component.y; y < component.y + h; y++) blocked.add(`V:${x},${y}`);
    for (const p of pinsFor(component)) pins.add(`${p.px},${p.py}`);
  }
  const dirs = [[1,0,'H'],[-1,0,'H'],[0,1,'V'],[0,-1,'V']];
  const minX = -145, maxX = 245, minY = -100, maxY = 230;
  const queue = [];
  const scores = new Map();
  const push = (item) => {
    queue.push(item);
    let n = queue.length - 1;
    while (n > 0) {
      const parent = Math.floor((n - 1) / 2);
      if (queue[parent].priority <= item.priority) break;
      queue[n] = queue[parent]; n = parent;
    }
    queue[n] = item;
  };
  const pop = () => {
    const first = queue[0], last = queue.pop();
    if (queue.length) {
      let n = 0;
      while (2*n + 1 < queue.length) {
        let child = 2*n + 1;
        if (child + 1 < queue.length && queue[child+1].priority < queue[child].priority) child++;
        if (last.priority <= queue[child].priority) break;
        queue[n] = queue[child]; n = child;
      }
      queue[n] = last;
    }
    return first;
  };
  const initial = { x: start.x, y: start.y, axis: '', crossing: false, cost: 0, prev: null, edge: null };
  push({ ...initial, priority: Math.abs(start.x-end.x)+Math.abs(start.y-end.y) });
  scores.set(`${start.x},${start.y},,0`, 0);
  let visited = 0;
  while (queue.length) {
    if (++visited > 300000) return false;
    const current = pop();
    const state = `${current.x},${current.y},${current.axis},${Number(current.crossing)}`;
    if (current.cost !== scores.get(state)) continue;
    if (current.x === end.x && current.y === end.y) {
      const edges = [];
      for (let p = current; p.edge; p = p.prev) edges.push(p.edge);
      edges.reverse();
      const trial = { ...board, wires: new Map(board.wires), junctions: new Set(board.junctions) };
      for (const edge of edges) trial.wires.set(edgeKey(edge), edge);
      if (wireLayoutError(trial) || !separateDrivers(trial)) continue;
      board.wires = trial.wires;
      return true;
    }
    for (const [dx,dy,axis] of dirs) {
      if (current.crossing && axis !== current.axis) continue;
      const x = current.x + dx, y = current.y + dy;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const edge = { o: axis, x: dx < 0 ? x : current.x, y: dy < 0 ? y : current.y, size };
      const key = edgeKey(edge);
      if (blocked.has(key)) continue;
      const existing = board.wires.get(key);
      if (existing && !own.has(key)) continue;
      const point = `${x},${y}`;
      if (pins.has(point) && !(x === end.x && y === end.y) && !(x === start.x && y === start.y)) continue;
      const touching = occupied.get(point) ?? [];
      const foreign = touching.filter((wire) => !own.has(edgeKey(wire)));
      let crossing = false;
      if (foreign.length) {
        if (!crossings || foreign.length !== 2 || foreign[0].o !== foreign[1].o ||
            foreign[0].o === axis || pins.has(point) || board.junctions.has(point)) continue;
        crossing = true;
      }
      const cost = current.cost + 1 + (current.axis && current.axis !== axis ? 2 : 0) + (crossing ? 4 : 0);
      const nextState = `${x},${y},${axis},${Number(crossing)}`;
      if (cost >= (scores.get(nextState) ?? Infinity)) continue;
      scores.set(nextState, cost);
      push({ x, y, axis, crossing, cost, prev: current, edge,
        priority: cost + Math.abs(x-end.x)+Math.abs(y-end.y) });
    }
  }
  return false;
}

function connect(fromKey, fromPin, toKey, toPin) {
  const a = pin(fromKey, fromPin), b = pin(toKey, toPin);
  if (a.size !== b.size) throw new Error(`Size mismatch ${fromKey} -> ${toKey}`);
  if (attempt(a, b, a.size)) return;
  const xs = [a.x - 8, a.x + 8, b.x - 8, b.x + 8, -100, 20, 70, 110, 140, 180, 220];
  const ys = [a.y - 8, a.y + 8, b.y - 8, b.y + 8, -30, 180];
  for (const x of xs) if (attempt(a, b, a.size, [{ x, y: a.y }, { x, y: b.y }])) return;
  for (const y of ys) if (attempt(a, b, a.size, [{ x: a.x, y }, { x: b.x, y }])) return;
  if (searchRoute(a, b, a.size, false) || searchRoute(a, b, a.size, true)) return;
  throw new Error(`Cannot wire ${fromKey}.${fromPin} -> ${toKey}.${toPin}`);
}

// Initial values, register bank, adjacent compare/swap cells, and selectors.
for (let i = 0; i < 8; i++) {
  const y = i * 22;
  part(`Value ${i}`, 'input', -70, y + 2, { size: 8, value: [7, 2, 6, 1, 5, 0, 4, 3][i] });
  part(`R${i}`, 'register', 0, y + 2, { size: 8 });
  part(`Even/Odd ${i}`, 'mux', 112, y + 2, { size: 8, channels: 2 });
  part(`Load/Sort ${i}`, 'mux', 142, y + 2, { size: 8, channels: 2 });
}
for (let i = 0; i < 7; i++) {
  const x = i % 2 === 0 ? 38 : 70;
  const y = i * 22 + 14;
  part(`Compare ${i}-${i+1}`, 'comparator', x, y, { size: 8 });
  part(`Low ${i}-${i+1}`, 'mux', x + 10, y - 10, { size: 8, channels: 2 });
  part(`High ${i}-${i+1}`, 'mux', x + 10, y + 12, { size: 8, channels: 2 });
}
part('LOAD', 'switch', -95, -20, { value: 0 });
part('RUN lock', 'switch', -85, -20, { value: 0 });
part('STEP clock', 'button', -75, -20);
part('RESET', 'button', -65, -20);
part('Run or load', 'or', -45, -20, { size: 1 });
part('Enabled clock', 'and', -30, -20, { size: 1 });
part('Phase', 'register', 85, -25, { size: 1 });
part('Next phase', 'not', 95, -40, { size: 1 });
part('Reset phase', 'or', 75, -40, { size: 1 });

connect('Next phase', 'out', 'Phase', 'D');
connect('Phase', 'Q', 'Next phase', 'in');
connect('RESET', 'out', 'Reset phase', 'in0');
connect('LOAD', 'out', 'Reset phase', 'in1');
connect('Reset phase', 'out', 'Phase', 'RESET');

for (let i = 0; i < 7; i++) {
  const suffix = `${i}-${i+1}`;
  connect(`R${i}`, 'Q', `Compare ${suffix}`, 'A');
  connect(`R${i+1}`, 'Q', `Compare ${suffix}`, 'B');
  connect(`R${i}`, 'Q', `Low ${suffix}`, 'D0');
  connect(`R${i+1}`, 'Q', `Low ${suffix}`, 'D1');
  connect(`R${i+1}`, 'Q', `High ${suffix}`, 'D0');
  connect(`R${i}`, 'Q', `High ${suffix}`, 'D1');
  connect(`Compare ${suffix}`, 'GT', `Low ${suffix}`, 'S');
  connect(`Compare ${suffix}`, 'GT', `High ${suffix}`, 'S');
}

for (let i = 0; i < 8; i++) {
  // Phase 0 compares (0,1), (2,3), (4,5), (6,7).
  const even = i % 2 === 0 ? `Low ${i}-${i+1}` : `High ${i-1}-${i}`;
  connect(even, 'Y', `Even/Odd ${i}`, 'D0');
  // The boundary registers are unchanged on phase 1.
  const odd = i === 0 || i === 7 ? `R${i}` :
    i % 2 === 1 ? `Low ${i}-${i+1}` : `High ${i-1}-${i}`;
  connect(odd, i === 0 || i === 7 ? 'Q' : 'Y', `Even/Odd ${i}`, 'D1');
  connect(`Even/Odd ${i}`, 'Y', `Load/Sort ${i}`, 'D0');
  connect(`Value ${i}`, 'out', `Load/Sort ${i}`, 'D1');
  connect(`Load/Sort ${i}`, 'Y', `R${i}`, 'D');
  connect('Phase', 'Q', `Even/Odd ${i}`, 'S');
  connect('LOAD', 'out', `Load/Sort ${i}`, 'S');
  connect('RESET', 'out', `R${i}`, 'RESET');
  connect('Enabled clock', 'out', `R${i}`, 'CLK');
}

connect('RUN lock', 'out', 'Run or load', 'in0');
connect('LOAD', 'out', 'Run or load', 'in1');
connect('Run or load', 'out', 'Enabled clock', 'in0');
connect('STEP clock', 'out', 'Enabled clock', 'in1');
connect('Enabled clock', 'out', 'Phase', 'CLK');

board.monitor.ids = [
  ...Array.from({ length: 8 }, (_, i) => components.get(`R${i}`).id),
  ...['LOAD', 'RUN lock', 'STEP clock', 'RESET', 'Phase'].map((name) => components.get(name).id),
];
for (const id of board.monitor.ids) board.monitor.formats.set(id, 'decimal');
board.monitor.breaks.add(components.get('LOAD').id);
board.monitor.breaks.add(components.get('Phase').id);

const document = JSON.parse(serialize(board));
parseDocument(JSON.stringify(document));
const project = { format: 'computer-architecture-project', version: 1, document,
  drafts: { rom: [], isa: [], assembly: [], breakpoints: [] } };
parseProject(JSON.stringify(project));
writeFileSync(new URL('../public/examples/odd-even-sorter.json', import.meta.url), JSON.stringify(project));
console.log(`Created ${board.components.length} components and ${board.wires.size} wire edges`);
