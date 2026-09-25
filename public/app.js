import { COMPONENT_TYPES, DEFAULT_CLOCK_FREQUENCY, bitWidth, channelCount, dimsOf, isSizable, pinsFor, selectWidth, spec, validBitWidth } from "./components.js";
import { addComponent, addWireEdge, createBoard, edgeKey, edgePlacementError, evaluateBoard, isValidComponent, netContaining, parseDocument, serialize, wireRoute } from "./model.js";
import { BoardEditor } from "./editor.js";
import { createRenderer } from "./renderer.js";
import { formatValue, parseValue } from "./value-format.js";

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
let pressedButton = null;
let pan = null;
let marquee = null;
let copiedSelection = { components: [], wires: [], wireKeys: [] };
let newWireSize = 1;
let wireStart = null;

const gridEl = document.getElementById("grid");
const paletteEl = document.getElementById("palette");
const paletteSearchEl = document.getElementById("palette-search");
const paletteEmptyEl = document.getElementById("palette-empty");
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
const selectedSizeLabelEl = document.getElementById("selected-size-label");
const selectedSizeEl = document.getElementById("selected-size");
const channelsRowEl = document.getElementById("channels-row");
const channelsEl = document.getElementById("channels");
const splitterOrderRowEl = document.getElementById("splitter-order-row");
const splitterOrderEl = document.getElementById("splitter-order");
const selectedValueRowEl = document.getElementById("selected-value-row");
const selectedValueLabelEl = document.getElementById("selected-value-label");
const selectedValueEl = document.getElementById("selected-value");
const constantValueRowEl = document.getElementById("constant-value-row");
const constantValueEl = document.getElementById("constant-value");
const valueFormatRowEl = document.getElementById("value-format-row");
const valueFormatEl = document.getElementById("value-format");
const clockFrequencyRowEl = document.getElementById("clock-frequency-row");
const clockFrequencyEl = document.getElementById("clock-frequency");
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
  btnCopy.disabled = selectedIds.size === 0 && selectedWires.size === 0;
  btnPaste.disabled = copiedSelection.components.length === 0 && copiedSelection.wires.length === 0;
  btnDelete.disabled = selectedIds.size === 0 && selectedWires.size === 0;
}

function busStatus(message, error = false) {
  busStatusEl.textContent = message;
  busStatusEl.classList.toggle("error", error);
}

function renderProperties() {
  const component = state.components.find((c) => c.id === selectedId);
  const net = selectedWire ? netContaining(state, selectedWire, editor.evaluation) : null;
  const selectionCount = selectedIds.size + selectedWires.size;
  selectedPropertiesHeadingEl.textContent = selectionCount > 1 ? `${selectionCount} items selected` : component ? "Component properties" : net ? "Wire properties" : "Selected properties";
  const size = component && (isSizable(component) || component.t === "debugdisplay") ? bitWidth(component) : net?.size;
  selectedSizeRowEl.hidden = size === undefined;
  selectedSizeLabelEl.textContent = component?.t === "mux" || component?.t === "demux" ? "Data width (bits)" : "Selected size (bits)";
  selectedSizeEl.disabled = size === undefined || component?.t === "debugdisplay";
  selectedSizeEl.value = size === undefined ? "" : String(size);
  selectedSizeEl.max = component?.t === "constant" ? "8" : "32";
  const plexer = component?.t === "mux" || component?.t === "demux";
  channelsRowEl.hidden = !plexer;
  channelsEl.disabled = !plexer;
  channelsEl.value = plexer ? String(channelCount(component)) : "";
  const splitter = component?.t === "splitter";
  splitterOrderRowEl.hidden = !splitter;
  splitterOrderEl.disabled = !splitter;
  splitterOrderEl.value = splitter ? component.order ?? "ascendant" : "ascendant";
  const constant = component?.t === "constant";
  constantValueRowEl.hidden = !constant;
  constantValueEl.disabled = !constant;
  constantValueEl.value = constant ? formatValue(component.value ?? 0, bitWidth(component), component.format) : "";
  const valueFormat = constant || component?.t === "output";
  valueFormatRowEl.hidden = !valueFormat;
  valueFormatEl.disabled = !valueFormat;
  valueFormatEl.value = valueFormat ? component.format ?? "decimal" : "decimal";
  const clock = component?.t === "clock";
  clockFrequencyRowEl.hidden = !clock;
  clockFrequencyEl.disabled = !clock;
  clockFrequencyEl.value = clock ? String(component.frequency ?? DEFAULT_CLOCK_FREQUENCY) : "";
  const output = component?.t === "output" || component?.t === "debugdisplay";
  const register = component?.t === "register";
  const displayedValue = output || register ? editor.evaluation.states.get(component.id)?.value ?? 0 : net?.value;
  const displayedSize = output || register ? bitWidth(component) : net?.size;
  selectedValueRowEl.hidden = !net && !output && !register;
  selectedValueLabelEl.textContent = register ? "Stored value (Q)" : component?.t === "debugdisplay" ? "Debug value" : output ? "Output value" : "Selected bus value";
  selectedValueEl.textContent = displayedValue === undefined ? "—" : output
    ? formatValue(displayedValue, displayedSize, component.t === "debugdisplay" ? "hex" : component.format)
    : displayedSize === 1 ? `${displayedValue} (${displayedValue ? "HIGH" : "LOW"})`
      : `${displayedValue} (0b${displayedValue.toString(2).padStart(displayedSize, "0")})`;
  if (size !== undefined && !busStatusEl.classList.contains("error")) {
    busStatus(component ? `${spec(component.t).label}: ${size} bit${size === 1 ? "" : "s"}${plexer ? `, ${channelCount(component)} channels, ${selectWidth(component)} selector bit${selectWidth(component) === 1 ? "" : "s"}` : ""}.` :
      `Selected bus: ${size} bit${size === 1 ? "" : "s"}.`);
  }
  if (clock && !busStatusEl.classList.contains("error"))
    busStatus(`Clock: ${component.frequency ?? DEFAULT_CLOCK_FREQUENCY} Hz.`);
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
  const current = component ? bitWidth(component) : selectedWire ? netContaining(state, selectedWire, editor.evaluation)?.size : undefined;
  if (size === current) return;
  const changed = component ? editor.resizeComponent(selectedId, size) : editor.resizeWire(selectedWire, size);
  if (!changed) busStatus(component?.t === "constant"
    ? "Constant width must be 1–8 bits and match connected wires."
    : "Bus size mismatch or invalid size (use 1–32 bits).", true);
  else busStatus(`Size set to ${size} bits.`);
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
  if (!component || component.t !== "constant") return;
  const value = parseValue(constantValueEl.value, component.format);
  if (value === component.value) { renderProperties(); return; }
  if (value !== null && editor.setConstantValue(selectedId, value)) {
    busStatus(`Constant set to ${value}.`);
  } else {
    busStatus(`Enter a valid ${component.format ?? "decimal"} whole number from 0 to ${2 ** bitWidth(component) - 1}; the value must not short circuit another output.`, true);
    renderProperties();
  }
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
      if (placingType) { mode = MODE.PAN; clearWireGesture(); }
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
  if (mode !== MODE.WIRE) {
    clearWireGesture();
  }
}

function render() {
  applyView();
  const logic = editor.evaluation;
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
      setSelection([]);
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
    if (comp.t === "switch" && !placingType && !e.shiftKey) {
      if (!editor.toggleSwitch(comp.id)) busStatus("Switch cannot toggle: conflicting outputs share a net.", true);
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
  if (drag.kind === "selection") {
    const world = worldFromEvent(e);
    const dx = Math.round((world.x - drag.startX) / CELL);
    const dy = Math.round((world.y - drag.startY) / CELL);
    if (dx === drag.dx && dy === drag.dy) return;
    drag.dx = dx;
    drag.dy = dy;
    const trial = editor.translatedSelection(drag.ids, drag.wires, dx, dy);
    drag.valid = !!trial || (!dx && !dy);
    state = trial ?? editor.board;
    selectedWires = new Set(trial ? drag.wires.map((key) => {
      const edge = editor.board.wires.get(key);
      return edge ? edgeKey({ ...edge, x: edge.x + dx, y: edge.y + dy }) : key;
    }) : drag.wires);
    const logic = trial ? evaluateBoard(trial) : editor.evaluation;
    renderComponents(logic);
    renderPins();
    renderWires(logic);
    return;
  }
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
  const added = editor.pasteSelection(copiedSelection);
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

function loadFromText(text) {
  try {
    // Parse before changing any selection or visible state.
    const { board, skipped } = parseDocument(text);
    setSelection([]);
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

function seedLayout(board) {
  const layout = [
    // a constant straight into an LED
    ["constant", 2, 0], ["led", 2, 3],
    // two constants into an AND, output into an LED
    ["constant", 7, 0], ["constant", 9, 0], ["and", 7, 3], ["led", 8, 6],
    // two constants into a NAND -> lights nothing
    ["constant", 14, 0], ["constant", 16, 0], ["nand", 14, 3], ["led", 15, 6],
    // two constants into an XOR -> also off
    ["constant", 22, 0], ["constant", 24, 0], ["xor", 22, 3], ["led", 23, 6],
  ];
  for (const [t, x, y] of layout) addComponent(board, {
    id: `c${board.components.length + 1}`, t, x, y, r: 0,
    ...(t === "constant" ? { size: 1, value: 1 } : {}),
  });
}

function seedWires(board) {
  const wires = [
    { o: "V", x: 3, y: 2 },
    { o: "V", x: 8, y: 2 }, { o: "V", x: 10, y: 2 }, { o: "V", x: 9, y: 5 },
    { o: "V", x: 15, y: 2 }, { o: "V", x: 17, y: 2 }, { o: "V", x: 16, y: 5 },
    { o: "V", x: 23, y: 2 }, { o: "V", x: 25, y: 2 }, { o: "V", x: 24, y: 5 },
  ];
  for (const wire of wires) addWireEdge(board, wire);
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
  const clocks = new Map(state.components.filter((component) => component.t === "clock")
    .map((component) => [component.id, component.frequency ?? DEFAULT_CLOCK_FREQUENCY]));
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

const editor = new BoardEditor({
  storage: getStorage(),
  onChange: (board) => { state = board; syncClockTimers(); render(); },
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
  const board = createBoard();
  seedLayout(board);
  seedWires(board);
  editor.replaceBoard(board, { save: false });
}
resetView();
