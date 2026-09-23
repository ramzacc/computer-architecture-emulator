import { COMPONENT_TYPES, bitWidth, dimsOf, isSizable, pinsFor, spec, validBitWidth } from "./components.js";
import { addComponent, addWireEdge, createBoard, edgeKey, edgePlacementError, evaluateBoard, isValidComponent, netContaining, parseDocument, serialize } from "./model.js";
import { BoardEditor } from "./editor.js";
import { createRenderer } from "./renderer.js";

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
const MODE = Object.freeze({ PAN: "pan", WIRE: "wire" });

let mode = MODE.PAN;
let state = createBoard();
let selectedId = null;
let selectedWire = null;
let placingType = null;
let drag = null;
let pan = null;
let newWireSize = 1;

const gridEl = document.getElementById("grid");
const paletteEl = document.getElementById("palette");
const btnWire = document.getElementById("btn-wire");
const btnPan = document.getElementById("btn-pan");
const canvasWrapEl = document.getElementById("canvas-wrap");
const zoomLabelEl = document.getElementById("zoom-level");
const newWireSizeEl = document.getElementById("new-wire-size");
const selectedPropertiesHeadingEl = document.getElementById("selected-properties-heading");
const selectedSizeRowEl = document.getElementById("selected-size-row");
const selectedSizeEl = document.getElementById("selected-size");
const splitterOrderRowEl = document.getElementById("splitter-order-row");
const splitterOrderEl = document.getElementById("splitter-order");
const selectedValueRowEl = document.getElementById("selected-value-row");
const selectedValueEl = document.getElementById("selected-value");
const constantValueRowEl = document.getElementById("constant-value-row");
const constantValueEl = document.getElementById("constant-value");
const busStatusEl = document.getElementById("bus-status");
const { componentArt, renderComponents, renderPins, renderWires, edgeBox, applyBox } =
  createRenderer(gridEl, () => state, () => selectedId, () => selectedWire);

function busStatus(message, error = false) {
  busStatusEl.textContent = message;
  busStatusEl.classList.toggle("error", error);
}

function renderProperties() {
  const component = state.components.find((c) => c.id === selectedId);
  const net = selectedWire ? netContaining(state, selectedWire) : null;
  selectedPropertiesHeadingEl.textContent = component ? "Component properties" : net ? "Wire properties" : "Selected properties";
  const size = component && isSizable(component) ? bitWidth(component) : net?.size;
  selectedSizeRowEl.hidden = size === undefined;
  selectedSizeEl.disabled = size === undefined;
  selectedSizeEl.value = size === undefined ? "" : String(size);
  selectedSizeEl.max = component?.t === "constant" ? "8" : "32";
  const splitter = component?.t === "splitter";
  splitterOrderRowEl.hidden = !splitter;
  splitterOrderEl.disabled = !splitter;
  splitterOrderEl.value = splitter ? component.order ?? "ascendant" : "ascendant";
  const constant = component?.t === "constant";
  constantValueRowEl.hidden = !constant;
  constantValueEl.disabled = !constant;
  constantValueEl.max = constant ? String(2 ** bitWidth(component) - 1) : "1";
  constantValueEl.value = constant ? String(component.value ?? 0) : "";
  selectedValueRowEl.hidden = !net;
  selectedValueEl.textContent = !net ? "—" : net.size === 1
    ? `${net.value} (${net.on ? "HIGH" : "LOW"})`
    : `${net.value} (0b${net.value.toString(2).padStart(net.size, "0")})`;
  if (size !== undefined && !busStatusEl.classList.contains("error")) {
    busStatus(component ? `${spec(component.t).label}: ${size} bit${size === 1 ? "" : "s"}.` :
      `Selected bus: ${size} bit${size === 1 ? "" : "s"}.`);
  }
}

newWireSizeEl.addEventListener("change", () => {
  const size = Number(newWireSizeEl.value);
  if (!validBitWidth(size)) {
    newWireSizeEl.value = String(newWireSize);
    busStatus("Wire size must be a whole number from 1 to 32.", true);
    return;
  }
  newWireSize = size;
  busStatus(`New wires will carry ${size} bit${size === 1 ? "" : "s"}.`);
});

selectedSizeEl.addEventListener("change", () => {
  const size = Number(selectedSizeEl.value);
  const component = editor.component(selectedId);
  const current = component ? bitWidth(component) : selectedWire ? netContaining(state, selectedWire)?.size : undefined;
  if (size === current) return;
  const changed = component ? editor.resizeComponent(selectedId, size) : editor.resizeWire(selectedWire, size);
  if (!changed) busStatus(component?.t === "constant"
    ? "Constant width must be 1–8 bits and match connected wires."
    : "Bus size mismatch or invalid size (use 1–32 bits).", true);
  else busStatus(`Size set to ${size} bits.`);
  renderProperties();
});

splitterOrderEl.addEventListener("change", () => {
  if (editor.setSplitterOrder(selectedId, splitterOrderEl.value))
    busStatus(`Splitter order set to ${splitterOrderEl.value}.`);
  else renderProperties();
});

constantValueEl.addEventListener("change", () => {
  const component = editor.component(selectedId);
  const value = Number(constantValueEl.value);
  if (editor.setConstantValue(selectedId, value)) {
    busStatus(`Constant set to ${value}.`);
  } else {
    if (component && value !== component.value)
      busStatus(`Constant value must be a whole number from 0 to ${2 ** bitWidth(component) - 1}.`, true);
    renderProperties();
  }
});

function selectWire(key) {
  selectedWire = key;
  selectedId = null;
  busStatus("Wire net selected.");
  renderProperties();
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
  paletteEl.innerHTML = "";
  for (const [type, s] of Object.entries(COMPONENT_TYPES)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.type = type;
    btn.classList.toggle("active", placingType === type);
    btn.innerHTML = `<span class="palette-icon" aria-hidden="true">${componentArt({ t: type, r: 0, size: s.splitter ? 4 : 1, value: 0 }, s)}</span>
      <span class="name">${s.label}</span>`;
    btn.addEventListener("click", () => {
      placingType = placingType === type ? null : type;
      // Arming a component is a normal-canvas activity, so leave wire mode.
      if (placingType) mode = MODE.PAN;
      renderPalette();
      syncPlacingCursor();
    });
    paletteEl.appendChild(btn);
  }
}

function syncPlacingCursor() {
  canvasWrapEl.classList.toggle("placing", placingType !== null);
  canvasWrapEl.classList.toggle("pan", mode === MODE.PAN && placingType === null);
  canvasWrapEl.classList.toggle("wire-mode", mode === MODE.WIRE);
  btnWire.classList.toggle("active", mode === MODE.WIRE);
  btnPan.classList.toggle("active", mode === MODE.PAN);
  if (mode !== MODE.WIRE) {
    const pv = gridEl.querySelector(".wire-preview");
    if (pv) pv.remove();
  }
}

function render() {
  applyView();
  const logic = evaluateBoard(state);
  renderWires(logic);
  renderComponents(logic);
  renderPins();
  renderProperties();
}

/* ---------- Interaction ---------- */

canvasWrapEl.addEventListener("pointerdown", (e) => {
  if (e.button === 2) return;

  const wireEl = e.target.closest(".wire");
  const compEl = e.target.closest(".comp");
  const cell = cellFromEvent(e);

  if (mode === MODE.WIRE) {
    if (wireEl) {
      selectWire(wireEl.dataset.key);
      renderWires();
      return;
    }
    const edge = { ...edgeFromEvent(e), size: newWireSize };
    const key = edgeKey(edge);
    if (state.wires.has(key)) {
      // Energization is derived, not toggled; just select it.
      selectWire(key);
      render();
    } else if (!editor.addWire(edge)) {
      busStatus(edgePlacementError(state, edge) ?? "Cannot place wire.", true);
      flashInvalidEdge(edge);
    }
    return;
  }

  if (wireEl) {
    selectWire(wireEl.dataset.key);
    renderWires();
    return;
  }

  if (compEl) {
    const comp = state.components.find((c) => c.id === compEl.dataset.id);
    if (!comp) return;
    selectedId = comp.id;
    selectedWire = null;
    busStatus("Component selected.");
    renderProperties();
    renderComponents();
    renderWires();

    const world = worldFromEvent(e);
    drag = {
      id: comp.id,
      originX: comp.x,
      originY: comp.y,
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
      selectedId = comp.id;
      selectedWire = null;
      busStatus("Component selected.");
      render();
    } else {
      busStatus("Cannot place component here. Check overlaps and bus sizes.", true);
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
  const wireEl = e.target.closest(".wire");
  let key = wireEl ? wireEl.dataset.key : null;
  if (!key && mode === MODE.WIRE) {
    const edge = edgeFromEvent(e);
    key = edgeKey(edge);
  }
  if (key && state.wires.has(key)) {
    e.preventDefault();
    if (selectedWire === key) selectedWire = null;
    editor.removeWire(key);
  }
});

canvasWrapEl.addEventListener("pointermove", (e) => {
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
    updateWirePreview(edgeFromEvent(e));
    return;
  }

  if (!drag) return;
  const comp = state.components.find((c) => c.id === drag.id);
  if (!comp) return;

  const world = worldFromEvent(e);
  const rawX = (world.x - drag.grabbedX) / CELL;
  const rawY = (world.y - drag.grabbedY) / CELL;
  const nx = Math.round(rawX);
  const ny = Math.round(rawY);
  if (nx === comp.x && ny === comp.y) return;

  comp.x = nx;
  comp.y = ny;

  const el = gridEl.querySelector(`.comp[data-id="${comp.id}"]`);
  drag.valid = isValidComponent(state, comp);
  if (el) {
    el.style.left = comp.x * CELL + "px";
    el.style.top = comp.y * CELL + "px";
    el.classList.toggle("invalid", !drag.valid);
  }
  // Pins and wires are derived from component positions, so move them live.
  renderPins();
  renderWires();
});

function endDrag(e) {
  if (pan) {
    const wasClick = !pan.moved;
    pan = null;
    canvasWrapEl.classList.remove("panning");
    if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) {
      canvasWrapEl.releasePointerCapture(e.pointerId);
    }
    if (wasClick) {
      selectedId = null;
      selectedWire = null;
      renderComponents();
      renderWires();
      renderProperties();
    }
    return;
  }
  if (!drag) return;
  const comp = editor.component(drag.id);
  const { id, originX, originY, valid } = drag;
  const target = comp ? { x: comp.x, y: comp.y } : null;
  if (comp) { comp.x = originX; comp.y = originY; }
  drag = null;
  if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) {
    canvasWrapEl.releasePointerCapture(e.pointerId);
  }
  if (e.type !== "pointercancel" && target && (target.x !== originX || target.y !== originY)) {
    if (!valid || !editor.move(id, target.x, target.y)) {
      busStatus("Cannot move component here. Check overlaps and bus sizes.", true);
      render();
    }
  } else render();
}

canvasWrapEl.addEventListener("pointerup", endDrag);
canvasWrapEl.addEventListener("pointercancel", endDrag);

canvasWrapEl.addEventListener("pointerleave", () => {
  const el = gridEl.querySelector(".wire-preview");
  if (el) el.remove();
});

function updateWirePreview(edge) {
  let el = gridEl.querySelector(".wire-preview");
  if (!el) {
    el = document.createElement("div");
    el.className = "wire-preview";
    gridEl.appendChild(el);
  }
  const key = edgeKey(edge);
  const existing = state.wires.has(key);
  const candidate = { ...edge, size: newWireSize };
  const error = existing ? null : edgePlacementError(state, candidate);
  const ok = existing || !error;
  applyBox(el, edgeBox(candidate));
  el.classList.toggle("valid", ok);
  el.classList.toggle("invalid", !ok);
  el.classList.toggle("remove", existing);
  el.title = existing ? "Right-click to remove" : (error ?? `${newWireSize} bit wire`);
}

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

function flashInvalidEdge(edge) {
  const el = document.createElement("div");
  el.className = "wire invalid";
  applyBox(el, edgeBox(edge));
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  const mod = e.ctrlKey || e.metaKey;
  const zoomIn = e.key === "+" || e.key === "=" || e.code === "NumpadAdd";
  const zoomOut = e.key === "-" || e.key === "_" || e.code === "NumpadSubtract";

  if (zoomIn) {
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
    mode = MODE.PAN;
    placingType = null;
    selectedId = null;
    selectedWire = null;
    renderPalette();
    syncPlacingCursor();
    render();
  }
});

/* ---------- Actions ---------- */

function rotateSelected() {
  editor.rotate(selectedId);
}

function deleteSelected() {
  if (selectedWire) {
    const key = selectedWire;
    selectedWire = null;
    editor.deleteNet(key);
  } else if (selectedId) {
    const id = selectedId;
    selectedId = null;
    editor.deleteComponent(id);
  }
}

btnWire.addEventListener("click", () => {
  mode = MODE.WIRE;
  placingType = null;
  selectedWire = null;
  renderPalette();
  syncPlacingCursor();
  renderWires();
  renderProperties();
});

btnPan.addEventListener("click", () => {
  mode = MODE.PAN;
  placingType = null;
  renderPalette();
  syncPlacingCursor();
});

/* ---------- Persistence ---------- */

function loadFromText(text) {
  try {
    // Parse before changing any selection or visible state.
    const { board, skipped } = parseDocument(text);
    selectedId = null;
    selectedWire = null;
    placingType = null;
    mode = MODE.PAN;
    editor.replaceBoard(board);
    if (skipped.components) console.warn(`Skipped ${skipped.components} invalid component(s).`);
    if (skipped.wires) console.warn(`Skipped ${skipped.wires} invalid wire segment(s).`);
    renderPalette();
    syncPlacingCursor();
    resetView();
    return true;
  } catch (error) {
    alert(`Invalid document: ${error.message}`);
    return false;
  }
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

document.getElementById("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadFromText(String(reader.result));
  reader.readAsText(file);
  e.target.value = "";
});

/* ---------- Seeds ---------- */

function seedLayout() {
  const layout = [
    // power straight into an LED
    ["power", 2, 0], ["led", 2, 3],
    // two powers into an AND, output into an LED
    ["power", 7, 0], ["power", 9, 0], ["and", 7, 3], ["led", 8, 6],
    // two powers into a NAND -> lights nothing
    ["power", 14, 0], ["power", 16, 0], ["nand", 14, 3], ["led", 15, 6],
    // two powers into an XOR -> also off
    ["power", 22, 0], ["power", 24, 0], ["xor", 22, 3], ["led", 23, 6],
  ];
  state.components = [];
  for (const [t, x, y] of layout) addComponent(state, { id: `c${state.components.length + 1}`, t, x, y, r: 0 });
}

function seedWires() {
  state.wires = new Map();
  const wires = [
    { o: "V", x: 3, y: 2 },
    { o: "V", x: 8, y: 2 }, { o: "V", x: 10, y: 2 }, { o: "V", x: 9, y: 5 },
    { o: "V", x: 15, y: 2 }, { o: "V", x: 17, y: 2 }, { o: "V", x: 16, y: 5 },
    { o: "V", x: 23, y: 2 }, { o: "V", x: 25, y: 2 }, { o: "V", x: 24, y: 5 },
  ];
  for (const wire of wires) addWireEdge(state, wire);
}

function getStorage() {
  try { return globalThis.localStorage; }
  catch (error) { console.warn("Browser storage is unavailable:", error); return null; }
}

const editor = new BoardEditor({
  storage: getStorage(),
  onChange: (board) => { state = board; render(); },
  onStorageError: (error) => {
    console.warn("Could not save board:", error);
    queueMicrotask(() => busStatus("Board changed, but browser storage is unavailable. Download a copy to keep it.", true));
  },
});
state = editor.board;

/* ---------- Boot ---------- */

renderPalette();
syncPlacingCursor();
let restored = null;
try { restored = editor.loadSaved(); }
catch (error) { console.warn("Saved document is invalid:", error); }
if (restored) {
  editor.replaceBoard(restored.board, { save: false });
  if (restored.skipped.components) console.warn(`Skipped ${restored.skipped.components} invalid component(s).`);
  if (restored.skipped.wires) console.warn(`Skipped ${restored.skipped.wires} invalid wire segment(s).`);
} else {
  seedLayout();
  seedWires();
  render();
}
resetView();
