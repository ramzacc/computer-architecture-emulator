import { bitWidth, channelCount, dimsOf, pinsFor, spec } from "./components.js";
import { edgeKey, wireSize } from "./model.js";
import { formatValue } from "./value-format.js";

const CELL = 48;
const GAP = 3;
const WIRE_W = 4;
const U = 40;

export function wireTitle(wire, value) {
  return `${wireSize(wire)} bit(s), value ${value}`;
}

export function createRenderer(gridEl, getBoard, getEvaluation, getSelectedIds, getSelectedWires) {
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

  function buttonArt(color, pressed) {
    const stroke = "rgba(255,255,255,.55)";
    return `<rect x="9" y="9" width="62" height="62" rx="12" fill="#473826" stroke="${stroke}" stroke-width="2"/>
      <circle class="button-cap" cx="40" cy="38" r="23" fill="${pressed ? "#ffd58b" : color}" stroke="${stroke}" stroke-width="2"/>
      <circle cx="40" cy="38" r="9" fill="#473826" opacity=".5"/>
      <line x1="40" y1="70" x2="40" y2="81" stroke="${stroke}" stroke-width="2"/>`;
  }

  function switchArt(color, high) {
    const stroke = "rgba(255,255,255,.6)";
    return `<rect x="8" y="8" width="64" height="64" rx="10" fill="#20362e" stroke="${stroke}" stroke-width="2"/>
      <rect x="23" y="16" width="34" height="48" rx="9" fill="#11241c"/>
      <rect x="26" y="${high ? 19 : 39}" width="28" height="22" rx="6" fill="${high ? "#adf3c6" : color}" stroke="${stroke}" stroke-width="2"/>
      <line x1="40" y1="72" x2="40" y2="81" stroke="${stroke}" stroke-width="2"/>`;
  }

  function clockArt(color, high) {
    const stroke = "rgba(255,255,255,.55)";
    return `<rect x="8" y="8" width="64" height="64" rx="10" fill="${high ? "#a9eaff" : color}" stroke="${stroke}" stroke-width="2"/>
      <path d="M17 48 H30 V28 H49 V48 H63" fill="none" stroke="#102426" stroke-width="4" stroke-linejoin="round"/>
      <line x1="40" y1="72" x2="40" y2="81" stroke="${stroke}" stroke-width="2"/>`;
  }

  function ledArt() {
    const stroke = "rgba(255,255,255,.4)";
    return `<rect class="led-body" x="4" y="4" width="72" height="72" fill="#5a5a7a" stroke="${stroke}" stroke-width="2"/>`;
  }

  function constantArt(c, color) {
    const value = formatValue(c.value ?? 0, bitWidth(c), c.format);
    const stroke = "rgba(255,255,255,.55)";
    const stub = [
      [40, 72, 40, 83], // south
      [8, 40, -1, 40],  // west
      [40, 8, 40, -1],  // north
      [72, 40, 83, 40], // east
    ][((c.r ?? 0) % 4 + 4) % 4];
    const fontSize = value.length > 8 ? 11 : value.length > 6 ? 14 : value.length > 4 ? 19 : 24;
    return `<rect x="8" y="8" width="64" height="64" rx="7" fill="${color}" stroke="${stroke}" stroke-width="2"/>
      <text x="40" y="45" text-anchor="middle" dominant-baseline="middle" fill="#14161a" font-size="${fontSize}" font-weight="700">${value}</text>
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
    const label = formatValue(value, bitWidth(c), c.format);
    const lines = c.format === "binary" && label.length > 10
      ? (label.slice(2).match(/.{1,8}/g) ?? []).map((chunk, index) => `${index === 0 ? "0b" : ""}${chunk}`)
      : [label];
    const fontSize = lines.length > 1 ? 11 : label.length > 8 ? 11 : label.length > 6 ? 14 : label.length > 4 ? 19 : 24;
    const lineHeight = lines.length > 1 ? 13 : 0;
    const startY = lines.length > 1 ? 40 - (lines.length - 1) * lineHeight / 2 : 45;
    const text = lines.map((line, index) => `<text x="40" y="${startY + index * lineHeight}" text-anchor="middle" dominant-baseline="middle" fill="#102426" font-size="${fontSize}" font-weight="700">${line}</text>`).join("");
    return `<rect x="8" y="8" width="64" height="64" rx="7" fill="${color}" stroke="${stroke}" stroke-width="2"/>
      ${text}
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
      if (shape === "xor" || shape === "xnor") {
        body += `<path d="M18 10 Q72 28 126 10" fill="none" stroke="${stroke}" stroke-width="2"/>`;
      }
    }
    const stubs = `
      <line x1="40" y1="0" x2="40" y2="18" stroke="${stroke}" stroke-width="2"/>
      <line x1="120" y1="0" x2="120" y2="18" stroke="${stroke}" stroke-width="2"/>`;
    let out = "";
    if (shape === "nand" || shape === "nor" || shape === "xnor") {
      out = `<circle cx="80" cy="74" r="6" fill="${color}" stroke="${stroke}" stroke-width="2"/>`;
    } else if (shape === "and") {
      out = `<line x1="80" y1="68" x2="80" y2="80" stroke="${stroke}" stroke-width="2"/>`;
    }
    return body + stubs + out;
  }

  function blockArt(s, c) {
    if (s.shape === "mux" || s.shape === "demux") return plexerArt(c, s);
    const symbols = { adder: "+", twos: "−A", comparator: "CMP", shl: "≪", shr: "≫" };
    const width = s.w * U, height = s.h * U;
    const font = s.w === 2 ? 23 : 26;
    const labels = s.pins.map((pin) => {
      const x = pin.x * U;
      const y = pin.role === "in" ? 26 : height - 14;
      return `<text x="${x}" y="${y}" text-anchor="middle" fill="#102426" font-size="12" font-weight="700">${pin.name}</text>`;
    }).join("");
    return `<rect x="7" y="7" width="${width - 14}" height="${height - 14}" rx="10" fill="${s.color}" stroke="rgba(255,255,255,.55)" stroke-width="2"/>
      <text x="${width / 2}" y="${height / 2 + 8}" text-anchor="middle" fill="#102426" font-size="${font}" font-weight="700">${symbols[s.shape]}</text>${labels}`;
  }

  function plexerArt(c, s) {
    const width = dimsOf({ ...c, r: 0 }).w * U, height = s.h * U;
    const mux = s.shape === "mux";
    const leftTop = mux ? 13 : width * .27;
    const rightTop = width - leftTop;
    const leftBottom = mux ? width * .27 : 13;
    const rightBottom = width - leftBottom;
    const stroke = "#dcecf1";
    // The tapered outline is the usual schematic cue: many channels converge
    // on one output for a mux, and one input fans out for a demux.
    const outline = `<path d="M${leftTop} 33 H${rightTop} L${rightBottom} ${height - 31} H${leftBottom} Z"
      fill="${s.color}" fill-opacity=".22" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`;
    const cx = width / 2;
    const glyph = mux
      ? `<path d="M${cx - 20} 50 L${cx} 78 M${cx + 20} 50 L${cx} 78 M${cx} 78 V${height - 42}"/>`
      : `<path d="M${cx} 43 V63 M${cx} 63 L${cx - 18} ${height - 43} M${cx} 63 L${cx + 18} ${height - 43}"/>`;
    const flow = `<g fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`;
    const labels = pinsFor({ ...c, x: 0, y: 0, r: 0 }).map((pin) => `<text x="${pin.px * U}" y="${pin.role === "in" ? 21 : height - 10}"
      text-anchor="middle" fill="${stroke}" font-size="11" font-weight="700">${pin.name}</text>`).join("");
    return outline + flow + labels;
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
    if (s.shape === "button") inner = buttonArt(s.color, value !== 0);
    else if (s.shape === "switch") inner = switchArt(s.color, value !== 0);
    else if (s.shape === "clock") inner = clockArt(s.color, value !== 0);
    else if (s.shape === "constant") inner = constantArt(c, s.color);
    else if (s.shape === "output") inner = outputArt(c, s.color, value);
    else if (s.shape === "led") inner = ledArt();
    else if (s.block) inner = blockArt(s, c);
    else inner = gateArt(s.shape, s.color);
    return svgWrap(inner, s.shape === "mux" || s.shape === "demux" ? dimsOf({ ...c, r: 0 }) : s,
      s.constant || s.shape === "output" ? 0 : c.r);
  }

  function renderComponents(logic = getEvaluation()) {
    const state = getBoard();
    const selectedIds = getSelectedIds();
    gridEl.querySelectorAll(".comp").forEach((el) => el.remove());
    for (const c of state.components) {
      const s = spec(c.t);
      const d = dimsOf(c);
      if (!s || !d) continue;
      const el = document.createElement("div");
      el.className = "comp shaped" + (["button", "switch"].includes(c.t) ? ` ${c.t}` : "");
      el.dataset.id = c.id;
      el.style.left = c.x * CELL + "px";
      el.style.top = c.y * CELL + "px";
      el.style.width = d.w * CELL - GAP + "px";
      el.style.height = d.h * CELL - GAP + "px";
      if (selectedIds.has(c.id)) el.classList.add("selected");
      const st = logic.states.get(c.id);
      if (c.t === "button") el.classList.toggle("pressed", st?.value === 1);
      if (c.t === "led") el.classList.toggle("lit", !!(st && st.lit));
      el.innerHTML = componentArt(c, s, st?.value ?? 0);
      el.title = `${s.label}  [${c.t}]  ${d.w}x${d.h}  ${bitWidth(c)} bit(s)${c.t === "clock" ? `  ${c.frequency ?? 1} Hz` : ""}${c.t === "mux" || c.t === "demux" ? `  ${channelCount(c)} channels` : ""}${c.t === "constant" ? "  value: " + formatValue(c.value ?? 0, bitWidth(c), c.format) : st && (c.t === "output" || st.value) ? "  value: " + (c.t === "output" ? formatValue(st.value, bitWidth(c), c.format) : st.value) : ""}`;
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

  function renderWires(logic = getEvaluation()) {
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
