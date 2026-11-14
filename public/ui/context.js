import { createBoard } from "../core/model.js";
import { renderComponents, renderWires } from "./canvas-render.js";
import { clearWireGesture } from "./canvas-gestures.js";
import { renderPalette, syncPlacingCursor } from "./canvas-input.js";
import { renderProperties } from "./inspector.js";

// Exactly one mode is always active.
export const MODE = Object.freeze({ PAN: "pan", WIRE: "wire", SELECT: "select" });

/** The single application state shared by every UI module. */
export const ctx = {
  editor: null,
  board: createBoard(),
  selectedId: null,
  selectedIds: new Set(),
  selectedWire: null,
  selectedWires: new Set(),
  mode: MODE.PAN,
  placingType: null,
  copiedSelection: { components: [], wires: [], wireKeys: [] },
  newWireSize: 1,
  activeIssue: null,
};

export function setSelection(ids, wires = []) {
  ctx.selectedIds = new Set(ids);
  ctx.selectedWires = new Set(wires);
  ctx.selectedId = ctx.selectedIds.size === 1 && !ctx.selectedWires.size ? [...ctx.selectedIds][0] : null;
  ctx.selectedWire = ctx.selectedWires.size === 1 && !ctx.selectedIds.size ? [...ctx.selectedWires][0] : null;
  renderComponents();
  renderWires();
  renderProperties();
}

export function setMode(mode) {
  ctx.mode = mode;
  ctx.placingType = null;
  clearWireGesture();
  renderPalette();
  syncPlacingCursor();
}
