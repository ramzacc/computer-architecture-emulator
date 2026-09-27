import test from "node:test";
import assert from "node:assert/strict";
import { createTabs } from "./public/tabs.js";

function tabList(names) {
  const panels = new Map();
  const tabs = names.map((name, index) => {
    const panel = { id: `${name}-view`, hidden: index !== 0, getAttribute: () => "tabpanel" };
    panels.set(panel.id, panel);
    return {
      id: `tab-${name}`, hidden: false, tabIndex: index ? -1 : 0, focused: false,
      attributes: new Map([["aria-controls", panel.id], ["aria-selected", String(index === 0)]]),
      getAttribute(key) { return this.attributes.get(key); },
      setAttribute(key, value) { this.attributes.set(key, value); },
      contains(target) { return target === this; },
      focus() { this.focused = true; },
    };
  });
  const listeners = new Map();
  return {
    tabs, panels,
    ownerDocument: { getElementById: (id) => panels.get(id) },
    querySelectorAll: () => tabs,
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatch(type, target, key) {
      let prevented = false;
      listeners.get(type)({ target, key, preventDefault() { prevented = true; } });
      return prevented;
    },
  };
}

test("tabs discover panels from markup and navigate any number of visible tabs", () => {
  const list = tabList(["canvas", "rom", "layout", "timing"]);
  const shown = [];
  const tabs = createTabs(list, (id) => shown.push(id));
  assert.equal(tabs.active, "canvas-view");
  assert.deepEqual(shown, []);

  list.dispatch("click", list.tabs[3]);
  assert.equal(tabs.active, "timing-view");
  assert.deepEqual([...list.panels.values()].map((panel) => panel.hidden), [true, true, true, false]);
  assert.deepEqual(list.tabs.map((tab) => tab.tabIndex), [-1, -1, -1, 0]);

  assert.equal(list.dispatch("keydown", list.tabs[3], "ArrowRight"), true);
  assert.equal(tabs.active, "canvas-view");
  assert.equal(list.tabs[0].focused, true);
  list.tabs[1].hidden = true;
  assert.equal(list.dispatch("keydown", list.tabs[0], "ArrowRight"), true);
  assert.equal(tabs.active, "layout-view");
  assert.equal(list.dispatch("keydown", list.tabs[2], "End"), true);
  assert.equal(tabs.active, "timing-view");
  assert.equal(list.dispatch("keydown", list.tabs[3], "Home"), true);
  assert.equal(tabs.active, "canvas-view");
  assert.equal(list.dispatch("keydown", list.tabs[0], "Enter"), false);
  assert.deepEqual(shown, ["timing-view", "canvas-view", "layout-view", "timing-view", "canvas-view"]);
  assert.throws(() => tabs.show("rom-view"), /No visible tab/);
});
