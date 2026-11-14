import { addressWidth, bitWidth } from "../core/components.js";
import { assemble, disassemble, parseIsa, sourceLineAddresses } from "../core/assembly.js";
import { restoreProgramSource } from "../core/program-source.js";
import { formatValue } from "../core/value-format.js";
import { ctx } from "./context.js";
import { byIds, el } from "./dom.js";
import { exportIsaDrafts, renderIsaRules, resetIsa, restoreIsaDrafts } from "./isa-editor.js";
import { createRamViewer } from "./ram-view.js";

const fields = { rom: "rom", ram: "ram", pc: "tag", run: "clock", step: "button", resetPc: "button", resetRegisters: "button" };
const names = { rom: "Program ROM", pc: "PC", run: "Main Clock", step: "Manual Clock", resetPc: "Reset PC", resetRegisters: "Reset Registers" };

const $ = byIds(
  "program-rom", "program-ram", "program-pc", "program-run", "program-step",
  "program-reset-pc", "program-reset-registers", "program-register-options",
  "program-add-register", "program-register-empty", "program-register-values",
  "program-format", "program-status", "program-source", "program-syntax-content",
  "program-gutter", "program-gutter-lines", "program-current-line",
  "program-assembly-note", "program-save-rom", "program-ram-view", "program-play",
  "program-pause", "program-step-button", "program-reset", "program-clear-breakpoints",
  "program-pc-value",
);
const selectEls = { rom: $.programRom, ram: $.programRam, pc: $.programPc, run: $.programRun,
  step: $.programStep, resetPc: $.programResetPc, resetRegisters: $.programResetRegisters };
const drafts = new Map();
let draftBoard = null;
let renderedEditor = null;
let renderedComponents = "";
let renderedConfig = "";
let renderedRegisters = "";
let renderedRamId = null;
const previousRegisterValues = new Map();
const registerHighlightTimers = new Map();
let defaultConfig = null;
let defaultBoard = null;
let lastPcLine = null;
let renderedSyntax = "";
const breakpoints = new Map();
let skipBreakpointAt = null;
let ramFormat = "hex";

const ramViewer = createRamViewer($.programRamView, {
  getEditor: () => ctx.editor,
  getRam: () => {
    const item = component(programConfig().ram);
    return item?.t === "ram" ? item : null;
  },
  getFormat: () => ramFormat,
  setFormat: (value) => { ramFormat = value; },
  emptyMessage: "Link a RAM in Program setup to view its memory.",
});

const components = () => ctx.editor.board.components;
const component = (id) => components().find((item) => item.id === id);
const activeRom = () => {
  const item = component(programConfig().rom);
  return item?.t === "rom" ? item : null;
};
const savedIsa = (rom) => programConfig().isa?.[rom.id] ?? "";

export function programConfig() {
  const board = ctx.editor.board;
  if (board.program) return board.program;
  if (defaultBoard !== board) {
    defaultBoard = board;
    defaultConfig = Object.fromEntries(Object.keys(fields).map((key) =>
      [key, key === "ram" ? null : components().find((item) => item.label === names[key] && [].concat(fields[key]).includes(item.t))?.id ?? null]));
    defaultConfig.registers = [];
    defaultConfig.offset = 0;
    defaultConfig.format = "hex";
  }
  return defaultConfig;
}

export function patchProgramConfig(patch) { ctx.editor.setProgramConfig({ ...programConfig(), ...patch }); }

function status(message, error = false) {
  $.programStatus.textContent = message;
  $.programStatus.classList.toggle("error", error);
}

function romKey(rom) {
  return JSON.stringify([rom.id, bitWidth(rom), addressWidth(rom), rom.data ?? [], savedIsa(rom), programConfig().sources?.[rom.id]]);
}

function savedSource(rom) {
  const source = programConfig().sources?.[rom.id];
  return source ? restoreProgramSource(source, rom.data ?? [], addressWidth(rom), bitWidth(rom), savedIsa(rom))
    : disassemble(rom.data ?? [], bitWidth(rom), savedIsa(rom));
}

function assemblyDraft(rom) {
  if (!rom) return null;
  let draft = drafts.get(rom.id);
  if (!draft) {
    draft = { text: savedSource(rom), key: romKey(rom), dirty: false };
    drafts.set(rom.id, draft);
  }
  return draft;
}

function isPlaying() {
  const run = component(programConfig().run);
  return run?.t === "clock" && run.enable !== false;
}

function updateAssembly() {
  const rom = activeRom();
  const draft = assemblyDraft(rom);
  const locked = isPlaying();
  $.programSource.disabled = !rom || locked;
  $.programSaveRom.disabled = !rom || locked || !draft?.dirty;
  if (!rom) {
    $.programSource.value = "";
    $.programSyntaxContent.replaceChildren();
    renderedSyntax = "";
    $.programGutterLines.replaceChildren();
    $.programGutter.dataset.key = "";
    $.programCurrentLine.hidden = true;
    $.programClearBreakpoints.disabled = ![...breakpoints.values()].some((items) => items.size);
    $.programAssemblyNote.textContent = "Link a ROM in Program setup.";
    return;
  }
  const key = romKey(rom);
  if (!draft.dirty && draft.key !== key) {
    draft.text = savedSource(rom);
    draft.key = key;
  }
  if ($.programSource.dataset.rom !== rom.id || $.programSource.value !== draft.text) $.programSource.value = draft.text;
  $.programSource.dataset.rom = rom.id;
  updateSyntax();
  updateGutter();
  $.programAssemblyNote.textContent = draft.dirty
    ? draft.key === key ? "Unsaved assembly edits." : "ROM or assembly rules changed since this draft. Assembling will replace ROM contents."
    : "Assembly matches the linked ROM.";
}

function updateSyntax() {
  const rom = activeRom();
  const isaSource = rom ? savedIsa(rom) : "";
  const key = JSON.stringify([$.programSource.value, isaSource, rom ? bitWidth(rom) : 0]);
  if (key === renderedSyntax) return;
  renderedSyntax = key;
  const keywords = new Set([".WORD"]);
  try {
    for (const rule of parseIsa(isaSource, bitWidth(rom))) keywords.add(rule.keyword);
  } catch { /* Keep the source editable while ISA rules are invalid. */ }
  const fragment = document.createDocumentFragment();
  const append = (text, className) => {
    if (!text) return;
    if (!className) { fragment.append(document.createTextNode(text)); return; }
    const span = el("span", { className, textContent: text });
    fragment.append(span);
  };
  for (const [index, line] of $.programSource.value.split(/\r?\n/).entries()) {
    if (index) append("\n");
    const comment = line.indexOf(";");
    const code = comment < 0 ? line : line.slice(0, comment);
    const match = /^(\s*)(\S+)/.exec(code);
    let start = 0;
    if (match && keywords.has(match[2].toUpperCase())) {
      append(match[1]);
      append(match[2], "program-token-keyword");
      start = match[0].length;
    }
    const operands = code.slice(start);
    let cursor = 0;
    for (const register of operands.matchAll(/\bR(?:0x[0-9a-f]+|0b[01]+|[0-9]+)\b/gi)) {
      append(operands.slice(cursor, register.index));
      append(register[0], "program-token-register");
      cursor = register.index + register[0].length;
    }
    append(operands.slice(cursor));
    if (comment >= 0) append(line.slice(comment), "program-token-comment");
  }
  $.programSyntaxContent.replaceChildren(fragment);
  syncSourceLayers();
}

function syncSourceLayers() {
  // These layers can have different scroll ranges, especially with a horizontal scrollbar.
  const { scrollTop, scrollLeft } = $.programSource;
  $.programGutterLines.style.transform = `translateY(${-scrollTop}px)`;
  $.programSyntaxContent.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
}

function formatAddress(address) {
  return `0x${address.toString(16).toUpperCase().padStart(Math.max(2, Math.ceil(addressWidth(activeRom() ?? { addressSize: 8 }) / 4)), "0")}`;
}

function updateSelectors() {
  for (const [key, type] of Object.entries(fields)) {
    const select = selectEls[key];
    const current = programConfig()[key];
    const allowed = components().filter((item) => [].concat(type).includes(item.t));
    select.replaceChildren(new Option("Select…", ""), ...allowed.map((item) => new Option(item.label || item.t, item.id)));
    select.value = allowed.some((item) => item.id === current) ? current : "";
  }
  const registers = components().filter((item) => item.t === "register");
  const selected = programConfig().registers.filter((id) => registers.some((register) => register.id === id));
  $.programRegisterOptions.replaceChildren();
  $.programRegisterEmpty.hidden = selected.length > 0;
  $.programRegisterEmpty.textContent = registers.length ? "No registers tracked yet." : "Add a register on Canvas, then link it here.";
  $.programAddRegister.disabled = selected.length >= registers.length;
  for (const [index, id] of selected.entries()) {
    const select = el("select", {
      "aria-label": `Tracked register ${index + 1}`,
      dataset: { index: String(index) },
    });
    select.replaceChildren(...registers.map((register) => {
      const option = new Option(register.label || "Register", register.id);
      option.disabled = register.id !== id && selected.includes(register.id);
      return option;
    }));
    select.value = id;
    const remove = el("button", {
      type: "button",
      dataset: { index: String(index) },
      "aria-label": `Remove tracked register ${registers.find((register) => register.id === id)?.label || index + 1}`,
      textContent: "×",
    });
    $.programRegisterOptions.append(el("tr", {}, el("td", {}, select), el("td", {}, remove)));
  }
  $.programFormat.value = programConfig().format;
}

function updateRegisters(force = false) {
  const registers = programConfig().registers.map(component).filter((item) => item?.t === "register");
  const key = JSON.stringify(registers.map((item) => [item.id, item.label, bitWidth(item)]));
  if (force || key !== renderedRegisters) {
    for (const timer of registerHighlightTimers.values()) clearTimeout(timer);
    registerHighlightTimers.clear();
    $.programRegisterValues.replaceChildren();
    renderedRegisters = key;
    if (!registers.length) $.programRegisterValues.textContent = "Add register tracking in Program setup.";
    for (const register of registers) {
      const output = el("output", { dataset: { register: register.id } });
      $.programRegisterValues.append(el("div", { className: "program-register-row" },
        el("span", { textContent: register.label || "Register" }), output));
    }
  }
  for (const output of $.programRegisterValues.querySelectorAll("[data-register]")) {
    const register = component(output.dataset.register);
    const value = ctx.editor.evaluation.states.get(register.id)?.value ?? 0;
    const previous = previousRegisterValues.get(register.id);
    if (previous !== undefined && previous !== value) {
      const row = output.parentElement;
      clearTimeout(registerHighlightTimers.get(register.id));
      row.classList.add("updated");
      registerHighlightTimers.set(register.id, setTimeout(() => {
        row.classList.remove("updated");
        registerHighlightTimers.delete(register.id);
      }, 1200));
    }
    previousRegisterValues.set(register.id, value);
    output.textContent = formatValue(value, bitWidth(register), programConfig().format);
  }
}

function pcValue() {
  const tag = component(programConfig().pc);
  return tag?.t === "tag" ? ctx.editor.evaluation.states.get(tag.id)?.value ?? 0 : null;
}

function updateGutter() {
  const rom = activeRom();
  if (!rom) return;
  const addresses = sourceLineAddresses($.programSource.value);
  const selected = breakpoints.get(rom.id) ?? new Set();
  const key = JSON.stringify([rom.id, addressWidth(rom), addresses, [...selected].sort((a, b) => a - b)]);
  if ($.programGutter.dataset.key !== key) {
    $.programGutterLines.replaceChildren(...addresses.map((address) => {
      const line = el("div");
      if (address !== null && address < 2 ** addressWidth(rom)) {
        const button = el("button", {
          type: "button",
          dataset: { address: String(address) },
          textContent: formatAddress(address),
        });
        button.classList.toggle("breakpoint", selected.has(address));
        button.setAttribute("aria-pressed", String(selected.has(address)));
        button.setAttribute("aria-label", `${selected.has(address) ? "Remove" : "Add"} breakpoint at ${formatAddress(address)}`);
        button.title = `${selected.has(address) ? "Remove" : "Add"} breakpoint at ${formatAddress(address)}`;
        line.append(button);
      } else if (address !== null) line.textContent = formatAddress(address);
      return line;
    }));
    $.programGutter.dataset.key = key;
  }
  syncSourceLayers();
  $.programClearBreakpoints.disabled = ![...breakpoints.values()].some((items) => items.size);
}

function highlightPc(pc) {
  const line = Number.isInteger(pc) && pc >= 0 ? sourceLineAddresses($.programSource.value).indexOf(pc) : -1;
  for (const child of $.programGutterLines.children) child.classList.toggle("active", child === $.programGutterLines.children[line]);
  $.programCurrentLine.hidden = line < 0;
  if (line < 0) { lastPcLine = null; return; }
  const style = getComputedStyle($.programSource);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const paddingTop = Number.parseFloat(style.paddingTop);
  const top = paddingTop + line * lineHeight;
  if (lastPcLine !== line && (top < $.programSource.scrollTop || top + lineHeight > $.programSource.scrollTop + $.programSource.clientHeight)) {
    $.programSource.scrollTop = Math.max(0, top - $.programSource.clientHeight / 2);
    syncSourceLayers();
  }
  $.programCurrentLine.style.top = `${top - $.programSource.scrollTop}px`;
  $.programCurrentLine.style.height = `${lineHeight}px`;
  lastPcLine = line;
}

function updatePc() {
  const pc = pcValue();
  $.programPcValue.textContent = pc === null ? "—" : formatAddress(pc);
  const run = component(programConfig().run);
  const playing = isPlaying();
  const dirty = assemblyDraft(activeRom())?.dirty;
  $.programPlay.disabled = run?.t !== "clock" || playing || dirty;
  $.programPause.disabled = run?.t !== "clock" || !playing;
  $.programStepButton.disabled = component(programConfig().step)?.t !== "button" || playing || dirty;
  highlightPc(pc);
  $.programReset.disabled = ![programConfig().resetPc, programConfig().resetRegisters].every((id) => component(id)?.t === "button");
}

function checkBreakpoint() {
  ensureBoard();
  const rom = activeRom();
  const pc = pcValue();
  if (!rom || pc === null || !isPlaying()) return;
  const clock = component(programConfig().run);
  if (skipBreakpointAt !== null) {
    if (pc === skipBreakpointAt) {
      if (ctx.editor.highClocks.has(clock.id)) skipBreakpointAt = null;
      return;
    }
    skipBreakpointAt = null;
  }
  if (!breakpoints.get(rom.id)?.has(pc)) return;
  if (ctx.editor.setClockEnabled(clock.id, false))
    status(`Breakpoint reached at ${formatAddress(pc)}.`);
}

export function renderIsa() {
  ensureBoard();
  renderIsaRules();
}

function render() {
  const editor = ctx.editor;
  ensureBoard();
  const key = JSON.stringify(editor.board.components.map((item) => [item.id, item.t, item.label]));
  const configKey = JSON.stringify(programConfig());
  if (renderedEditor !== editor || renderedComponents !== key || renderedConfig !== configKey) {
    if (renderedEditor !== editor) previousRegisterValues.clear();
    renderedEditor = editor;
    renderedComponents = key;
    renderedConfig = configKey;
    renderedRegisters = "";
    updateSelectors();
  }
  if (renderedRamId !== programConfig().ram) { renderedRamId = programConfig().ram; ramViewer.reset(); }
  $.programFormat.value = programConfig().format;
  updateAssembly();
  updateRegisters();
  ramViewer.render();
  updatePc();
}

for (const key of Object.keys(fields)) {
  selectEls[key].addEventListener("change", () => patchProgramConfig({ [key]: selectEls[key].value || null }));
}

$.programSource.addEventListener("scroll", () => {
  syncSourceLayers();
  highlightPc(pcValue());
});
$.programSource.addEventListener("input", () => {
  const rom = activeRom();
  if (!rom || isPlaying()) return;
  const draft = assemblyDraft(rom);
  draft.text = $.programSource.value;
  draft.dirty = true;
  updateAssembly();
  updatePc();
});
$.programGutter.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-address]");
  const rom = activeRom();
  if (!button || !rom) return;
  const address = Number(button.dataset.address);
  const selected = breakpoints.get(rom.id) ?? new Set();
  if (selected.has(address)) selected.delete(address);
  else selected.add(address);
  breakpoints.set(rom.id, selected);
  updateGutter();
  highlightPc(pcValue());
  checkBreakpoint();
});
$.programClearBreakpoints.addEventListener("click", () => {
  breakpoints.clear();
  skipBreakpointAt = null;
  updateGutter();
  highlightPc(pcValue());
  $.programClearBreakpoints.disabled = true;
});
$.programSaveRom.addEventListener("click", () => {
  const rom = activeRom();
  if (!rom || isPlaying()) return;
  const draft = assemblyDraft(rom);
  try {
    const entries = assemble(draft.text, addressWidth(rom), bitWidth(rom), savedIsa(rom));
    if (!ctx.editor.saveProgramSource(rom.id, entries, draft.text))
      throw new Error("ROM write could not be applied to the circuit.");
    draft.key = romKey(rom);
    draft.dirty = false;
    render();
    status(`Saved ${entries.length} nonzero words to ROM.`);
  } catch (error) { status(error.message, true); }
});
$.programAddRegister.addEventListener("click", () => {
  const selected = programConfig().registers.filter((id) => component(id)?.t === "register");
  const available = components().find((item) => item.t === "register" && !selected.includes(item.id));
  if (available) patchProgramConfig({ registers: [...selected, available.id] });
});
$.programRegisterOptions.addEventListener("change", (event) => {
  const select = event.target.closest("select[data-index]");
  if (!select) return;
  const registers = programConfig().registers.filter((id) => component(id)?.t === "register");
  if (component(select.value)?.t !== "register" || registers.includes(select.value)) return;
  registers[Number(select.dataset.index)] = select.value;
  patchProgramConfig({ registers });
});
$.programRegisterOptions.addEventListener("click", (event) => {
  const remove = event.target.closest("button[data-index]");
  if (!remove) return;
  const registers = programConfig().registers.filter((id) => component(id)?.t === "register");
  registers.splice(Number(remove.dataset.index), 1);
  patchProgramConfig({ registers });
});
$.programFormat.addEventListener("change", () => patchProgramConfig({ format: $.programFormat.value }));

function run(enable) {
  if (enable && assemblyDraft(activeRom())?.dirty) { status("Save your draft to ROM before Play.", true); return; }
  const item = component(programConfig().run);
  if (item?.t !== "clock") { status("Link a clock in Program setup.", true); return; }
  skipBreakpointAt = enable && breakpoints.get(activeRom()?.id)?.has(pcValue()) ? pcValue() : null;
  const changed = (item.enable !== false) === enable || ctx.editor.setClockEnabled(item.id, enable);
  if (!changed) status("Clock could not be changed.", true);
  else status(enable ? "Playing." : "Paused.");
}

$.programPlay.addEventListener("click", () => run(true));
$.programPause.addEventListener("click", () => run(false));

function pulse(ids) {
  const selected = [...new Set(ids)].filter((id) => component(id)?.t === "button");
  let ok = true;
  for (const id of selected) ok = ctx.editor.setButtonPressed(id, true) && ok;
  for (const id of selected) ctx.editor.setButtonPressed(id, false);
  return selected.length > 0 && ok;
}

$.programStepButton.addEventListener("click", () => {
  if (assemblyDraft(activeRom())?.dirty) { status("Save your draft to ROM before Step.", true); return; }
  const ok = pulse([programConfig().step]);
  status(ok ? "Stepped." : "Step button could not be pressed.", !ok);
  updatePc();
});
$.programReset.addEventListener("click", () => {
  const ok = pulse([programConfig().resetPc, programConfig().resetRegisters]);
  status(ok ? "PC and registers reset." : "Reset controls could not be pressed.", !ok);
});

function ensureBoard() {
  const board = ctx.editor.board;
  if (draftBoard === board) return;
  drafts.clear();
  breakpoints.clear();
  skipBreakpointAt = null;
  draftBoard = board;
  $.programSource.dataset.rom = "";
  renderedSyntax = "";
  resetIsa();
}

export { render, checkBreakpoint };

export function exportDrafts() {
  ensureBoard();
  return {
    isa: exportIsaDrafts(),
    assembly: [...drafts].filter(([id, draft]) => draft.dirty && component(id)?.t === "rom").map(([id, draft]) => [id, draft.text]),
    breakpoints: [...breakpoints].filter(([id, addresses]) => component(id)?.t === "rom" && addresses.size)
      .map(([id, addresses]) => [id, [...addresses].sort((a, b) => a - b)]),
  };
}

export function restoreDrafts({ isa: savedIsaDrafts = [], assembly = [], breakpoints: savedBreakpoints = [] } = {}) {
  ensureBoard();
  restoreIsaDrafts(savedIsaDrafts);
  for (const [id, source] of assembly) {
    const rom = component(id);
    drafts.set(id, { text: source, key: romKey(rom), dirty: true });
  }
  for (const [id, addresses] of savedBreakpoints) breakpoints.set(id, new Set(addresses));
  renderIsaRules();
  render();
}

export function syncRom(id) {
  drafts.delete(id);
  if (activeRom()?.id === id) updateAssembly();
}

export function reset() {
  for (const timer of registerHighlightTimers.values()) clearTimeout(timer);
  registerHighlightTimers.clear();
  previousRegisterValues.clear();
  renderedEditor = null;
  renderedComponents = "";
  renderedConfig = "";
  renderedRamId = null;
  drafts.clear();
  breakpoints.clear();
  skipBreakpointAt = null;
  draftBoard = null;
  $.programSource.dataset.rom = "";
  renderedSyntax = "";
  defaultBoard = null;
  resetIsa();
  ramViewer.reset();
}
