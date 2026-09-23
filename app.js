import { COMPONENT_TYPES, bitWidth, dimsOf, isSizable, pinsFor, spec, validBitWidth, validConstant } from "./components.js?v=13";
import { addComponent, addWireEdge, createBoard, edgeKey,
  edgePlacementError, evaluateBoard, isValidComponent, netContaining, parseDocument, resizeNet, sanitizeWires, serialize, wireSize } from "./model.js?v=13";

const CELL = 48;
const GAP = 3;
const WIRE_W = 4;
const U = 40;
const STORAGE_KEY = "grid-canvas-prototype-v5";
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
let idCounter = 1;
let newWireSize = 1;

const gridEl = document.getElementById("grid");
const paletteEl = document.getElementById("palette");
const btnWire = document.getElementById("btn-wire");
const btnPan = document.getElementById("btn-pan");
const canvasWrapEl = document.getElementById("canvas-wrap");
const zoomLabelEl = document.getElementById("zoom-level");
const newWireSizeEl = document.getElementById("new-wire-size");
const selectedSizeRowEl = document.getElementById("selected-size-row");
const selectedSizeEl = document.getElementById("selected-size");
const splitterOrderRowEl = document.getElementById("splitter-order-row");
const splitterOrderEl = document.getElementById("splitter-order");
const selectedValueRowEl = document.getElementById("selected-value-row");
const selectedValueEl = document.getElementById("selected-value");
const constantValueRowEl = document.getElementById("constant-value-row");
const constantValueEl = document.getElementById("constant-value");
const busStatusEl = document.getElementById("bus-status");

function busStatus(message, error = false) {
  busStatusEl.textContent = message;
  busStatusEl.classList.toggle("error", error);
}

function renderProperties() {
  const component = state.components.find((c) => c.id === selectedId);
  const net = selectedWire ? netContaining(state, selectedWire) : null;
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
  const component = state.components.find((c) => c.id === selectedId);
  let changed = false;
  if (validBitWidth(size) && component && isSizable(component)) {
    const old = component.size ?? 1;
    const oldValue = component.value;
    if (component.t !== "constant" || size <= 8) {
      component.size = size;
      if (component.t === "constant") component.value = Math.min(component.value ?? 0, 2 ** size - 1);
      changed = isValidComponent(state, component);
      if (!changed) { component.size = old; component.value = oldValue; }
    }
  } else if (validBitWidth(size) && selectedWire) {
    changed = resizeNet(state, selectedWire, size);
  }
  if (!changed) busStatus(component?.t === "constant"
    ? "Constant width must be 1–8 bits and match connected wires."
    : "Bus size mismatch or invalid size (use 1–32 bits).", true);
  else { busStatus(`Size set to ${size} bits.`); render(); }
  renderProperties();
});

splitterOrderEl.addEventListener("change", () => {
  const component = state.components.find((c) => c.id === selectedId);
  if (!component || component.t !== "splitter") return;
  component.order = splitterOrderEl.value;
  busStatus(`Splitter order set to ${component.order}.`);
  render();
});

constantValueEl.addEventListener("change", () => {
  const component = state.components.find((c) => c.id === selectedId);
  const value = Number(constantValueEl.value);
  if (!component || component.t !== "constant" || !validConstant({ ...component, value })) {
    busStatus(`Constant value must be a whole number from 0 to ${component ? 2 ** bitWidth(component) - 1 : 1}.`, true);
    renderProperties();
    return;
  }
  component.value = value;
  busStatus(`Constant set to ${value}.`);
  render();
});

function nextId() {
  let id;
  do { id = `c${idCounter++}`; }
  while (state.components.some((component) => component.id === id));
  return id;
}

function placeComponent(type, x, y) {
  const component = { id: nextId(), t: type, x, y, r: 0,
    ...(type === "splitter" ? { size: 4, order: "ascendant" } : {}),
    ...(type === "constant" ? { size: 1, value: 0 } : {}) };
  return addComponent(state, component) ? component : null;
}

function sanitizeAfterComponentEdit() {
  sanitizeWires(state);
  if (selectedWire && !state.wires.has(selectedWire)) selectedWire = null;
}

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

function svgWrap(inner, s, r) {
  const q = ((r % 4) + 4) % 4;
  const vw = (q % 2 ? s.h : s.w) * U;
  const vh = (q % 2 ? s.w : s.h) * U;
  const transform = q === 1 ? `translate(${s.h * U},0) rotate(90)`
    : q === 2 ? `translate(${s.w * U},${s.h * U}) rotate(180)`
    : q === 3 ? `translate(0,${s.w * U}) rotate(270)`
    : null;
  const content = transform ? `<g transform="${transform}">${inner}</g>` : inner;
  return `<svg class="art" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none">${content}</svg>`;
}

function powerArt(color) {
  const stroke = "rgba(255,255,255,.4)";
  return `
    <line x1="40" y1="63" x2="40" y2="83" stroke="${stroke}" stroke-width="2"/>
    <circle cx="40" cy="38" r="25" fill="${color}" stroke="${stroke}" stroke-width="2"/>
    <line x1="29" y1="38" x2="51" y2="38" stroke="#14161a" stroke-width="4"/>
    <line x1="40" y1="27" x2="40" y2="49" stroke="#14161a" stroke-width="4"/>`;
}

function ledArt() {
  const stroke = "rgba(255,255,255,.4)";
  return `<rect class="led-body" x="4" y="4" width="72" height="72" fill="#5a5a7a" stroke="${stroke}" stroke-width="2"/>`;
}

function constantArt(c, color) {
  const value = c.value ?? 0;
  const stroke = "rgba(255,255,255,.55)";
  const stub = [
    [40, 72, 40, 83], // south
    [8, 40, -1, 40],  // west
    [40, 8, 40, -1],  // north
    [72, 40, 83, 40], // east
  ][((c.r ?? 0) % 4 + 4) % 4];
  return `<rect x="8" y="8" width="64" height="64" rx="7" fill="${color}" stroke="${stroke}" stroke-width="2"/>
    <text x="40" y="48" text-anchor="middle" fill="#14161a" font-size="24" font-weight="700">${value}</text>
    <line x1="${stub[0]}" y1="${stub[1]}" x2="${stub[2]}" y2="${stub[3]}" stroke="${stroke}" stroke-width="2"/>`;
}

function gateArt(shape, color) {
  const stroke = "rgba(255,255,255,.35)";
  if (shape === "not") return `
    <line x1="40" y1="0" x2="40" y2="18" stroke="${stroke}" stroke-width="2"/>
    <path d="M16 18 H64 L40 60 Z" fill="${color}" stroke="${stroke}" stroke-width="2"/>
    <circle cx="40" cy="66" r="6" fill="${color}" stroke="${stroke}" stroke-width="2"/>
    <line x1="40" y1="72" x2="40" y2="80" stroke="${stroke}" stroke-width="2"/>`;
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
  if (s.splitter) {
    const n = bitWidth(c);
    const branches = Array.from({ length: n }, (_, index) => {
      const bit = c.order === "descendant" ? n - 1 - index : index;
      return `<line x1="40" y1="${(index + 1) * U}" x2="80" y2="${(index + 1) * U}" stroke="#ddb866" stroke-width="3"/>
       <text x="53" y="${(index + 1) * U - 5}" fill="#f4deb2" font-size="12">${bit}</text>`;
    }).join("");
    const inner = `<line x1="40" y1="0" x2="40" y2="${(n + 1) * U}" stroke="#ddb866" stroke-width="8"/>${branches}`;
    return svgWrap(inner, { w: 2, h: n + 1 }, c.r);
  }
  let inner;
  if (s.shape === "power") inner = powerArt(s.color);
  else if (s.shape === "constant") inner = constantArt(c, s.color);
  else if (s.shape === "led") inner = ledArt();
  else inner = gateArt(s.shape, s.color);
  return svgWrap(inner, s, s.constant ? 0 : c.r);
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
    el.title = `${s.label}  [${c.t}]  ${d.w}x${d.h}  ${bitWidth(c)} bit(s)${st && st.value ? "  value: " + st.value : ""}`;
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
  const width = wireSize(e) > 1 ? 7 : WIRE_W;
  if (e.o === "H") {
    return {
      left: e.x * CELL + "px",
      top: e.y * CELL - width / 2 + "px",
      width: CELL + "px",
      height: width + "px",
    };
  }
  return {
    left: e.x * CELL - width / 2 + "px",
    top: e.y * CELL + "px",
    width: width + "px",
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
    el.className = "wire " + (i.on ? "on" : "off") + (wireSize(w) > 1 ? " bus" : "") + (selected ? " selected" : "");
    el.title = `${wireSize(w)} bit(s), value ${i.value}`;
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
    btn.title = s.splitter ? "2 x (bits + 1)" : `${s.w}x${s.h}`;
    btn.innerHTML = `<span class="swatch" style="background:${s.color}"></span>
      <span class="name">${s.label}</span>
      <span class="size">${s.splitter ? "1–32 bits" : s.constant ? "1–8 bits" : `${s.w}x${s.h}`}</span>`;
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
    } else if (addWireEdge(state, edge)) {
      render();
    } else {
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
      startX: e.clientX,
      startY: e.clientY,
      originX: comp.x,
      originY: comp.y,
      grabbedX: world.x - comp.x * CELL,
      grabbedY: world.y - comp.y * CELL,
      moved: false,
      valid: true,
    };
    canvasWrapEl.setPointerCapture(e.pointerId);
    return;
  }

  if (placingType) {
    const comp = placeComponent(placingType, cell.x, cell.y);
    if (comp) {
      selectedId = comp.id;
      selectedWire = null;
      busStatus("Component selected.");
      sanitizeAfterComponentEdit();
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
    state.wires.delete(key);
    if (selectedWire === key) selectedWire = null;
    render();
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
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;

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
  const comp = state.components.find((c) => c.id === drag.id);
  const wasDrag = drag.moved;
  if (comp && !drag.valid) {
    busStatus("Cannot move component here. Check overlaps and bus sizes.", true);
    comp.x = drag.originX;
    comp.y = drag.originY;
  }
  drag = null;
  if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) {
    canvasWrapEl.releasePointerCapture(e.pointerId);
  }
  if (wasDrag) {
    sanitizeAfterComponentEdit();
    render();
  } else {
    renderComponents();
  }
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
  const sel = state.components.find((c) => c.id === selectedId);
  if (!sel) return;
  const prev = ((sel.r % 4) + 4) % 4;
  // Step through all four orientations; a rotation that would overlap is skipped
  // so the user can still reach the other valid directions.
  for (let step = 1; step <= 3; step++) {
    sel.r = (prev + step) % 4;
    if (isValidComponent(state, sel)) {
      sanitizeAfterComponentEdit();
      render();
      return;
    }
  }
  sel.r = prev;
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
  renderProperties();
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
    resetView();
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
    ["power", 2, 0], ["led", 2, 3],
    // two powers into an AND, output into an LED
    ["power", 7, 0], ["power", 9, 0], ["and", 7, 3], ["led", 8, 6],
    // two powers into a NAND -> lights nothing
    ["power", 14, 0], ["power", 16, 0], ["nand", 14, 3], ["led", 15, 6],
    // two powers into an XOR -> also off
    ["power", 22, 0], ["power", 24, 0], ["xor", 22, 3], ["led", 23, 6],
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
  resetView();
}
