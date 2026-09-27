import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "./public/renderer.js";
import { createBoard, edgeKey } from "./public/model.js";

test("renderer reuses unchanged canvas elements and removes stale ones", () => {
  const originalDocument = globalThis.document;
  const grid = {
    children: [],
    appendChild(el) { this.children.push(el); el.parent = this; },
  };
  let artWrites = 0;
  globalThis.document = {
    createElement() {
      return {
        style: {}, dataset: {}, className: "", title: "",
        set innerHTML(value) { this.art = value; artWrites++; },
        get innerHTML() { return this.art; },
        remove() {
          const index = this.parent?.children.indexOf(this) ?? -1;
          if (index >= 0) this.parent.children.splice(index, 1);
        },
      };
    },
  };
  try {
    const board = createBoard();
    board.components.push({ id: "lamp", t: "led", x: 0, y: 0, r: 0 });
    const edge = { o: "H", x: 3, y: 1, size: 1 };
    board.wires.set(edgeKey(edge), edge);
    const selectedIds = new Set();
    const selectedWires = new Set();
    let logic = { states: new Map([["lamp", { value: 0, lit: false }]]),
      nets: new Map([["net", { id: "net", edges: [edge], on: false, value: 0 }]]) };
    const renderer = createRenderer(grid, () => board, () => logic, () => selectedIds, () => selectedWires);
    renderer.renderComponents();
    renderer.renderWires();
    const componentEl = grid.children.find((el) => el.dataset.id === "lamp");
    const wireEl = grid.children.find((el) => el.dataset.key === edgeKey(edge));
    renderer.renderComponents();
    renderer.renderWires();
    assert.equal(grid.children.length, 2);
    assert.equal(grid.children.find((el) => el.dataset.id === "lamp"), componentEl);
    assert.equal(grid.children.find((el) => el.dataset.key === edgeKey(edge)), wireEl);
    assert.equal(artWrites, 1);

    logic = { states: new Map([["lamp", { value: 1, lit: true }]]),
      nets: new Map([["net", { id: "net", edges: [edge], on: true, value: 1 }]]) };
    selectedIds.add("lamp");
    selectedWires.add(edgeKey(edge));
    renderer.renderComponents();
    renderer.renderWires();
    assert.match(componentEl.className, /lit/);
    assert.match(componentEl.className, /selected/);
    assert.match(wireEl.className, /on selected/);
    assert.equal(artWrites, 2);

    board.components.length = 0;
    board.wires.clear();
    logic = { states: new Map(), nets: new Map() };
    renderer.renderComponents();
    renderer.renderWires();
    assert.equal(grid.children.length, 0);
  } finally {
    globalThis.document = originalDocument;
  }
});
