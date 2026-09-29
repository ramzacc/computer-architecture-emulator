import { addressWidth, bitWidth } from "./components.js";
import { formatValue } from "./value-format.js";
import { assemble, disassemble, parseIsa, isaGrid, serializeIsaGrid, assignIsaCell, sourceLineAddresses } from "./assembly.js";
import { restoreProgramSource } from "./program-source.js";
import { createRamViewer } from "./ram-view.js";

const fields = { rom: "rom", pc: "tag", run: "clock", step: "button", resetPc: "button", resetRegisters: "button" };
const names = { rom: "Program ROM", pc: "PC", run: "Main Clock", step: "Manual Clock", resetPc: "Reset PC", resetRegisters: "Reset Registers" };
const $ = (id) => document.getElementById(`program-${id}`);
const operandName = (index) => index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
const operandHue = (index) => (195 + index * 137.508) % 360;

export function createProgram({ getEditor }) {
  const selectEls = Object.fromEntries(Object.keys(fields).map((key) => [key, $(key === "resetPc" ? "reset-pc" : key === "resetRegisters" ? "reset-registers" : key)]));
  const registerOptions = $("register-options");
  const addRegister = $("add-register");
  const registerEmpty = $("register-empty");
  const registerValues = $("register-values");
  const formatEl = $("format");
  const ramSelectEl = $("ram-select");
  let ramFormat = "hex";
  const ramViewer = createRamViewer($("ram-view"), {
    getEditor,
    getRam: () => component(ramSelectEl.value),
    getFormat: () => ramFormat,
    setFormat: (value) => { ramFormat = value; },
  });
  const statusEl = $("status");
  const sourceEl = $("source");
  const syntaxContentEl = $("syntax-content");
  const gutterEl = $("gutter");
  const gutterLinesEl = $("gutter-lines");
  const currentLineEl = $("current-line");
  const assemblyNoteEl = $("assembly-note");
  const saveRomEl = $("save-rom");
  const isaRomEl = document.getElementById("isa-rom");
  const isaRulesEl = document.getElementById("isa-rules");
  const isaAddEl = document.getElementById("isa-add");
  const saveIsaEl = document.getElementById("isa-save");
  const isaNoteEl = document.getElementById("isa-note");
  const drafts = new Map();
  const isaDrafts = new Map();
  let draftBoard = null;
  let renderedEditor = null;
  let renderedComponents = "";
  let renderedConfig = "";
  let renderedRegisters = "";
  const previousRegisterValues = new Map();
  const registerHighlightTimers = new Map();
  let defaultConfig = null;
  let defaultBoard = null;
  let renderedIsaRoms = "";
  let lastPcLine = null;
  let renderedSyntax = "";
  const breakpoints = new Map();
  let skipBreakpointAt = null;

  const components = () => getEditor().board.components;
  const component = (id) => components().find((item) => item.id === id);
  function config() {
    const board = getEditor().board;
    if (board.program) return board.program;
    if (defaultBoard !== board) {
      defaultBoard = board;
      defaultConfig = Object.fromEntries(Object.keys(fields).map((key) =>
        [key, components().find((item) => item.label === names[key] && [].concat(fields[key]).includes(item.t))?.id ?? null]));
      defaultConfig.registers = [];
      defaultConfig.offset = 0;
      defaultConfig.format = "hex";
    }
    return defaultConfig;
  }
  function setConfig(patch) { getEditor().setProgramConfig({ ...config(), ...patch }); }
  function status(message, error = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", error);
  }
  function activeRom() { const item = component(config().rom); return item?.t === "rom" ? item : null; }
  function savedIsa(rom) { return config().isa?.[rom.id] ?? ""; }
  function romKey(rom) { return JSON.stringify([rom.id, bitWidth(rom), addressWidth(rom), rom.data ?? [], savedIsa(rom), config().sources?.[rom.id]]); }
  function savedSource(rom) {
    const source = config().sources?.[rom.id];
    return source ? restoreProgramSource(source, rom.data ?? [], addressWidth(rom), bitWidth(rom), savedIsa(rom))
      : disassemble(rom.data ?? [], bitWidth(rom), savedIsa(rom));
  }
  function isaRom() { return activeRom(); }
  function isaDraft(rom) {
    let draft = isaDrafts.get(rom.id);
    if (!draft) {
      draft = { rules: isaGrid(savedIsa(rom), bitWidth(rom)), saved: savedIsa(rom), dirty: false, selected: [] };
      isaDrafts.set(rom.id, draft);
    }
    if (!draft.dirty && draft.saved !== savedIsa(rom)) {
      draft.rules = isaGrid(savedIsa(rom), bitWidth(rom));
      draft.saved = savedIsa(rom);
    }
    return draft;
  }
  function markIsaDirty(draft) { draft.dirty = true; isaNoteEl.textContent = "Unsaved ISA rules."; isaNoteEl.classList.remove("error"); }
  function renderIsa() {
    ensureBoard();
    const roms = components().filter((item) => item.t === "rom");
    const key = JSON.stringify(roms.map((item) => [item.id, item.label, bitWidth(item)]));
    if (key !== renderedIsaRoms) {
      renderedIsaRoms = key;
      isaRomEl.replaceChildren(new Option("Select ROM…", ""), ...roms.map((item) =>
        new Option(`${item.label || "ROM"} · ${bitWidth(item)} bits`, item.id)));
    }
    const rom = isaRom();
    isaRomEl.value = rom?.id ?? "";
    isaAddEl.disabled = !rom;
    saveIsaEl.disabled = !rom;
    isaRulesEl.replaceChildren();
    if (!rom) {
      isaNoteEl.textContent = roms.length ? "Select a ROM." : "Add a ROM on Canvas.";
      return;
    }
    let draft;
    try { draft = isaDraft(rom); }
    catch (error) { isaNoteEl.textContent = error.message; isaNoteEl.classList.add("error"); return; }
    isaNoteEl.textContent = draft.dirty ? "Unsaved ISA rules." : `${bitWidth(rom)}-bit ROM · rules saved.`;
    isaNoteEl.classList.remove("error");
    draft.rules.forEach((rule, ruleIndex) => {
      const card = document.createElement("section");
      card.className = "isa-card";
      card.dataset.rule = String(ruleIndex);
      const head = document.createElement("div"); head.className = "isa-card-head";
      const keyword = document.createElement("input"); keyword.value = rule.keyword;
      keyword.placeholder = "KEYWORD"; keyword.maxLength = 24; keyword.dataset.action = "keyword";
      keyword.setAttribute("aria-label", `Instruction ${ruleIndex + 1} keyword`);
      const comment = document.createElement("input"); comment.value = rule.comment ?? "";
      comment.placeholder = "Comment (optional)"; comment.maxLength = 160; comment.dataset.action = "comment";
      comment.setAttribute("aria-label", `Instruction ${ruleIndex + 1} comment`);
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.dataset.action = "remove-rule";
      head.append(keyword, comment, remove); card.append(head);
      const body = document.createElement("div"); body.className = "isa-card-body";
      const controls = document.createElement("div"); controls.className = "isa-card-controls";
      const operandList = document.createElement("div"); operandList.className = "isa-operand-list";
      const palette = document.createElement("div"); palette.className = "isa-palette";
      for (const [index, operand] of rule.operands.entries()) {
        const button = document.createElement("button"); button.type = "button";
        const value = `operand:${index}`;
        button.textContent = `${operand.kind === "register" ? "Register" : "Value"} ${operandName(index)}`;
        button.dataset.action = "select"; button.dataset.value = value;
        button.classList.add("isa-operand-color");
        button.style.setProperty("--isa-hue", operandHue(index));
        button.classList.toggle("selected", draft.selected[ruleIndex] === value);
        button.setAttribute("aria-pressed", String(draft.selected[ruleIndex] === value));
        palette.append(button);
      }
      const addRegister = document.createElement("button"); addRegister.type = "button"; addRegister.textContent = "+ Register"; addRegister.dataset.action = "add-register";
      const addValue = document.createElement("button"); addValue.type = "button"; addValue.textContent = "+ Value"; addValue.dataset.action = "add-value";
      palette.append(addRegister, addValue); controls.append(palette);
      const grid = document.createElement("div"); grid.className = "isa-grid"; grid.setAttribute("role", "group"); grid.setAttribute("aria-label", `${rule.keyword || "Instruction"} bits`);
      for (let bit = rule.cells.length - 1; bit >= 0; bit--) {
        const cell = rule.cells[bit]; const button = document.createElement("button"); button.type = "button";
        button.dataset.action = "cell"; button.dataset.bit = String(bit);
        button.classList.add(cell === null ? "empty-cell" : typeof cell === "number" ? "operand-cell" : "fixed-cell");
        if (typeof cell === "number") button.style.setProperty("--isa-hue", operandHue(cell));
        const position = typeof cell === "number" ? rule.operands[cell]?.bits.indexOf(bit) ?? -1 : -1;
        const label = cell === null ? "·" : typeof cell === "number" ? `${operandName(cell)}${rule.operands[cell].bits.length - position - 1}` : cell;
        button.innerHTML = `<small>${bit}</small><strong>${label}</strong>`;
        button.setAttribute("aria-label", `Bit ${bit}: ${typeof cell === "number" ? `${rule.operands[cell]?.kind} ${operandName(cell)} bit ${rule.operands[cell].bits.length - position - 1}` : cell ?? "unassigned"}`);
        grid.append(button);
      }
      rule.operands.forEach((operand, operandIndex) => {
        const row = document.createElement("div"); row.className = "isa-operand"; row.dataset.operand = String(operandIndex);
        const kind = document.createElement("select"); kind.dataset.action = "kind"; kind.setAttribute("aria-label", `Operand ${operandIndex + 1} type`);
        kind.replaceChildren(new Option("Register", "register"), new Option("Value", "value")); kind.value = operand.kind;
        const name = document.createElement("span"); name.className = "isa-operand-name";
        name.textContent = operandName(operandIndex);
        name.style.setProperty("--isa-hue", operandHue(operandIndex));
        const del = document.createElement("button"); del.type = "button"; del.textContent = "×"; del.dataset.action = "remove-operand"; del.setAttribute("aria-label", `Remove operand ${operandName(operandIndex)}`);
        row.append(name, kind, del); operandList.append(row);
      });
      controls.append(operandList);
      body.append(controls, grid);
      card.append(body);
      isaRulesEl.append(card);
    });
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
  function updateAssembly() {
    const rom = activeRom();
    const draft = assemblyDraft(rom);
    const locked = isPlaying();
    sourceEl.disabled = !rom || locked;
    saveRomEl.disabled = !rom || locked || !draft?.dirty;
    if (!rom) {
      sourceEl.value = "";
      syntaxContentEl.replaceChildren(); renderedSyntax = "";
      gutterLinesEl.replaceChildren(); gutterEl.dataset.key = ""; currentLineEl.hidden = true;
      $("clear-breakpoints").disabled = ![...breakpoints.values()].some((items) => items.size);
      assemblyNoteEl.textContent = "Link a ROM in Program setup.";
      return;
    }
    const key = romKey(rom);
    if (!draft.dirty && draft.key !== key) {
      draft.text = savedSource(rom);
      draft.key = key;
    }
    if (sourceEl.dataset.rom !== rom.id || sourceEl.value !== draft.text) sourceEl.value = draft.text;
    sourceEl.dataset.rom = rom.id;
    updateSyntax();
    updateGutter();
    assemblyNoteEl.textContent = draft.dirty
      ? draft.key === key ? "Unsaved assembly edits." : "ROM or ISA rules changed since this draft. Assembling will replace ROM contents."
      : "Assembly matches the linked ROM.";
  }
  function updateSyntax() {
    const rom = activeRom();
    const isa = rom ? savedIsa(rom) : "";
    const key = JSON.stringify([sourceEl.value, isa, rom ? bitWidth(rom) : 0]);
    if (key === renderedSyntax) return;
    renderedSyntax = key;
    let keywords = new Set([".WORD"]);
    try { for (const rule of parseIsa(isa, bitWidth(rom))) keywords.add(rule.keyword); }
    catch { /* Keep the source editable while ISA rules are invalid. */ }
    const fragment = document.createDocumentFragment();
    const append = (text, className) => {
      if (!text) return;
      if (!className) { fragment.append(document.createTextNode(text)); return; }
      const span = document.createElement("span");
      span.className = className; span.textContent = text; fragment.append(span);
    };
    for (const [index, line] of sourceEl.value.split(/\r?\n/).entries()) {
      if (index) append("\n");
      const comment = line.indexOf(";");
      const code = comment < 0 ? line : line.slice(0, comment);
      const match = /^(\s*)(\S+)/.exec(code);
      let start = 0;
      if (match && keywords.has(match[2].toUpperCase())) {
        append(match[1]); append(match[2], "program-token-keyword");
        start = match[0].length;
      }
      const operands = code.slice(start);
      const registers = /\bR(?:0x[0-9a-f]+|0b[01]+|[0-9]+)\b/gi;
      let cursor = 0;
      for (const register of operands.matchAll(registers)) {
        append(operands.slice(cursor, register.index));
        append(register[0], "program-token-register");
        cursor = register.index + register[0].length;
      }
      append(operands.slice(cursor));
      if (comment >= 0) append(line.slice(comment), "program-token-comment");
    }
    syntaxContentEl.replaceChildren(fragment);
    syncSourceLayers();
  }
  function syncSourceLayers() {
    // These layers can have different scroll ranges, especially with a horizontal scrollbar.
    const { scrollTop, scrollLeft } = sourceEl;
    gutterLinesEl.style.transform = `translateY(${-scrollTop}px)`;
    syntaxContentEl.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
  }
  function formatAddress(address) {
    return `0x${address.toString(16).toUpperCase().padStart(Math.max(2, Math.ceil(addressWidth(activeRom() ?? { addressSize: 8 }) / 4)), "0")}`;
  }
  function updateSelectors() {
    for (const [key, type] of Object.entries(fields)) {
      const select = selectEls[key];
      const current = config()[key];
      const allowed = components().filter((item) => [].concat(type).includes(item.t));
      select.replaceChildren(new Option("Select…", ""), ...allowed.map((item) => new Option(item.label || item.t, item.id)));
      select.value = allowed.some((item) => item.id === current) ? current : "";
    }
    const registers = components().filter((item) => item.t === "register");
    const selected = config().registers.filter((id) => registers.some((register) => register.id === id));
    registerOptions.replaceChildren();
    registerEmpty.hidden = selected.length > 0;
    registerEmpty.textContent = registers.length ? "No registers tracked yet." : "Add a register on Canvas, then link it here.";
    addRegister.disabled = selected.length >= registers.length;
    for (const [index, id] of selected.entries()) {
      const row = document.createElement("tr");
      const registerCell = document.createElement("td");
      const select = document.createElement("select");
      select.setAttribute("aria-label", `Tracked register ${index + 1}`);
      select.dataset.index = String(index);
      select.replaceChildren(...registers.map((register) => {
        const option = new Option(register.label || "Register", register.id);
        option.disabled = register.id !== id && selected.includes(register.id);
        return option;
      }));
      select.value = id;
      registerCell.append(select);
      const removeCell = document.createElement("td");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.index = String(index);
      remove.setAttribute("aria-label", `Remove tracked register ${registers.find((register) => register.id === id)?.label || index + 1}`);
      remove.textContent = "×";
      removeCell.append(remove);
      row.append(registerCell, removeCell);
      registerOptions.append(row);
    }
    formatEl.value = config().format;
  }
  function updateRegisters(force = false) {
    const registers = config().registers.map(component).filter((item) => item?.t === "register");
    const key = JSON.stringify(registers.map((item) => [item.id, item.label, bitWidth(item)]));
    if (force || key !== renderedRegisters) {
      for (const timer of registerHighlightTimers.values()) clearTimeout(timer);
      registerHighlightTimers.clear();
      registerValues.replaceChildren();
      renderedRegisters = key;
      if (!registers.length) registerValues.textContent = "Add register tracking in Program setup.";
      for (const register of registers) {
        const row = document.createElement("div");
        row.className = "program-register-row";
        const name = document.createElement("span");
        name.textContent = register.label || "Register";
        const value = document.createElement("output");
        value.dataset.register = register.id;
        row.append(name, value);
        registerValues.append(row);
      }
    }
    for (const output of registerValues.querySelectorAll("[data-register]")) {
      const register = component(output.dataset.register);
      const value = getEditor().evaluation.states.get(register.id)?.value ?? 0;
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
      output.textContent = formatValue(value, bitWidth(register), config().format);
    }
  }
  function updateRamOptions() {
    const rams = components().filter((item) => item.t === "ram");
    const selected = ramSelectEl.value;
    ramSelectEl.replaceChildren(...rams.map((ram) => new Option(ram.label || "RAM", ram.id)));
    if (rams.some((ram) => ram.id === selected)) ramSelectEl.value = selected;
    ramSelectEl.hidden = rams.length < 2;
    ramViewer.reset();
  }
  function pcValue() {
    const tag = component(config().pc);
    return tag?.t === "tag" ? getEditor().evaluation.states.get(tag.id)?.value ?? 0 : null;
  }
  function isPlaying() {
    const run = component(config().run);
    return run?.t === "clock" && run.enable !== false;
  }
  function updateGutter() {
    const rom = activeRom(); if (!rom) return;
    const addresses = sourceLineAddresses(sourceEl.value);
    const selected = breakpoints.get(rom.id) ?? new Set();
    const key = JSON.stringify([rom.id, addressWidth(rom), addresses, [...selected].sort((a, b) => a - b)]);
    if (gutterEl.dataset.key !== key) {
      gutterLinesEl.replaceChildren(...addresses.map((address) => {
        const line = document.createElement("div");
        if (address !== null && address < 2 ** addressWidth(rom)) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.address = String(address);
          button.classList.toggle("breakpoint", selected.has(address));
          button.setAttribute("aria-pressed", String(selected.has(address)));
          button.setAttribute("aria-label", `${selected.has(address) ? "Remove" : "Add"} breakpoint at ${formatAddress(address)}`);
          button.title = `${selected.has(address) ? "Remove" : "Add"} breakpoint at ${formatAddress(address)}`;
          button.textContent = formatAddress(address);
          line.append(button);
        } else if (address !== null) line.textContent = formatAddress(address);
        return line;
      }));
      gutterEl.dataset.key = key;
    }
    syncSourceLayers();
    $("clear-breakpoints").disabled = ![...breakpoints.values()].some((items) => items.size);
  }
  function highlightPc(pc) {
    const line = Number.isInteger(pc) && pc >= 0 ? sourceLineAddresses(sourceEl.value).indexOf(pc) : -1;
    for (const child of gutterLinesEl.children) child.classList.toggle("active", child === gutterLinesEl.children[line]);
    currentLineEl.hidden = line < 0;
    if (line < 0) { lastPcLine = null; return; }
    const style = getComputedStyle(sourceEl);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const paddingTop = Number.parseFloat(style.paddingTop);
    const top = paddingTop + line * lineHeight;
    if (lastPcLine !== line && (top < sourceEl.scrollTop || top + lineHeight > sourceEl.scrollTop + sourceEl.clientHeight)) {
      sourceEl.scrollTop = Math.max(0, top - sourceEl.clientHeight / 2);
      syncSourceLayers();
    }
    currentLineEl.style.top = `${top - sourceEl.scrollTop}px`;
    currentLineEl.style.height = `${lineHeight}px`;
    lastPcLine = line;
  }
  function updatePc() {
    const pc = pcValue();
    $("pc-value").textContent = pc === null ? "—" : formatAddress(pc);
    const run = component(config().run);
    const playing = isPlaying();
    const dirty = assemblyDraft(activeRom())?.dirty;
    $("play").disabled = run?.t !== "clock" || playing || dirty;
    $("pause").disabled = run?.t !== "clock" || !playing;
    $("step-button").disabled = component(config().step)?.t !== "button" || playing || dirty;
    highlightPc(pc);
    $("reset").disabled = ![config().resetPc, config().resetRegisters].every((id) => component(id)?.t === "button");
  }
  function checkBreakpoint() {
    ensureBoard();
    const rom = activeRom();
    const pc = pcValue();
    if (!rom || pc === null || !isPlaying()) return;
    const clock = component(config().run);
    if (skipBreakpointAt !== null) {
      if (pc === skipBreakpointAt) {
        if (getEditor().highClocks.has(clock.id)) skipBreakpointAt = null;
        return;
      }
      skipBreakpointAt = null;
    }
    if (!breakpoints.get(rom.id)?.has(pc)) return;
    if (getEditor().setClockEnabled(clock.id, false))
      status(`Breakpoint reached at ${formatAddress(pc)}.`);
  }
  function render() {
    const editor = getEditor();
    ensureBoard();
    const key = JSON.stringify(editor.board.components.map((item) => [item.id, item.t, item.label]));
    const configKey = JSON.stringify(config());
    if (renderedEditor !== editor || renderedComponents !== key || renderedConfig !== configKey) {
      if (renderedEditor !== editor) previousRegisterValues.clear();
      renderedEditor = editor;
      renderedComponents = key;
      renderedConfig = configKey;
      renderedRegisters = "";
      updateSelectors();
      updateRamOptions();
    }
    formatEl.value = config().format;
    updateAssembly();
    updateRegisters();
    ramViewer.render();
    updatePc();
  }
  ramSelectEl.addEventListener("change", () => ramViewer.reset());
  for (const key of Object.keys(fields)) selectEls[key].addEventListener("change", () => setConfig({ [key]: selectEls[key].value || null }));
  isaRomEl.addEventListener("change", () => { setConfig({ rom: isaRomEl.value || null }); renderIsa(); });
  isaAddEl.addEventListener("click", () => {
    const rom = isaRom(); if (!rom) return;
    const draft = isaDraft(rom);
    draft.rules.push({ keyword: "", cells: Array(bitWidth(rom)).fill(null), operands: [] });
    markIsaDirty(draft); renderIsa();
    isaRulesEl.lastElementChild?.querySelector("input")?.focus();
  });
  isaRulesEl.addEventListener("input", (event) => {
    const action = event.target.dataset.action;
    if (action !== "keyword" && action !== "comment") return;
    const draft = isaDraft(isaRom());
    const rule = draft.rules[Number(event.target.closest("[data-rule]").dataset.rule)];
    rule[action] = action === "keyword" ? event.target.value.toUpperCase() : event.target.value;
    markIsaDirty(draft);
  });
  isaRulesEl.addEventListener("change", (event) => {
    if (event.target.dataset.action !== "kind") return;
    const draft = isaDraft(isaRom()); const card = event.target.closest("[data-rule]");
    draft.rules[Number(card.dataset.rule)].operands[Number(event.target.closest("[data-operand]").dataset.operand)].kind = event.target.value;
    markIsaDirty(draft); renderIsa();
  });
  isaRulesEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]"); if (!button) return;
    const rom = isaRom(); if (!rom) return;
    const draft = isaDraft(rom); const ruleIndex = Number(button.closest("[data-rule]").dataset.rule);
    const rule = draft.rules[ruleIndex]; const action = button.dataset.action;
    if (action === "select") { draft.selected[ruleIndex] = draft.selected[ruleIndex] === button.dataset.value ? null : button.dataset.value; renderIsa(); return; }
    if (action === "remove-rule") { draft.rules.splice(ruleIndex, 1); draft.selected.splice(ruleIndex, 1); }
    else if (action === "add-register" || action === "add-value") {
      rule.operands.push({ kind: action === "add-register" ? "register" : "value", bits: [] });
      draft.selected[ruleIndex] = `operand:${rule.operands.length - 1}`;
    } else if (action === "cell") {
      const bit = Number(button.dataset.bit); const selected = draft.selected[ruleIndex] ?? null;
      assignIsaCell(rule, selected, bit);
    } else {
      const operandIndex = Number(button.closest("[data-operand]").dataset.operand);
      if (action === "remove-operand") {
        rule.cells = rule.cells.map((cell) => cell === operandIndex ? null : typeof cell === "number" && cell > operandIndex ? cell - 1 : cell);
        rule.operands.splice(operandIndex, 1); draft.selected[ruleIndex] = null;
      }
    }
    markIsaDirty(draft); renderIsa();
  });
  saveIsaEl.addEventListener("click", () => {
    const rom = isaRom(); if (!rom) return;
    const draft = isaDraft(rom); const source = serializeIsaGrid(draft.rules);
    try {
      parseIsa(source, bitWidth(rom));
      const isa = { ...(config().isa ?? {}) };
      if (draft.rules.length) isa[rom.id] = source; else delete isa[rom.id];
      draft.dirty = false; draft.saved = isa[rom.id] ?? "";
      if (draft.saved !== savedIsa(rom)) setConfig({ isa });
      renderIsa(); isaNoteEl.textContent = "ISA saved.";
    } catch (error) { isaNoteEl.textContent = error.message; isaNoteEl.classList.add("error"); }
  });
  sourceEl.addEventListener("scroll", () => {
    syncSourceLayers();
    highlightPc(pcValue());
  });
  sourceEl.addEventListener("input", () => {
    const rom = activeRom();
    if (!rom) return;
    if (isPlaying()) return;
    const draft = assemblyDraft(rom);
    draft.text = sourceEl.value;
    draft.dirty = true;
    updateAssembly(); updatePc();
  });
  gutterEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-address]");
    const rom = activeRom();
    if (!button || !rom) return;
    const address = Number(button.dataset.address);
    const selected = breakpoints.get(rom.id) ?? new Set();
    if (selected.has(address)) selected.delete(address);
    else selected.add(address);
    breakpoints.set(rom.id, selected);
    updateGutter(); highlightPc(pcValue()); checkBreakpoint();
  });
  $("clear-breakpoints").addEventListener("click", () => {
    breakpoints.clear();
    skipBreakpointAt = null;
    updateGutter(); highlightPc(pcValue());
    $("clear-breakpoints").disabled = true;
  });
  saveRomEl.addEventListener("click", () => {
    const rom = activeRom();
    if (!rom || isPlaying()) return;
    const draft = assemblyDraft(rom);
    try {
      const entries = assemble(draft.text, addressWidth(rom), bitWidth(rom), savedIsa(rom));
      if (!getEditor().saveProgramSource(rom.id, entries, draft.text))
        throw new Error("ROM write could not be applied to the circuit.");
      draft.key = romKey(rom);
      draft.dirty = false;
      render();
      status(`Saved ${entries.length} nonzero words to ROM.`);
    } catch (error) { status(error.message, true); }
  });
  addRegister.addEventListener("click", () => {
    const selected = config().registers.filter((id) => component(id)?.t === "register");
    const available = components().find((item) => item.t === "register" && !selected.includes(item.id));
    if (available) setConfig({ registers: [...selected, available.id] });
  });
  registerOptions.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-index]");
    if (!select) return;
    const registers = config().registers.filter((id) => component(id)?.t === "register");
    const index = Number(select.dataset.index);
    if (component(select.value)?.t !== "register" || registers.includes(select.value)) return;
    registers[index] = select.value;
    setConfig({ registers });
  });
  registerOptions.addEventListener("click", (event) => {
    const remove = event.target.closest("button[data-index]");
    if (!remove) return;
    const registers = config().registers.filter((id) => component(id)?.t === "register");
    registers.splice(Number(remove.dataset.index), 1);
    setConfig({ registers });
  });
  formatEl.addEventListener("change", () => setConfig({ format: formatEl.value }));
  function run(enable) {
    if (enable && assemblyDraft(activeRom())?.dirty) { status("Save your draft to ROM before Play.", true); return; }
    const item = component(config().run);
    if (item?.t !== "clock") { status("Link a clock in Program setup.", true); return; }
    skipBreakpointAt = enable && breakpoints.get(activeRom()?.id)?.has(pcValue()) ? pcValue() : null;
    const changed = (item.enable !== false) === enable || getEditor().setClockEnabled(item.id, enable);
    if (!changed) status("Clock could not be changed.", true);
    else status(enable ? "Playing." : "Paused.");
  }
  $("play").addEventListener("click", () => run(true));
  $("pause").addEventListener("click", () => run(false));
  function pulse(ids) {
    const selected = [...new Set(ids)].filter((id) => component(id)?.t === "button");
    let ok = true;
    for (const id of selected) ok = getEditor().setButtonPressed(id, true) && ok;
    for (const id of selected) getEditor().setButtonPressed(id, false);
    return selected.length > 0 && ok;
  }
  $("step-button").addEventListener("click", () => {
    if (assemblyDraft(activeRom())?.dirty) { status("Save your draft to ROM before Step.", true); return; }
    const ok = pulse([config().step]);
    status(ok ? "Stepped." : "Step button could not be pressed.", !ok);
    updatePc();
  });
  $("reset").addEventListener("click", () => {
    const ok = pulse([config().resetPc, config().resetRegisters]);
    status(ok ? "PC and registers reset." : "Reset controls could not be pressed.", !ok);
  });
  function ensureBoard() {
    const board = getEditor().board;
    if (draftBoard === board) return;
    drafts.clear(); isaDrafts.clear(); breakpoints.clear(); skipBreakpointAt = null; draftBoard = board;
    sourceEl.dataset.rom = "";
    renderedSyntax = "";
    renderedIsaRoms = "";
  }
  return { render, renderIsa, checkBreakpoint,
    exportDrafts() {
      ensureBoard();
      return {
        isa: [...isaDrafts].filter(([id, draft]) => draft.dirty && component(id)?.t === "rom").map(([id, draft]) => [id, structuredClone(draft.rules)]),
        assembly: [...drafts].filter(([id, draft]) => draft.dirty && component(id)?.t === "rom").map(([id, draft]) => [id, draft.text]),
        breakpoints: [...breakpoints].filter(([id, addresses]) => component(id)?.t === "rom" && addresses.size)
          .map(([id, addresses]) => [id, [...addresses].sort((a, b) => a - b)]),
      };
    },
    restoreDrafts({ isa = [], assembly = [], breakpoints: savedBreakpoints = [] } = {}) {
      ensureBoard();
      for (const [id, rules] of isa) {
        const rom = component(id);
        isaDrafts.set(id, { rules: structuredClone(rules), saved: savedIsa(rom), dirty: true, selected: [] });
      }
      for (const [id, source] of assembly) {
        const rom = component(id);
        drafts.set(id, { text: source, key: romKey(rom), dirty: true });
      }
      for (const [id, addresses] of savedBreakpoints) breakpoints.set(id, new Set(addresses));
      renderedIsaRoms = "";
      renderIsa();
      render();
    },
    syncRom(id) {
    drafts.delete(id);
    if (activeRom()?.id === id) updateAssembly();
  }, reset() {
    for (const timer of registerHighlightTimers.values()) clearTimeout(timer);
    registerHighlightTimers.clear();
    previousRegisterValues.clear();
    renderedEditor = null; renderedComponents = ""; renderedConfig = ""; renderedIsaRoms = "";
    drafts.clear(); isaDrafts.clear(); breakpoints.clear(); skipBreakpointAt = null; draftBoard = null; sourceEl.dataset.rom = "";
    renderedSyntax = "";
    defaultBoard = null;
  } };
}
