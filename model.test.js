import test from "node:test";
import assert from "node:assert/strict";
import { dimsOf, pinsFor, spec } from "./components.js";
import { addComponent, addWireEdge, canPlaceEdge, computeNets, createBoard,
  edgeKey, isValidComponent, parseDocument, sanitizeWires, serialize } from "./model.js";

test("component geometry rotates pins and rejects overlap", () => {
  const board = createBoard(8, 8);
  const cpu = { id: "c1", t: "cpu", x: 1, y: 1, r: 0 };
  assert.equal(addComponent(board, cpu), true);
  assert.equal(addComponent(board, { id: "c2", t: "ram", x: 2, y: 2, r: 0 }), false);
  assert.equal(isValidComponent(board, { id: "c2", t: "ram", x: 5, y: 2.5, r: 0 }), false);
  assert.equal(spec("__proto__"), null);
  cpu.r = 1;
  assert.deepEqual(dimsOf(cpu), { w: 2, h: 2 });
  assert.deepEqual(pinsFor(cpu).find((pin) => pin.dir === "E").edge, { o: "H", x: 3, y: 2 });
});

test("wires start at pins, connect into nets, and sanitize after edits", () => {
  const board = createBoard(8, 8);
  addComponent(board, { id: "c1", t: "cpu", x: 1, y: 1, r: 0 });
  assert.equal(canPlaceEdge(board, { o: "H", x: 6, y: 6 }), false);
  const stub = { o: "H", x: 3, y: 2 };
  assert.equal(addWireEdge(board, stub), true);
  assert.equal(addWireEdge(board, { o: "H", x: 4, y: 2 }), true);
  const [net] = computeNets(board).values();
  assert.equal(net.on, true);
  assert.equal(net.edges.length, 2);
  board.components.push({ id: "c2", t: "reg", x: 4, y: 1, r: 0 });
  sanitizeWires(board);
  assert.equal(board.wires.has(edgeKey({ o: "H", x: 4, y: 2 })), false);
});

test("imports skip overlap and malformed wires without changing the schema", () => {
  const text = JSON.stringify({ version: 4, grid: { cols: 8, rows: 8 }, components: [
    { t: "cpu", x: 1, y: 1 }, { t: "ram", x: 2, y: 2 }, { t: "rom", x: 5, y: 5 },
  ], wires: [
    { o: "H", x: 3, y: 2, on: true }, { o: "H", x: 4.5, y: 2 }, { o: "X", x: 1, y: 1 },
  ] });
  const { board, skipped } = parseDocument(text);
  assert.deepEqual(skipped, { components: 1, wires: 2 });
  assert.equal(board.components.length, 2);
  assert.equal(board.wires.size, 1);
  const saved = JSON.parse(serialize(board));
  assert.deepEqual(saved.wires, [{ o: "H", x: 3, y: 2 }]);
  assert.deepEqual(JSON.parse(serialize(parseDocument(serialize(board)).board)), saved);
});
