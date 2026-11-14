import { createBoard } from "../core/model.js";

// Exactly one mode is always active.
export const MODE = Object.freeze({ PAN: "pan", WIRE: "wire", SELECT: "select" });

/**
 * Shared application state. Modules read and mutate this object instead of
 * importing each other's globals; the composition root fills in `hooks` once
 * the renderer, inspector, and canvas input exist.
 */
export function createContext() {
  const hooks = {
    renderComponents: () => {},
    renderWires: () => {},
    renderProperties: () => {},
    renderPalette: () => {},
    syncPlacingCursor: () => {},
    clearWireGesture: () => {},
  };
  const ctx = {
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
    hooks,

    setSelection(ids, wires = []) {
      ctx.selectedIds = new Set(ids);
      ctx.selectedWires = new Set(wires);
      ctx.selectedId = ctx.selectedIds.size === 1 && !ctx.selectedWires.size ? [...ctx.selectedIds][0] : null;
      ctx.selectedWire = ctx.selectedWires.size === 1 && !ctx.selectedIds.size ? [...ctx.selectedWires][0] : null;
      hooks.renderComponents();
      hooks.renderWires();
      hooks.renderProperties();
    },

    setMode(mode) {
      ctx.mode = mode;
      ctx.placingType = null;
      hooks.clearWireGesture();
      hooks.renderPalette();
      hooks.syncPlacingCursor();
    },
  };
  return ctx;
}
