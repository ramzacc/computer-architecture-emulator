import test from "node:test";
import assert from "node:assert/strict";
import { insertionIndex } from "./public/monitor.js";
import { addComponent, createBoard, parseDocument, serialize } from "./public/model.js";

test("drops across and below responsive rows follow reading order", () => {
  const rects = [
    { left: 0, top: 0, width: 100, bottom: 80 },
    { left: 112, top: 0, width: 100, bottom: 80 },
    { left: 0, top: 92, width: 100, bottom: 172 },
    { left: 112, top: 92, width: 100, bottom: 172 },
  ];
  assert.equal(insertionIndex(rects, 10, -10), 0);
  assert.equal(insertionIndex(rects, 150, 40), 1);
  assert.equal(insertionIndex(rects, 300, 40), 2);
  assert.equal(insertionIndex(rects, 50, 85), 2);
  assert.equal(insertionIndex(rects, 150, 120), 3);
  assert.equal(insertionIndex(rects, 300, 400), 4);
  assert.equal(insertionIndex([], 300, 400), 0);
});

test("monitor order, formats, and incomplete rows survive JSON save and load", () => {
  const board = createBoard();
  for (const [id, t, x] of [["first", "button", 0], ["second", "tag", 4], ["third", "switch", 10]])
    assert.equal(addComponent(board, { id, t, x, y: 0, label: id }), true);
  board.monitor.ids = ["third", "first", "second"];
  board.monitor.formats.set("second", "hex");
  board.monitor.breaks.add("first");
  const document = JSON.parse(serialize(board));
  assert.deepEqual(document.monitor, [[2, "binary", false], [0, "binary", true], [1, "hex", false]]);
  const restored = parseDocument(JSON.stringify(document)).board;
  assert.deepEqual(restored.monitor.ids, ["c3", "c1", "c2"]);
  assert.equal(restored.monitor.formats.get("c2"), "hex");
  assert.equal(restored.monitor.breaks.has("c1"), true);
  assert.deepEqual(JSON.parse(serialize(restored)).monitor, document.monitor);
});

test("old documents load without a monitor and malformed monitor entries are rejected", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "tag", t: "tag", x: 0, y: 0, label: "Signal" }), true);
  const document = JSON.parse(serialize(board));
  assert.equal("monitor" in document, false);
  assert.deepEqual(parseDocument(JSON.stringify(document)).board.monitor.ids, []);
  for (const monitor of [[[1, "hex", false]], [[0, "octal", false]], [[0, "hex", 1]], [[0, "hex", false], [0, "binary", true]]])
    assert.throws(() => parseDocument(JSON.stringify({ ...document, monitor })), /monitor/);
});
