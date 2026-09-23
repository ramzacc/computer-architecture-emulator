import { COMPONENT_TYPES, dimsOf, pinsFor, spec } from "./components.js";
import { addComponent, addWireEdge, canPlaceEdge, createBoard, edgeKey,
  evaluateBoard, isValidComponent, netContaining, parseDocument, sanitizeWires, serialize } from "./model.js";

const CELL = 48;
const GAP = 3;
const WIRE_W = 4;
const U = 40;
const STORAGE_KEY = "grid-canvas-prototype-v5";

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
let idCounter = 1;

const gridEl = document.getElementById("grid");
const paletteEl = document.getElementById("palette");
const btnWire = document.getElementById("btn-wire");
const btnPan = document.getElementById("btn-pan");
const canvasWrapEl = document.getElementById("canvas-wrap");

function nextId() {
  let id;
  do { id = `c${idCounter++}`; }
  while (state.components.some((component) => component.id === id));
  return id;
}

function placeComponent(type, x, y) {
  const component = { id: nextId(), t: type, x, y, r: 0 };
  return addComponent(state, component) ? component : null;
}

function sanitizeAfterComponentEdit() {
  sanitizeWires(state);
  if (selectedWire && !state.wires.has(selectedWire)) selectedWire = null;
}

function selectWire(key) {
  selectedWire = key;
  selectedId = null;
}

function cellFromEvent(ev) {
  const rect = gridEl.getBoundingClientRect();
  return {
    x: Math.floor((ev.clientX - rect.left) / CELL),
    y: Math.floor((ev.clientY - rect.top) / CELL),
  };
}

function edgeFromEvent(ev) {
  const rect = gridEl.getBoundingClientRect();
  const fx = (ev.clientX - rect.left) / CELL;
  const fy = (ev.clientY - rect.top) / CELL;
  const hEdge = { o: "H", x: Math.floor(fx), y: Math.round(fy) };
  const vEdge = { o: "V", x: Math.round(fx), y: Math.floor(fy) };
  const hDist = Math.abs(fy - hEdge.y);
  const vDist = Math.abs(fx - vEdge.x);
  return hDist <= vDist ? hEdge : vEdge;
}

/* ---------- Rendering ---------- */

function renderGridSize() {
  gridEl.style.width = state.grid.cols * CELL + "px";
  gridEl.style.height = state.grid.rows * CELL + "px";
  gridEl.style.backgroundSize = `${CELL}px ${CELL}px, ${CELL}px ${CELL}px`;
}

function svgWrap(inner, s, rotated) {
  const vw = rotated ? s.h * U : s.w * U;
  const vh = rotated ? s.w * U : s.h * U;
  const content = rotated
    ? `<g transform="translate(${s.h * U},0) rotate(90)">${inner}</g>`
    : inner;
  return `<svg class="art" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none">${content}</svg>`;
}

function powerArt(color) {
  const stroke = "rgba(255,255,255,.4)";
  return `
    <line x1="40" y1="31" x2="40" y2="40" stroke="${stroke}" stroke-width="2"/>
    <circle cx="40" cy="18" r="13" fill="${color}" stroke="${stroke}" stroke-width="2"/>
    <line x1="34" y1="18" x2="46" y2="18" stroke="#14161a" stroke-width="3"/>
    <line x1="40" y1="12" x2="40" y2="24" stroke="#14161a" stroke-width="3"/>`;
}

function ledArt() {
  const stroke = "rgba(255,255,255,.4)";
  return `
    <line x1="40" y1="0" x2="40" y2="12" stroke="${stroke}" stroke-width="2"/>
    <polygon class="led-tri" points="28,12 52,12 40,28" fill="#5a5a7a" stroke="${stroke}" stroke-width="2"/>
    <line class="led-bar" x1="28" y1="28" x2="52" y2="28" stroke="${stroke}" stroke-width="2"/>
    <line x1="40" y1="28" x2="40" y2="36" stroke="${stroke}" stroke-width="2"/>
    <line x1="32" y1="36" x2="48" y2="36" stroke="${stroke}" stroke-width="2"/>
    <g class="led-rays" stroke="#ff4136" stroke-width="2" stroke-linecap="round">
      <line x1="20" y1="6" x2="12" y2="0"/>
      <line x1="60" y1="6" x2="68" y2="0"/>
      <line x1="18" y1="20" x2="8" y2="20"/>
      <line x1="62" y1="20" x2="72" y2="20"/>
    </g>`;
}

function gateArt(shape, color) {
  const stroke = "rgba(255,255,255,.35)";
  let body = "";
  if (shape === "and" || shape === "nand") {
    body = `<path d="M28 14 H132 V36 A52 32 0 0 1 28 36 Z" fill="${color}" stroke="${stroke}" stroke-width="2"/>`;
  } else {
    body = `<path d="M26 14 Q80 32 134 14 Q134 54 80 80 Q26 54 26 14 Z" fill="${color}" stroke="${stroke}" stroke-width="2"/>`;
    if (shape === "xor") {
      body += `<path d="M18 10 Q72 28 126 10" fill="none" stroke="${stroke}" stroke-width="2"/>`;
    }
  }
  const stubs = `
    <line x1="40" y1="0" x2="40" y2="18" stroke="${stroke}" stroke-width="2"/>
    <line x1="120" y1="0" x2="120" y2="18" stroke="${stroke}" stroke-width="2"/>`;
  let out = "";
  if (shape === "nand") {
    out = `<circle cx="80" cy="74" r="6" fill="${color}" stroke="${stroke}" stroke-width="2"/>`;
  } else if (shape === "and") {
    out = `<line x1="80" y1="68" x2="80" y2="80" stroke="${stroke}" stroke-width="2"/>`;
  }
  return body + stubs + out;
}

function componentArt(c, s) {
  let inner;
  if (s.shape === "power") inner = powerArt(s.color);
  else if (s.shape === "led") inner = ledArt();
  else inner = gateArt(s.shape, s.color);
  return svgWrap(inner, s, !!c.r);
}

function renderComponents(logic = evaluateBoard(state)) {
  gridEl.querySelectorAll(".comp").forEach((el) => el.remove());
  for (const c of state.components) {
    const s = spec(c.t);
    const d = dimsOf(c);
    if (!s || !d) continue;
    const el = document.createElement("div");
    el.className = "comp shaped";
    el.dataset.id = c.id;
    el.style.left = c.x * CELL + "px";
    el.style.top = c.y * CELL + "px";
    el.style.width = d.w * CELL - GAP + "px";
    el.style.height = d.h * CELL - GAP + "px";
    if (c.id === selectedId) el.classList.add("selected");
    const st = logic.states.get(c.id);
    if (c.t === "led") el.classList.toggle("lit", !!(st && st.lit));
    el.innerHTML = componentArt(c, s);
    el.title = `${s.label}  [${c.t}]  ${d.w}x${d.h}${st && st.value ? "  ON" : ""}`;
    gridEl.appendChild(el);
  }
}

function renderPins() {
  gridEl.querySelectorAll(".pin").forEach((el) => el.remove());
  for (const c of state.components) {
    for (const p of pinsFor(c)) {
      const el = document.createElement("div");
      el.className = "pin " + p.role;
      el.style.left = p.px * CELL + "px";
      el.style.top = p.py * CELL + "px";
      gridEl.appendChild(el);
    }
  }
}

function edgeBox(e) {
  if (e.o === "H") {
    return {
      left: e.x * CELL + "px",
      top: e.y * CELL - WIRE_W / 2 + "px",
      width: CELL + "px",
      height: WIRE_W + "px",
    };
  }
  return {
    left: e.x * CELL - WIRE_W / 2 + "px",
    top: e.y * CELL + "px",
    width: WIRE_W + "px",
    height: CELL + "px",
  };
}

function applyBox(el, box) {
  el.style.left = box.left;
  el.style.top = box.top;
  el.style.width = box.width;
  el.style.height = box.height;
}

function renderWires(logic = evaluateBoard(state)) {
  gridEl.querySelectorAll(".wire").forEach((el) => el.remove());
  const info = new Map();
  for (const net of logic.nets.values()) {
    for (const edge of net.edges) info.set(edgeKey(edge), { on: net.on, netId: net.id });
  }
  const selNetId = selectedWire && info.has(selectedWire) ? info.get(selectedWire).netId : null;
  for (const w of state.wires.values()) {
    const key = edgeKey(w);
    const i = info.get(key);
    const el = document.createElement("div");
    el.dataset.key = key;
    const selected = selNetId !== null && i.netId === selNetId;
    el.className = "wire " + (i.on ? "on" : "off") + (selected ? " selected" : "");
    applyBox(el, edgeBox(w));
    gridEl.appendChild(el);
  }
}

function renderPalette() {
  paletteEl.innerHTML = "";
  for (const [type, s] of Object.entries(COMPONENT_TYPES)) {
    const btn = document.createElement("button");
    btn.dataset.type = type;
    btn.classList.toggle("active", placingType === type);
    btn.title = `${s.w}x${s.h}`;
    btn.innerHTML = `<span class="swatch" style="background:${s.color}"></span>
      <span class="name">${s.label}</span>
      <span class="size">${s.w}x${s.h}</span>`;
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
  gridEl.classList.toggle("placing", placingType !== null);
  gridEl.classList.toggle("pan", mode === MODE.PAN && placingType === null);
  gridEl.classList.toggle("wire-mode", mode === MODE.WIRE);
  btnWire.classList.toggle("active", mode === MODE.WIRE);
  btnPan.classList.toggle("active", mode === MODE.PAN);
  if (mode !== MODE.WIRE) {
    const pv = gridEl.querySelector(".wire-preview");
    if (pv) pv.remove();
  }
}

function render() {
  renderGridSize();
  const logic = evaluateBoard(state);
  renderWires(logic);
  renderComponents(logic);
  renderPins();
}

/* ---------- Interaction ---------- */

gridEl.addEventListener("pointerdown", (e) => {
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
    const edge = edgeFromEvent(e);
    const key = edgeKey(edge);
    if (state.wires.has(key)) {
      // Energization is derived, not toggled; just select it.
      selectWire(key);
      render();
    } else if (addWireEdge(state, edge)) {
      render();
    } else {
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
    renderComponents();
    renderWires();

    const rect = gridEl.getBoundingClientRect();
    drag = {
      id: comp.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: comp.x,
      originY: comp.y,
      grabbedX: e.clientX - rect.left - comp.x * CELL,
      grabbedY: e.clientY - rect.top - comp.y * CELL,
      moved: false,
      valid: true,
    };
    gridEl.setPointerCapture(e.pointerId);
    return;
  }

  if (placingType) {
    const comp = placeComponent(placingType, cell.x, cell.y);
    if (comp) {
      selectedId = comp.id;
      selectedWire = null;
      sanitizeAfterComponentEdit();
      render();
    } else {
      flashInvalid(cell);
    }
    return;
  }

  // Pan mode: drag empty canvas to pan; a plain click clears the selection.
  pan = {
    startX: e.clientX,
    startY: e.clientY,
    left: canvasWrapEl.scrollLeft,
    top: canvasWrapEl.scrollTop,
    moved: false,
  };
  gridEl.classList.add("panning");
  gridEl.setPointerCapture(e.pointerId);
});

gridEl.addEventListener("contextmenu", (e) => {
  const wireEl = e.target.closest(".wire");
  let key = wireEl ? wireEl.dataset.key : null;
  if (!key && mode === MODE.WIRE) {
    const edge = edgeFromEvent(e);
    key = edgeKey(edge);
  }
  if (key && state.wires.has(key)) {
    e.preventDefault();
    state.wires.delete(key);
    if (selectedWire === key) selectedWire = null;
    render();
  }
});

gridEl.addEventListener("pointermove", (e) => {
  if (pan) {
    if (Math.abs(e.clientX - pan.startX) > 3 || Math.abs(e.clientY - pan.startY) > 3) {
      pan.moved = true;
    }
    canvasWrapEl.scrollLeft = pan.left - (e.clientX - pan.startX);
    canvasWrapEl.scrollTop = pan.top - (e.clientY - pan.startY);
    return;
  }

  if (mode === MODE.WIRE && !drag) {
    updateWirePreview(edgeFromEvent(e));
    return;
  }

  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;

  const comp = state.components.find((c) => c.id === drag.id);
  if (!comp) return;

  const rect = gridEl.getBoundingClientRect();
  const rawX = (e.clientX - rect.left - drag.grabbedX) / CELL;
  const rawY = (e.clientY - rect.top - drag.grabbedY) / CELL;
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
    gridEl.classList.remove("panning");
    if (gridEl.hasPointerCapture?.(e.pointerId)) {
      gridEl.releasePointerCapture(e.pointerId);
    }
    if (wasClick) {
      selectedId = null;
      selectedWire = null;
      renderComponents();
      renderWires();
    }
    return;
  }
  if (!drag) return;
  const comp = state.components.find((c) => c.id === drag.id);
  const wasDrag = drag.moved;
  if (comp && !drag.valid) {
    comp.x = drag.originX;
    comp.y = drag.originY;
  }
  drag = null;
  if (gridEl.hasPointerCapture?.(e.pointerId)) {
    gridEl.releasePointerCapture(e.pointerId);
  }
  if (wasDrag) {
    sanitizeAfterComponentEdit();
    render();
  } else {
    renderComponents();
  }
}

gridEl.addEventListener("pointerup", endDrag);
gridEl.addEventListener("pointercancel", endDrag);

gridEl.addEventListener("pointerleave", () => {
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
  const ok = existing || canPlaceEdge(state, edge);
  applyBox(el, edgeBox(edge));
  el.classList.toggle("valid", ok);
  el.classList.toggle("invalid", !ok);
  el.classList.toggle("remove", existing);
  el.title = existing ? "Right-click to remove" : "";
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

document.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") {
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
  const sel = state.components.find((c) => c.id === selectedId);
  if (!sel) return;
  const prev = sel.r;
  sel.r = prev ? 0 : 1;
  if (!isValidComponent(state, sel)) {
    sel.r = prev;
    return;
  }
  sanitizeAfterComponentEdit();
  render();
}

function deleteSelected() {
  if (selectedWire) {
    const net = netContaining(state, selectedWire);
    if (net) for (const w of net.edges) state.wires.delete(edgeKey(w));
    selectedWire = null;
    render();
    return;
  }
  if (!selectedId) return;
  state.components = state.components.filter((c) => c.id !== selectedId);
  selectedId = null;
  render();
}

document.getElementById("btn-rotate")?.addEventListener("click", rotateSelected);
document.getElementById("btn-delete")?.addEventListener("click", deleteSelected);

btnWire.addEventListener("click", () => {
  mode = MODE.WIRE;
  placingType = null;
  selectedWire = null;
  renderPalette();
  syncPlacingCursor();
  renderWires();
});

btnPan.addEventListener("click", () => {
  mode = MODE.PAN;
  placingType = null;
  renderPalette();
  syncPlacingCursor();
});

document.getElementById("btn-clear").addEventListener("click", () => {
  if (!confirm("Remove all components and wires?")) return;
  state.components = [];
  state.wires = new Map();
  selectedId = null;
  selectedWire = null;
  render();
});

document.getElementById("btn-clear-wires").addEventListener("click", () => {
  if (state.wires.size === 0) return;
  if (!confirm("Remove all wires?")) return;
  state.wires = new Map();
  selectedWire = null;
  render();
});

/* ---------- Persistence ---------- */

function loadFromText(text) {
  try {
    const { board, skipped } = parseDocument(text);
    state = board;
    idCounter = board.components.length + 1;
    selectedId = null;
    selectedWire = null;
    placingType = null;
    mode = MODE.PAN;
    if (skipped.components) console.warn(`Skipped ${skipped.components} invalid component(s).`);
    if (skipped.wires) console.warn(`Skipped ${skipped.wires} invalid wire segment(s).`);
    renderPalette();
    syncPlacingCursor();
    render();
    return true;
  } catch (error) {
    alert(`Invalid document: ${error.message}`);
    return false;
  }
}

document.getElementById("btn-save").addEventListener("click", () => {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(state));
    alert("Saved to browser storage.");
  } catch (err) {
    alert("Save failed: " + err.message);
  }
});

document.getElementById("btn-load").addEventListener("click", () => {
  const text = localStorage.getItem(STORAGE_KEY);
  if (!text) {
    alert("No saved state found.");
    return;
  }
  loadFromText(text);
});

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
    ["power", 2, 1], ["led", 2, 3],
    // two powers into an AND, output into an LED
    ["power", 7, 1], ["power", 9, 1], ["and", 7, 3], ["led", 8, 6],
    // two powers into a NAND -> lights nothing
    ["power", 14, 1], ["power", 16, 1], ["nand", 14, 3], ["led", 15, 6],
    // two powers into an XOR -> also off
    ["power", 22, 1], ["power", 24, 1], ["xor", 22, 3], ["led", 23, 6],
  ];
  state.components = [];
  for (const [t, x, y] of layout) placeComponent(t, x, y);
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

/* ---------- Boot ---------- */

renderPalette();
syncPlacingCursor();
const saved = localStorage.getItem(STORAGE_KEY);
if (!saved || !loadFromText(saved)) {
  seedLayout();
  seedWires();
  render();
}
