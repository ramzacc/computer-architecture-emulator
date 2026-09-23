import test from "node:test";
import assert from "node:assert/strict";
import { dimsOf, pinsFor, spec } from "./components.js";
import { addComponent, addWireEdge, canPlaceEdge, computeNets, createBoard,
  edgeKey, evaluateBoard, isValidComponent, parseDocument, resizeNet, sanitizeWires, serialize } from "./model.js";

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
  addComponent(board, { id: "p", t: "power", x: 1, y: 1, r: 0 }); // out edge V:2,2
  addComponent(board, { id: "l", t: "led", x: 1, y: 3, r: 0 });   // in edge V:2,2
  assert.equal(canPlaceEdge(board, { o: "H", x: 6, y: 6 }), false);
  assert.equal(addWireEdge(board, { o: "V", x: 2, y: 2 }), true);
  const [net] = computeNets(board).values();
  assert.equal(net.on, true);
  assert.equal(net.edges.length, 1);
  assert.equal(evaluateBoard(board).states.get("l").lit, true);
  board.components.push({ id: "x", t: "led", x: 0, y: 2, r: 0 });
  sanitizeWires(board);
  assert.equal(board.wires.has(edgeKey({ o: "V", x: 2, y: 2 })), false);
});

test("gates compute their output from the input nets", () => {
  const board = createBoard(12, 12);
  addComponent(board, { id: "p1", t: "power", x: 0, y: 0, r: 0 }); // out edge V:1,1
  addComponent(board, { id: "p2", t: "power", x: 2, y: 0, r: 0 }); // out edge V:3,1
  addComponent(board, { id: "g", t: "and", x: 0, y: 3, r: 0 });   // in V:1,2 V:3,2, out V:2,5
  addComponent(board, { id: "p3", t: "power", x: 6, y: 0, r: 0 }); // out edge V:7,1
  addComponent(board, { id: "p4", t: "power", x: 8, y: 0, r: 0 }); // out edge V:9,1
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
  assert.equal(saved.version, 6);
  assert.equal(saved.components[0].size, 32);
  assert.equal(saved.wires[0].size, 32);
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);
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
