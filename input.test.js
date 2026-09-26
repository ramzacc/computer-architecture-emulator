import test from "node:test";
import assert from "node:assert/strict";
import { dimsOf, pinsFor, spec } from "./public/components.js";
import { addComponent, addWireEdge, createBoard, evaluateBoard, parseDocument, serialize } from "./public/model.js";
import { BoardEditor } from "./public/editor.js";
import { createRenderer } from "./public/renderer.js";

test("input bits drive a matching output, with a tile per bit and two pin sides", () => {
  const board = createBoard();
  const input = { id: "in", t: "input", x: 0, y: 0, r: 2, size: 4, value: 0b1010, label: "Address" };
  const output = { id: "out", t: "output", x: 3, y: 0, r: 0, size: 4, label: "Bus" };
  assert.equal(addComponent(board, input), true);
  assert.equal(addComponent(board, output), true);
  assert.deepEqual(dimsOf(input), { w: 2, h: 5 });
  assert.deepEqual(dimsOf(output), { w: 2, h: 5 });
  assert.deepEqual(pinsFor(input)[0].edge, { o: "H", x: 2, y: 1 });
  assert.deepEqual(pinsFor(output)[0].edge, { o: "H", x: 2, y: 1 });
  assert.equal(addWireEdge(board, { o: "H", x: 2, y: 1, size: 4 }), true);
  assert.equal(evaluateBoard(board).states.get("out").value, 10);
  const art = createRenderer(null, () => null, () => null, () => new Set(), () => new Set()).componentArt;
  const inputArt = art(input, spec("input"));
  assert.equal((inputArt.match(/class="bit-tile interactive"/g) ?? []).length, 4);
  assert.match(inputArt, /data-bit="3"/);
  assert.match(inputArt, />Address<\/text>/);
  assert.match(art(output, spec("output"), 10), />Bus<\/text>/);
  const restored = parseDocument(serialize(board)).board;
  assert.equal(restored.components[0].label, "Address");
  assert.equal(restored.components[1].label, "Bus");
  assert.equal(evaluateBoard(restored).states.get(restored.components[1].id).value, 10);
});

test("input bit toggles and labels persist; rotating moves its pin to the other side", () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const input = editor.place("input", 0, 0);
  assert.ok(input);
  assert.equal(editor.resizeComponent(input.id, 4), true);
  assert.equal(editor.toggleInputBit(input.id, 2), true);
  assert.equal(editor.component(input.id).value, 4);
  assert.equal(editor.setLabel(input.id, "Enable"), true);
  assert.equal(editor.rotate(input.id), true);
  assert.equal(editor.component(input.id).r, 2);
  assert.equal(pinsFor(editor.component(input.id))[0].dir, "E");
  assert.equal(editor.rotate(input.id), true);
  assert.equal(editor.component(input.id).r, 0);
  assert.equal(editor.toggleInputBit(input.id, 4), false);
});

test("older output tuples load with an empty label", () => {
  const board = parseDocument(JSON.stringify({ components: [["output", 0, 0, 0, 1, 0]], wires: [] })).board;
  assert.equal(board.components[0].label, "");
  assert.deepEqual(dimsOf(board.components[0]), { w: 2, h: 2 });
});
