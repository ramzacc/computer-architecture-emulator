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
  function svgWrap(inner, s, r, overlay = "", aspectRatio = "xMidYMid meet") {
    const q = ((r % 4) + 4) % 4;
    const vw = (q % 2 ? s.h : s.w) * U;
    const vh = (q % 2 ? s.w : s.h) * U;
    const transform = q === 1 ? `translate(${s.h * U},0) rotate(90)`
      : q === 2 ? `translate(${s.w * U},${s.h * U}) rotate(180)`
      : q === 3 ? `translate(0,${s.w * U}) rotate(270)`
      : null;
    const content = transform ? `<g transform="${transform}">${inner}</g>` : inner;
    return `<svg class="art" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="${aspectRatio}">${content}${overlay}</svg>`;
  }

  // All parts share the same chassis and edge connection treatment. Geometry
  // stays on the model's lattice so existing boards and rotations still align.
  const ink = "#e8e9ec";
  const muted = "#a0a3ab";
  const surface = "#202126";
  const border = "#555861";

  function textAt(x, y, value, size = 12, color = ink, weight = 600, anchor = "middle") {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" fill="${color}" font-family="Inter, system-ui, sans-serif" font-size="${size}" font-weight="${weight}">${value}</text>`;
  }

  function frame(w, h, color) {
    return `<rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="10" fill="${surface}" stroke="${border}" stroke-width="1.5"/>
      <path d="M16 7 H${w - 16}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity=".9"/>`;
  }

  function ports(pins, w, h, color) {
    return pins.map((pin) => {
      const x = pin.x * U, y = pin.y * U;
      const line = pin.dir === "N" ? `<path d="M${x} 0 V7"/>`
        : pin.dir === "S" ? `<path d="M${x} ${h - 7} V${h}"/>`
        : pin.dir === "E" ? `<path d="M${w - 7} ${y} H${w}"/>`
        : `<path d="M0 ${y} H7"/>`;
      return `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round">${line}</g>`;
    }).join("");
  }

  function localPins(c, s) {
    return pinsFor({ ...c, x: 0, y: 0, r: 0 }).map((pin) =>
      ({ x: pin.px, y: pin.py, dir: pin.dir, role: pin.role, name: pin.name, bit: pin.bit }));
  }

  function actualPins(c) {
    const x = c.x ?? 0, y = c.y ?? 0;
    return pinsFor({ ...c, x, y }).map((pin) => ({
      x: pin.px - x, y: pin.py - y, dir: pin.dir,
      role: pin.role, name: pin.name, bit: pin.bit,
    }));
  }

  function portLabels(pins, w, h) {
    return pins.filter((pin) => pin.name).map((pin) => {
      const x = pin.x * U, y = pin.y * U;
      const size = pin.name.length > 2 ? 9 : 10;
      if (pin.dir === "N") return textAt(x, 19, pin.name, size, muted, 700);
      if (pin.dir === "S") return textAt(x, h - 17, pin.name, size, muted, 700);
      if (pin.dir === "E") return textAt(w - 17, y, pin.name, size, muted, 700, "end");
      return textAt(17, y, pin.name, size, muted, 700, "start");
    }).join("");
  }

  function valueLines(value, width = 8) {
    if (value.length <= width) return [value];
    if (value.startsWith("0b")) return (value.slice(2).match(/.{1,8}/g) ?? []).map((part, i) => i ? part : `0b${part}`);
    return [value];
  }

  function numberArt(c, s, value, source) {
    const w = 80, h = 80;
    const formatted = formatValue(source ? (c.value ?? 0) : value, bitWidth(c), c.format);
    const lines = valueLines(formatted);
    const font = lines.length > 1 ? 10 : formatted.length > 8 ? 10 : formatted.length > 6 ? 13 : formatted.length > 4 ? 17 : 22;
    const lineHeight = 12;
    const firstY = 48 - (lines.length - 1) * lineHeight / 2;
    const label = source ? "CONST" : "OUTPUT";
    const values = lines.map((line, i) => textAt(40, firstY + i * lineHeight, line, font, ink, 650)).join("");
    // Number displays remain upright when rotated; ports are drawn in their
    // actual direction rather than rotating the text with the body.
    const actual = actualPins(c);
    return svgWrap(frame(w, h, s.color) + textAt(40, 23, label, 9, s.color, 750) + values +
      ports(actual, w, h, s.color), s, 0);
  }

  function sourceArt(c, s, active) {
    const w = 80, h = 80;
    let graphic = "";
    if (s.shape === "button") {
      graphic = `<circle class="button-cap" cx="40" cy="48" r="15" fill="${active ? s.color : "#3b3d45"}" stroke="${s.color}" stroke-width="2"/>
        <circle cx="40" cy="48" r="5" fill="${active ? surface : s.color}"/>`;
    } else if (s.shape === "switch") {
      graphic = `<rect x="22" y="39" width="36" height="18" rx="9" fill="#141519" stroke="${border}" stroke-width="1.5"/>
        <circle cx="${active ? 48 : 32}" cy="48" r="7" fill="${active ? s.color : muted}"/>`;
    } else {
      graphic = `<path d="M20 50 H31 V39 H46 V50 H60" fill="none" stroke="${s.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="57" cy="29" r="3" fill="${active ? s.color : muted}"/>`;
    }
    const name = s.shape === "switch" ? "SWITCH" : s.shape.toUpperCase();
    return svgWrap(frame(w, h, s.color) + textAt(40, 23, name, 9, s.color, 750) + graphic +
      ports(actualPins(c), w, h, s.color), s, 0);
  }

  function ledArt(c, s) {
    return svgWrap(frame(80, 80, s.color) + textAt(40, 23, "LED", 9, s.color, 750) +
      `<circle cx="40" cy="49" r="17" fill="#141519" stroke="${border}" stroke-width="1.5"/>
       <circle class="led-lamp" cx="40" cy="49" r="10" fill="#5e6068"/>` +
      ports(actualPins(c), 80, 80, s.color), s, 0);
  }

  function segmentPaths() {
    return [
      "M86 20 H154 L145 31 H95 Z", "M161 27 L171 36 V91 L160 99 L152 90 V39 Z",
      "M160 102 L171 110 V164 L161 173 L152 161 V112 Z", "M95 169 H145 L154 180 H86 Z",
      "M79 102 L88 112 V161 L79 173 L69 164 V110 Z", "M79 27 L88 39 V90 L80 99 L69 91 V36 Z",
      "M91 95 H149 L159 100 L149 105 H91 L81 100 Z",
    ];
  }

  function segments(inputs) {
    return segmentPaths().map((path, i) => `<path d="${path}" fill="${inputs[i] ? "#f2bb85" : "#3b3840"}"/>`).join("");
  }

  function sevenSegArt(c, s, inputs) {
    const d = dimsOf(c), w = d.w * U, h = d.h * U;
    const tx = (w - 240) / 2, ty = (h - 200) / 2;
    const display = `<g transform="translate(${tx} ${ty})">
      <rect x="56" y="19" width="128" height="164" rx="8" fill="#17181d" stroke="#44464e" stroke-width="1"/>
      ${segments(inputs)}</g>`;
    const pins = actualPins(c);
    return svgWrap(frame(w, h, s.color) + display + ports(pins, w, h, s.color) +
      portLabels(pins, w, h), d, 0);
  }

  function debugDisplayArt(c, s, value) {
    const patterns = ["1111110", "0110000", "1101101", "1111001", "0110011", "1011011", "1011111", "1110000",
      "1111111", "1111011", "1110111", "0011111", "1001110", "0111101", "1001111", "1000111"];
    const inputs = [...patterns[value & 15]].map(Number);
    const pins = actualPins(c);
    return svgWrap(frame(160, 160, s.color) + textAt(80, 146, "DBG", 9, s.color, 750) +
      `<rect x="40" y="31" width="80" height="107" rx="7" fill="#17181d" stroke="#44464e" stroke-width="1"/>
       <g transform="translate(19 33) scale(.5)">${segments(inputs)}</g>` +
      ports(pins, 160, 160, s.color) + portLabels(pins, 160, 160), s, 0);
  }

  function chipArt(c, s) {
    const d = dimsOf({ ...c, r: 0 });
    const w = d.w * U, h = d.h * U;
    const rotated = dimsOf(c), rw = rotated.w * U, rh = rotated.h * U;
    const titles = { and: "AND", or: "OR", xor: "XOR", not: "NOT", nand: "NAND", nor: "NOR", xnor: "XNOR",
      mux: "MULTIPLEXER", demux: "DEMULTIPLEXER", adder: "ADDER", twos: "NEGATE", comparator: "COMPARATOR",
      shl: "SHIFT LEFT", shr: "SHIFT RIGHT", register: "REGISTER" };
    const glyphs = { and: "&amp;", or: "1+", xor: "=1", not: "!", nand: "&amp;", nor: "1+", xnor: "=1",
      mux: "MUX", demux: "DEMUX", adder: "+", twos: "-A", comparator: "A:B", shl: "&lt;&lt;", shr: "&gt;&gt;", register: "D / Q" };
    const title = titles[s.shape];
    const pins = actualPins(c);
    const sideRows = [...new Set(pins.filter((pin) => pin.name && (pin.dir === "E" || pin.dir === "W"))
      .map((pin) => pin.y * U))].sort((a, b) => a - b);
    // Put the central label block between named side ports when the rotated
    // footprint is tall enough to provide a clear row.
    const rows = [0, ...sideRows, rh];
    const gaps = rows.slice(1).map((end, i) => ({
      center: (rows[i] + end) / 2,
      size: end - rows[i],
    }));
    const clearGap = gaps.filter((gap) => gap.size >= 70)
      .sort((a, b) => Math.abs(a.center - rh / 2) - Math.abs(b.center - rh / 2))[0];
    const labelCenter = rh > rw && clearGap ? clearGap.center : rh / 2;
    const isCompact = rh === 80;
    const titleY = isCompact ? 27 : labelCenter - 25;
    const glyphY = isCompact ? 52 : labelCenter + 18;
    const symbolSize = rw === 80 ? 20 : isCompact ? 22 : 25;
    const smallLabel = rw <= 120 && title.length >= 11 ? 8 : title.length > 11 ? 9 : 10;
    const glyph = textAt(rw / 2, glyphY, glyphs[s.shape], symbolSize, ink, 650);
    const negation = ["nand", "nor", "xnor"].includes(s.shape)
      ? `<circle cx="${rw / 2 + (rw === 80 ? 19 : 31)}" cy="${glyphY - 1}" r="3" fill="${s.color}"/>` : "";
    const channel = ["mux", "demux"].includes(s.shape)
      ? textAt(rw / 2, titleY + 17, `${channelCount(c)} CHANNELS`, 9, muted, 650) : "";
    const labels = textAt(rw / 2, titleY, title, smallLabel, s.color, 750) + glyph +
      negation + channel + portLabels(pins, rw, rh);
    return svgWrap(frame(w, h, s.color) + ports(localPins(c, s), w, h, s.color), d, c.r, labels);
  }

  function splitterArt(c, s) {
    const n = bitWidth(c), h = (n + 1) * U;
    const pins = localPins(c, s);
    const branches = pins.filter((pin) => pin.role === "out").map((pin) =>
      `<path d="M40 ${pin.y * U} H80" stroke="${s.color}" stroke-width="2" fill="none"/>` +
      `<circle cx="40" cy="${pin.y * U}" r="3" fill="${s.color}"/>`).join("");
    const spine = `<path d="M40 0 V${n * U}" stroke="${s.color}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    const d = dimsOf(c), rw = d.w * U, rh = d.h * U;
    const bitLabels = actualPins(c).filter((pin) => pin.role === "out").map((pin) => {
      const x = pin.x * U, y = pin.y * U;
      if (pin.dir === "N") return textAt(x, rh - 20, pin.bit, 10, ink, 700);
      if (pin.dir === "S") return textAt(x, 20, pin.bit, 10, ink, 700);
      if (pin.dir === "E") return textAt(20, y, pin.bit, 10, ink, 700);
      return textAt(rw - 20, y, pin.bit, 10, ink, 700);
    }).join("");
    // The rail reaches lattice points at the SVG edges; stretching it to the
    // full component footprint keeps those endpoints on the model's pins.
    return svgWrap(spine + branches + ports(pins, 80, h, s.color),
      { w: 2, h: n + 1 }, c.r, bitLabels, "none");
  }

  function componentArt(c, s, value = 0, inputs = []) {
    if (s.splitter) return splitterArt(c, s);
    if (s.constant || s.output) return numberArt(c, s, value, !!s.constant);
    if (["button", "switch", "clock"].includes(s.shape)) return sourceArt(c, s, value !== 0);
    if (s.shape === "led") return ledArt(c, s);
    if (s.shape === "sevenseg") return sevenSegArt(c, s, inputs);
    if (s.shape === "debugdisplay") return debugDisplayArt(c, s, value);
    return chipArt(c, s);
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
      el.className = "comp shaped" + (["button", "switch"].includes(c.t) || s.splitter ? ` ${c.t}` : "");
      el.dataset.id = c.id;
      el.style.left = c.x * CELL + "px";
      el.style.top = c.y * CELL + "px";
      el.style.width = d.w * CELL - (s.splitter ? 0 : GAP) + "px";
      el.style.height = d.h * CELL - (s.splitter ? 0 : GAP) + "px";
      if (selectedIds.has(c.id)) el.classList.add("selected");
      const st = logic.states.get(c.id);
      if (c.t === "button") el.classList.toggle("pressed", st?.value === 1);
      if (c.t === "led") el.classList.toggle("lit", !!(st && st.lit));
      el.innerHTML = componentArt(c, s, st?.value ?? 0, st?.inputs ?? []);
      el.title = `${s.label}  [${c.t}]  ${d.w}x${d.h}  ${bitWidth(c)} bit(s)${c.t === "clock" ? `  ${c.frequency ?? 1} Hz` : ""}${c.t === "mux" || c.t === "demux" ? `  ${channelCount(c)} channels` : ""}${c.t === "constant" ? "  value: " + formatValue(c.value ?? 0, bitWidth(c), c.format) : st && (["output", "debugdisplay"].includes(c.t) || st.value) ? "  value: " + (["output", "debugdisplay"].includes(c.t) ? formatValue(st.value, bitWidth(c), c.t === "debugdisplay" ? "hex" : c.format) : st.value) : ""}`;
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
