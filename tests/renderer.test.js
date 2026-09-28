import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "../public/renderer.js";
import { createBoard, edgeKey } from "../public/model.js";
import { spec } from "../public/components.js";

test("ROM canvas art shows its label safely", () => {
  const { componentArt } = createRenderer(null, () => null, () => null, () => null, () => null);
  const rom = { id: "c1", t: "rom", x: 0, y: 0, r: 0, size: 8, addressSize: 8, data: [], label: "Boot <code>" };
  const art = componentArt(rom, spec("rom"));
  assert.match(art, /Boot &lt;code&gt;/);
  assert.doesNotMatch(art, /Boot <code>/);
});

test("register canvas art shows its stored output and side reset port", () => {
  const { componentArt } = createRenderer(null, () => null, () => null, () => null, () => null);
  const register = { t: "register", x: 0, y: 0, r: 0, size: 4 };
  assert.match(componentArt(register, spec("register"), 0), /Q: 0/);
  assert.match(componentArt(register, spec("register"), 9), /Q: 9/);
  assert.match(componentArt(register, spec("register"), 9), /RESET/);
});

test("tag canvas art keeps a 4x2 face and escaped label at every pin direction", () => {
  const { componentArt } = createRenderer(null, () => null, () => null, () => null, () => null);
  for (const r of [0, 1, 2, 3]) {
    const tag = { t: "tag", x: 0, y: 0, r, size: 8, label: "DATA <bus>" };
    const art = componentArt(tag, spec("tag"));
    assert.match(art, /viewBox="0 0 160 80"/);
    assert.match(art, /DATA &lt;bus&gt;/);
    assert.doesNotMatch(art, /DATA <bus>/);
    assert.doesNotMatch(art, /rotate\(/);
  }
});

test("control and portal canvas art escapes labels and tracks their state", () => {
  const { componentArt } = createRenderer(null, () => null, () => null, () => null, () => null);
  assert.match(componentArt({ t: "switch", x: 0, y: 0, r: 0, label: "S" }, spec("switch"), true), />SWITCH<\/text>/);
  assert.match(componentArt({ t: "button", x: 0, y: 0, r: 0, label: "B" }, spec("button")), />BUTTON<\/text>/);
  assert.match(componentArt({ t: "clock", x: 0, y: 0, r: 0, enable: false }, spec("clock")), />OFF<\/text>/);
  assert.match(componentArt({ t: "clock", x: 0, y: 0, r: 0, enable: true }, spec("clock")), />ON<\/text>/);
  const portal = componentArt({ t: "portal", x: 0, y: 0, r: 0, size: 4, label: "BUS <a>" }, spec("portal"));
  assert.match(portal, /viewBox="0 0 120 80"/);
  assert.match(portal, /BUS &lt;a&gt;/);
  assert.doesNotMatch(portal, /BUS <a>/);
  assert.match(portal, /<path d="M8 40 H25 L36 28 H106 L114 40 L106 52 H36 L25 40"/);
  assert.match(componentArt({ t: "portal", x: 0, y: 0, r: 0, size: 1 }, spec("portal")), />PORTAL<\/text>/);
});

test("wire boxes follow orientation and widen for buses", () => {
  const renderer = createRenderer(null, () => null, () => null, () => null, () => null);
  assert.deepEqual(renderer.edgeBox({ o: "H", x: 2, y: 3, size: 1 }),
    { left: "96px", top: "142px", width: "48px", height: "4px" });
  assert.deepEqual(renderer.edgeBox({ o: "V", x: 2, y: 3, size: 1 }),
    { left: "94px", top: "144px", width: "4px", height: "48px" });
  assert.deepEqual(renderer.edgeBox({ o: "V", x: 2, y: 3, size: 4 }),
    { left: "92.5px", top: "144px", width: "7px", height: "48px" });
  const el = { style: {} };
  renderer.applyBox(el, { left: "1px", top: "2px", width: "3px", height: "4px" });
  assert.deepEqual(el.style, { left: "1px", top: "2px", width: "3px", height: "4px" });
});

test("splitter art keeps its proportions in the component palette", () => {
  const { componentArt } = createRenderer(null, () => null, () => null, () => null, () => null);
  const art = componentArt({ t: "splitter", x: 0, y: 0, r: 0, size: 4 }, spec("splitter"));
  assert.match(art, /viewBox="0 0 80 200"/);
  assert.match(art, /preserveAspectRatio="xMidYMid meet"/);
});

test("wire junctions appear at branches and disappear when the branch is removed", () => {
  const originalDocument = globalThis.document;
  const grid = { children: [], appendChild(el) { this.children.push(el); el.parent = this; } };
  globalThis.document = {
    createElement() {
      return {
        style: {}, dataset: {}, className: "", title: "",
        remove() {
          const index = this.parent?.children.indexOf(this) ?? -1;
          if (index >= 0) this.parent.children.splice(index, 1);
        },
      };
    },
  };
  try {
    const board = createBoard();
    for (const edge of [{ o: "H", x: 2, y: 1, size: 1 }, { o: "H", x: 3, y: 1, size: 1 }, { o: "V", x: 3, y: 1, size: 1 }])
      board.wires.set(edgeKey(edge), edge);
    const logic = { nets: new Map([["net", { id: "net", edges: [...board.wires.values()], on: false, value: 0 }]]) };
    const renderer = createRenderer(grid, () => board, () => logic, () => new Set(), () => new Set());
    renderer.renderWires();
    assert.equal(grid.children.filter((el) => el.className.startsWith("wire-junction")).length, 1);
    board.wires.delete(edgeKey({ o: "V", x: 3, y: 1 }));
    logic.nets.get("net").edges = [...board.wires.values()];
    renderer.renderWires();
    assert.equal(grid.children.filter((el) => el.className.startsWith("wire-junction")).length, 0);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("renderer reuses unchanged canvas elements and removes stale ones", () => {
  const originalDocument = globalThis.document;
  const grid = {
    children: [],
    appendChild(el) {
      for (const child of el.children ?? [el]) {
        this.children.push(child);
        child.parent = this;
      }
    },
  };
  let artWrites = 0;
  globalThis.document = {
    createDocumentFragment() {
      return {
        children: [],
        appendChild(el) { this.children.push(el); },
        hasChildNodes() { return this.children.length > 0; },
      };
    },
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
    renderer.renderPins();
    renderer.renderWires();
    const componentEl = grid.children.find((el) => el.dataset.id === "lamp");
    const wireEl = grid.children.find((el) => el.dataset.key === edgeKey(edge));
    const pins = grid.children.filter((el) => el.className.startsWith("pin "));
    assert.ok(pins.length > 0);
    renderer.renderComponents();
    renderer.renderPins();
    renderer.renderWires();
    assert.equal(grid.children.length, 2 + pins.length);
    assert.deepEqual(grid.children.filter((el) => el.className.startsWith("pin ")), pins);
    assert.equal(grid.children.find((el) => el.dataset.id === "lamp"), componentEl);
    assert.equal(grid.children.find((el) => el.dataset.key === edgeKey(edge)), wireEl);
    assert.equal(artWrites, 1);

    logic = { states: new Map([["lamp", { value: 1, lit: true }]]),
      nets: new Map([["net", { id: "net", edges: [edge], on: true, value: 1 }]]) };
    selectedIds.add("lamp");
    selectedWires.add(edgeKey(edge));
    renderer.renderComponents();
    renderer.renderPins();
    renderer.renderWires();
    assert.match(componentEl.className, /lit/);
    assert.match(componentEl.className, /selected/);
    assert.match(wireEl.className, /on selected/);
    assert.equal(artWrites, 2);

    board.components.length = 0;
    board.wires.clear();
    logic = { states: new Map(), nets: new Map() };
    renderer.renderComponents();
    renderer.renderPins();
    renderer.renderWires();
    assert.equal(grid.children.length, 0);
  } finally {
    globalThis.document = originalDocument;
  }
});
