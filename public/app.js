import { COMPONENT_TYPES, DEFAULT_CLOCK_FREQUENCY, addressWidth, bitWidth, channelCount, dimsOf, isSizable, moduleFaceParts, modulePinLayout, modulePorts, pinsFor, selectWidth, spec, validBitWidth } from "./components.js";
import { addComponent, addWireEdge, clocksInBoard, createBoard, edgeKey, edgePlacementError, evaluateBoard, netContaining, parseDocument, serialize, wireRoute } from "./model.js";
import { BoardEditor } from "./editor.js";
import { createRenderer } from "./renderer.js";
import { formatValue, parseValue } from "./value-format.js";
import { parseRomFile, serializeRomFile, validHexWord } from "./rom-format.js";
import { createTabs } from "./tabs.js";
import { createMonitor } from "./monitor.js";
import { createProgram } from "./program.js";

const CELL = 48;
const GAP = 3;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;

// The lattice is unbounded: `view` maps world pixels onto the viewport with
// translate(view.x, view.y) then scale(view.zoom), anchored at the top-left.
const view = { x: 0, y: 0, zoom: 1 };

// Exactly one mode is always active. Add future modes here and wire them into
// the pointer handlers below; never allow a null/empty mode.
const MODE = Object.freeze({ PAN: "pan", WIRE: "wire", SELECT: "select" });

let mode = MODE.PAN;
let state = createBoard();
let selectedId = null;
let selectedIds = new Set();
let selectedWire = null;
let selectedWires = new Set();
let inspectorSelectionKey = null;
let placingType = null;
let drag = null;
let dragPreviewFrame = null;
let pendingDragPoint = null;
let pressedButton = null;
let pan = null;
let marquee = null;
let copiedSelection = { components: [], wires: [], wireKeys: [] };
let newWireSize = 1;
let wireStart = null;
let wirePreviewFrame = null;
let pendingWirePreviewPoint = null;
let lastWirePreviewKey = null;
let romTargetId = null;
let layoutTargetId = null;
const romDrafts = new Map();
let romPageStart = 0;
let romRenderedKey = null;
const ROM_COLUMN_SIZE = 16;
const ROM_PAGE_SIZE = ROM_COLUMN_SIZE * 4;

const gridEl = document.getElementById("grid");
const paletteEl = document.getElementById("palette");
const paletteSearchEl = document.getElementById("palette-search");
const paletteEmptyEl = document.getElementById("palette-empty");
const btnWire = document.getElementById("btn-wire");
const btnPan = document.getElementById("btn-pan");
const btnSelect = document.getElementById("btn-select");
const canvasViewEl = document.getElementById("canvas-view");
const btnCopy = document.getElementById("btn-copy");
const btnPaste = document.getElementById("btn-paste");
const btnDelete = document.getElementById("btn-delete");
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");
const canvasWrapEl = document.getElementById("canvas-wrap");
const zoomLabelEl = document.getElementById("zoom-level");
const newWireSizeEl = document.getElementById("new-wire-size");
const newWireRowEl = document.getElementById("new-wire-row");
const selectedPropertiesHeadingEl = document.getElementById("selected-properties-heading");
const inspectorEmptyEl = document.getElementById("inspector-empty");
const selectedSizeRowEl = document.getElementById("selected-size-row");
const selectedSizeLabelEl = document.getElementById("selected-size-label");
const selectedSizeEl = document.getElementById("selected-size");
const romDataSizeRowEl = document.getElementById("rom-data-size-row");
const romDataSizeEl = document.getElementById("rom-data-size");
const romAddressSizeRowEl = document.getElementById("rom-address-size-row");
const romAddressSizeEl = document.getElementById("rom-address-size");
const channelsRowEl = document.getElementById("channels-row");
const channelsEl = document.getElementById("channels");
const splitterOrderRowEl = document.getElementById("splitter-order-row");
const splitterOrderEl = document.getElementById("splitter-order");
const selectedValueRowEl = document.getElementById("selected-value-row");
const selectedValueLabelEl = document.getElementById("selected-value-label");
const selectedValueEl = document.getElementById("selected-value");
const constantValueRowEl = document.getElementById("constant-value-row");
const constantValueEl = document.getElementById("constant-value");
const sourceValueLabelEl = document.getElementById("source-value-label");
const componentLabelRowEl = document.getElementById("component-label-row");
const componentLabelEl = document.getElementById("component-label");
const romOpenEl = document.getElementById("rom-open");
const romRowsEl = document.getElementById("rom-rows");
const romRangeEl = document.getElementById("rom-range");
const romPrevEl = document.getElementById("rom-prev");
const romNextEl = document.getElementById("rom-next");
const romJumpEl = document.getElementById("rom-jump");
const romGoEl = document.getElementById("rom-go");
const romSaveEl = document.getElementById("rom-save");
const romImportEl = document.getElementById("rom-file-input");
const romExportEl = document.getElementById("rom-export");
const romListEl = document.getElementById("rom-list");
const romWidthsEl = document.getElementById("rom-widths");
const romActionsEl = document.getElementById("rom-actions");
const romEmptyEl = document.getElementById("rom-empty");
const romEditorWrapEl = document.getElementById("rom-editor-wrap");
const romStatusEl = document.getElementById("rom-status");
const valueFormatRowEl = document.getElementById("value-format-row");
const valueFormatEl = document.getElementById("value-format");
const clockFrequencyRowEl = document.getElementById("clock-frequency-row");
const clockFrequencyEl = document.getElementById("clock-frequency");
const clockEnableRowEl = document.getElementById("clock-enable-row");
const clockEnableEl = document.getElementById("clock-enable");
const moduleOpenEl = document.getElementById("module-open");
const moduleLayoutOpenEl = document.getElementById("module-layout-open");
const moduleLayoutEl = document.getElementById("module-layout");
const moduleLayoutTitleEl = document.getElementById("module-layout-title");
const moduleLayoutListEl = document.getElementById("module-layout-list");
const moduleLayoutEmptyEl = document.getElementById("module-layout-empty");
const moduleLayoutScrollEl = document.getElementById("module-layout-scroll");
const moduleLayoutStatusEl = document.getElementById("module-layout-status");
const moduleLayoutStageEl = document.getElementById("module-layout-stage");
const moduleLayoutBoardEl = document.getElementById("module-layout-board");
const moduleLayoutNextEl = document.getElementById("module-layout-next");
const moduleLayoutNextRightEl = document.getElementById("module-layout-next-right");
const moduleLayoutResizeEl = document.getElementById("module-layout-resize");
const moduleLayoutTargetEl = document.getElementById("module-layout-target");
const moduleLayoutTrayEl = document.getElementById("module-layout-tray");
const moduleLayoutItemsEl = document.getElementById("module-layout-items");
const moduleLayoutTrayHeadingEl = moduleLayoutTrayEl.querySelector("h3");
const moduleNavigationEl = document.getElementById("module-navigation");
const moduleBackEl = document.getElementById("module-back");
const modulePathEl = document.getElementById("module-path");
const moduleStack = [];
const monitor = createMonitor({
  getEditor: () => editor,
  signalsEl: document.getElementById("monitor-signals"),
  noTagsEl: document.getElementById("monitor-no-tags"),
  workspaceEl: document.querySelector(".monitor-workspace"),
  gridEl: document.getElementById("monitor-grid"),
  emptyEl: document.getElementById("monitor-empty"),
});
const program = createProgram({ getEditor: () => editor });

const viewRenderers = {
  "canvas-view": applyView,
  "monitor-view": monitor.render,
  "rom-view": renderRomTab,
  "program-view": program.render,
  "module-layout-view": renderModuleLayout,
};
const tabs = createTabs(document.querySelector(".view-tabs"), (panelId) => viewRenderers[panelId]?.());
moduleLayoutOpenEl.addEventListener("click", () => {
  layoutTargetId = selectedId;
  tabs.show("module-layout-view", { focus: true });
});
const busStatusEl = document.getElementById("bus-status");
const { componentArt, renderComponents, renderPins, renderWires, edgeBox, applyBox } =
  createRenderer(gridEl, () => state, () => editor.evaluation, () => selectedIds, () => selectedWires);

function setSelection(ids, wires = []) {
  selectedIds = new Set(ids);
  selectedWires = new Set(wires);
  selectedId = selectedIds.size === 1 && !selectedWires.size ? [...selectedIds][0] : null;
  selectedWire = selectedWires.size === 1 && !selectedIds.size ? [...selectedWires][0] : null;
  renderComponents();
  renderWires();
  renderProperties();
}

function syncActionButtons() {
  btnUndo.disabled = !editor.canUndo;
  btnRedo.disabled = !editor.canRedo;
  btnCopy.disabled = selectedIds.size === 0 && selectedWires.size === 0;
  btnPaste.disabled = copiedSelection.components.length === 0 && copiedSelection.wires.length === 0;
  btnDelete.disabled = selectedIds.size === 0 && selectedWires.size === 0;
}

function busStatus(message, error = false) {
  busStatusEl.textContent = message;
  busStatusEl.hidden = !message;
  busStatusEl.classList.toggle("error", error);
}

function renderProperties() {
  const component = state.components.find((c) => c.id === selectedId);
  const net = selectedWire ? netContaining(state, selectedWire, editor.evaluation) : null;
  const selectionKey = component ? `component:${component.id}` : net ? `wire:${selectedWire}` : null;
  const preserveDraft = selectionKey !== null && selectionKey === inspectorSelectionKey;
  const setFieldValue = (field, value) => {
    if (!preserveDraft || document.activeElement !== field) field.value = value;
  };
  const selectionCount = selectedIds.size + selectedWires.size;
  selectedPropertiesHeadingEl.textContent = selectionCount > 1 ? `${selectionCount} items selected` : component ? spec(component.t).label : net ? "Wire" : mode === MODE.WIRE ? "Wire tool" : "Inspector";
  newWireRowEl.hidden = mode !== MODE.WIRE;
  inspectorEmptyEl.hidden = selectionCount > 0 || mode === MODE.WIRE;
  inspectorEmptyEl.textContent = placingType ? "Click the canvas to place the selected component." : "Select a component or wire to edit its properties.";
  const size = component && (isSizable(component) || component.t === "debugdisplay") ? bitWidth(component) : net?.size;
  const memory = component?.t === "rom" || component?.t === "ram";
  selectedSizeRowEl.hidden = size === undefined || memory;
  selectedSizeLabelEl.textContent = memory || component?.t === "mux" || component?.t === "demux" ? "Data size (bits)" : "Selected size (bits)";
  selectedSizeEl.disabled = size === undefined || component?.t === "debugdisplay";
  setFieldValue(selectedSizeEl, size === undefined ? "" : String(size));
  selectedSizeEl.max = ["constant", "input"].includes(component?.t) ? "8" : "32";
  romDataSizeRowEl.hidden = !memory;
  romDataSizeEl.disabled = !memory;
  setFieldValue(romDataSizeEl, memory ? String(bitWidth(component)) : "8");
  const plexer = component?.t === "mux" || component?.t === "demux";
  channelsRowEl.hidden = !plexer;
  channelsEl.disabled = !plexer;
  setFieldValue(channelsEl, plexer ? String(channelCount(component)) : "");
  const splitter = component?.t === "splitter";
  splitterOrderRowEl.hidden = !splitter;
  splitterOrderEl.disabled = !splitter;
  setFieldValue(splitterOrderEl, splitter ? component.order ?? "ascendant" : "ascendant");
  const source = component?.t === "constant" || component?.t === "input";
  constantValueRowEl.hidden = !source;
  constantValueEl.disabled = !source;
  sourceValueLabelEl.textContent = component?.t === "input" ? "Input value" : "Constant value";
  setFieldValue(constantValueEl, source ? formatValue(component.value ?? 0, bitWidth(component), component.format) : "");
  componentLabelRowEl.hidden = !component;
  componentLabelEl.disabled = !component;
  setFieldValue(componentLabelEl, component?.label ?? "");
  moduleOpenEl.hidden = component?.t !== "module";
  moduleLayoutOpenEl.hidden = component?.t !== "module" ||
    (!modulePorts(component).length && !moduleFaceParts(component).length);
  const rom = component?.t === "rom";
  romAddressSizeRowEl.hidden = !memory;
  romAddressSizeEl.disabled = !memory;
  setFieldValue(romAddressSizeEl, memory ? String(addressWidth(component)) : "");
  romOpenEl.hidden = !rom;
  const valueFormat = source || component?.t === "output";
  valueFormatRowEl.hidden = !valueFormat;
  valueFormatEl.disabled = !valueFormat;
  setFieldValue(valueFormatEl, valueFormat ? component.format ?? "decimal" : "decimal");
  const clock = component?.t === "clock";
  clockFrequencyRowEl.hidden = !clock;
  clockFrequencyEl.disabled = !clock;
  setFieldValue(clockFrequencyEl, clock ? String(component.frequency ?? DEFAULT_CLOCK_FREQUENCY) : "");
  clockEnableRowEl.hidden = !clock;
  clockEnableEl.disabled = !clock;
  clockEnableEl.checked = clock && component.enable !== false;
  const output = component?.t === "output" || component?.t === "debugdisplay";
  const stored = component?.t === "register" || component?.t === "counter" || component?.t === "ram";
  const displayedValue = output || stored ? editor.evaluation.states.get(component.id)?.value ?? 0 : net?.value;
  const displayedSize = output || stored ? bitWidth(component) : net?.size;
  selectedValueRowEl.hidden = !net && !output && !stored;
  selectedValueLabelEl.textContent = component?.t === "ram" ? "Data at address" : stored ? "Stored value (Q)" : component?.t === "debugdisplay" ? "Debug value" : output ? "Output value" : "Selected bus value";
  selectedValueEl.textContent = displayedValue === undefined ? "—" : output
    ? formatValue(displayedValue, displayedSize, component.t === "debugdisplay" ? "hex" : component.format)
    : displayedSize === 1 ? `${displayedValue} (${displayedValue ? "HIGH" : "LOW"})`
      : `${displayedValue} (0b${displayedValue.toString(2).padStart(displayedSize, "0")})`;
  if (size !== undefined && !busStatusEl.classList.contains("error")) {
    busStatus(component ? `${spec(component.t).label}: ${size} bit${size === 1 ? "" : "s"}${plexer ? `, ${channelCount(component)} channels, ${selectWidth(component)} selector bit${selectWidth(component) === 1 ? "" : "s"}` : ""}.` :
      `Selected bus: ${size} bit${size === 1 ? "" : "s"}.`);
  }
  if (clock && !busStatusEl.classList.contains("error"))
    busStatus(`Clock: ${component.frequency ?? DEFAULT_CLOCK_FREQUENCY} Hz, ${component.enable === false ? "disabled" : "enabled"}.`);
  if (memory && !busStatusEl.classList.contains("error")) {
    const inputs = editor.evaluation.states.get(component.id)?.inputs ?? [];
    const value = editor.evaluation.states.get(component.id)?.value ?? 0;
    busStatus(`${component.t.toUpperCase()} address ${(inputs[0] ?? 0).toString(16).toUpperCase().padStart(Math.ceil(addressWidth(component) / 4), "0")}: ${value.toString(16).toUpperCase()}.`);
  }
  inspectorSelectionKey = selectionKey;
  syncActionButtons();
}

const MODULE_LAYOUT_STEP = 80;
let moduleLayoutDragging = false;

function renderModuleLayout() {
  if (moduleLayoutDragging) return;
  let component = editor.component(layoutTargetId);
  const modules = state.components.filter((item) => item.t === "module");
  if (component?.t !== "module") {
    component = modules[0] ?? null;
    layoutTargetId = component?.id ?? null;
  }
  const names = modules.map((item) => item.label || "Module");
  moduleLayoutListEl.replaceChildren();
  modules.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = names.filter((name) => name === names[index]).length > 1
      ? `${names[index]} ${index + 1}` : names[index];
    button.className = "module-layout-module";
    button.classList.toggle("active", item.id === layoutTargetId);
    button.setAttribute("aria-pressed", String(item.id === layoutTargetId));
    button.addEventListener("click", () => {
      layoutTargetId = item.id;
      moduleLayoutStatus("");
      renderModuleLayout();
    });
    moduleLayoutListEl.append(button);
  });
  moduleLayoutEmptyEl.hidden = !!component;
  moduleLayoutEmptyEl.textContent = "Add a module on Canvas";
  moduleLayoutScrollEl.hidden = !component;
  moduleLayoutTrayEl.hidden = !component;
  if (!component) return;
  const ports = modulePorts(component);
  const parts = moduleFaceParts(component);
  moduleLayoutTitleEl.textContent = component.label || "Module";

  const local = { ...component, x: 0, y: 0, r: 0 };
  const { w, h } = dimsOf(local);
  const step = MODULE_LAYOUT_STEP;
  moduleLayoutStageEl.style.width = `${(w + 2) * step}px`;
  moduleLayoutStageEl.style.height = `${(h + 2) * step}px`;
  moduleLayoutBoardEl.style.width = `${w * step}px`;
  moduleLayoutBoardEl.style.height = `${h * step}px`;
  moduleLayoutBoardEl.innerHTML = componentArt(local, spec("module"), 0, [], editor.evaluation.states.get(component.id));
  moduleLayoutNextEl.style.top = `${h * step}px`;
  moduleLayoutNextEl.style.height = `${2 * step}px`;
  moduleLayoutNextEl.style.width = `${(w + 2) * step}px`;
  moduleLayoutNextRightEl.style.left = `${w * step}px`;
  moduleLayoutNextRightEl.style.width = `${2 * step}px`;
  moduleLayoutNextRightEl.style.height = `${h * step}px`;
  moduleLayoutResizeEl.style.left = `${w * step}px`;
  moduleLayoutResizeEl.style.top = `${h * step}px`;
  moduleLayoutStageEl.querySelectorAll(".module-layout-pin, .module-layout-face").forEach((item) => item.remove());
  moduleLayoutTargetEl.hidden = true;

  modulePinLayout(component).forEach(([side, position], index) => {
    const port = ports[index];
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `module-layout-pin ${port.role}`;
    pin.dataset.kind = "pin";
    pin.dataset.index = String(index);
    pin.style.left = `${(side === "W" ? 0 : side === "E" ? w : position) * step}px`;
    pin.style.top = `${(side === "N" ? 0 : side === "S" ? h : position) * step}px`;
    pin.title = `${port.name || `Pin ${index + 1}`} · ${port.role === "in" ? "Input" : "Output"}`;
    pin.setAttribute("aria-label", `Move ${pin.title}`);
    moduleLayoutStageEl.append(pin);
  });

  moduleLayoutTrayEl.hidden = parts.every((part) => component.faceLayout?.some(([index]) => index === part.index));
  moduleLayoutTrayHeadingEl.textContent = "Available components";
  moduleLayoutItemsEl.replaceChildren();
  for (const part of parts) {
    const slot = component.faceLayout?.find(([index]) => index === part.index);
    const name = part.label || `${spec(part.type).label} #${part.index + 1}`;
    const item = document.createElement("button");
    item.type = "button";
    item.className = slot ? "module-layout-face" : "module-layout-chip";
    item.dataset.kind = "face";
    item.dataset.index = String(part.index);
    item.title = name;
    item.setAttribute("aria-label", slot ? `Move ${name}` : `Place ${name}`);
    if (slot) {
      item.style.left = `${slot[1] * step}px`;
      item.style.top = `${slot[2] * step}px`;
      moduleLayoutStageEl.append(item);
    } else {
      item.textContent = name;
      const entry = document.createElement("div");
      entry.className = "module-layout-entry";
      const add = document.createElement("button");
      add.type = "button";
      add.className = "module-layout-add";
      add.textContent = "Place";
      add.title = `Add ${name} to module face`;
      add.setAttribute("aria-label", add.title);
      add.addEventListener("click", () => addModuleFacePart(component.id, part.index));
      entry.append(item, add);
      moduleLayoutItemsEl.append(entry);
    }
  }
}

function moduleLayoutStatus(message, error = false) {
  moduleLayoutStatusEl.textContent = message;
  moduleLayoutStatusEl.hidden = !message;
  moduleLayoutStatusEl.classList.toggle("error", error);
}

function addModuleFacePart(id, index) {
  const component = editor.component(id);
  if (component?.t !== "module") return;
  const { w, h } = dimsOf({ ...component, r: 0 });
  const cells = [];
  for (let y = 2; y <= Math.min(32, h + 1); y++) for (let x = 1; x <= Math.min(19, w + 1); x++)
    cells.push([x, y]);
  cells.sort((a, b) => Math.abs(a[0] - w / 2) + Math.abs(a[1] - 2) -
    Math.abs(b[0] - w / 2) - Math.abs(b[1] - 2));
  for (const [x, y] of cells) {
    if (editor.setModuleFacePart(id, index, x, y)) {
      moduleLayoutStatus("");
      renderProperties();
      return;
    }
  }
  moduleLayoutStatus("No available space for this component.", true);
}

function moduleLayoutCandidate(kind, index, clientX, clientY) {
  const component = editor.component(layoutTargetId);
  if (component?.t !== "module") return null;
  const step = MODULE_LAYOUT_STEP;
  const rect = moduleLayoutStageEl.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const { w, h } = dimsOf({ ...component, r: 0 });
  const boardHeight = h * step;
  if (kind === "face" && moduleLayoutTrayEl.getBoundingClientRect().left <= clientX &&
      moduleLayoutTrayEl.getBoundingClientRect().right >= clientX &&
      moduleLayoutTrayEl.getBoundingClientRect().top <= clientY &&
      moduleLayoutTrayEl.getBoundingClientRect().bottom >= clientY) return { hidden: true };
  if (kind === "resize") {
    const width = Math.max(4, Math.min(20, w + 2, Math.round(x / step)));
    const height = Math.max(3, Math.min(32, h + 2, Math.round(y / step)));
    return { width, height, x: width * step, y: height * step };
  }
  if (x < 0 || x > (w + (kind === "face" ? 2 : 0)) * step ||
      y < 0 || y > (h + (kind === "face" ? 2 : 0)) * step) return null;
  if (kind === "pin") {
    const distances = [["N", y], ["E", w * step - x], ["S", boardHeight - y], ["W", x]];
    const side = distances.sort((a, b) => a[1] - b[1])[0][0];
    const maximum = side === "N" || side === "S" ? w - 1 : h - 1;
    const position = Math.max(1, Math.min(maximum, Math.round((side === "N" || side === "S" ? x : y) / step)));
    if (modulePinLayout(component).some(([usedSide, usedPosition], other) =>
      other !== index && usedSide === side && usedPosition === position)) return null;
    return { side, position, x: (side === "W" ? 0 : side === "E" ? w : position) * step,
      y: (side === "N" ? 0 : side === "S" ? h : position) * step };
  }
  const cellX = Math.max(1, Math.min(19, w + 1, Math.round(x / step)));
  const cellY = Math.max(2, Math.min(32, h + 1, Math.round(y / step)));
  if ((component.faceLayout ?? []).some(([partIndex, placedX, placedY]) =>
    partIndex !== index && placedX === cellX && placedY === cellY)) return null;
  return { cellX, cellY, x: cellX * step, y: cellY * step };
}

moduleLayoutEl.addEventListener("pointerdown", (event) => {
  const source = event.target.closest("[data-kind]");
  if (!source || event.button !== 0) return;
  event.preventDefault();
  const kind = source.dataset.kind, index = Number(source.dataset.index);
  const ghost = source.cloneNode(true);
  ghost.className = "module-layout-ghost";
  ghost.removeAttribute("id");
  ghost.textContent = source.title;
  ghost.style.left = `${event.clientX}px`;
  ghost.style.top = `${event.clientY}px`;
  document.body.append(ghost);
  source.classList.add("dragging");
  source.setPointerCapture(event.pointerId);
  moduleLayoutDragging = true;
  if (kind === "face" && source.classList.contains("module-layout-face")) {
    moduleLayoutTrayEl.hidden = false;
    if (!moduleLayoutItemsEl.childElementCount) moduleLayoutTrayHeadingEl.textContent = "Remove component";
  }
  let candidate = null;
  const move = (nextEvent) => {
    ghost.style.left = `${nextEvent.clientX}px`;
    ghost.style.top = `${nextEvent.clientY}px`;
    candidate = moduleLayoutCandidate(kind, index, nextEvent.clientX, nextEvent.clientY);
    moduleLayoutTargetEl.hidden = !candidate || candidate.hidden;
    if (candidate && !candidate.hidden) {
      moduleLayoutTargetEl.className = `module-layout-target ${kind}`;
      moduleLayoutTargetEl.style.left = `${candidate.x}px`;
      moduleLayoutTargetEl.style.top = `${candidate.y}px`;
    }
    moduleLayoutTrayEl.classList.toggle("drop-target", !!candidate?.hidden);
  };
  const finish = (nextEvent) => {
    source.removeEventListener("pointermove", move);
    source.removeEventListener("pointerup", finish);
    source.removeEventListener("pointercancel", cancel);
    ghost.remove();
    moduleLayoutDragging = false;
    source.classList.remove("dragging");
    moduleLayoutTargetEl.hidden = true;
    moduleLayoutTrayEl.classList.remove("drop-target");
    if (nextEvent.type === "pointercancel") { renderProperties(); return; }
    candidate = moduleLayoutCandidate(kind, index, nextEvent.clientX, nextEvent.clientY);
    if (!candidate) { renderProperties(); return; }
    const id = layoutTargetId;
    const changed = kind === "pin" ? editor.setModulePin(id, index, candidate.side, candidate.position)
      : kind === "resize" ? editor.setModuleSize(id, candidate.width, candidate.height)
      : editor.setModuleFacePart(id, index, candidate.hidden ? null : candidate.cellX, candidate.hidden ? null : candidate.cellY);
    if (!changed) moduleLayoutStatus("That placement is blocked by a wire, another component, or the module boundary.", true);
    else moduleLayoutStatus("");
    renderProperties();
  };
  const cancel = (nextEvent) => finish(nextEvent);
  source.addEventListener("pointermove", move);
  source.addEventListener("pointerup", finish);
  source.addEventListener("pointercancel", cancel);
});

for (const field of [selectedSizeEl, romDataSizeEl, channelsEl, splitterOrderEl,
  constantValueEl, componentLabelEl, romAddressSizeEl, valueFormatEl, clockFrequencyEl]) {
  field.addEventListener("blur", () => renderProperties());
}

newWireSizeEl.addEventListener("change", () => {
  const size = Number(newWireSizeEl.value);
  if (!validBitWidth(size)) {
    newWireSizeEl.value = String(newWireSize);
    busStatus("Wire size must be a whole number from 1 to 32.", true);
    return;
  }
  newWireSize = size;
  clearWireGesture();
  busStatus(`New wires will carry ${size} bit${size === 1 ? "" : "s"}.`);
});

selectedSizeEl.addEventListener("change", () => {
  const size = Number(selectedSizeEl.value);
  const component = editor.component(selectedId);
  const current = component ? bitWidth(component) : selectedWire ? netContaining(state, selectedWire, editor.evaluation)?.size : undefined;
  if (size === current) return;
  const changed = component ? editor.resizeComponent(selectedId, size) : editor.resizeWire(selectedWire, size);
  if (!changed) busStatus(["constant", "input"].includes(component?.t)
    ? "Source width must be 1–8 bits and match connected wires."
    : component?.t === "rom" ? "ROM data width must be 1, 2, 4, 8, 16, or 32 bits and match connected wires."
    : "Bus size mismatch or invalid size (use 1–32 bits).", true);
  else busStatus(`Size set to ${size} bits.`);
  renderProperties();
});

romDataSizeEl.addEventListener("change", () => {
  const size = Number(romDataSizeEl.value);
  const kind = editor.component(selectedId)?.t.toUpperCase() ?? "Memory";
  if (editor.resizeComponent(selectedId, size)) busStatus(`${kind} data size set to ${size} bits.`);
  else busStatus(`${kind} data size must match connected wires.`, true);
  renderProperties();
});

romAddressSizeEl.addEventListener("change", () => {
  const size = Number(romAddressSizeEl.value);
  const kind = editor.component(selectedId)?.t;
  const changed = editor.resizeMemoryAddress(selectedId, size);
  if (changed) busStatus(`${kind.toUpperCase()} address size set to ${size} bits.`);
  else busStatus(`${kind?.toUpperCase() ?? "Memory"} address width must be 1, 2, 4, 8, or 16 bits and fit connected wires${kind === "rom" ? ", and include every stored address" : ""}.`, true);
  renderProperties();
});

channelsEl.addEventListener("change", () => {
  const channels = Number(channelsEl.value);
  if (editor.setChannelCount(selectedId, channels))
    busStatus(`Set ${channels} data channels; selector uses ${selectWidth(editor.component(selectedId))} bit(s).`);
  else busStatus("Channel count must be 1–16 and fit without overlapping other components or mismatched wires.", true);
  renderProperties();
});

splitterOrderEl.addEventListener("change", () => {
  if (editor.setSplitterOrder(selectedId, splitterOrderEl.value))
    busStatus(`Splitter order set to ${splitterOrderEl.value}.`);
  else renderProperties();
});

constantValueEl.addEventListener("change", () => {
  const component = editor.component(selectedId);
  if (!component || !["constant", "input"].includes(component.t)) return;
  const value = parseValue(constantValueEl.value, component.format);
  if (value === component.value) { renderProperties(); return; }
  if (value !== null && editor.setConstantValue(selectedId, value)) {
    busStatus(`Constant set to ${value}.`);
  } else {
    busStatus(`Enter a valid ${component.format ?? "decimal"} whole number from 0 to ${2 ** bitWidth(component) - 1}; the value must not short circuit another output.`, true);
    renderProperties();
  }
});

componentLabelEl.addEventListener("change", () => {
  const component = editor.component(selectedId);
  if (!editor.setLabel(selectedId, componentLabelEl.value)) {
    if (component && component.label !== componentLabelEl.value)
      busStatus(component.t === "portal"
        ? "Portal labels must be at most 80 characters."
        : `Each ${spec(component.t).label} needs a unique label of at most 80 characters.`, true);
    renderProperties();
  }
});

function romTarget() {
  const component = editor.component(romTargetId);
  return component?.t === "rom" ? component : null;
}

function romStatus(message, error = false) {
  romStatusEl.textContent = message;
  romStatusEl.hidden = !message;
  romStatusEl.classList.toggle("error", error);
}

function romEntries(component) {
  const draft = romDrafts.get(component.id);
  if (!draft) return new Map(component.data ?? []);
  const addressSize = addressWidth(component);
  const dataSize = bitWidth(component);
  if (draft.addressSize !== addressSize || draft.dataSize !== dataSize) {
    draft.entries = new Map([...draft.entries]
      .filter(([address]) => address < 2 ** addressSize)
      .map(([address, value]) => [address, value % (2 ** dataSize)])
      .filter(([, value]) => value !== 0));
    draft.addressSize = addressSize;
    draft.dataSize = dataSize;
  }
  return draft.entries;
}

function editRomEntry(component, address, value) {
  if (!romDrafts.has(component.id)) romDrafts.set(component.id, {
    entries: new Map(component.data ?? []), addressSize: addressWidth(component), dataSize: bitWidth(component),
  });
  const entries = romEntries(component);
  if (value) entries.set(address, value);
  else entries.delete(address);
  romStatus("Unsaved ROM edits.");
}

function addressLabel(address, width) {
  return address.toString(16).toUpperCase().padStart(Math.max(2, Math.ceil(width / 4)), "0");
}

function constrainHexInput(input, width) {
  const currentWidth = () => typeof width === "function" ? width() : width;
  input.addEventListener("beforeinput", (event) => {
    if (event.data === null || event.isComposing) return;
    const next = input.value.slice(0, input.selectionStart) + event.data + input.value.slice(input.selectionEnd);
    if (!validHexWord(next, currentWidth())) {
      event.preventDefault();
      romStatus(`Use hexadecimal digits that fit ${currentWidth()} bits.`, true);
    }
  });
  input.addEventListener("input", () => {
    if (validHexWord(input.value, currentWidth())) {
      input.dataset.valid = input.value;
      delete input.dataset.rejected;
    }
    else {
      input.value = input.dataset.valid ?? "";
      input.dataset.rejected = "true";
      romStatus(`Use hexadecimal digits that fit ${currentWidth()} bits.`, true);
    }
  });
}

function renderRomRows(force = false) {
  const component = romTarget();
  if (!component) {
    romRowsEl.replaceChildren();
    romRangeEl.textContent = "";
    romPrevEl.disabled = true;
    romNextEl.disabled = true;
    romRenderedKey = null;
    return;
  }
  const count = 2 ** addressWidth(component);
  romPageStart = Math.min(romPageStart, Math.floor((count - 1) / ROM_PAGE_SIZE) * ROM_PAGE_SIZE);
  const key = `${component.id}:${addressWidth(component)}:${bitWidth(component)}:${romPageStart}`;
  if (!force && key === romRenderedKey) return;
  romRenderedKey = key;
  const end = Math.min(romPageStart + ROM_PAGE_SIZE, count);
  romRangeEl.textContent = `${addressLabel(romPageStart, addressWidth(component))}–${addressLabel(end - 1, addressWidth(component))} of ${addressLabel(count - 1, addressWidth(component))}`;
  romPrevEl.disabled = romPageStart === 0;
  romNextEl.disabled = end === count;
  const entries = romEntries(component);
  const digits = Math.ceil(bitWidth(component) / 4);
  const fragment = document.createDocumentFragment();
  for (let columnStart = romPageStart; columnStart < end; columnStart += ROM_COLUMN_SIZE) {
    const column = document.createElement("div");
    column.className = "rom-column";
    const header = document.createElement("div");
    header.className = "rom-column-head";
    const addressHead = document.createElement("span");
    addressHead.textContent = "Address";
    const valueHead = document.createElement("span");
    valueHead.textContent = "Hex value";
    header.append(addressHead, valueHead);
    column.appendChild(header);
    for (let address = columnStart; address < Math.min(columnStart + ROM_COLUMN_SIZE, end); address++) {
      const row = document.createElement("div");
      row.className = "rom-row";
      const label = document.createElement("span");
      label.className = "rom-address";
      label.textContent = addressLabel(address, addressWidth(component));
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "text";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.maxLength = digits;
      input.dataset.address = String(address);
      input.placeholder = "0".padStart(digits, "0");
      input.setAttribute("aria-label", `Value at address ${label.textContent}`);
      input.value = entries.has(address) ? entries.get(address).toString(16).toUpperCase().padStart(digits, "0") : "";
      input.dataset.valid = input.value;
      constrainHexInput(input, bitWidth(component));
      input.addEventListener("input", () => {
        if (input.dataset.rejected === "true") { delete input.dataset.rejected; return; }
        if (romTarget() !== component || !validHexWord(input.value, bitWidth(component))) return;
        input.value = input.value.toUpperCase();
        input.dataset.valid = input.value;
        editRomEntry(component, address, input.value ? parseInt(input.value, 16) : 0);
      });
      input.addEventListener("keydown", (event) => {
        const direction = event.key === "ArrowDown" || event.key === "Enter" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        if (!direction) return;
        const next = romRowsEl.querySelector(`input[data-address="${address + direction}"]`);
        if (next) { event.preventDefault(); next.focus(); next.select(); }
      });
      row.append(label, input);
      column.append(row);
    }
    fragment.append(column);
  }
  romRowsEl.replaceChildren(fragment);
}

function renderRomTab() {
  const roms = state.components.filter((item) => item.t === "rom");
  if (!romTarget()) romTargetId = roms[0]?.id ?? null;
  const component = romTarget();
  const ready = !!component;
  romListEl.replaceChildren();
  const names = roms.map((item) => item.label || "ROM");
  roms.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = names.filter((name) => name === names[index]).length > 1
      ? `${names[index]} ${index + 1}` : names[index];
    button.className = "rom-list-item";
    button.classList.toggle("active", item.id === romTargetId);
    button.setAttribute("aria-pressed", String(item.id === romTargetId));
    button.addEventListener("click", () => openRom(item.id));
    romListEl.append(button);
  });
  romEmptyEl.hidden = ready;
  romEditorWrapEl.hidden = !ready;
  romActionsEl.hidden = !ready;
  if (!ready) romStatus("");
  romWidthsEl.textContent = ready ? `${addressWidth(component)}-bit address · ${bitWidth(component)}-bit data` : "";
  romWidthsEl.hidden = !ready;
  romSaveEl.disabled = !ready;
  romImportEl.disabled = !ready;
  romExportEl.disabled = !ready;
  romJumpEl.disabled = !ready;
  romGoEl.disabled = !ready;
  if (ready && !validHexWord(romJumpEl.value, addressWidth(component))) {
    romJumpEl.value = "";
    romJumpEl.dataset.valid = "";
  }
  renderRomRows();
}

function openRom(id) {
  const component = editor.component(id);
  if (component?.t !== "rom") return;
  romTargetId = component.id;
  romPageStart = 0;
  romRenderedKey = null;
  romJumpEl.value = "";
  romJumpEl.dataset.valid = "";
  romStatus(romDrafts.has(component.id) ? "Unsaved ROM edits." : "");
  tabs.show("rom-view");
  romRowsEl.querySelector("input")?.focus();
}

romOpenEl.addEventListener("click", () => openRom(selectedId));
romPrevEl.addEventListener("click", () => { romPageStart -= ROM_PAGE_SIZE; renderRomRows(true); });
romNextEl.addEventListener("click", () => { romPageStart += ROM_PAGE_SIZE; renderRomRows(true); });
constrainHexInput(romJumpEl, () => romTarget() ? addressWidth(romTarget()) : 1);
romJumpEl.addEventListener("keydown", (event) => { if (event.key === "Enter") romGoEl.click(); });
romGoEl.addEventListener("click", () => {
  const component = romTarget();
  if (!component || !romJumpEl.value) return;
  const address = parseInt(romJumpEl.value, 16);
  if (address >= 2 ** addressWidth(component)) {
    romStatus(`Address must fit ${addressWidth(component)} bits.`, true);
    return;
  }
  romPageStart = Math.floor(address / ROM_PAGE_SIZE) * ROM_PAGE_SIZE;
  renderRomRows(true);
  romRowsEl.querySelector(`input[data-address="${address}"]`)?.focus();
});

romSaveEl.addEventListener("click", () => {
  const component = romTarget();
  if (!component) return;
  try {
    const entries = [...romEntries(component)].sort((a, b) => a[0] - b[0]);
    if (JSON.stringify(entries) !== JSON.stringify(component.data ?? []) && !editor.setRomData(component.id, entries))
      throw new Error("ROM contents conflict with a connected output.");
    romDrafts.delete(component.id);
    romStatus("ROM changes saved.");
  } catch (error) { romStatus(error.message, true); }
});

romImportEl.addEventListener("change", async () => {
  const file = romImportEl.files[0];
  romImportEl.value = "";
  const component = romTarget();
  if (!file || !component) return;
  try {
    const contents = await file.text();
    if (romTarget() !== component) return;
    const entries = parseRomFile(contents, addressWidth(component), bitWidth(component));
    romDrafts.set(component.id, { entries: new Map(entries), addressSize: addressWidth(component), dataSize: bitWidth(component) });
    renderRomRows(true);
    romStatus("ROM file loaded. Save to apply it to the component.");
  } catch (error) { romStatus(error.message, true); }
});

romExportEl.addEventListener("click", () => {
  const component = romTarget();
  if (!component) return;
  try {
    const entries = [...romEntries(component)].sort((a, b) => a[0] - b[0]);
    const blob = new Blob([serializeRomFile(entries, addressWidth(component), bitWidth(component))], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${component.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    romStatus("ROM file exported.");
  } catch (error) { romStatus(error.message, true); }
});

valueFormatEl.addEventListener("change", () => {
  if (editor.setValueFormat(selectedId, valueFormatEl.value))
    busStatus(`Value format set to ${valueFormatEl.selectedOptions[0].textContent}.`);
  else renderProperties();
});

clockFrequencyEl.addEventListener("change", () => {
  const frequency = Number(clockFrequencyEl.value);
  if (editor.setClockFrequency(selectedId, frequency))
    busStatus(`Clock set to ${frequency} Hz.`);
  else if (editor.component(selectedId)?.frequency !== frequency)
    busStatus("Frequency must be between 0.1 and 20 Hz.", true);
  renderProperties();
});

clockEnableEl.addEventListener("change", () => {
  if (editor.setClockEnabled(selectedId, clockEnableEl.checked))
    busStatus(`Clock ${clockEnableEl.checked ? "enabled" : "disabled"}.`);
  renderProperties();
});

function selectWire(key) {
  const net = netContaining(state, key, editor.evaluation);
  setSelection([], [net ? edgeKey(net.edges[0]) : key]);
  busStatus("Wire net selected.");
}

function beginSelectionDrag(e) {
  const world = worldFromEvent(e);
  drag = { kind: "selection", pointerId: e.pointerId, startX: world.x, startY: world.y,
    ids: [...selectedIds], wires: [...selectedWires], dx: 0, dy: 0, valid: true };
  canvasWrapEl.setPointerCapture(e.pointerId);
}

function viewportFromEvent(ev) {
  const rect = canvasWrapEl.getBoundingClientRect();
  return {
    x: ev.clientX - rect.left - canvasWrapEl.clientLeft,
    y: ev.clientY - rect.top - canvasWrapEl.clientTop,
  };
}

function worldFromViewport(p) {
  return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
}

function worldFromEvent(ev) {
  return worldFromViewport(viewportFromEvent(ev));
}

function cellFromEvent(ev) {
  const world = worldFromEvent(ev);
  return { x: Math.floor(world.x / CELL), y: Math.floor(world.y / CELL) };
}

function pointFromEvent(ev) {
  const world = worldFromEvent(ev);
  return { x: Math.round(world.x / CELL), y: Math.round(world.y / CELL) };
}

function edgeFromEvent(ev) {
  const world = worldFromEvent(ev);
  const fx = world.x / CELL;
  const fy = world.y / CELL;
  const hEdge = { o: "H", x: Math.floor(fx), y: Math.round(fy) };
  const vEdge = { o: "V", x: Math.round(fx), y: Math.floor(fy) };
  const hDist = Math.abs(fy - hEdge.y);
  const vDist = Math.abs(fx - vEdge.x);
  const nearest = hDist <= vDist ? hEdge : vEdge;
  const alternate = nearest === hEdge ? vEdge : hEdge;
  const alternateDist = nearest === hEdge ? vDist : hDist;
  // Near a component outline, the closest grid line can run through its body.
  // Prefer the nearby border edge when the closest edge is blocked.
  if (alternateDist <= 0.25 &&
      edgePlacementError(state, { ...nearest, size: newWireSize }) === "Wire is blocked by a component." &&
      edgePlacementError(state, { ...alternate, size: newWireSize }) === null) return alternate;
  return nearest;
}

/* ---------- Rendering ---------- */

function applyView() {
  gridEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  const step = CELL * view.zoom;
  canvasWrapEl.style.backgroundSize = `${step}px ${step}px`;
  canvasWrapEl.style.backgroundPosition = `${view.x}px ${view.y}px`;
  if (zoomLabelEl) zoomLabelEl.textContent = `${Math.round(view.zoom * 100)}%`;
}

function zoomAt(factor, cx, cy) {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  if (Math.abs(next - view.zoom) < 1e-6) return;
  if (cx === undefined) {
    const rect = canvasWrapEl.getBoundingClientRect();
    cx = rect.width / 2;
    cy = rect.height / 2;
  }
  // Keep the world point under the anchor fixed while the scale changes.
  const wx = (cx - view.x) / view.zoom;
  const wy = (cy - view.y) / view.zoom;
  view.zoom = next;
  view.x = cx - wx * next;
  view.y = cy - wy * next;
  applyView();
}

function contentCenter() {
  if (!state.components.length) return { x: 0, y: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of state.components) {
    const d = dimsOf(c);
    if (!d) continue;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + d.w);
    maxY = Math.max(maxY, c.y + d.h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 };
  return { x: ((minX + maxX) / 2) * CELL, y: ((minY + maxY) / 2) * CELL };
}

function resetView() {
  view.zoom = 1;
  const rect = canvasWrapEl.getBoundingClientRect();
  const center = contentCenter();
  view.x = rect.width / 2 - center.x;
  view.y = rect.height / 2 - center.y;
  applyView();
}

function renderPalette() {
  const scrollTop = paletteEl.scrollTop;
  const query = paletteSearchEl.value.trim().toLocaleLowerCase();
  paletteEl.innerHTML = "";
  for (const [type, s] of Object.entries(COMPONENT_TYPES)) {
    if (!s.label.toLocaleLowerCase().includes(query) && !type.toLocaleLowerCase().includes(query)) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.type = type;
    btn.classList.toggle("active", placingType === type);
    btn.innerHTML = `<span class="palette-icon" aria-hidden="true">${componentArt({ t: type, r: 0, size: s.splitter ? 4 : 1, value: 0 }, s)}</span>
      <span class="name">${s.label}</span>`;
    btn.addEventListener("click", () => {
      placingType = placingType === type ? null : type;
      // Arming a component is a normal-canvas activity, so leave wire mode.
      if (placingType) { mode = MODE.PAN; clearWireGesture(); setSelection([]); }
      renderPalette();
      syncPlacingCursor();
    });
    paletteEl.appendChild(btn);
  }
  paletteEl.scrollTop = scrollTop;
  paletteEmptyEl.hidden = paletteEl.childElementCount !== 0;
}

paletteSearchEl.addEventListener("input", renderPalette);

function syncPlacingCursor() {
  canvasWrapEl.classList.toggle("placing", placingType !== null);
  canvasWrapEl.classList.toggle("pan", mode === MODE.PAN && placingType === null);
  canvasWrapEl.classList.toggle("wire-mode", mode === MODE.WIRE);
  canvasWrapEl.classList.toggle("select-mode", mode === MODE.SELECT);
  btnWire.classList.toggle("active", mode === MODE.WIRE);
  btnPan.classList.toggle("active", mode === MODE.PAN);
  btnSelect.classList.toggle("active", mode === MODE.SELECT);
  btnWire.setAttribute("aria-pressed", String(mode === MODE.WIRE));
  btnPan.setAttribute("aria-pressed", String(mode === MODE.PAN));
  btnSelect.setAttribute("aria-pressed", String(mode === MODE.SELECT));
  if (mode !== MODE.WIRE) {
    clearWireGesture();
  }
  renderProperties();
}

function render() {
  const logic = editor.evaluation;
  renderWires(logic);
  renderComponents(logic);
  renderPins();
  renderProperties();
  viewRenderers[tabs.active]?.();
}

function showModulePath() {
  moduleNavigationEl.hidden = moduleStack.length === 0;
  modulePathEl.textContent = ["Canvas", ...moduleStack.map(({ name }) => name)].join(" / ");
}

function openModule(id) {
  const component = editor.component(id);
  if (component?.t !== "module") return;
  if (moduleStack.length >= 8) {
    busStatus("Modules can be nested up to eight levels.", true);
    return;
  }
  const { board } = parseDocument(JSON.stringify(component.module));
  clearWireGesture();
  moduleStack.push({ editor, id, name: component.label || "Module" });
  editor = new BoardEditor({ storage: { setItem() {} },
    onChange: boardChanged });
  editor.replaceBoard(board, { save: false });
  state = editor.board;
  romTargetId = null;
  layoutTargetId = null;
  setSelection([]);
  placingType = null;
  mode = MODE.PAN;
  renderPalette();
  syncPlacingCursor();
  showModulePath();
  tabs.show("canvas-view");
  syncClockTimers();
  render();
  resetView();
}

function closeModule() {
  const parent = moduleStack.at(-1);
  if (!parent) return;
  const child = editor;
  clearWireGesture();
  editor = parent.editor;
  if (!editor.setModuleBoard(parent.id, child.board)) {
    editor = child;
    busStatus("The module cannot fit here. Check its pins, connected wire sizes, overlaps, and short circuits.", true);
    return;
  }
  moduleStack.pop();
  state = editor.board;
  romTargetId = null;
  layoutTargetId = parent.id;
  setSelection([parent.id]);
  showModulePath();
  syncClockTimers();
  render();
  resetView();
  const component = editor.component(parent.id);
  if (component && (modulePorts(component).length || moduleFaceParts(component).length)) tabs.show("module-layout-view");
  busStatus("Module saved.");
}

moduleOpenEl.addEventListener("click", () => openModule(selectedId));
moduleBackEl.addEventListener("click", closeModule);

/* ---------- Interaction ---------- */

for (const controls of document.querySelectorAll(".canvas-controls")) {
  for (const type of ["pointerdown", "dblclick", "contextmenu", "wheel"]) {
    controls.addEventListener(type, (e) => e.stopPropagation());
  }
}

canvasWrapEl.addEventListener("pointerdown", (e) => {
  if (e.button === 2) return;

  const wireEl = e.target.closest(".wire");
  const compEl = e.target.closest(".comp");
  const cell = cellFromEvent(e);

  if (mode === MODE.WIRE) {
    const point = pointFromEvent(e);
    if (e.shiftKey) {
      clearWireGesture();
      const changed = editor.toggleJunction(point.x, point.y);
      busStatus(changed
        ? "Crossing connection changed. Shift-click to toggle it again."
        : "No compatible four-way crossing here, or joining it would short the circuit.",
        !changed);
      return;
    }
    if (!wireStart) {
      wireStart = point;
      setSelection([]);
      busStatus("Click to place a corner or endpoint. Shift-click a crossing to join or separate it. Double-click or right-click to finish; Esc cancels.");
    } else if (point.x !== wireStart.x || point.y !== wireStart.y) {
      const result = editor.addWireRoute(wireStart, point, newWireSize);
      if (result.error) busStatus(result.error, true);
      else {
        wireStart = point;
        busStatus("Corner placed. Click to continue, or double-click/right-click to finish.");
      }
    }
    if (wirePreviewFrame !== null) cancelAnimationFrame(wirePreviewFrame);
    wirePreviewFrame = null;
    pendingWirePreviewPoint = null;
    lastWirePreviewKey = null;
    updateWirePreview(point);
    return;
  }

  if (mode === MODE.SELECT) {
    if (compEl) {
      const id = compEl.dataset.id;
      if (e.shiftKey) {
        const ids = new Set(selectedIds);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        setSelection(ids, selectedWires);
      } else {
        if (!selectedIds.has(id)) setSelection([id]);
        beginSelectionDrag(e);
      }
      busStatus(`${selectedIds.size} component${selectedIds.size === 1 ? "" : "s"} and ${selectedWires.size} wire net${selectedWires.size === 1 ? "" : "s"} selected.`);
    } else if (wireEl) {
      const net = netContaining(state, wireEl.dataset.key, editor.evaluation);
      const key = net ? edgeKey(net.edges[0]) : wireEl.dataset.key;
      if (e.shiftKey) {
        const wires = new Set(selectedWires);
        if (wires.has(key)) wires.delete(key);
        else wires.add(key);
        setSelection(selectedIds, wires);
        busStatus(`${selectedIds.size} component${selectedIds.size === 1 ? "" : "s"} and ${selectedWires.size} wire net${selectedWires.size === 1 ? "" : "s"} selected.`);
      } else {
        if (!selectedWires.has(key)) selectWire(key);
        beginSelectionDrag(e);
      }
    } else {
      const world = worldFromEvent(e);
      marquee = { startX: world.x, startY: world.y, endX: world.x, endY: world.y,
        additive: e.shiftKey, initial: new Set(selectedIds), initialWires: new Set(selectedWires), moved: false };
      canvasWrapEl.setPointerCapture(e.pointerId);
    }
    return;
  }

  if (wireEl) {
    selectWire(wireEl.dataset.key);
    return;
  }

  if (compEl) {
    const comp = state.components.find((c) => c.id === compEl.dataset.id);
    if (!comp) return;
    const faceButton = e.target.closest?.("[data-face-button]");
    if (comp.t === "module" && faceButton && !placingType && !e.shiftKey && !pressedButton) {
      const id = `${comp.id}/${faceButton.dataset.faceButton}`;
      pressedButton = { id, pointerId: e.pointerId };
      canvasWrapEl.setPointerCapture(e.pointerId);
      if (!editor.setButtonPressed(id, true)) busStatus("Button cannot press: conflicting outputs share a net.", true);
      return;
    }
    const tile = e.target.closest?.(".bit-tile[data-bit]");
    if (comp.t === "input" && tile && !placingType && !e.shiftKey) {
      if (!editor.toggleInputBit(comp.id, Number(tile.dataset.bit)))
        busStatus("Input bit cannot toggle: conflicting outputs share a net.", true);
      return;
    }
    if (comp.t === "switch" && !placingType && !e.shiftKey) {
      if (!editor.toggleSwitch(comp.id)) busStatus("Switch cannot toggle: conflicting outputs share a net.", true);
      return;
    }
    if (comp.t === "clock" && !placingType && !e.shiftKey) {
      const enabled = comp.enable === false;
      if (editor.setClockEnabled(comp.id, enabled)) busStatus(`Clock ${enabled ? "enabled" : "disabled"}.`);
      return;
    }
    if (comp.t === "button" && !placingType && !e.shiftKey && !pressedButton) {
      pressedButton = { id: comp.id, pointerId: e.pointerId };
      canvasWrapEl.setPointerCapture(e.pointerId);
      editor.setButtonPressed(comp.id, true);
      return;
    }
    setSelection([comp.id]);
    busStatus("Component selected.");

    const world = worldFromEvent(e);
    drag = {
      pointerId: e.pointerId,
      id: comp.id,
      originX: comp.x,
      originY: comp.y,
      x: comp.x,
      y: comp.y,
      grabbedX: world.x - comp.x * CELL,
      grabbedY: world.y - comp.y * CELL,
      valid: true,
    };
    canvasWrapEl.setPointerCapture(e.pointerId);
    return;
  }

  if (placingType) {
    const comp = editor.place(placingType, cell.x, cell.y);
    if (comp) {
      setSelection([comp.id]);
      busStatus("Component selected.");
    } else {
      busStatus("Cannot place component here. Check overlaps, bus sizes, and short circuits.", true);
      flashInvalid(cell);
    }
    return;
  }

  // Pan mode: drag empty canvas to pan; a plain click clears the selection.
  pan = {
    startX: e.clientX,
    startY: e.clientY,
    originX: view.x,
    originY: view.y,
    moved: false,
  };
  canvasWrapEl.classList.add("panning");
  canvasWrapEl.setPointerCapture(e.pointerId);
});

canvasWrapEl.addEventListener("contextmenu", (e) => {
  if (mode === MODE.WIRE && wireStart) {
    e.preventDefault();
    clearWireGesture();
    busStatus("Wire finished.");
    return;
  }
  const wireEl = e.target.closest(".wire");
  let key = wireEl ? wireEl.dataset.key : null;
  if (!key && mode === MODE.WIRE) {
    const edge = edgeFromEvent(e);
    key = edgeKey(edge);
  }
  if (key && state.wires.has(key)) {
    e.preventDefault();
    editor.removeWire(key);
    setSelection(selectedIds);
  }
});

function renderDragPreview() {
  if (!drag) return;
  const evaluatePreview = (trial) => evaluateBoard(trial, editor.pressedButtons,
    editor.highClocks, editor.registerValues, editor.ramValues);
  if (drag.kind === "selection") {
    const { dx, dy } = drag;
    const trial = editor.translatedSelection(drag.ids, drag.wires, dx, dy);
    drag.valid = !!trial || (!dx && !dy);
    state = trial ?? editor.board;
    selectedWires = new Set(trial ? drag.wires.map((key) => {
      const edge = editor.board.wires.get(key);
      return edge ? edgeKey({ ...edge, x: edge.x + dx, y: edge.y + dy }) : key;
    }) : drag.wires);
    const logic = trial ? evaluatePreview(trial) : editor.evaluation;
    renderComponents(logic);
    renderPins();
    renderWires(logic);
    return;
  }
  const nx = drag.x, ny = drag.y;
  const trial = editor.previewMove(drag.id, nx, ny);
  drag.valid = !!trial;
  state = trial ?? { ...editor.board, components: editor.board.components.map((item) =>
    item.id === drag.id ? { ...item, x: nx, y: ny } : item) };
  const logic = trial && trial !== editor.board ? evaluatePreview(trial) : editor.evaluation;
  renderComponents(logic);
  renderPins();
  renderWires(logic);
  if (!trial) gridEl.querySelector(`.comp[data-id="${drag.id}"]`)?.classList.add("invalid");
}

function updateDragPreview(clientX, clientY) {
  if (!drag) return;
  const world = worldFromEvent({ clientX, clientY });
  if (drag.kind === "selection") {
    const dx = Math.round((world.x - drag.startX) / CELL);
    const dy = Math.round((world.y - drag.startY) / CELL);
    if (dx === drag.dx && dy === drag.dy) return;
    drag.dx = dx;
    drag.dy = dy;
  } else {
    const nx = Math.round((world.x - drag.grabbedX) / CELL);
    const ny = Math.round((world.y - drag.grabbedY) / CELL);
    if (nx === drag.x && ny === drag.y) return;
    drag.x = nx;
    drag.y = ny;
  }
  renderDragPreview();
}

canvasWrapEl.addEventListener("pointermove", (e) => {
  if (marquee) {
    const world = worldFromEvent(e);
    marquee.endX = world.x;
    marquee.endY = world.y;
    marquee.moved ||= Math.abs(world.x - marquee.startX) > 3 || Math.abs(world.y - marquee.startY) > 3;
    drawMarquee();
    return;
  }
  if (pan) {
    if (Math.abs(e.clientX - pan.startX) > 3 || Math.abs(e.clientY - pan.startY) > 3) {
      pan.moved = true;
    }
    view.x = pan.originX + (e.clientX - pan.startX);
    view.y = pan.originY + (e.clientY - pan.startY);
    applyView();
    return;
  }

  if (mode === MODE.WIRE && !drag) {
    scheduleWirePreview(pointFromEvent(e));
    return;
  }

  if (!drag || e.pointerId !== drag.pointerId) return;
  pendingDragPoint = { x: e.clientX, y: e.clientY };
  if (dragPreviewFrame !== null) return;
  dragPreviewFrame = requestAnimationFrame(() => {
    dragPreviewFrame = null;
    const point = pendingDragPoint;
    pendingDragPoint = null;
    if (point) updateDragPreview(point.x, point.y);
  });
});

function endDrag(e) {
  if (drag && e.pointerId !== drag.pointerId) return;
  if (dragPreviewFrame !== null) cancelAnimationFrame(dragPreviewFrame);
  dragPreviewFrame = null;
  pendingDragPoint = null;
  if (drag && e.type !== "pointercancel") updateDragPreview(e.clientX, e.clientY);
  if (pressedButton?.pointerId === e.pointerId) {
    releasePressedButton();
    if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) canvasWrapEl.releasePointerCapture(e.pointerId);
    return;
  }
  if (marquee) {
    const { startX, startY, endX, endY, moved, additive, initial, initialWires } = marquee;
    marquee = null;
    gridEl.querySelector(".selection-box")?.remove();
    if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) canvasWrapEl.releasePointerCapture(e.pointerId);
    if (e.type === "pointercancel") return;
    const ids = new Set(additive ? initial : []);
    const wires = new Set(additive ? initialWires : []);
    if (moved) {
      const left = Math.min(startX, endX), right = Math.max(startX, endX);
      const top = Math.min(startY, endY), bottom = Math.max(startY, endY);
      for (const component of state.components) {
        const { w, h } = dimsOf(component);
        if (component.x * CELL < right && (component.x + w) * CELL > left &&
            component.y * CELL < bottom && (component.y + h) * CELL > top) ids.add(component.id);
      }
      for (const net of editor.evaluation.nets.values()) {
        if (net.edges.some((edge) => {
          const box = edgeBox(edge);
          const x = parseFloat(box.left), y = parseFloat(box.top);
          return x < right && x + parseFloat(box.width) > left &&
            y < bottom && y + parseFloat(box.height) > top;
        })) wires.add(edgeKey(net.edges[0]));
      }
    }
    setSelection(ids, wires);
    busStatus(`${ids.size} component${ids.size === 1 ? "" : "s"} and ${wires.size} wire net${wires.size === 1 ? "" : "s"} selected.`);
    return;
  }
  if (pan) {
    const wasClick = !pan.moved;
    pan = null;
    canvasWrapEl.classList.remove("panning");
    if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) {
      canvasWrapEl.releasePointerCapture(e.pointerId);
    }
    if (wasClick) {
      setSelection([]);
    }
    return;
  }
  if (!drag) return;
  if (drag.kind === "selection") {
    const { ids, wires, dx, dy, valid } = drag;
    const movedWireKeys = wires.map((key) => {
      const edge = editor.board.wires.get(key);
      return edge ? edgeKey({ ...edge, x: edge.x + dx, y: edge.y + dy }) : key;
    });
    drag = null;
    state = editor.board;
    selectedWires = new Set(wires);
    if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) canvasWrapEl.releasePointerCapture(e.pointerId);
    if (e.type === "pointercancel" || (!dx && !dy)) { render(); return; }
    if (!valid || !editor.moveSelection(ids, wires, dx, dy)) {
      busStatus("Cannot move selection here. Check overlaps, bus sizes, and short circuits.", true);
      render();
      return;
    }
    selectedWires = new Set(movedWireKeys);
    selectedWire = selectedWires.size === 1 && !selectedIds.size ? movedWireKeys[0] : null;
    render();
    return;
  }
  const { id, originX, originY, x, y, valid } = drag;
  drag = null;
  state = editor.board;
  if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) {
    canvasWrapEl.releasePointerCapture(e.pointerId);
  }
  if (e.type !== "pointercancel" && (x !== originX || y !== originY)) {
    if (!valid || !editor.move(id, x, y)) {
      busStatus("Cannot move component here. Check overlaps, bus sizes, and short circuits.", true);
      render();
    }
  } else render();
}

function drawMarquee() {
  let box = gridEl.querySelector(".selection-box");
  if (!box) {
    box = document.createElement("div");
    box.className = "selection-box";
    gridEl.appendChild(box);
  }
  box.style.left = Math.min(marquee.startX, marquee.endX) + "px";
  box.style.top = Math.min(marquee.startY, marquee.endY) + "px";
  box.style.width = Math.abs(marquee.endX - marquee.startX) + "px";
  box.style.height = Math.abs(marquee.endY - marquee.startY) + "px";
}

canvasWrapEl.addEventListener("pointerup", endDrag);
canvasWrapEl.addEventListener("pointercancel", endDrag);
canvasWrapEl.addEventListener("lostpointercapture", (e) => {
  if (pressedButton?.pointerId === e.pointerId) releasePressedButton();
});
window.addEventListener("blur", releasePressedButton);

function releasePressedButton() {
  if (!pressedButton) return;
  const { id } = pressedButton;
  pressedButton = null;
  editor.setButtonPressed(id, false);
}

canvasWrapEl.addEventListener("pointerleave", () => {
  if (wirePreviewFrame !== null) cancelAnimationFrame(wirePreviewFrame);
  wirePreviewFrame = null;
  pendingWirePreviewPoint = null;
  lastWirePreviewKey = null;
  gridEl.querySelectorAll(".wire-preview").forEach((el) => el.remove());
});

function clearWireGesture() {
  wireStart = null;
  if (wirePreviewFrame !== null) cancelAnimationFrame(wirePreviewFrame);
  wirePreviewFrame = null;
  pendingWirePreviewPoint = null;
  lastWirePreviewKey = null;
  gridEl.querySelectorAll(".wire-preview, .wire-anchor").forEach((el) => el.remove());
}

function scheduleWirePreview(point) {
  pendingWirePreviewPoint = point;
  if (wirePreviewFrame !== null) return;
  wirePreviewFrame = requestAnimationFrame(() => {
    wirePreviewFrame = null;
    const next = pendingWirePreviewPoint;
    pendingWirePreviewPoint = null;
    if (next) updateWirePreview(next);
  });
}

function updateWirePreview(point) {
  if (mode !== MODE.WIRE) return;
  const key = `${wireStart?.x},${wireStart?.y}:${point.x},${point.y}:${newWireSize}`;
  if (key === lastWirePreviewKey) return;
  lastWirePreviewKey = key;
  gridEl.querySelectorAll(".wire-preview, .wire-anchor").forEach((el) => el.remove());
  const anchor = wireStart ?? point;
  const marker = document.createElement("div");
  marker.className = "wire-anchor";
  marker.style.left = anchor.x * CELL + "px";
  marker.style.top = anchor.y * CELL + "px";
  gridEl.appendChild(marker);
  if (!wireStart) return;
  const route = wireRoute(state, wireStart, point, newWireSize);
  for (const edge of route.edges) {
    const el = document.createElement("div");
    el.className = `wire-preview ${route.error ? "invalid" : "valid"}`;
    applyBox(el, edgeBox(edge));
    el.title = route.error ?? `${newWireSize} bit wire`;
    gridEl.appendChild(el);
  }
}

canvasWrapEl.addEventListener("dblclick", (e) => {
  const id = e.target.closest?.(".comp")?.dataset.id;
  if (id && editor.component(id)?.t === "module") {
    e.preventDefault();
    openModule(id);
    return;
  }
  if (mode !== MODE.WIRE || !wireStart) return;
  e.preventDefault();
  clearWireGesture();
  busStatus("Wire finished.");
});

function flashInvalid(cell) {
  const el = document.createElement("div");
  el.className = "comp invalid";
  el.style.left = cell.x * CELL + "px";
  el.style.top = cell.y * CELL + "px";
  el.style.width = CELL - GAP + "px";
  el.style.height = CELL - GAP + "px";
  el.style.background = "transparent";
  el.style.pointerEvents = "none";
  gridEl.appendChild(el);
  setTimeout(() => el.remove(), 250);
}

canvasWrapEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const p = viewportFromEvent(e);
    zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, p.x, p.y);
  } else {
    // Two-finger / wheel scroll pans the infinite canvas.
    view.x -= e.deltaX;
    view.y -= e.deltaY;
    applyView();
  }
}, { passive: false });

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
    if (selectedIds.size || selectedWires.size) { copySelected(); e.preventDefault(); }
  } else if (mod && e.key.toLowerCase() === "v") {
    if (copiedSelection.components.length || copiedSelection.wires.length) { pasteCopied(); e.preventDefault(); }
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
    if (wireStart) {
      clearWireGesture();
      busStatus("Wire finished.");
      return;
    }
    mode = MODE.PAN;
    placingType = null;
    setSelection([]);
    renderPalette();
    syncPlacingCursor();
    render();
  }
});

/* ---------- Actions ---------- */

function undoEdit() {
  if (!editor.canUndo) return;
  clearWireGesture();
  setSelection([]);
  editor.undo();
  busStatus("Undone.");
}

function redoEdit() {
  if (!editor.canRedo) return;
  clearWireGesture();
  setSelection([]);
  editor.redo();
  busStatus("Redone.");
}

function rotateSelected() {
  editor.rotate(selectedId);
}

function deleteSelected() {
  const ids = [...selectedIds];
  const wires = [...selectedWires];
  setSelection([]);
  editor.deleteSelection(ids, wires);
}

function copySelected() {
  copiedSelection = editor.copySelection(selectedIds, selectedWires);
  syncActionButtons();
  busStatus(`${copiedSelection.components.length} component${copiedSelection.components.length === 1 ? "" : "s"} and ${copiedSelection.wireKeys.length} wire net${copiedSelection.wireKeys.length === 1 ? "" : "s"} copied.`);
}

function pasteCopied() {
  const rect = canvasWrapEl.getBoundingClientRect();
  const center = worldFromViewport({ x: rect.width / 2, y: rect.height / 2 });
  const added = editor.pasteSelection(copiedSelection, { x: center.x / CELL, y: center.y / CELL });
  if (!added) {
    busStatus("Cannot paste selection nearby. Check overlaps, bus sizes, and short circuits.", true);
    return;
  }
  mode = MODE.SELECT;
  placingType = null;
  renderPalette();
  syncPlacingCursor();
  setSelection(added.components.map((component) => component.id), added.wireKeys);
  busStatus(`${added.components.length} component${added.components.length === 1 ? "" : "s"} and ${added.wireKeys.length} wire net${added.wireKeys.length === 1 ? "" : "s"} pasted.`);
}

btnCopy.addEventListener("click", copySelected);
btnPaste.addEventListener("click", pasteCopied);
btnDelete.addEventListener("click", deleteSelected);
btnUndo.addEventListener("click", undoEdit);
btnRedo.addEventListener("click", redoEdit);

btnSelect.addEventListener("click", () => {
  clearWireGesture();
  mode = MODE.SELECT;
  placingType = null;
  setSelection(selectedIds);
  renderPalette();
  syncPlacingCursor();
});

btnWire.addEventListener("click", () => {
  clearWireGesture();
  mode = MODE.WIRE;
  placingType = null;
  setSelection([]);
  renderPalette();
  syncPlacingCursor();
});

btnPan.addEventListener("click", () => {
  clearWireGesture();
  mode = MODE.PAN;
  placingType = null;
  renderPalette();
  syncPlacingCursor();
  renderProperties();
});

/* ---------- Persistence ---------- */

function loadBoard(board) {
  romTargetId = null;
  layoutTargetId = null;
  romDrafts.clear();
  romPageStart = 0;
  romRenderedKey = null;
  romJumpEl.value = "";
  romJumpEl.dataset.valid = "";
  romStatus("");
  monitor.reset();
  program.reset();
  setSelection([]);
  placingType = null;
  clearWireGesture();
  mode = MODE.PAN;
  editor.replaceBoard(board);
  renderPalette();
  syncPlacingCursor();
  resetView();
}

function parseImport(text) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL("./import-worker.js", import.meta.url), { type: "module" }); }
    catch (error) { reject(error); return; }
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.board);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The document could not be validated."));
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error("The validated document could not be opened."));
    };
    try { worker.postMessage(text); }
    catch (error) { worker.terminate(); reject(error); }
  });
}

document.getElementById("btn-download").addEventListener("click", () => {
  const blob = new Blob([serialize(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "grid-canvas.json";
  a.click();
  URL.revokeObjectURL(url);
});

const fileInputEl = document.getElementById("file-input");
const importScreenEl = document.getElementById("import-screen");
const importTitleEl = document.getElementById("import-title");
const importDetailEl = document.getElementById("import-detail");
const importNameEl = document.getElementById("import-name");
const importErrorEl = document.getElementById("import-error");
const headerEl = document.querySelector(".view-header");
const mainEl = document.querySelector("main");
let importing = false;

function showLoading(title, detail, name = "", focus = false) {
  importTitleEl.textContent = title;
  importDetailEl.textContent = detail;
  importNameEl.textContent = name;
  importScreenEl.hidden = false;
  headerEl.inert = true;
  mainEl.inert = true;
  if (focus) importScreenEl.focus();
}

function hideLoading() {
  importScreenEl.hidden = true;
  headerEl.inert = false;
  mainEl.inert = false;
}

function loadingPainted() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

fileInputEl.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";
  if (importing) return;
  importing = true;
  fileInputEl.disabled = true;
  importErrorEl.hidden = true;
  importErrorEl.textContent = "";
  showLoading("Importing file", "Reading file…", file.name, true);
  try {
    const text = await file.text();
    importDetailEl.textContent = "Validating document…";
    const board = await parseImport(text);
    importDetailEl.textContent = "Opening circuit…";
    // Let the updated progress message paint before evaluation and rendering.
    await loadingPainted();
    loadBoard(board);
  } catch (error) {
    importErrorEl.textContent = `Could not import ${file.name}: ${error.message}`;
    importErrorEl.hidden = false;
  } finally {
    hideLoading();
    fileInputEl.disabled = false;
    importing = false;
    fileInputEl.focus();
  }
});

/* ---------- Seeds ---------- */

function seedLayout(board) {
  addComponent(board, { id: "c1", t: "input", x: 2, y: 0, r: 2, size: 1, value: 0, label: "A" });
  addComponent(board, { id: "c2", t: "output", x: 5, y: 0, r: 0, size: 1, label: "Result" });
  addWireEdge(board, { o: "H", x: 4, y: 1 });
}


function getStorage() {
  try { return globalThis.localStorage; }
  catch (error) { console.warn("Browser storage is unavailable:", error); return null; }
}

const clockTimers = new Map();
let timerBoard = null;

function syncClockTimers() {
  if (timerBoard !== state) {
    for (const { interval } of clockTimers.values()) clearInterval(interval);
    clockTimers.clear();
    timerBoard = state;
  }
  const clocks = new Map([...clocksInBoard(state)]
    .filter(([, component]) => component.enable !== false)
    .map(([id, component]) => [id, component.frequency ?? DEFAULT_CLOCK_FREQUENCY]));
  for (const [id, timer] of clockTimers) {
    if (clocks.get(id) === timer.frequency) continue;
    clearInterval(timer.interval);
    clockTimers.delete(id);
  }
  for (const [id, frequency] of clocks) {
    if (clockTimers.has(id)) continue;
    const interval = setInterval(() => editor.tickClock(id), 500 / frequency);
    clockTimers.set(id, { frequency, interval });
  }
}

function boardChanged(board) {
  state = board;
  syncClockTimers();
  if (drag) {
    // A clock or input update can arrive between pointer moves. Rebuild the
    // preview at its current offset so the normal render cannot snap it back.
    renderDragPreview();
    renderProperties();
    viewRenderers[tabs.active]?.();
  } else render();
}

let editor = new BoardEditor({
  storage: getStorage(),
  onChange: boardChanged,
  onStorageError: (error) => {
    console.warn("Could not save board:", error);
    queueMicrotask(() => busStatus("Board changed, but browser storage is unavailable. Download a copy to keep it.", true));
  },
});
state = editor.board;

/* ---------- Boot ---------- */

renderPalette();
syncPlacingCursor();
showLoading("Loading circuit", "Opening circuit…");
try {
  await loadingPainted();
  let restored = null;
  try { restored = editor.loadSaved(); }
  catch (error) { console.warn("Saved document is invalid:", error); }
  if (restored) {
    editor.replaceBoard(restored.board, { save: false });
  } else {
    importDetailEl.textContent = "Loading default example…";
    importNameEl.textContent = "8-bit computer";
    let board;
    try {
      const response = await fetch(new URL("./examples/8-bit-computer.json", import.meta.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      board = parseDocument(await response.text()).board;
    } catch (error) {
      console.warn("Could not load the default example:", error);
      board = createBoard();
      seedLayout(board);
    }
    importDetailEl.textContent = "Opening circuit…";
    await loadingPainted();
    editor.replaceBoard(board, { save: false });
  }
  resetView();
} finally {
  hideLoading();
}
