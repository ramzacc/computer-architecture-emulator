import { COMPONENT_TYPES, validBitWidth } from "../core/components.js";
import { componentArt } from "./canvas-render.js";
import { CELL, ZOOM_STEP, canvasWrap, resetView, worldFromViewport, zoomAt } from "./canvas-view.js";
import { MODE, ctx, setMode, setSelection } from "./context.js";
import { byIds, countLabel } from "./dom.js";
import { clearWireGesture, hasWire } from "./canvas-gestures.js";
import { renderProperties, syncActionButtons } from "./inspector.js";
import { busStatus } from "./status.js";
import { render } from "./views.js";

const $ = byIds("palette", "palette-search", "palette-empty", "btn-wire", "btn-pan",
  "btn-select", "btn-copy", "btn-paste", "btn-delete", "btn-undo", "btn-redo",
  "canvas-view", "new-wire-size");

export function renderPalette() {
  const scrollTop = $.palette.scrollTop;
  const query = $.paletteSearch.value.trim().toLocaleLowerCase();
  $.palette.innerHTML = "";
  for (const [type, spec] of Object.entries(COMPONENT_TYPES)) {
    if (!spec.label.toLocaleLowerCase().includes(query) && !type.toLocaleLowerCase().includes(query)) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.type = type;
    btn.classList.toggle("active", ctx.placingType === type);
    btn.innerHTML = `<span class="palette-icon" aria-hidden="true">${componentArt({ t: type, r: 0, size: spec.splitter ? 4 : 1, value: 0 }, spec)}</span>
    <span class="name">${spec.label}</span>`;
    btn.addEventListener("click", () => armPlacement(type));
    $.palette.appendChild(btn);
  }
  $.palette.scrollTop = scrollTop;
  $.paletteEmpty.hidden = $.palette.childElementCount !== 0;
}

function armPlacement(type) {
  ctx.placingType = ctx.placingType === type ? null : type;
  // Arming a component is a normal-canvas activity, so leave wire mode.
  if (ctx.placingType) {
    ctx.mode = MODE.PAN;
    clearWireGesture();
    setSelection([]);
  }
  renderPalette();
  syncPlacingCursor();
}

export function syncPlacingCursor() {
  const placing = ctx.placingType !== null;
  canvasWrap.classList.toggle("placing", placing);
  canvasWrap.classList.toggle("pan", ctx.mode === MODE.PAN && !placing);
  canvasWrap.classList.toggle("wire-mode", ctx.mode === MODE.WIRE);
  canvasWrap.classList.toggle("select-mode", ctx.mode === MODE.SELECT);
  for (const [button, active] of [[$.btnWire, ctx.mode === MODE.WIRE], [$.btnPan, ctx.mode === MODE.PAN],
    [$.btnSelect, ctx.mode === MODE.SELECT]]) {
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (ctx.mode !== MODE.WIRE) clearWireGesture();
  renderProperties();
}

function undoEdit() {
  if (!ctx.editor.canUndo) return;
  clearWireGesture();
  setSelection([]);
  ctx.editor.undo();
  busStatus("Undone.");
}

function redoEdit() {
  if (!ctx.editor.canRedo) return;
  clearWireGesture();
  setSelection([]);
  ctx.editor.redo();
  busStatus("Redone.");
}

function rotateSelected() {
  ctx.editor.rotate(ctx.selectedId);
}

function deleteSelected() {
  const ids = [...ctx.selectedIds];
  const wires = [...ctx.selectedWires];
  setSelection([]);
  ctx.editor.deleteSelection(ids, wires);
}

function copySelected() {
  ctx.copiedSelection = ctx.editor.copySelection(ctx.selectedIds, ctx.selectedWires);
  syncActionButtons();
  busStatus(`${countLabel(ctx.copiedSelection.components.length, "component")} and ${countLabel(ctx.copiedSelection.wireKeys.length, "wire net")} copied.`);
}

function pasteCopied() {
  const rect = canvasWrap.getBoundingClientRect();
  const center = worldFromViewport({ x: rect.width / 2, y: rect.height / 2 });
  const added = ctx.editor.pasteSelection(ctx.copiedSelection, { x: center.x / CELL, y: center.y / CELL });
  if (!added) {
    busStatus("Cannot paste selection nearby. Check overlaps, bus sizes, and short circuits.", true);
    return;
  }
  setMode(MODE.SELECT);
  setSelection(added.components.map((component) => component.id), added.wireKeys);
  busStatus(`${countLabel(added.components.length, "component")} and ${countLabel(added.wireKeys.length, "wire net")} pasted.`);
}

$.paletteSearch.addEventListener("input", renderPalette);
$.btnCopy.addEventListener("click", copySelected);
$.btnPaste.addEventListener("click", pasteCopied);
$.btnDelete.addEventListener("click", deleteSelected);
$.btnUndo.addEventListener("click", undoEdit);
$.btnRedo.addEventListener("click", redoEdit);

$.btnSelect.addEventListener("click", () => {
  setMode(MODE.SELECT);
  setSelection(ctx.selectedIds);
});
$.btnWire.addEventListener("click", () => {
  setMode(MODE.WIRE);
  setSelection([]);
});
$.btnPan.addEventListener("click", () => setMode(MODE.PAN));

$.newWireSize.addEventListener("change", () => {
  const size = Number($.newWireSize.value);
  if (!validBitWidth(size)) {
    $.newWireSize.value = String(ctx.newWireSize);
    busStatus("Wire size must be a whole number from 1 to 32.", true);
    return;
  }
  ctx.newWireSize = size;
  clearWireGesture();
  busStatus(`New wires will carry ${countLabel(size, "bit")}.`);
});

for (const controls of document.querySelectorAll(".canvas-controls")) {
  for (const type of ["pointerdown", "dblclick", "contextmenu", "wheel"]) {
    controls.addEventListener(type, (e) => e.stopPropagation());
  }
}

document.addEventListener("keydown", (e) => {
  if ($.canvasView.hidden) return;
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
    zoomAt(ZOOM_STEP);
    e.preventDefault();
  } else if (zoomOut) {
    zoomAt(1 / ZOOM_STEP);
    e.preventDefault();
  } else if (mod && e.key === "0") {
    resetView();
    e.preventDefault();
  } else if (e.key === "r" || e.key === "R") {
    rotateSelected();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    deleteSelected();
    e.preventDefault();
  } else if (e.key === "Escape") {
    if (hasWire()) {
      clearWireGesture();
      busStatus("Wire finished.");
      return;
    }
    setMode(MODE.PAN);
    setSelection([]);
    render();
  }
});
