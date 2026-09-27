import { bitWidth, channelCount, dimsOf, moduleFaceParts, modulePorts, pinsFor, spec } from "./components.js";
import { edgeKey, edgePoints, wireSize } from "./model.js";
import { formatValue } from "./value-format.js";

const CELL = 48;
const WIRE_W = 4;
const U = 40;

export function wireTitle(wire, value) {
  return `${wireSize(wire)} bit(s), value ${value}`;
}

export function createRenderer(gridEl, getBoard, getEvaluation, getSelectedIds, getSelectedWires) {
  const componentEls = new Map();
  const wireEls = new Map();
  const junctionEls = new Map();
  // Face states are Maps, so they need a Map-aware serialization to participate
  // in the render-caching signature.
  function stateSignature(st) {
    if (!st) return null;
    return JSON.stringify(st, (key, value) => value instanceof Map ? [...value] : value);
  }
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
  const ink = "var(--part-ink)";
  const muted = "var(--part-muted)";
  const surface = "var(--part-surface)";
  const border = "var(--part-border)";
  const recess = "var(--part-recess)";
  const display = "var(--part-display)";
  const displayBorder = "var(--part-display-border)";
  const segmentOn = "var(--part-segment-on)";
  const segmentOff = "var(--part-segment-off)";

  function partAccent(s) {
    if (s.splitter) return "var(--part-splitter)";
    if (s.register || s.rom || s.ram || s.counter || s.block || s.module) return "var(--part-memory)";
    if (s.op) return "var(--part-logic)";
    if (["output", "led", "sevenseg", "debugdisplay"].includes(s.shape)) return "var(--part-output)";
    return "var(--part-control)";
  }

  function textAt(x, y, value, size = 12, color = ink, weight = 600, anchor = "middle") {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" fill="${color}" font-family="Inter, system-ui, sans-serif" font-size="${size}" font-weight="${weight}">${value}</text>`;
  }

  function escapeText(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function displayName(c, fallback, limit) {
    const name = c.label?.trim() || fallback;
    return escapeText(name.length > limit ? `${name.slice(0, limit - 1)}…` : name);
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

  function numberArt(c, s, value, source) {
    const width = bitWidth(c), w = (width + 1) * U, h = 2 * U;
    const current = source ? c.value ?? 0 : value;
    const title = s.constant ? "CONST" : displayName(c, c.t === "input" ? "INPUT" : "OUTPUT", 11);
    const tiles = Array.from({ length: width }, (_, index) => {
      const bit = width - 1 - index;
      const on = (current >>> bit) & 1;
      const x = (index + 1) * U + 3;
      return `<g class="bit-tile${c.t === "input" ? " interactive" : ""}"${c.t === "input" ? ` data-bit="${bit}"` : ""}>
        <rect x="${x}" y="43" width="34" height="30" rx="5" fill="${on ? partAccent(s) : recess}" stroke="${on ? partAccent(s) : border}"/>
        ${textAt(x + 8, 58, bit, 8, on ? "var(--part-active-ink)" : muted, 650)}
        ${textAt(x + 23, 58, on, 16, on ? "var(--part-active-ink)" : ink, 750)}</g>`;
    }).join("");
    const formatted = formatValue(current, width, c.format);
    const base = frame(w, h, partAccent(s)) + textAt(w / 2, 16, title, 9, partAccent(s), 750) +
      textAt(w / 2, 31, escapeText(formatted), 7, muted, 650) + tiles +
      ports(actualPins(c), w, h, partAccent(s));
    return svgWrap(base, { w: width + 1, h: 2 }, 0);
  }

  function sourceArt(c, s, active) {
    const w = 80, h = 80;
    let graphic = "";
    if (s.shape === "button") {
      graphic = `<circle class="button-cap" cx="40" cy="48" r="15" fill="${active ? partAccent(s) : recess}" stroke="${partAccent(s)}" stroke-width="2"/>
        <circle cx="40" cy="48" r="5" fill="${active ? surface : partAccent(s)}"/>`;
    } else if (s.shape === "switch") {
      graphic = `<rect x="22" y="39" width="36" height="18" rx="9" fill="${recess}" stroke="${border}" stroke-width="1.5"/>
        <circle cx="${active ? 48 : 32}" cy="48" r="7" fill="${active ? partAccent(s) : muted}"/>`;
    } else {
      graphic = `<path d="M20 50 H31 V39 H46 V50 H60" fill="none" stroke="${partAccent(s)}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="57" cy="29" r="3" fill="${active ? partAccent(s) : muted}"/>`;
    }
    const name = s.shape === "switch" ? "SWITCH" : s.shape.toUpperCase();
    return svgWrap(frame(w, h, partAccent(s)) + textAt(40, 23, name, 9, partAccent(s), 750) + graphic +
      ports(actualPins(c), w, h, partAccent(s)), s, 0);
  }

  function portalArt(c, s) {
    const w = 120, h = 80;
    const inner = frame(w, h, partAccent(s)) +
      `<path d="M8 40 H25 L36 28 H106 L114 40 L106 52 H36 L25 40" fill="none" stroke="${partAccent(s)}" stroke-width="2"/>` +
      ports(localPins(c, s), w, h, partAccent(s));
    const d = dimsOf(c);
    return svgWrap(inner, s, c.r,
      textAt(d.w * U / 2, d.h * U / 2, displayName(c, "PORTAL", 12), 10, ink, 700));
  }

  function tagArt(c, s) {
    const w = 160, h = 80;
    const inner = frame(w, h, partAccent(s)) +
      `<path d="M10 40 H28" fill="none" stroke="${partAccent(s)}" stroke-width="2"/>` +
      ports(localPins(c, s), w, h, partAccent(s));
    const d = dimsOf(c);
    return svgWrap(inner, s, c.r,
      textAt(d.w * U / 2, d.h * U / 2, displayName(c, "TAG", 20), 13, ink, 700));
  }

  function ledArt(c, s) {
    return svgWrap(frame(80, 80, partAccent(s)) + textAt(40, 23, "LED", 9, partAccent(s), 750) +
      `<circle cx="40" cy="49" r="17" fill="${recess}" stroke="${border}" stroke-width="1.5"/>
       <circle class="led-lamp" cx="40" cy="49" r="10" fill="var(--part-lamp-off)"/>` +
      ports(actualPins(c), 80, 80, partAccent(s)), s, 0);
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
    return segmentPaths().map((path, i) => `<path d="${path}" fill="${inputs[i] ? segmentOn : segmentOff}"/>`).join("");
  }

  function sevenSegArt(c, s, inputs) {
    const d = dimsOf(c), w = d.w * U, h = d.h * U;
    const tx = (w - 240) / 2, ty = (h - 200) / 2;
    const displayArt = `<g transform="translate(${tx} ${ty})">
      <rect x="56" y="19" width="128" height="164" rx="8" fill="${display}" stroke="${displayBorder}" stroke-width="1"/>
      ${segments(inputs)}</g>`;
    const pins = actualPins(c);
    return svgWrap(frame(w, h, partAccent(s)) + displayArt + ports(pins, w, h, partAccent(s)) +
      portLabels(pins, w, h), d, 0);
  }

  function debugDisplayArt(c, s, value) {
    const patterns = ["1111110", "0110000", "1101101", "1111001", "0110011", "1011011", "1011111", "1110000",
      "1111111", "1111011", "1110111", "0011111", "1001110", "0111101", "1001111", "1000111"];
    const inputs = [...patterns[value & 15]].map(Number);
    const pins = actualPins(c);
    return svgWrap(frame(160, 160, partAccent(s)) + textAt(80, 146, "DBG", 9, partAccent(s), 750) +
      `<rect x="40" y="31" width="80" height="107" rx="7" fill="${display}" stroke="${displayBorder}" stroke-width="1"/>
       <g transform="translate(19 33) scale(.5)">${segments(inputs)}</g>` +
      ports(pins, 160, 160, partAccent(s)) + portLabels(pins, 160, 160), s, 0);
  }

  function chipArt(c, s) {
    const d = dimsOf({ ...c, r: 0 });
    const w = d.w * U, h = d.h * U;
    const rotated = dimsOf(c), rw = rotated.w * U, rh = rotated.h * U;
    const titles = { and: "AND", or: "OR", xor: "XOR", not: "NOT", nand: "NAND", nor: "NOR", xnor: "XNOR",
      mux: "MULTIPLEXER", demux: "DEMULTIPLEXER", adder: "ADDER", twos: "NEGATE", comparator: "COMPARATOR",
      shl: "SHIFT LEFT", shr: "SHIFT RIGHT", register: "REGISTER", rom: "ROM", ram: "RAM", counter: "COUNTER" };
    const glyphs = { and: "&amp;", or: "1+", xor: "=1", not: "!", nand: "&amp;", nor: "1+", xnor: "=1",
      mux: "MUX", demux: "DEMUX", adder: "+", twos: "-A", comparator: "A:B", shl: "&lt;&lt;", shr: "&gt;&gt;", register: "D / Q", rom: "ROM", ram: "RAM", counter: "+1" };
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
    const romName = c.t === "rom" && c.label?.trim();
    const glyph = textAt(rw / 2, glyphY, romName ? displayName(c, "ROM", 16) : glyphs[s.shape], romName ? 14 : symbolSize, ink, 650);
    const negation = ["nand", "nor", "xnor"].includes(s.shape)
      ? `<circle cx="${rw / 2 + (rw === 80 ? 19 : 31)}" cy="${glyphY - 1}" r="3" fill="${partAccent(s)}"/>` : "";
    const channel = ["mux", "demux"].includes(s.shape)
      ? textAt(rw / 2, titleY + 17, `${channelCount(c)} CHANNELS`, 9, muted, 650) : "";
    const labels = textAt(rw / 2, titleY, title, smallLabel, partAccent(s), 750) + glyph +
      negation + channel + portLabels(pins, rw, rh);
    return svgWrap(frame(w, h, partAccent(s)) + ports(localPins(c, s), w, h, partAccent(s)), d, c.r, labels);
  }

  function splitterArt(c, s) {
    const n = bitWidth(c), h = (n + 1) * U;
    const pins = localPins(c, s);
    const accent = partAccent(s);
    const branches = pins.filter((pin) => pin.role === "out").map((pin) =>
      `<path d="M40 ${pin.y * U} H80" stroke="${accent}" stroke-width="3" fill="none"/>` +
      `<circle cx="40" cy="${pin.y * U}" r="3" fill="${accent}"/>`).join("");
    const spine = `<path d="M40 0 V${n * U}" stroke="${accent}" stroke-width="6" fill="none" stroke-linecap="round"/>` +
      `<circle cx="40" cy="9" r="8" fill="${surface}" stroke="${accent}" stroke-width="4"/>`;
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
    return svgWrap(spine + branches + ports(pins, 80, h, accent),
      { w: 2, h: n + 1 }, c.r, bitLabels, "none");
  }

  function moduleArt(c, s, state) {
    const d = dimsOf(c), w = d.w * U, h = d.h * U;
    const pins = actualPins(c);
    const face = moduleFaceParts(c).flatMap((part) => {
      const placement = c.faceLayout?.find(([index]) => index === part.index);
      if (!placement) return [];
      const [, cellX, cellY] = placement;
      const x = cellX * U, y = cellY * U;
      const status = state?.faceStates?.get(part.id);
      const base = `<rect x="${x - 17}" y="${y - 17}" width="34" height="34" rx="5" fill="${display}" stroke="${displayBorder}"/>`;
      if (part.type === "led") return [base +
        `<circle cx="${x}" cy="${y}" r="10" fill="${status?.lit ? "var(--lamp-lit)" : "var(--part-lamp-off)"}"/>`];
      if (part.type === "sevenseg" || part.type === "debugdisplay") {
        const patterns = ["1111110", "0110000", "1101101", "1111001", "0110011", "1011011", "1011111", "1110000",
          "1111111", "1111011", "1110111", "0011111", "1001110", "0111101", "1001111", "1000111"];
        const bits = part.type === "sevenseg" ? status?.inputs ?? [] : [...patterns[(status?.value ?? 0) & 15]].map(Number);
        return [base + `<g transform="translate(${x - 21.6} ${y - 18}) scale(.18)">${segments(bits)}</g>`];
      }
      const label = part.label || "OUT";
      return [base + textAt(x, y - 10, escapeText(label.length > 5 ? `${label.slice(0, 4)}…` : label), 6, muted, 700) +
        textAt(x, y + 5, status?.value ?? 0, 12, ink, 750)];
    }).join("");
    return svgWrap(frame(w, h, partAccent(s)) + ports(pins, w, h, partAccent(s)) +
      textAt(w / 2, face ? 23 : h / 2 - 8, displayName(c, "Module", 18), 13, ink, 750) +
      (face ? face : textAt(w / 2, h / 2 + 12, "MODULE", 8, muted, 700)) +
      portLabels(pins, w, h), d, 0);
  }

  function componentArt(c, s, value = 0, inputs = [], state = null) {
    if (s.module) return moduleArt(c, s, state);
    if (s.splitter) return splitterArt(c, s);
    if (s.portal) return portalArt(c, s);
    if (s.tag) return tagArt(c, s);
    if (s.constant || s.input || s.output) return numberArt(c, s, value, !!(s.constant || s.input));
    if (["button", "switch", "clock"].includes(s.shape)) return sourceArt(c, s, value !== 0);
    if (s.shape === "led") return ledArt(c, s);
    if (s.shape === "sevenseg") return sevenSegArt(c, s, inputs);
    if (s.shape === "debugdisplay") return debugDisplayArt(c, s, value);
    return chipArt(c, s);
  }

  function renderComponents(logic = getEvaluation()) {
    const state = getBoard();
    const selectedIds = getSelectedIds();
    const present = new Set();
    for (const c of state.components) {
      const s = spec(c.t);
      const d = dimsOf(c);
      if (!s || !d) continue;
      present.add(c.id);
      const st = logic.states.get(c.id);
      let entry = componentEls.get(c.id);
      if (!entry) {
        const el = document.createElement("div");
        el.dataset.id = c.id;
        gridEl.appendChild(el);
        entry = { el, signature: null };
        componentEls.set(c.id, entry);
      }
      const { el } = entry;
      const signature = JSON.stringify(c) + stateSignature(st);
      if (signature !== entry.signature) {
        entry.signature = signature;
        el.style.left = c.x * CELL + "px";
        el.style.top = c.y * CELL + "px";
        // The SVG and pins must span the same lattice footprint.
        el.style.width = d.w * CELL + "px";
        el.style.height = d.h * CELL + "px";
        el.innerHTML = componentArt(c, s, st?.value ?? 0, st?.inputs ?? [], st);
        el.title = `${c.label || s.label}  [${c.t}]  ${d.w}x${d.h}  ${s.module ? `${modulePorts(c).filter((p) => p.role === "in").length} inputs, ${modulePorts(c).filter((p) => p.role === "out").length} outputs` : `${bitWidth(c)} bit(s)`}${c.t === "clock" ? `  ${c.frequency ?? 1} Hz  ${c.enable === false ? "disabled" : "enabled"}` : ""}${c.t === "mux" || c.t === "demux" ? `  ${channelCount(c)} channels` : ""}${c.t === "constant" || c.t === "input" ? "  value: " + formatValue(c.value ?? 0, bitWidth(c), c.format) : st && (["output", "debugdisplay"].includes(c.t) || st.value) ? "  value: " + (["output", "debugdisplay"].includes(c.t) ? formatValue(st.value, bitWidth(c), c.t === "debugdisplay" ? "hex" : c.format) : st.value) : ""}`;
      }
      const className = "comp shaped" + (["button", "switch"].includes(c.t) || s.splitter ? ` ${c.t}` : "") +
        (selectedIds.has(c.id) ? " selected" : "") + (c.t === "button" && st?.value === 1 ? " pressed" : "") +
        (c.t === "led" && st?.lit ? " lit" : "");
      if (el.className !== className) el.className = className;
    }
    for (const [id, entry] of componentEls) if (!present.has(id)) {
      entry.el.remove();
      componentEls.delete(id);
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
    const presentWires = new Set();
    const presentJunctions = new Set();
    const info = new Map();
    for (const net of logic.nets.values()) {
      for (const edge of net.edges) info.set(edgeKey(edge), { on: net.on, value: net.value, netId: net.id });
    }
    const selectedNetIds = new Set([...selectedWires].filter((key) => info.has(key)).map((key) => info.get(key).netId));
    for (const w of state.wires.values()) {
      const key = edgeKey(w);
      presentWires.add(key);
      const i = info.get(key);
      let entry = wireEls.get(key);
      if (!entry) {
        const el = document.createElement("div");
        el.dataset.key = key;
        gridEl.appendChild(el);
        entry = { el, size: null };
        wireEls.set(key, entry);
      }
      const { el } = entry;
      const selected = selectedNetIds.has(i.netId);
      const className = "wire " + (i.on ? "on" : "off") + (wireSize(w) > 1 ? " bus" : "") + (selected ? " selected" : "");
      if (el.className !== className) el.className = className;
      const title = wireTitle(w, i.value);
      if (el.title !== title) el.title = title;
      if (entry.size !== wireSize(w)) {
        applyBox(el, edgeBox(w));
        entry.size = wireSize(w);
      }
    }
    for (const [key, entry] of wireEls) if (!presentWires.has(key)) {
      entry.el.remove();
      wireEls.delete(key);
    }
    const points = new Map();
    for (const wire of state.wires.values()) for (const [x, y] of edgePoints(wire)) {
      const key = `${x},${y}`;
      if (!points.has(key)) points.set(key, []);
      points.get(key).push(wire);
    }
    for (const [point, wires] of points) {
      if (wires.length < 3 || !wires.some((wire) => wire.o === "H") ||
          !wires.some((wire) => wire.o === "V") ||
          (wires.length === 4 && !state.junctions?.has(point))) continue;
      const [x, y] = point.split(",").map(Number);
      const net = info.get(edgeKey(wires[0]));
      presentJunctions.add(point);
      let el = junctionEls.get(point);
      if (!el) {
        el = document.createElement("div");
        el.style.left = x * CELL + "px";
        el.style.top = y * CELL + "px";
        gridEl.appendChild(el);
        junctionEls.set(point, el);
      }
      const className = "wire-junction " + (net?.on ? "on" : "off") +
        (selectedNetIds.has(net?.netId) ? " selected" : "");
      if (el.className !== className) el.className = className;
    }
    for (const [point, el] of junctionEls) if (!presentJunctions.has(point)) {
      el.remove();
      junctionEls.delete(point);
    }
  }

  return { componentArt, renderComponents, renderPins, renderWires, edgeBox, applyBox };
}
