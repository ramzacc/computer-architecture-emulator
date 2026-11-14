import { COMPONENT_TYPES, validBitWidth } from "../core/components.js";
import { CELL, ZOOM_STEP } from "./canvas-view.js";
import { MODE } from "./context.js";
import { byId, countLabel } from "./dom.js";

/**
 * Palette, mode buttons, keyboard shortcuts, and the edit actions they share.
 * Canvas pointer gestures live in canvas-gestures.js.
 */
export function createCanvasInput({ ctx, status, gestures, canvas, renderer, render, renderProperties, syncActionButtons }) {
  const { componentArt } = renderer;
  const paletteEl = byId("palette");
  const paletteSearchEl = byId("palette-search");
  const paletteEmptyEl = byId("palette-empty");
  const btnWire = byId("btn-wire");
  const btnPan = byId("btn-pan");
  const btnSelect = byId("btn-select");
  const btnCopy = byId("btn-copy");
  const btnPaste = byId("btn-paste");
  const btnDelete = byId("btn-delete");
  const btnUndo = byId("btn-undo");
  const btnRedo = byId("btn-redo");
  const canvasViewEl = byId("canvas-view");
  const newWireSizeEl = byId("new-wire-size");
  const { canvasWrapEl } = canvas;

  function renderPalette() {
    const scrollTop = paletteEl.scrollTop;
    const query = paletteSearchEl.value.trim().toLocaleLowerCase();
    paletteEl.innerHTML = "";
    for (const [type, spec] of Object.entries(COMPONENT_TYPES)) {
      if (!spec.label.toLocaleLowerCase().includes(query) && !type.toLocaleLowerCase().includes(query)) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.type = type;
      btn.classList.toggle("active", ctx.placingType === type);
      btn.innerHTML = `<span class="palette-icon" aria-hidden="true">${componentArt({ t: type, r: 0, size: spec.splitter ? 4 : 1, value: 0 }, spec)}</span>
      <span class="name">${spec.label}</span>`;
      btn.addEventListener("click", () => armPlacement(type));
      paletteEl.appendChild(btn);
    }
    paletteEl.scrollTop = scrollTop;
    paletteEmptyEl.hidden = paletteEl.childElementCount !== 0;
  }

  function armPlacement(type) {
    ctx.placingType = ctx.placingType === type ? null : type;
    // Arming a component is a normal-canvas activity, so leave wire mode.
    if (ctx.placingType) {
      ctx.mode = MODE.PAN;
      gestures.clearWireGesture();
      ctx.setSelection([]);
    }
    renderPalette();
    syncPlacingCursor();
  }

  function syncPlacingCursor() {
    const placing = ctx.placingType !== null;
    canvasWrapEl.classList.toggle("placing", placing);
    canvasWrapEl.classList.toggle("pan", ctx.mode === MODE.PAN && !placing);
    canvasWrapEl.classList.toggle("wire-mode", ctx.mode === MODE.WIRE);
    canvasWrapEl.classList.toggle("select-mode", ctx.mode === MODE.SELECT);
    for (const [button, active] of [[btnWire, ctx.mode === MODE.WIRE], [btnPan, ctx.mode === MODE.PAN],
      [btnSelect, ctx.mode === MODE.SELECT]]) {
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (ctx.mode !== MODE.WIRE) gestures.clearWireGesture();
    renderProperties();
  }

  function undoEdit() {
    if (!ctx.editor.canUndo) return;
    gestures.clearWireGesture();
    ctx.setSelection([]);
    ctx.editor.undo();
    status.busStatus("Undone.");
  }

  function redoEdit() {
    if (!ctx.editor.canRedo) return;
    gestures.clearWireGesture();
    ctx.setSelection([]);
    ctx.editor.redo();
    status.busStatus("Redone.");
  }

  function rotateSelected() {
    ctx.editor.rotate(ctx.selectedId);
  }

  function deleteSelected() {
    const ids = [...ctx.selectedIds];
    const wires = [...ctx.selectedWires];
    ctx.setSelection([]);
    ctx.editor.deleteSelection(ids, wires);
  }

  function copySelected() {
    ctx.copiedSelection = ctx.editor.copySelection(ctx.selectedIds, ctx.selectedWires);
    syncActionButtons();
    status.busStatus(`${countLabel(ctx.copiedSelection.components.length, "component")} and ${countLabel(ctx.copiedSelection.wireKeys.length, "wire net")} copied.`);
  }

  function pasteCopied() {
    const rect = canvasWrapEl.getBoundingClientRect();
    const center = canvas.worldFromViewport({ x: rect.width / 2, y: rect.height / 2 });
    const added = ctx.editor.pasteSelection(ctx.copiedSelection, { x: center.x / CELL, y: center.y / CELL });
    if (!added) {
      status.busStatus("Cannot paste selection nearby. Check overlaps, bus sizes, and short circuits.", true);
      return;
    }
    ctx.setMode(MODE.SELECT);
    ctx.setSelection(added.components.map((component) => component.id), added.wireKeys);
    status.busStatus(`${countLabel(added.components.length, "component")} and ${countLabel(added.wireKeys.length, "wire net")} pasted.`);
  }

  paletteSearchEl.addEventListener("input", renderPalette);
  btnCopy.addEventListener("click", copySelected);
  btnPaste.addEventListener("click", pasteCopied);
  btnDelete.addEventListener("click", deleteSelected);
  btnUndo.addEventListener("click", undoEdit);
  btnRedo.addEventListener("click", redoEdit);

  btnSelect.addEventListener("click", () => {
    ctx.setMode(MODE.SELECT);
    ctx.setSelection(ctx.selectedIds);
  });
  btnWire.addEventListener("click", () => {
    ctx.setMode(MODE.WIRE);
    ctx.setSelection([]);
  });
  btnPan.addEventListener("click", () => ctx.setMode(MODE.PAN));

  newWireSizeEl.addEventListener("change", () => {
    const size = Number(newWireSizeEl.value);
    if (!validBitWidth(size)) {
      newWireSizeEl.value = String(ctx.newWireSize);
      status.busStatus("Wire size must be a whole number from 1 to 32.", true);
      return;
    }
    ctx.newWireSize = size;
    gestures.clearWireGesture();
    status.busStatus(`New wires will carry ${countLabel(size, "bit")}.`);
  });

  for (const controls of document.querySelectorAll(".canvas-controls")) {
    for (const type of ["pointerdown", "dblclick", "contextmenu", "wheel"]) {
      controls.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  document.addEventListener("keydown", (e) => {
    if (canvasViewEl.hidden) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const mod = e.ctrlKey || e.metaKey;
    const zoomIn = e.key === "+" || e.key === "=" || e.code === "NumpadAdd";
    const zoomOut = e.key === "-" || e.key === "_" || e.code === "NumpadSubtract";

    if (mod && e.key.toLowerCase() === "z") {
      if (e.shiftKey) redoEdit();
      else undoEdit();
      e.preventDefault();
    } else if (mod && e.key.toLowerCase() === "y") {
      redoEdit();
      e.preventDefault();
    } else if (mod && e.key.toLowerCase() === "c") {
      if (ctx.selectedIds.size || ctx.selectedWires.size) { copySelected(); e.preventDefault(); }
    } else if (mod && e.key.toLowerCase() === "v") {
      if (ctx.copiedSelection.components.length || ctx.copiedSelection.wires.length) { pasteCopied(); e.preventDefault(); }
    } else if (zoomIn) {
      canvas.zoomAt(ZOOM_STEP);
      e.preventDefault();
    } else if (zoomOut) {
      canvas.zoomAt(1 / ZOOM_STEP);
      e.preventDefault();
    } else if (mod && e.key === "0") {
      canvas.resetView();
      e.preventDefault();
    } else if (e.key === "r" || e.key === "R") {
      rotateSelected();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      deleteSelected();
      e.preventDefault();
    } else if (e.key === "Escape") {
      if (gestures.hasWire()) {
        gestures.clearWireGesture();
        status.busStatus("Wire finished.");
        return;
      }
      ctx.setMode(MODE.PAN);
      ctx.setSelection([]);
      render();
    }
  });

  return { renderPalette, syncPlacingCursor };
}
