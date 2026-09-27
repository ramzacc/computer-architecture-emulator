import test from "node:test";
import assert from "node:assert/strict";
import { dimsOf, pinsFor, spec } from "./public/components.js";
import { addComponent, addWireEdge, createBoard, evaluateBoard, parseDocument, serialize } from "./public/model.js";
import { BoardEditor } from "./public/editor.js";
import { createRenderer } from "./public/renderer.js";

test("input bits drive a matching output, with a tile per bit and two pin sides", () => {
  const board = createBoard();
  const input = { id: "in", t: "input", x: 0, y: 0, r: 2, size: 4, value: 0b1010, label: "Address" };
  const output = { id: "out", t: "output", x: 6, y: 0, r: 0, size: 4, label: "Bus" };
  assert.equal(addComponent(board, input), true);
  assert.equal(addComponent(board, output), true);
  assert.deepEqual(dimsOf(input), { w: 5, h: 2 });
  assert.deepEqual(dimsOf(output), { w: 5, h: 2 });
  assert.deepEqual(pinsFor(input)[0].edge, { o: "H", x: 5, y: 1 });
  assert.deepEqual(pinsFor(output)[0].edge, { o: "H", x: 5, y: 1 });
  assert.equal(addWireEdge(board, { o: "H", x: 5, y: 1, size: 4 }), true);
  assert.equal(evaluateBoard(board).states.get("out").value, 10);
  const art = createRenderer(null, () => null, () => null, () => new Set(), () => new Set()).componentArt;
  const inputArt = art(input, spec("input"));
  assert.equal((inputArt.match(/class="bit-tile interactive"/g) ?? []).length, 4);
  assert.match(inputArt, /data-bit="3"/);
  assert.match(inputArt, /viewBox="0 0 200 80"/);
  assert.match(inputArt, /<rect x="43" y="43" width="34"/);
  assert.match(inputArt, /<rect x="163" y="43" width="34"/);
  assert.match(inputArt, /M193 40 H200/);
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

test("output tuples require a label", () => {
  const document = { components: [["output", 0, 0, 0, 1, 0]], wires: [], junctions: [] };
  assert.throws(() => parseDocument(JSON.stringify(document)), /entries/);
  document.components[0].push("");
  const board = parseDocument(JSON.stringify(document)).board;
  assert.deepEqual(dimsOf(board.components[0]), { w: 2, h: 2 });
});

test("constant, input, and output grow to the right as bit width increases", () => {
  const art = createRenderer(null, () => null, () => null, () => new Set(), () => new Set()).componentArt;
  for (const t of ["constant", "input", "output"]) {
    const component = { t, x: 2, y: 3, r: 2, size: 8 };
    assert.deepEqual(dimsOf(component), { w: 9, h: 2 });
    assert.deepEqual(pinsFor(component)[0].edge, { o: "H", x: 11, y: 4 });
    const svg = art(component, spec(t));
    assert.match(svg, /viewBox="0 0 360 80"/);
    assert.equal((svg.match(/class="bit-tile/g) ?? []).length, 8);
    assert.match(svg, /M353 40 H360/);
  }
});
