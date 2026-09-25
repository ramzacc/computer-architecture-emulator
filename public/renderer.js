import { bitWidth, dimsOf, pinsFor, spec } from "./components.js";
import { edgeKey, evaluateBoard, wireSize } from "./model.js";

const CELL = 48;
const GAP = 3;
const WIRE_W = 4;
const U = 40;

export function wireTitle(wire, value) {
  return `${wireSize(wire)} bit(s), value ${value}`;
}

export function createRenderer(gridEl, getBoard, getSelectedIds, getSelectedWires) {
  function svgWrap(inner, s, r) {
    const q = ((r % 4) + 4) % 4;
    const vw = (q % 2 ? s.h : s.w) * U;
    const vh = (q % 2 ? s.w : s.h) * U;
    const transform = q === 1 ? `translate(${s.h * U},0) rotate(90)`
      : q === 2 ? `translate(${s.w * U},${s.h * U}) rotate(180)`
      : q === 3 ? `translate(0,${s.w * U}) rotate(270)`
      : null;
    const content = transform ? `<g transform="${transform}">${inner}</g>` : inner;
    return `<svg class="art" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">${content}</svg>`;
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

  function outputArt(c, color, value) {
    const stroke = "rgba(255,255,255,.55)";
    const stub = [
      [40, 8, 40, -1], // north
      [72, 40, 83, 40], // east
      [40, 72, 40, 83], // south
      [8, 40, -1, 40], // west
    ][((c.r ?? 0) % 4 + 4) % 4];
    const fontSize = String(value).length > 8 ? 11 : String(value).length > 6 ? 14 : String(value).length > 4 ? 19 : 24;
    return `<rect x="8" y="8" width="64" height="64" rx="7" fill="${color}" stroke="${stroke}" stroke-width="2"/>
      <text x="40" y="48" text-anchor="middle" fill="#102426" font-size="${fontSize}" font-weight="700">${value}</text>
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

  function componentArt(c, s, value = 0) {
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
    else if (s.shape === "output") inner = outputArt(c, s.color, value);
    else if (s.shape === "led") inner = ledArt();
    else inner = gateArt(s.shape, s.color);
    return svgWrap(inner, s, s.constant || s.shape === "output" ? 0 : c.r);
  }

  function renderComponents(logic = evaluateBoard(getBoard())) {
    const state = getBoard();
    const selectedIds = getSelectedIds();
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
      if (selectedIds.has(c.id)) el.classList.add("selected");
      const st = logic.states.get(c.id);
      if (c.t === "led") el.classList.toggle("lit", !!(st && st.lit));
      el.innerHTML = componentArt(c, s, st?.value ?? 0);
      el.title = `${s.label}  [${c.t}]  ${d.w}x${d.h}  ${bitWidth(c)} bit(s)${st && (c.t === "output" || st.value) ? "  value: " + st.value : ""}`;
      gridEl.appendChild(el);
    }
  }

  function renderPins() {
    const state = getBoard();
    gridEl.querySelectorAll(".pin").forEach((el) => el.remove());
    for (const c of state.components) {
      for (const p of pinsFor(c)) {
        const el = document.createElement("div");
        el.className = "pin " + p.role;
        el.style.left = p.px * CELL + "px";
        el.style.top = p.py * CELL + "px";
        if (p.name) el.title = `${p.name}: ${p.size} bit${p.size === 1 ? "" : "s"} (${p.role})`;
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

  function renderWires(logic = evaluateBoard(getBoard())) {
    const state = getBoard();
    const selectedWires = getSelectedWires();
    gridEl.querySelectorAll(".wire").forEach((el) => el.remove());
    const info = new Map();
    for (const net of logic.nets.values()) {
      for (const edge of net.edges) info.set(edgeKey(edge), { on: net.on, value: net.value, netId: net.id });
    }
    const selectedNetIds = new Set([...selectedWires].filter((key) => info.has(key)).map((key) => info.get(key).netId));
    for (const w of state.wires.values()) {
      const key = edgeKey(w);
      const i = info.get(key);
      const el = document.createElement("div");
      el.dataset.key = key;
      const selected = selectedNetIds.has(i.netId);
      el.className = "wire " + (i.on ? "on" : "off") + (wireSize(w) > 1 ? " bus" : "") + (selected ? " selected" : "");
      el.title = wireTitle(w, i.value);
      applyBox(el, edgeBox(w));
      gridEl.appendChild(el);
    }
  }

  return { componentArt, renderComponents, renderPins, renderWires, edgeBox, applyBox };
}
