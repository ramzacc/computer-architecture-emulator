import test from "node:test";
import assert from "node:assert/strict";
import { dropPlacement, insertionIndex } from "./public/monitor.js";
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

test("dragging below a partly filled row starts a new row", () => {
  const rects = [
    { left: 0, top: 0, width: 100, bottom: 80 },
    { left: 112, top: 0, width: 100, bottom: 80 },
    { left: 0, top: 92, width: 100, bottom: 172 },
  ];
  assert.deepEqual(dropPlacement(rects, [false, false, true], 300, 40), { index: 2, newRow: false });
  assert.deepEqual(dropPlacement(rects, [false, false, true], 150, 86), { index: 2, newRow: true });
  assert.deepEqual(dropPlacement(rects, [false, false, true], 20, 120), { index: 2, newRow: true });
  assert.deepEqual(dropPlacement(rects, [false, false, true], 150, 190), { index: 3, newRow: true });
  assert.deepEqual(dropPlacement([], [], 20, 190), { index: 0, newRow: false });
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

test("a clock can be saved in the monitor layout", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "clock", t: "clock", x: 0, y: 0, label: "Main Clock", enable: false }), true);
  board.monitor.ids.push("clock");
  const document = JSON.parse(serialize(board));
  assert.deepEqual(document.monitor, [[0, "binary", false]]);
  const restored = parseDocument(JSON.stringify(document)).board;
  assert.equal(restored.components[0].enable, false);
  assert.deepEqual(restored.monitor.ids, ["c1"]);
});

test("a register can be saved in the monitor layout", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "register", t: "register", x: 0, y: 0, label: "Accumulator", size: 8 }), true);
  board.monitor.ids.push("register");
  board.monitor.formats.set("register", "hex");
  const document = JSON.parse(serialize(board));
  assert.deepEqual(document.monitor, [[0, "hex", false]]);
  const restored = parseDocument(JSON.stringify(document)).board;
  assert.deepEqual(restored.monitor.ids, ["c1"]);
  assert.equal(restored.monitor.formats.get("c1"), "hex");
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
