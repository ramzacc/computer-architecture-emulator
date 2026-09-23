const SCHEMA_VERSION = 4;
const CELL = 48;
const GAP = 3;
const WIRE_W = 4;
const STORAGE_KEY = "grid-canvas-prototype-v4";
const DEFAULT_COLS = 64;
const DEFAULT_ROWS = 44;

// Fixed component registry. Characteristics live here, never in the saved file.
// Instances only persist their type + position (+ orientation when rotated).
//
// Pins are declared per component in unrotated local lattice coordinates:
//   dir = outward normal ("N" | "E" | "S" | "W").
// A pin must sit on the interior of one side, never on a corner (a corner has
// no single outward normal). Concretely: N/S pins need 0 < x < w; E/W pins
// need 0 < y < h. So 1-wide parts carry W/E pins and 1-tall parts carry N/S
// pins. Layouts are irregular on purpose; nothing assumes 4 symmetric pins.
const COMPONENT_TYPES = {
  cpu: {
    label: "CPU", w: 2, h: 2, color: "#4c8bf5", source: true,
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 2, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 2, y: 1, dir: "E" },
    ],
  },
  gpu: {
    label: "GPU", w: 2, h: 2, color: "#8e4cf5", source: true,
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 2, y: 1, dir: "E" },
      { x: 0, y: 1, dir: "W" },
      { x: 1, y: 2, dir: "S" },
    ],
  },
  reg: {
    label: "Register", w: 1, h: 2, color: "#e5484d",
    pins: [
      { x: 0, y: 1, dir: "W" },
      { x: 1, y: 1, dir: "E" },
    ],
  },
  cache: {
    label: "Cache", w: 1, h: 2, color: "#f5883b",
    pins: [
      { x: 0, y: 1, dir: "W" },
      { x: 1, y: 1, dir: "E" },
    ],
  },
  bus: {
    label: "Bus", w: 2, h: 1, color: "#30a46c",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 1, dir: "S" },
    ],
  },
  clock: {
    label: "Clock", w: 2, h: 1, color: "#e5c84c", source: true,
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 1, dir: "S" },
    ],
  },
  board: {
    label: "Board", w: 3, h: 3, color: "#2f6f4f",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 2, y: 0, dir: "N" },
      { x: 1, y: 3, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 3, y: 2, dir: "E" },
    ],
  },
  fpga: {
    label: "FPGA", w: 3, h: 3, color: "#7a4c2f",
    pins: [
      { x: 2, y: 0, dir: "N" },
      { x: 1, y: 3, dir: "S" },
      { x: 2, y: 3, dir: "S" },
      { x: 0, y: 2, dir: "W" },
      { x: 3, y: 1, dir: "E" },
    ],
  },
  ram: {
    label: "RAM", w: 3, h: 2, color: "#2c6f8f",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 2, y: 0, dir: "N" },
      { x: 1, y: 2, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 3, y: 1, dir: "E" },
    ],
  },
  rom: {
    label: "ROM", w: 3, h: 2, color: "#5a5a7a",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 2, y: 0, dir: "N" },
      { x: 0, y: 1, dir: "W" },
      { x: 3, y: 1, dir: "E" },
    ],
  },
  alu: {
    label: "ALU", w: 2, h: 3, color: "#a03a6b",
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 3, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 0, y: 2, dir: "W" },
      { x: 2, y: 2, dir: "E" },
    ],
  },
  cu: {
    label: "Control", w: 2, h: 3, color: "#3a6ba0", source: true,
    pins: [
      { x: 1, y: 0, dir: "N" },
      { x: 1, y: 3, dir: "S" },
      { x: 0, y: 1, dir: "W" },
      { x: 2, y: 1, dir: "E" },
      { x: 2, y: 2, dir: "E" },
    ],
  },
};

// 90-degree clockwise rotation of an outward normal.
const ROTATE_CW = { N: "E", E: "S", S: "W", W: "N" };

function spec(type) {
  return COMPONENT_TYPES[type] || null;
}

function dimsFor(type, rotated) {
  const s = spec(type);
  if (!s) return null;
  return rotated ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}

let state = {
  grid: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS, cell: CELL },
  components: [],
  wires: new Map(),
};

let selectedId = null;
let selectedWire = null;
let placingType = null;
let wirePreviewEdge = null;
let drag = null;
let pan = null;
let idCounter = 1;

// DOM refs
const gridEl = document.getElementById("grid");
const paletteEl = document.getElementById("palette");
const serializedEl = document.getElementById("serialized");
const selectionInfoEl = document.getElementById("selection-info");
const btnRotate = document.getElementById("btn-rotate");
const btnDelete = document.getElementById("btn-delete");
const btnWire = document.getElementById("btn-wire");
const btnPan = document.getElementById("btn-pan");
const canvasWrapEl = document.getElementById("canvas-wrap");

/* ---------- Model helpers ---------- */

function nextId() {
  let id;
  do {
    id = "c" + idCounter++;
  } while (state.components.some((c) => c.id === id));
  return id;
}

function dimsOf(comp) {
  return dimsFor(comp.t, !!comp.r);
}

function componentAt(cellX, cellY, ignoreId) {
  return state.components.find((c) => {
    if (c.id === ignoreId) return false;
    const { w, h } = dimsOf(c);
    return cellX >= c.x && cellX < c.x + w && cellY >= c.y && cellY < c.y + h;
  });
}

function isValid(comp) {
  const d = dimsOf(comp);
  if (!d) return false;
  if (comp.x < 0 || comp.y < 0) return false;
  if (comp.x + d.w > state.grid.cols) return false;
  if (comp.y + d.h > state.grid.rows) return false;

  for (let y = comp.y; y < comp.y + d.h; y++) {
    for (let x = comp.x; x < comp.x + d.w; x++) {
      if (componentAt(x, y, comp.id)) return false;
    }
  }
  return true;
}

function addComponent(type, x, y) {
  if (!spec(type)) return null;
  const comp = { id: nextId(), t: type, x, y, r: 0 };
  if (!isValid(comp)) return null;
  state.components.push(comp);
  return comp;
}

/* ---------- Wire geometry (edges on the lattice) ---------- */

function edgeKey(o, x, y) {
  return o + ":" + x + "," + y;
}

function edgeInBoundsFor(cols, rows, e) {
  if (e.o === "H") return e.x >= 0 && e.x < cols && e.y >= 0 && e.y <= rows;
  return e.x >= 0 && e.x <= cols && e.y >= 0 && e.y < rows;
}

function edgePoints(e) {
  return e.o === "H"
    ? [
        [e.x, e.y],
        [e.x + 1, e.y],
      ]
    : [
        [e.x, e.y],
        [e.x, e.y + 1],
      ];
}

function edgeMid(e) {
  return e.o === "H" ? [e.x + 0.5, e.y] : [e.x, e.y + 0.5];
}

function blockedFor(components, e) {
  const [mx, my] = edgeMid(e);
  return components.some((c) => {
    const d = dimsFor(c.t, !!c.r);
    if (!d) return false;
    return mx >= c.x && mx <= c.x + d.w && my >= c.y && my <= c.y + d.h;
  });
}

function edgeBlocked(e) {
  return blockedFor(state.components, e);
}

// A segment endpoint may land on a component's contour only if that point is
// one of that component's declared pins. This stops wires from dead-ending
// orthogonally into a bare side ("pointing" at a component with no pin there).
function endpointOnWallFor(components, e) {
  for (const [x, y] of edgePoints(e)) {
    for (const c of components) {
      const d = dimsFor(c.t, !!c.r);
      if (!d) continue;
      const x0 = c.x, y0 = c.y, x1 = c.x + d.w, y1 = c.y + d.h;
      const onContour =
        ((x === x0 || x === x1) && y >= y0 && y <= y1) ||
        ((y === y0 || y === y1) && x >= x0 && x <= x1);
      if (!onContour) continue;
      if (!pinsFor(c).some((p) => p.px === x && p.py === y)) return true;
    }
  }
  return false;
}

function endpointOnWall(e) {
  return endpointOnWallFor(state.components, e);
}

function edgeInBounds(e) {
  return edgeInBoundsFor(state.grid.cols, state.grid.rows, e);
}

function outwardEdge(px, py, dir) {
  switch (dir) {
    case "N": return { o: "V", x: px, y: py - 1 };
    case "S": return { o: "V", x: px, y: py };
    case "W": return { o: "H", x: px - 1, y: py };
    default:  return { o: "H", x: px, y: py };
  }
}

// Registry-declared pins, transformed into world space (and rotated). These
// outward stubs are the only legal seeds for a wire.
function pinsFor(comp) {
  const s = spec(comp.t);
  if (!s || !s.pins) return [];
  const { w, h } = dimsFor(comp.t, false);
  const out = [];
  for (const p of s.pins) {
    let lx = p.x;
    let ly = p.y;
    let dir = p.dir;
    if (comp.r) {
      lx = h - p.y;
      ly = p.x;
      dir = ROTATE_CW[dir];
    }
    const px = comp.x + lx;
    const py = comp.y + ly;
    out.push({ px, py, dir, edge: outwardEdge(px, py, dir) });
  }
  return out;
}

function isPinStub(e) {
  const k = edgeKey(e.o, e.x, e.y);
  return state.components.some((c) =>
    pinsFor(c).some((p) => edgeKey(p.edge.o, p.edge.x, p.edge.y) === k)
  );
}

function edgeTouchesWire(e) {
  const pts = edgePoints(e).map((p) => p.join(","));
  for (const w of state.wires.values()) {
    if (edgePoints(w).some((p) => pts.includes(p.join(",")))) return true;
  }
  return false;
}

function canPlaceEdge(e) {
  return (
    edgeInBounds(e) &&
    !edgeBlocked(e) &&
    !endpointOnWall(e) &&
    !state.wires.has(edgeKey(e.o, e.x, e.y)) &&
    (isPinStub(e) || edgeTouchesWire(e))
  );
}

function addWireEdge(e) {
  if (!canPlaceEdge(e)) return false;
  state.wires.set(edgeKey(e.o, e.x, e.y), { o: e.o, x: e.x, y: e.y });
  return true;
}

// Re-apply the wire placement rules after components change (move, rotate,
// place). Any segment that now crosses a component or dead-ends into a bare
// side is dropped, so component edits can't reintroduce the ugliness.
function sanitizeWires() {
  let removed = 0;
  for (const [key, w] of [...state.wires]) {
    if (blockedFor(state.components, w) || endpointOnWallFor(state.components, w)) {
      state.wires.delete(key);
      removed++;
    }
  }
  if (selectedWire && !state.wires.has(selectedWire)) selectedWire = null;
  return removed;
}

// Where energization "comes from": the pins of source components.
function energizedPoints() {
  const pts = new Set();
  for (const c of state.components) {
    const s = spec(c.t);
    if (!s || !s.source) continue;
    for (const p of pinsFor(c)) pts.add(p.px + "," + p.py);
  }
  return pts;
}

// A net is ON iff it reaches a source component's pin. This is a predicate,
// never persisted; it is recomputed from components every time it is asked.
function netIsOn(net, energized) {
  return net.edges.some((e) =>
    edgePoints(e).some(([x, y]) => energized.has(x + "," + y))
  );
}

// Connected edge networks, grouped by shared endpoints.
function computeNets() {
  const parent = new Map();
  const find = (a) => {
    while (parent.get(a) !== a) {
      parent.set(a, parent.get(parent.get(a)));
      a = parent.get(a);
    }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const w of state.wires.values()) {
    const [a, b] = edgePoints(w).map((p) => p.join(","));
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    union(a, b);
  }

  const energized = energizedPoints();
  const nets = new Map();
  for (const w of state.wires.values()) {
    const [a] = edgePoints(w).map((p) => p.join(","));
    const r = find(a);
    if (!nets.has(r)) nets.set(r, { id: r, edges: [] });
    nets.get(r).edges.push(w);
  }
  for (const net of nets.values()) net.on = netIsOn(net, energized);
  return nets;
}

function netInfoByEdgeKey() {
  const map = new Map();
  for (const net of computeNets().values()) {
    for (const w of net.edges) {
      map.set(edgeKey(w.o, w.x, w.y), { on: net.on, netId: net.id });
    }
  }
  return map;
}

function netContaining(key) {
  for (const net of computeNets().values()) {
    if (net.edges.some((w) => edgeKey(w.o, w.x, w.y) === key)) return net;
  }
  return null;
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

function renderComponents() {
  gridEl.querySelectorAll(".comp").forEach((el) => el.remove());
  for (const c of state.components) {
    const s = spec(c.t);
    const d = dimsOf(c);
    if (!s || !d) continue;
    const el = document.createElement("div");
    el.className = "comp";
    el.dataset.id = c.id;
    el.style.left = c.x * CELL + "px";
    el.style.top = c.y * CELL + "px";
    el.style.width = d.w * CELL - GAP + "px";
    el.style.height = d.h * CELL - GAP + "px";
    el.style.background = s.color;
    el.textContent = s.label;
    el.title = `${s.label}  [${c.t}]  ${d.w}x${d.h}`;
    if (c.id === selectedId) el.classList.add("selected");
    gridEl.appendChild(el);
  }
}

function renderPins() {
  gridEl.querySelectorAll(".pin").forEach((el) => el.remove());
  for (const c of state.components) {
    for (const p of pinsFor(c)) {
      const el = document.createElement("div");
      el.className = "pin";
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

function renderWires() {
  gridEl.querySelectorAll(".wire").forEach((el) => el.remove());
  const info = netInfoByEdgeKey();
  const selNetId = selectedWire && info.has(selectedWire) ? info.get(selectedWire).netId : null;
  for (const w of state.wires.values()) {
    const key = edgeKey(w.o, w.x, w.y);
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
      renderPalette();
      syncPlacingCursor();
    });
    paletteEl.appendChild(btn);
  }
}

function syncPlacingCursor() {
  gridEl.classList.toggle("placing", placingType !== null && placingType !== "pan");
  gridEl.classList.toggle("pan", placingType === "pan");
  btnWire.classList.toggle("active", placingType === "wire");
  btnPan.classList.toggle("active", placingType === "pan");
  if (placingType !== "wire") {
    const pv = gridEl.querySelector(".wire-preview");
    if (pv) pv.remove();
  }
}

function renderSelection() {
  if (selectedWire && state.wires.has(selectedWire)) {
    const net = netContaining(selectedWire);
    selectionInfoEl.classList.remove("muted");
    selectionInfoEl.textContent = `Wire net  ${net ? net.edges.length : 0} segment(s)  ${
      net && net.on ? "ON" : "OFF"
    }`;
    btnRotate.disabled = true;
    btnDelete.disabled = false;
    return;
  }

  const sel = state.components.find((c) => c.id === selectedId);
  if (!sel) {
    selectionInfoEl.textContent = "Nothing selected";
    selectionInfoEl.classList.add("muted");
    btnRotate.disabled = true;
    btnDelete.disabled = true;
    return;
  }
  const s = spec(sel.t);
  const d = dimsOf(sel);
  selectionInfoEl.classList.remove("muted");
  selectionInfoEl.textContent = `${s.label} [${sel.t}]  ${d.w}x${d.h}  @ (${sel.x}, ${sel.y})${
    sel.r ? "  rotated" : ""
  }`;
  btnRotate.disabled = false;
  btnDelete.disabled = false;
}

function serialize() {
  // Wire energization is derived (see energizedPoints/netIsOn), so wires are
  // persisted as pure geometry only.
  const wires = [...state.wires.values()].map((w) => ({ o: w.o, x: w.x, y: w.y }));
  return JSON.stringify(
    {
      version: SCHEMA_VERSION,
      grid: { cols: state.grid.cols, rows: state.grid.rows },
      components: state.components.map((c) =>
        c.r ? { t: c.t, x: c.x, y: c.y, r: 1 } : { t: c.t, x: c.x, y: c.y }
      ),
      wires,
    },
    null,
    2
  );
}

function updateSerialized() {
  serializedEl.value = serialize();
}

function render() {
  renderGridSize();
  renderWires();
  renderComponents();
  renderPins();
  renderSelection();
  updateSerialized();
}

/* ---------- Interaction ---------- */

gridEl.addEventListener("pointerdown", (e) => {
  if (placingType === "pan") {
    if (e.button === 2) return;
    pan = {
      startX: e.clientX,
      startY: e.clientY,
      left: canvasWrapEl.scrollLeft,
      top: canvasWrapEl.scrollTop,
    };
    gridEl.classList.add("panning");
    gridEl.setPointerCapture(e.pointerId);
    return;
  }

  const wireEl = e.target.closest(".wire");
  const compEl = e.target.closest(".comp");
  const cell = cellFromEvent(e);

  if (placingType === "wire") {
    if (e.button === 2) return;
    if (wireEl) {
      selectWire(wireEl.dataset.key);
      renderSelection();
      renderWires();
      return;
    }
    const edge = edgeFromEvent(e);
    const key = edgeKey(edge.o, edge.x, edge.y);
    if (state.wires.has(key)) {
      // Energization is derived, not toggled; just select it.
      selectWire(key);
      render();
    } else if (canPlaceEdge(edge)) {
      state.wires.set(key, { o: edge.o, x: edge.x, y: edge.y });
      render();
    } else {
      flashInvalidEdge(edge);
    }
    return;
  }

  if (wireEl) {
    selectWire(wireEl.dataset.key);
    renderSelection();
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
    renderSelection();

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
    const comp = addComponent(placingType, cell.x, cell.y);
    if (comp) {
      selectedId = comp.id;
      selectedWire = null;
      sanitizeWires();
      render();
    } else {
      flashInvalid(cell);
    }
  } else {
    selectedId = null;
    selectedWire = null;
    renderSelection();
    renderComponents();
    renderWires();
  }
});

gridEl.addEventListener("contextmenu", (e) => {
  const wireEl = e.target.closest(".wire");
  let key = wireEl ? wireEl.dataset.key : null;
  if (!key && placingType === "wire") {
    const edge = edgeFromEvent(e);
    key = edgeKey(edge.o, edge.x, edge.y);
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
    canvasWrapEl.scrollLeft = pan.left - (e.clientX - pan.startX);
    canvasWrapEl.scrollTop = pan.top - (e.clientY - pan.startY);
    return;
  }

  if (placingType === "wire" && !drag) {
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
  drag.valid = isValid(comp);
  if (el) {
    el.style.left = comp.x * CELL + "px";
    el.style.top = comp.y * CELL + "px";
    el.classList.toggle("invalid", !drag.valid);
  }
  // Pins and wires are derived from component positions, so move them live.
  renderPins();
  renderWires();
  renderSelection();
});

function endDrag(e) {
  if (pan) {
    pan = null;
    gridEl.classList.remove("panning");
    if (gridEl.hasPointerCapture?.(e.pointerId)) {
      gridEl.releasePointerCapture(e.pointerId);
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
    sanitizeWires();
    render();
  } else {
    renderComponents();
  }
}

gridEl.addEventListener("pointerup", endDrag);
gridEl.addEventListener("pointercancel", endDrag);

gridEl.addEventListener("pointerleave", () => {
  wirePreviewEdge = null;
  const el = gridEl.querySelector(".wire-preview");
  if (el) el.remove();
});

function updateWirePreview(edge) {
  wirePreviewEdge = edge;
  let el = gridEl.querySelector(".wire-preview");
  if (!el) {
    el = document.createElement("div");
    el.className = "wire-preview";
    gridEl.appendChild(el);
  }
  const key = edgeKey(edge.o, edge.x, edge.y);
  const existing = state.wires.has(key);
  const ok = existing || canPlaceEdge(edge);
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
  if (e.target === serializedEl) return;
  if (e.key === "r" || e.key === "R") {
    rotateSelected();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    deleteSelected();
    e.preventDefault();
  } else if (e.key === "Escape") {
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
  if (!isValid(sel)) {
    sel.r = prev;
    return;
  }
  sanitizeWires();
  render();
}

function deleteSelected() {
  if (selectedWire) {
    const net = netContaining(selectedWire);
    if (net) for (const w of net.edges) state.wires.delete(edgeKey(w.o, w.x, w.y));
    selectedWire = null;
    render();
    return;
  }
  if (!selectedId) return;
  state.components = state.components.filter((c) => c.id !== selectedId);
  selectedId = null;
  render();
}

document.getElementById("btn-rotate").addEventListener("click", rotateSelected);
document.getElementById("btn-delete").addEventListener("click", deleteSelected);

btnWire.addEventListener("click", () => {
  placingType = placingType === "wire" ? null : "wire";
  selectedWire = null;
  renderPalette();
  syncPlacingCursor();
  renderSelection();
  renderWires();
});

btnPan.addEventListener("click", () => {
  placingType = placingType === "pan" ? null : "pan";
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
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    alert("Invalid JSON: " + err.message);
    return false;
  }
  if (!data || !Array.isArray(data.components)) {
    alert("Invalid document: missing components array.");
    return false;
  }

  const grid = data.grid || {};
  const cols = clampInt(grid.cols, 1, 500, DEFAULT_COLS);
  const rows = clampInt(grid.rows, 1, 500, DEFAULT_ROWS);

  const components = [];
  let skipped = 0;
  for (const raw of data.components) {
    if (!raw || !spec(raw.t)) {
      skipped++;
      continue;
    }
    const rotated = raw.r ? 1 : 0;
    const { w, h } = dimsFor(raw.t, rotated);
    components.push({
      id: "c" + ++idCounter,
      t: raw.t,
      x: clampInt(raw.x, 0, Math.max(0, cols - w), 0),
      y: clampInt(raw.y, 0, Math.max(0, rows - h), 0),
      r: rotated,
    });
  }
  if (skipped) console.warn(`Skipped ${skipped} unknown component type(s).`);

  const wires = new Map();
  let droppedWires = 0;
  if (Array.isArray(data.wires)) {
    for (const raw of data.wires) {
      if (!raw) continue;
      const edge = {
        o: raw.o === "V" ? "V" : "H",
        x: Math.trunc(Number(raw.x)),
        y: Math.trunc(Number(raw.y)),
      };
      if (!Number.isFinite(edge.x) || !Number.isFinite(edge.y)) continue;
      // Any persisted energization field is intentionally ignored.
      if (
        !edgeInBoundsFor(cols, rows, edge) ||
        blockedFor(components, edge) ||
        endpointOnWallFor(components, edge)
      ) {
        droppedWires++;
        continue;
      }
      const key = edgeKey(edge.o, edge.x, edge.y);
      if (!wires.has(key)) wires.set(key, { o: edge.o, x: edge.x, y: edge.y });
    }
  }
  if (droppedWires) console.warn(`Dropped ${droppedWires} invalid wire segment(s).`);

  state = { grid: { cols, rows, cell: CELL }, components, wires };
  selectedId = null;
  selectedWire = null;
  placingType = null;
  renderPalette();
  syncPlacingCursor();
  render();
  return true;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

document.getElementById("btn-save").addEventListener("click", () => {
  try {
    localStorage.setItem(STORAGE_KEY, serialize());
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
  const blob = new Blob([serialize()], { type: "application/json" });
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

document.getElementById("btn-apply").addEventListener("click", () => {
  loadFromText(serializedEl.value);
});

document.getElementById("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(serialize());
  } catch {
    serializedEl.select();
    document.execCommand("copy");
  }
});

/* ---------- Seeds ---------- */

function seedLayout() {
  const layout = [
    ["cpu", 0, 0],
    ["gpu", 3, 0],
    ["reg", 5, 0],
    ["cache", 5, 3],
    ["bus", 3, 4],
    ["clock", 3, 5],
    ["board", 9, 0],
    ["fpga", 9, 4],
    ["ram", 6, 6],
    ["rom", 0, 7],
    ["alu", 12, 6],
    ["cu", 0, 4],
  ];
  state.components = [];
  for (const [t, x, y] of layout) addComponent(t, x, y);
}

function seedWires() {
  state.wires = new Map();
  addWireEdge({ o: "H", x: 2, y: 1 });
  addWireEdge({ o: "H", x: 6, y: 1 });
  addWireEdge({ o: "H", x: 7, y: 1 });
  addWireEdge({ o: "V", x: 8, y: 1 });
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
