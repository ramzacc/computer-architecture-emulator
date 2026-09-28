import test from "node:test";
import assert from "node:assert/strict";
import { createMonitor, dropPlacement, insertionIndex } from "../public/monitor.js";
import { addComponent, createBoard, evaluateBoard, parseDocument, serialize } from "../public/model.js";

function matchSimple(el, selector) {
  let rest = selector;
  const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(rest);
  if (tag) {
    if (el.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
    rest = rest.slice(tag[0].length);
  }
  while (rest) {
    if (rest[0] === ".") {
      const part = /^\.([A-Za-z0-9_-]+)/.exec(rest);
      if (!part || !el._class.has(part[1])) return false;
      rest = rest.slice(part[0].length);
    } else if (rest[0] === "[") {
      const part = /^\[([^\]]+)\]/.exec(rest);
      if (!part || !hasAttribute(el, part[1])) return false;
      rest = rest.slice(part[0].length);
    } else return false;
  }
  return true;
}

function hasAttribute(el, attribute) {
  if (attribute.startsWith("data-")) {
    const key = attribute.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return el.dataset[key] !== undefined;
  }
  return el.attributes[attribute] !== undefined;
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this._class = new Set();
    this._text = "";
    this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this.hidden = false;
    this.style = { setProperty(key, value) { this[key] = value; } };
  }
  get className() { return [...this._class].join(" "); }
  set className(value) { this._class = new Set(String(value ?? "").split(/\s+/).filter(Boolean)); }
  get classList() {
    return {
      add: (...names) => names.forEach((name) => this._class.add(name)),
      remove: (...names) => names.forEach((name) => this._class.delete(name)),
      contains: (name) => this._class.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !this._class.has(name) : force;
        if (on) this._class.add(name); else this._class.delete(name);
        return on;
      },
    };
  }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() {
    const index = this.parent?.children.indexOf(this) ?? -1;
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }
  contains(node) { for (let current = node; current; current = current.parent) if (current === this) return true; return false; }
  descendants() {
    const found = [];
    for (const child of this.children) { found.push(child, ...child.descendants()); }
    return found;
  }
  querySelectorAll(selector) {
    return this.descendants().filter((el) =>
      selector.split(",").some((part) => matchSimple(el, part.trim())));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) {
    for (let current = this; current; current = current.parent)
      if (selector.split(",").some((part) => matchSimple(current, part.trim()))) return current;
    return null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setPointerCapture() {}
  focus() {}
  getBoundingClientRect() { return this._rect; }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
}

function makeDom() {
  const elements = {
    signalsEl: new FakeElement("div"),
    noTagsEl: new FakeElement("p"),
    workspaceEl: new FakeElement("div"),
    gridEl: new FakeElement("div"),
    emptyEl: new FakeElement("div"),
  };
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  return { elements, restore() { globalThis.document = originalDocument; } };
}

function fire(container, type, target, extra = {}) {
  let prevented = false;
  const event = { target, currentTarget: container, repeat: false, button: 0,
    preventDefault() { prevented = true; }, ...extra };
  for (const handler of container.listeners[type] ?? []) handler(event);
  return prevented;
}

function monitorBoard() {
  const board = createBoard();
  for (const [id, t, x, extra] of [
    ["c1", "tag", 0, { label: "Data" }],
    ["c2", "register", 6, { size: 8, label: "Acc" }],
    ["c3", "input", 12, { size: 2, value: 1, label: "Switches" }],
    ["c4", "output", 18, { size: 2, label: "Result" }],
    ["c5", "button", 24, { label: "Go" }],
    ["c6", "switch", 28, { value: 1, label: "Enable" }],
    ["c7", "clock", 32, { enable: true, label: "Tick" }],
  ]) assert.equal(addComponent(board, { id, t, x, y: 0, ...extra }), true, id);
  return board;
}

function monitorEditor(board) {
  const state = { saves: 0, pressed: new Set(), clock: new Map() };
  const editor = {
    board,
    evaluation: evaluateBoard(board),
    pressedButtons: state.pressed,
    state,
    component: (id) => board.components.find((component) => component.id === id),
    save: () => { state.saves++; },
    toggleSwitch: (id) => { const item = editor.component(id); item.value = item.value === 1 ? 0 : 1; },
    setClockEnabled: (id, enable) => { editor.component(id).enable = enable; return true; },
    setButtonPressed: (id, pressed) => { if (pressed) state.pressed.add(id); else state.pressed.delete(id); return true; },
    toggleInputBit: (id, bit) => { const item = editor.component(id); item.value ^= 1 << bit; return true; },
  };
  return editor;
}

test("the monitor renders signal groups, cards, and live values, then edits the layout", () => {
  const dom = makeDom();
  try {
    const board = monitorBoard();
    const editor = monitorEditor(board);
    const monitor = createMonitor({ getEditor: () => editor, ...dom.elements });
    const { signalsEl, gridEl, emptyEl, noTagsEl, workspaceEl } = dom.elements;

    monitor.render();
    assert.equal(noTagsEl.hidden, true);
    assert.equal(workspaceEl.hidden, false);
    assert.deepEqual(signalsEl.children.map((section) => section.children[0].textContent),
      ["Tags and outputs", "Registers", "Controls"]);
    assert.equal(gridEl.children.length, 1);
    assert.equal(gridEl.children[0], emptyEl);

    const signal = (id) => signalsEl.descendants().find((el) => el.dataset.id === id);
    for (const id of ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]) {
      fire(signalsEl, "click", signal(id));
    }
    assert.deepEqual(board.monitor.ids, ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
    assert.equal(editor.state.saves, 7);
    assert.equal(gridEl.children.length, 7);
    assert.equal(emptyEl.hidden, true);

    const card = (id) => gridEl.descendants().find((el) => el.className === "monitor-card" && el.dataset.id === id);
    assert.equal(card("c1").querySelector("[data-value]").textContent, "0b0");
    assert.equal(card("c2").querySelector("[data-value]").textContent, "0b00000000");
    assert.equal(card("c3").querySelector(".monitor-bits").children.length, 2);
    assert.equal(card("c6").querySelector("[data-control]").querySelector(".monitor-control-status").textContent, "On");

    const format = card("c1").querySelector("select[data-format]");
    format.value = "hex";
    fire(gridEl, "change", format);
    assert.equal(board.monitor.formats.get("c1"), "hex");
    assert.equal(card("c1").querySelector("[data-value]").textContent, "0x0");

    fire(gridEl, "click", card("c6").querySelector("[data-control]"));
    assert.equal(editor.component("c6").value, 0);
    fire(gridEl, "click", card("c7").querySelector("[data-control]"));
    assert.equal(editor.component("c7").enable, false);

    fire(gridEl, "click", card("c3").querySelectorAll("[data-input-bit]").at(-1));
    assert.equal(editor.component("c3").value, 0);

    const button = card("c5").querySelector("[data-control]");
    fire(gridEl, "pointerdown", button, { button: 0, pointerId: 1 });
    assert.equal(editor.state.pressed.has("c5"), true);
    fire(gridEl, "pointerup", button);
    assert.equal(editor.state.pressed.has("c5"), false);
    fire(gridEl, "keydown", button, { key: "Enter" });
    assert.equal(editor.state.pressed.has("c5"), true);
    fire(gridEl, "keyup", button, { key: "Enter" });
    assert.equal(editor.state.pressed.has("c5"), false);

    const saves = editor.state.saves;
    fire(gridEl, "click", card("c1").querySelector("[data-remove]"));
    assert.equal(board.monitor.ids.includes("c1"), false);
    assert.equal(editor.state.saves, saves + 1);

    board.components = board.components.filter((component) => component.id !== "c4");
    monitor.render();
    assert.equal(board.monitor.ids.includes("c4"), false);

    monitor.reset();
    monitor.render();
    assert.equal(gridEl.children.length, board.monitor.ids.length);
  } finally {
    dom.restore();
  }
});

test("dragging a signal reorders the monitor and blank grid space drops at the end", () => {
  const dom = makeDom();
  try {
    const board = monitorBoard();
    const editor = monitorEditor(board);
    const monitor = createMonitor({ getEditor: () => editor, ...dom.elements });
    const { signalsEl, gridEl, workspaceEl } = dom.elements;
    monitor.render();
    const signal = (id) => signalsEl.descendants().find((el) => el.dataset.id === id);
    for (const id of ["c1", "c2"]) fire(signalsEl, "click", signal(id));
    gridEl._rect = { left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 };
    const cards = gridEl.children;
    cards[0]._rect = { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 };
    cards[1]._rect = { left: 112, top: 0, right: 212, bottom: 80, width: 112, height: 100 };

    const transfer = { effectAllowed: "", dropEffect: "", setData() {} };
    fire(signalsEl, "dragstart", signal("c1"), { dataTransfer: transfer });
    fire(workspaceEl, "dragover", gridEl, { clientX: 300, clientY: 40, dataTransfer: transfer });
    fire(workspaceEl, "drop", gridEl, { clientX: 300, clientY: 40, dataTransfer: transfer });
    assert.deepEqual(board.monitor.ids, ["c2", "c1"]);
    assert.equal(gridEl.children.map((card) => card.dataset.id).join(","), "c2,c1");
    fire(workspaceEl, "dragleave", workspaceEl, { relatedTarget: signal("c2") });
  } finally {
    dom.restore();
  }
});

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
