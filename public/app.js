import { COMPONENT_TYPES, bitWidth, dimsOf, isSizable, pinsFor, spec, validBitWidth } from "./components.js";
import { addComponent, addWireEdge, createBoard, edgeKey, edgePlacementError, evaluateBoard, isValidComponent, netContaining, parseDocument, serialize, wireRoute } from "./model.js";
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
const MODE = Object.freeze({ PAN: "pan", WIRE: "wire", SELECT: "select" });

let mode = MODE.PAN;
let state = createBoard();
let selectedId = null;
let selectedIds = new Set();
let selectedWire = null;
let selectedWires = new Set();
let placingType = null;
let drag = null;
let pan = null;
let marquee = null;
let copiedComponents = [];
let newWireSize = 1;
let wireStart = null;

const gridEl = document.getElementById("grid");
const paletteEl = document.getElementById("palette");
const btnWire = document.getElementById("btn-wire");
const btnPan = document.getElementById("btn-pan");
const btnSelect = document.getElementById("btn-select");
const btnCopy = document.getElementById("btn-copy");
const btnPaste = document.getElementById("btn-paste");
const btnDelete = document.getElementById("btn-delete");
const canvasWrapEl = document.getElementById("canvas-wrap");
const zoomLabelEl = document.getElementById("zoom-level");
const newWireSizeEl = document.getElementById("new-wire-size");
const selectedPropertiesHeadingEl = document.getElementById("selected-properties-heading");
const selectedSizeRowEl = document.getElementById("selected-size-row");
const selectedSizeEl = document.getElementById("selected-size");
const splitterOrderRowEl = document.getElementById("splitter-order-row");
const splitterOrderEl = document.getElementById("splitter-order");
const selectedValueRowEl = document.getElementById("selected-value-row");
const selectedValueLabelEl = document.getElementById("selected-value-label");
const selectedValueEl = document.getElementById("selected-value");
const constantValueRowEl = document.getElementById("constant-value-row");
const constantValueEl = document.getElementById("constant-value");
const busStatusEl = document.getElementById("bus-status");
const { componentArt, renderComponents, renderPins, renderWires, edgeBox, applyBox } =
  createRenderer(gridEl, () => state, () => selectedIds, () => selectedWires);

function setSelection(ids, wires = []) {
  selectedIds = new Set(ids);
  selectedWires = new Set(wires);
  selectedId = selectedIds.size === 1 && !selectedWires.size ? [...selectedIds][0] : null;
  selectedWire = selectedWires.size === 1 && !selectedIds.size ? [...selectedWires][0] : null;
  renderComponents();
  renderWires();
  renderProperties();
}

function setSelectedComponents(ids) {
  setSelection(ids);
}

function syncActionButtons() {
  btnCopy.disabled = selectedIds.size === 0;
  btnPaste.disabled = copiedComponents.length === 0;
  btnDelete.disabled = selectedIds.size === 0 && selectedWires.size === 0;
}

function busStatus(message, error = false) {
  busStatusEl.textContent = message;
  busStatusEl.classList.toggle("error", error);
}

function renderProperties() {
  const component = state.components.find((c) => c.id === selectedId);
  const net = selectedWire ? netContaining(state, selectedWire) : null;
  const selectionCount = selectedIds.size + selectedWires.size;
  selectedPropertiesHeadingEl.textContent = selectionCount > 1 ? `${selectionCount} items selected` : component ? "Component properties" : net ? "Wire properties" : "Selected properties";
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
  const output = component?.t === "output";
  const displayedValue = output ? evaluateBoard(state).states.get(component.id)?.value ?? 0 : net?.value;
  const displayedSize = output ? bitWidth(component) : net?.size;
  selectedValueRowEl.hidden = !net && !output;
  selectedValueLabelEl.textContent = output ? "Output value" : "Selected bus value";
  selectedValueEl.textContent = displayedValue === undefined ? "—" : displayedSize === 1
    ? `${displayedValue} (${displayedValue ? "HIGH" : "LOW"})`
    : `${displayedValue} (0b${displayedValue.toString(2).padStart(displayedSize, "0")})`;
  if (size !== undefined && !busStatusEl.classList.contains("error")) {
    busStatus(component ? `${spec(component.t).label}: ${size} bit${size === 1 ? "" : "s"}.` :
      `Selected bus: ${size} bit${size === 1 ? "" : "s"}.`);
  }
  syncActionButtons();
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
      busStatus(`Constant value must be a whole number from 0 to ${2 ** bitWidth(component) - 1}, and must not short circuit another output.`, true);
    renderProperties();
  }
});

function selectWire(key) {
  const net = netContaining(state, key);
  setSelection([], [net ? edgeKey(net.edges[0]) : key]);
  busStatus("Wire net selected.");
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
      if (placingType) { mode = MODE.PAN; clearWireGesture(); }
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
  canvasWrapEl.classList.toggle("select-mode", mode === MODE.SELECT);
  btnWire.classList.toggle("active", mode === MODE.WIRE);
  btnPan.classList.toggle("active", mode === MODE.PAN);
  btnSelect.classList.toggle("active", mode === MODE.SELECT);
  if (mode !== MODE.WIRE) {
    clearWireGesture();
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
    const point = pointFromEvent(e);
    if (!wireStart) {
      wireStart = point;
      selectedId = null;
      selectedIds.clear();
      selectedWire = null;
      selectedWires.clear();
      renderComponents();
      renderWires();
      renderProperties();
      busStatus("Click to place a corner or endpoint. Double-click or right-click to finish; Esc cancels.");
    } else if (point.x !== wireStart.x || point.y !== wireStart.y) {
      const result = editor.addWireRoute(wireStart, point, newWireSize);
      if (result.error) busStatus(result.error, true);
      else {
        wireStart = point;
        busStatus("Corner placed. Click to continue, or double-click/right-click to finish.");
      }
    }
    updateWirePreview(point);
    return;
  }

  if (mode === MODE.SELECT) {
    if (compEl) {
      const ids = new Set(e.shiftKey ? selectedIds : []);
      const id = compEl.dataset.id;
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      setSelection(ids, e.shiftKey ? selectedWires : []);
      busStatus(`${selectedIds.size} component${selectedIds.size === 1 ? "" : "s"} and ${selectedWires.size} wire net${selectedWires.size === 1 ? "" : "s"} selected.`);
    } else if (wireEl) {
      if (e.shiftKey) {
        const net = netContaining(state, wireEl.dataset.key);
        const key = net ? edgeKey(net.edges[0]) : wireEl.dataset.key;
        const wires = new Set(selectedWires);
        if (wires.has(key)) wires.delete(key);
        else wires.add(key);
        setSelection(selectedIds, wires);
        busStatus(`${selectedIds.size} component${selectedIds.size === 1 ? "" : "s"} and ${selectedWires.size} wire net${selectedWires.size === 1 ? "" : "s"} selected.`);
      } else selectWire(wireEl.dataset.key);
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
    selectedId = comp.id;
    selectedIds = new Set([comp.id]);
    selectedWire = null;
    selectedWires.clear();
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
      selectedIds = new Set([comp.id]);
      selectedWire = null;
      selectedWires.clear();
      busStatus("Component selected.");
      render();
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
    selectedWire = null;
    selectedWires.clear();
    editor.removeWire(key);
  }
});

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
    updateWirePreview(pointFromEvent(e));
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
      for (const net of evaluateBoard(state).nets.values()) {
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
      selectedId = null;
      selectedIds.clear();
      selectedWire = null;
      selectedWires.clear();
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

canvasWrapEl.addEventListener("pointerleave", () => {
  gridEl.querySelectorAll(".wire-preview").forEach((el) => el.remove());
});

function clearWireGesture() {
  wireStart = null;
  gridEl.querySelectorAll(".wire-preview, .wire-anchor").forEach((el) => el.remove());
}

function updateWirePreview(point) {
  gridEl.querySelectorAll(".wire-preview, .wire-anchor").forEach((el) => el.remove());
  if (mode !== MODE.WIRE) return;
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  const mod = e.ctrlKey || e.metaKey;
  const zoomIn = e.key === "+" || e.key === "=" || e.code === "NumpadAdd";
  const zoomOut = e.key === "-" || e.key === "_" || e.code === "NumpadSubtract";

  if (mod && e.key.toLowerCase() === "c") {
    if (selectedIds.size) { copySelected(); e.preventDefault(); }
  } else if (mod && e.key.toLowerCase() === "v") {
    if (copiedComponents.length) { pasteCopied(); e.preventDefault(); }
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
    selectedId = null;
    selectedIds.clear();
    selectedWire = null;
    selectedWires.clear();
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
  const ids = [...selectedIds];
  const wires = [...selectedWires];
  selectedIds.clear();
  selectedWires.clear();
  selectedId = null;
  selectedWire = null;
  editor.deleteSelection(ids, wires);
  syncActionButtons();
}

function copySelected() {
  copiedComponents = editor.copyComponents(selectedIds);
  syncActionButtons();
  busStatus(`${copiedComponents.length} component${copiedComponents.length === 1 ? "" : "s"} copied.`);
}

function pasteCopied() {
  const added = editor.pasteComponents(copiedComponents);
  if (!added.length) {
    busStatus("Cannot paste components nearby. Check overlaps, bus sizes, and short circuits.", true);
    return;
  }
  mode = MODE.SELECT;
  placingType = null;
  renderPalette();
  syncPlacingCursor();
  setSelectedComponents(added.map((component) => component.id));
  busStatus(`${added.length} component${added.length === 1 ? "" : "s"} pasted.`);
}

btnCopy.addEventListener("click", copySelected);
btnPaste.addEventListener("click", pasteCopied);
btnDelete.addEventListener("click", deleteSelected);

btnSelect.addEventListener("click", () => {
  clearWireGesture();
  mode = MODE.SELECT;
  placingType = null;
  selectedWire = null;
  selectedWires.clear();
  renderPalette();
  syncPlacingCursor();
  renderWires();
  renderProperties();
});

btnWire.addEventListener("click", () => {
  clearWireGesture();
  mode = MODE.WIRE;
  placingType = null;
  selectedWire = null;
  selectedWires.clear();
  selectedId = null;
  selectedIds.clear();
  renderPalette();
  syncPlacingCursor();
  renderComponents();
  renderWires();
  renderProperties();
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

function loadFromText(text) {
  try {
    // Parse before changing any selection or visible state.
    const { board, skipped } = parseDocument(text);
    selectedId = null;
    selectedIds.clear();
    selectedWire = null;
    selectedWires.clear();
    placingType = null;
    clearWireGesture();
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
