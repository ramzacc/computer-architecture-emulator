import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { dimsOf, pinsFor, spec } from "./components.js";
import { addComponent, addWireEdge, canPlaceEdge, computeNets, createBoard,
  edgeKey, evaluateBoard, isValidComponent, parseDocument, resizeNet, sanitizeWires, serialize, wireRoute } from "./model.js";

test("wire routes use a clear bend and reject blocked paths", () => {
  const board = createBoard();
  addComponent(board, { id: "p", t: "power", x: 1, y: 0, r: 0 });
  const route = wireRoute(board, { x: 0, y: 1 }, { x: 4, y: 3 }, 1);
  assert.equal(route.error, null);
  assert.deepEqual(route.edges.map(edgeKey), [
    "V:0,1", "V:0,2", "H:0,3", "H:1,3", "H:2,3", "H:3,3",
  ]);
  assert.equal(wireRoute(board, { x: 0, y: 1 }, { x: 4, y: 1 }, 1).error,
    "Wire is blocked by a component.");
  assert.equal(board.wires.size, 0);
});

test("component geometry rotates pins and rejects overlap", () => {
  const board = createBoard(10, 10);
  const gate = { id: "c1", t: "and", x: 1, y: 1, r: 0 };
  assert.equal(addComponent(board, gate), true);
  assert.equal(addComponent(board, { id: "c2", t: "led", x: 2, y: 2, r: 0 }), false);
  assert.equal(isValidComponent(board, { id: "c2", t: "led", x: 5, y: 2.5, r: 0 }), false);
  assert.equal(spec("__proto__"), null);
  gate.r = 1;
  assert.deepEqual(dimsOf(gate), { w: 2, h: 4 });
  const input = pinsFor(gate).find((pin) => pin.role === "in" && pin.px === 3 && pin.py === 2);
  assert.deepEqual(input.edge, { o: "H", x: 3, y: 2 });

  gate.r = 2;
  assert.deepEqual(dimsOf(gate), { w: 4, h: 2 });
  assert.deepEqual(
    pinsFor(gate).map((pin) => [pin.px, pin.py, pin.dir]),
    [[4, 3, "S"], [2, 3, "S"], [3, 1, "N"]],
  );

  gate.r = 3;
  assert.deepEqual(dimsOf(gate), { w: 2, h: 4 });
  assert.deepEqual(
    pinsFor(gate).map((pin) => [pin.px, pin.py, pin.dir]),
    [[1, 4, "W"], [1, 2, "W"], [3, 3, "E"]],
  );
});

test("a power net drives an LED and sanitizes after edits", () => {
  const board = createBoard(10, 10);
  addComponent(board, { id: "p", t: "power", x: 1, y: 0, r: 0 }); // out edge V:2,2
  addComponent(board, { id: "l", t: "led", x: 1, y: 3, r: 0 });   // in edge V:2,2
  assert.equal(canPlaceEdge(board, { o: "H", x: 6, y: 6 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 2, y: 2 }), true);
  const [net] = computeNets(board).values();
  assert.equal(net.on, true);
  assert.equal(net.edges.length, 1);
  assert.equal(evaluateBoard(board).states.get("l").lit, true);
  board.components.push({ id: "x", t: "power", x: 1, y: 2, r: 0 });
  sanitizeWires(board);
  assert.equal(board.wires.has(edgeKey({ o: "V", x: 2, y: 2 })), false);
});

test("older power circuits keep their output connections after the 2x2 resize", () => {
  const text = readFileSync(new URL("./examples/power-led.json", import.meta.url), "utf8");
  const { board, skipped } = parseDocument(text);
  assert.deepEqual(skipped, { components: 0, wires: 0 });
  const power = board.components.find((component) => component.t === "power");
  assert.deepEqual(dimsOf(power), { w: 2, h: 2 });
  assert.deepEqual(pinsFor(power)[0].edge, { o: "V", x: 3, y: 2 });
  assert.equal(evaluateBoard(board).states.get("c2").lit, true);

  const rotated = parseDocument(JSON.stringify({ version: 7, components: [
    { t: "power", x: 10, y: 10, r: 3 },
  ], wires: [{ o: "H", x: 11, y: 11, size: 1 }] }));
  assert.deepEqual(rotated.skipped, { components: 0, wires: 0 });
  assert.deepEqual(pinsFor(rotated.board.components[0])[0].edge, { o: "H", x: 11, y: 11 });
});

test("wires can follow component borders but cannot cross their interiors", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "p", t: "power", x: 3, y: 1, r: 0 }), true);
  assert.equal(addComponent(board, { id: "l", t: "led", x: 4, y: 4, r: 0 }), true);

  // The power pin reaches the LED's top edge, including a point that is not a pin.
  for (const edge of [
    { o: "V", x: 4, y: 3 },
    { o: "H", x: 4, y: 4 },
    { o: "H", x: 5, y: 4 },
    { o: "V", x: 6, y: 4 },
    { o: "V", x: 6, y: 5 },
    { o: "H", x: 5, y: 6 },
    { o: "H", x: 4, y: 6 },
    { o: "V", x: 4, y: 5 },
    { o: "V", x: 4, y: 4 },
  ]) assert.equal(addWireEdge(board, edge), true, JSON.stringify(edge));

  assert.equal(canPlaceEdge(board, { o: "V", x: 5, y: 4 }), false);
  assert.equal(canPlaceEdge(board, { o: "H", x: 4, y: 5 }), false);
  sanitizeWires(board);
  assert.equal(board.wires.size, 9);

  const { board: imported, skipped } = parseDocument(serialize(board));
  assert.deepEqual(skipped, { components: 0, wires: 0 });
  assert.equal(imported.wires.size, 9);
});

test("a wire can start anywhere on a component border", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "l", t: "led", x: 4, y: 4, r: 0 }), true);
  for (const edge of [
    { o: "H", x: 4, y: 4 }, { o: "H", x: 5, y: 4 },
    { o: "V", x: 6, y: 4 }, { o: "V", x: 6, y: 5 },
    { o: "H", x: 4, y: 6 }, { o: "H", x: 5, y: 6 },
    { o: "V", x: 4, y: 4 }, { o: "V", x: 4, y: 5 },
  ]) assert.equal(addWireEdge(board, edge), true, JSON.stringify(edge));
  assert.equal(board.wires.size, 8);
  assert.equal(canPlaceEdge(board, { o: "H", x: 4, y: 5 }), false);
});

test("gates compute their output from the input nets", () => {
  const board = createBoard(12, 12);
  addComponent(board, { id: "p1", t: "power", x: 0, y: -1, r: 0 }); // out edge V:1,1
  addComponent(board, { id: "p2", t: "power", x: 2, y: -1, r: 0 }); // out edge V:3,1
  addComponent(board, { id: "g", t: "and", x: 0, y: 3, r: 0 });   // in V:1,2 V:3,2, out V:2,5
  addComponent(board, { id: "p3", t: "power", x: 6, y: -1, r: 0 }); // out edge V:7,1
  addComponent(board, { id: "p4", t: "power", x: 8, y: -1, r: 0 }); // out edge V:9,1
  addComponent(board, { id: "h", t: "nand", x: 6, y: 3, r: 0 });  // in V:7,2 V:9,2, out V:8,5
  for (const wire of [
    { o: "V", x: 1, y: 1 }, { o: "V", x: 1, y: 2 },
    { o: "V", x: 3, y: 1 }, { o: "V", x: 3, y: 2 },
    { o: "V", x: 7, y: 1 }, { o: "V", x: 7, y: 2 },
    { o: "V", x: 9, y: 1 }, { o: "V", x: 9, y: 2 },
  ]) assert.equal(addWireEdge(board, wire), true, `wire ${JSON.stringify(wire)}`);
  const { states } = evaluateBoard(board);
  assert.equal(states.get("g").value, 1);
  assert.equal(states.get("h").value, 0);
});

test("documents persist all four orientations", () => {
  const board = createBoard(10, 10);
  addComponent(board, { id: "c1", t: "power", x: 1, y: 1, r: 3 });
  const saved = JSON.parse(serialize(board));
  assert.deepEqual(saved.components, [{ t: "power", x: 1, y: 1, r: 3 }]);
  const { board: reloaded, skipped } = parseDocument(JSON.stringify(saved));
  assert.deepEqual(skipped, { components: 0, wires: 0 });
  assert.equal(reloaded.components[0].r, 3);
  assert.deepEqual(JSON.parse(serialize(reloaded)), saved);
});

test("imports skip overlap and malformed wires without changing the schema", () => {
  const text = JSON.stringify({ version: 5, grid: { cols: 10, rows: 10 }, components: [
    { t: "and", x: 1, y: 1 }, { t: "led", x: 2, y: 2 }, { t: "power", x: 6, y: 6 },
    { t: "nand", x: 0, y: 6 },
  ], wires: [
    { o: "H", x: 0, y: 9, on: true }, { o: "H", x: 4.5, y: 2 }, { o: "X", x: 1, y: 1 },
  ] });
  const { board, skipped } = parseDocument(text);
  assert.deepEqual(skipped, { components: 1, wires: 2 });
  assert.equal(board.components.length, 3);
  assert.equal(board.wires.size, 1);
  const saved = JSON.parse(serialize(board));
  assert.deepEqual(saved.wires, [{ o: "H", x: 0, y: 9, size: 1 }]);
  assert.deepEqual(JSON.parse(serialize(parseDocument(serialize(board)).board)), saved);
});


test("bus sizes must match connected wires and gate pins", () => {
  const board = createBoard();
  addComponent(board, { id: "g", t: "and", x: 0, y: 2, r: 0, size: 8 });
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 1, size: 1 }), false);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 1, size: 8 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 0, size: 4 }), false);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 0, size: 8 }), true);
  assert.equal(resizeNet(board, "V:1,1", 4), false);
  assert.equal(board.wires.get("V:1,1").size, 8);
  assert.equal(resizeNet(board, "V:1,1", 8), true);
  assert.equal(addWireEdge(board, { o: "V", x: 3, y: 1, size: 33 }), false);
});

test("32 bit NAND uses a full width mask and persists sizes", () => {
  const board = createBoard();
  addComponent(board, { id: "n", t: "nand", x: 0, y: 0, r: 0, size: 32 });
  assert.equal(addWireEdge(board, { o: "V", x: 2, y: 2, size: 32 }), true);
  const result = evaluateBoard(board);
  assert.equal(result.states.get("n").value, 0xffffffff);
  assert.equal([...result.nets.values()][0].value, 0xffffffff);
  const saved = JSON.parse(serialize(board));
  assert.equal(saved.version, 8);
  assert.equal(saved.components[0].size, 32);
  assert.equal(saved.wires[0].size, 32);
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);
});

test("NOT is a rotatable 2x2 gate and inverts every bit of its selected width", () => {
  const board = createBoard();
  const constant = { id: "k", t: "constant", x: 0, y: 0, r: 0, size: 4, value: 0b0101 };
  const inverter = { id: "n", t: "not", x: 0, y: 4, r: 0, size: 4 };
  assert.equal(addComponent(board, constant), true);
  assert.equal(addComponent(board, inverter), true);
  assert.deepEqual(dimsOf(inverter), { w: 2, h: 2 });
  assert.deepEqual(pinsFor(inverter).map(({ px, py, role, size }) => [px, py, role, size]),
    [[1, 4, "in", 4], [1, 6, "out", 4]]);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 2, size: 4 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 3, size: 4 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 6, size: 4 }), true);
  assert.equal(evaluateBoard(board).states.get("n").value, 0b1010);
  assert.equal([...computeNets(board).values()].find((net) => net.edges.some((edge) => edge.y === 6)).value, 0b1010);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 7, size: 1 }), false);
  const saved = JSON.parse(serialize(board));
  assert.deepEqual(saved.components[1], { t: "not", x: 0, y: 4, size: 4 });
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);

  const wide = createBoard();
  const wideInverter = { id: "wide", t: "not", x: 3, y: 3, r: 1, size: 32 };
  assert.equal(addComponent(wide, wideInverter), true);
  assert.deepEqual(dimsOf(wideInverter), { w: 2, h: 2 });
  assert.deepEqual(pinsFor(wideInverter).map(({ px, py, dir }) => [px, py, dir]),
    [[5, 4, "E"], [3, 4, "W"]]);
  assert.equal(evaluateBoard(wide).states.get("wide").value, 0xffffffff);
});

test("constant drives its configured value and enforces its width and range", () => {
  const board = createBoard();
  const constant = { id: "k", t: "constant", x: 0, y: 0, r: 0, size: 8, value: 173 };
  assert.equal(addComponent(board, constant), true);
  assert.deepEqual(dimsOf(constant), { w: 2, h: 2 });
  assert.equal(pinsFor(constant)[0].size, 8);
  assert.deepEqual(pinsFor(constant)[0].edge, { o: "V", x: 1, y: 2 });
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 2, size: 1 }), false);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 2, size: 8 }), true);
  assert.equal(evaluateBoard(board).states.get("k").value, 173);
  assert.equal([...computeNets(board).values()][0].value, 173);
  const saved = JSON.parse(serialize(board));
  assert.equal(saved.version, 8);
  assert.deepEqual(saved.components[0], { t: "constant", x: 0, y: 0, size: 8, value: 173 });
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);
  constant.value = 256;
  assert.equal(isValidComponent(board, constant), false);
  constant.value = -1;
  assert.equal(isValidComponent(board, constant), false);
  constant.value = 1.5;
  assert.equal(isValidComponent(board, constant), false);
  constant.value = 0;
  constant.size = 9;
  assert.equal(isValidComponent(board, constant), false);
  const invalid = parseDocument(JSON.stringify({ components: [
    { t: "constant", x: 0, y: 0, size: 9, value: 1 },
    { t: "constant", x: 3, y: 0, size: 2, value: 4 },
  ] }));
  assert.equal(invalid.skipped.components, 2);
});

test("ALU selects arithmetic and logic operations and drives result flags", () => {
  const board = createBoard();
  for (const component of [
    { id: "a", t: "constant", x: 0, y: 0, r: 0, size: 4, value: 7 },
    { id: "b", t: "constant", x: 2, y: 0, r: 0, size: 4, value: 3 },
    { id: "op", t: "constant", x: 4, y: 0, r: 0, size: 2, value: 0 },
    { id: "alu", t: "alu", x: 0, y: 4, r: 0, size: 4 },
  ]) assert.equal(addComponent(board, component), true);
  assert.deepEqual(pinsFor(board.components[3]).map(({ name, size }) => [name, size]),
    [["A", 4], ["B", 4], ["OP", 2], ["C", 1], ["R", 4], ["Z", 1]]);
  for (const [x, size] of [[1, 4], [3, 4], [5, 2]]) {
    for (const y of [2, 3]) assert.equal(addWireEdge(board, { o: "V", x, y, size }), true);
  }
  for (const [x, size] of [[1, 1], [3, 4], [5, 1]])
    assert.equal(addWireEdge(board, { o: "V", x, y: 7, size }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 5, y: 1, size: 4 }), false);

  const state = () => evaluateBoard(board).states.get("alu");
  const nets = () => [...computeNets(board).values()].filter((net) => net.edges.some((edge) => edge.y === 7))
    .sort((a, b) => a.edges[0].x - b.edges[0].x).map((net) => net.value);
  assert.deepEqual([state().value, state().carry, state().zero], [10, 0, 0]);
  assert.deepEqual(nets(), [0, 10, 0]);
  board.components[2].value = 1;
  assert.deepEqual([state().value, state().carry, state().zero], [4, 1, 0]);
  board.components[0].value = 2;
  assert.deepEqual([state().value, state().carry, state().zero], [15, 0, 0]);
  board.components[2].value = 2;
  assert.deepEqual([state().value, state().carry, state().zero], [2, 0, 0]);
  board.components[2].value = 3;
  assert.deepEqual([state().value, state().carry, state().zero], [3, 0, 0]);
  board.components[0].value = 3;
  board.components[2].value = 1;
  assert.deepEqual([state().value, state().carry, state().zero], [0, 1, 1]);
  board.components[0].value = 15;
  board.components[1].value = 1;
  board.components[2].value = 0;
  assert.deepEqual([state().value, state().carry, state().zero], [0, 1, 1]);

  const saved = JSON.parse(serialize(board));
  assert.deepEqual(saved.components[3], { t: "alu", x: 0, y: 4, size: 4 });
  assert.deepEqual(parseDocument(JSON.stringify(saved)).skipped, { components: 0, wires: 0 });
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);
  const rotated = { id: "rotated", t: "alu", x: 10, y: 0, r: 1, size: 32 };
  assert.equal(addComponent(board, rotated), true);
  assert.deepEqual(dimsOf(rotated), { w: 3, h: 6 });
  assert.deepEqual(pinsFor(rotated).map(({ size }) => size), [32, 32, 2, 1, 32, 1]);
});

test("imports reject mixed width connections", () => {
  const data = { components: [{ t: "and", x: 0, y: 2, size: 8 }], wires: [
    { o: "V", x: 1, y: 1, size: 8 },
    { o: "V", x: 1, y: 0, size: 4 },
    { o: "V", x: 3, y: 1, size: 1 },
    { o: "V", x: 3, y: 0, size: 8 },
  ] };
  const { board, skipped } = parseDocument(JSON.stringify(data));
  assert.equal(board.wires.size, 2);
  assert.equal(skipped.wires, 2);
});

test("splitter has one ordered one-bit branch per bus bit", () => {
  const board = createBoard();
  const nand = { id: "n", t: "nand", x: 0, y: 0, r: 0, size: 4 };
  const splitter = { id: "s", t: "splitter", x: 0, y: 4, r: 0, size: 4 };
  assert.equal(addComponent(board, nand), true);
  assert.equal(addComponent(board, splitter), true);
  assert.deepEqual(dimsOf(splitter), { w: 2, h: 5 });
  assert.deepEqual(pinsFor(splitter).map(({ px, py, size, bit }) => [px, py, size, bit]),
    [[1, 4, 4, undefined], [2, 5, 1, 0], [2, 6, 1, 1], [2, 7, 1, 2], [2, 8, 1, 3]]);
  for (const edge of [
    { o: "V", x: 2, y: 2, size: 4 }, { o: "H", x: 1, y: 3, size: 4 },
    { o: "V", x: 1, y: 3, size: 4 },
    ...[5, 6, 7, 8].map((y) => ({ o: "H", x: 2, y, size: 1 })),
  ]) assert.equal(addWireEdge(board, edge), true, JSON.stringify(edge));
  assert.equal(addWireEdge(board, { o: "H", x: 3, y: 5, size: 4 }), false);
  const logic = evaluateBoard(board);
  assert.equal(logic.states.get("s").value, 15);
  for (const y of [5, 6, 7, 8]) {
    const net = [...logic.nets.values()].find((n) => n.edges.some((e) => edgeKey(e) === `H:2,${y}`));
    assert.equal(net.value, 1);
    assert.equal(net.size, 1);
  }
  const saved = JSON.parse(serialize(board));
  assert.equal(saved.components.find((c) => c.t === "splitter").size, 4);
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);
});

test("splitter rotation and size changes adjust its footprint", () => {
  const board = createBoard();
  const splitter = { id: "s", t: "splitter", x: 0, y: 0, r: 1, size: 3 };
  assert.equal(addComponent(board, splitter), true);
  assert.deepEqual(dimsOf(splitter), { w: 4, h: 2 });
  assert.deepEqual(pinsFor(splitter).map(({ px, py, dir, size }) => [px, py, dir, size]),
    [[4, 1, "E", 3], [3, 2, "S", 1], [2, 2, "S", 1], [1, 2, "S", 1]]);
  splitter.size = 33;
  assert.equal(isValidComponent(board, splitter), false);
});

test("descendant splitter order reverses branch bits and persists", () => {
  const board = createBoard();
  const source = { id: "k", t: "constant", x: 0, y: 0, r: 0, size: 4, value: 1 };
  const splitter = { id: "s", t: "splitter", x: 0, y: 4, r: 0, size: 4, order: "descendant" };
  assert.equal(addComponent(board, source), true);
  assert.equal(addComponent(board, splitter), true);
  assert.deepEqual(pinsFor(splitter).slice(1).map(({ py, bit }) => [py, bit]),
    [[5, 3], [6, 2], [7, 1], [8, 0]]);
  for (const wire of [
    { o: "V", x: 1, y: 2, size: 4 }, { o: "V", x: 1, y: 3, size: 4 },
    ...[5, 6, 7, 8].map((y) => ({ o: "H", x: 2, y, size: 1 })),
  ]) assert.equal(addWireEdge(board, wire), true);
  const nets = computeNets(board);
  for (const y of [5, 6, 7, 8]) {
    const net = [...nets.values()].find((item) => item.edges.some((edge) => edgeKey(edge) === `H:2,${y}`));
    assert.equal(net.value, y === 8 ? 1 : 0);
  }
  const saved = JSON.parse(serialize(board));
  assert.equal(saved.components.find((component) => component.t === "splitter").order, "descendant");
  const { board: reloaded, skipped } = parseDocument(JSON.stringify(saved));
  assert.deepEqual(skipped, { components: 0, wires: 0 });
  assert.deepEqual(JSON.parse(serialize(reloaded)), saved);
  splitter.order = "backward";
  assert.equal(isValidComponent(board, splitter), false);
  const legacy = parseDocument(JSON.stringify({ components: [{ t: "splitter", x: 0, y: 0, size: 2 }] }));
  assert.equal(legacy.board.components[0].order, "ascendant");
});


test("a splitter combines one-bit power branches and drives LEDs through a gate", () => {
  const text = readFileSync(new URL("./examples/splitter-combine.json", import.meta.url), "utf8");
  const { board, skipped } = parseDocument(text);
  assert.deepEqual(skipped, { components: 0, wires: 0 });
  const { states, nets } = evaluateBoard(board);
  assert.equal(states.get("c2").value, 3);
  assert.equal(states.get("c7").value, 3);
  assert.equal(states.get("c4").value, 3);
  assert.equal(states.get("c5").lit, true);
  assert.equal(states.get("c6").lit, true);
  assert.equal([...nets.values()].find((net) => net.edges.some((edge) => edgeKey(edge) === "H:6,0")).value, 3);
});
