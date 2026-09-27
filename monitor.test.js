import test from "node:test";
import assert from "node:assert/strict";
import { insertionIndex } from "./public/monitor.js";

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
