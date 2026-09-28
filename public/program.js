import { addressWidth, bitWidth } from "./components.js";
import { formatValue } from "./value-format.js";
import { assemble, disassemble, parseIsa, isaGrid, serializeIsaGrid } from "./assembly.js";

const fields = { rom: "rom", pc: "tag", run: "clock", step: "button", resetPc: "button", resetRegisters: "button" };
const names = { rom: "Program ROM", pc: "PC", run: "Main Clock", step: "Manual Clock", resetPc: "Reset PC", resetRegisters: "Reset Registers" };
const $ = (id) => document.getElementById(`program-${id}`);

export function createProgram({ getEditor }) {
  const selectEls = Object.fromEntries(Object.keys(fields).map((key) => [key, $(key === "resetPc" ? "reset-pc" : key === "resetRegisters" ? "reset-registers" : key)]));
  const registerOptions = $("register-options");
  const addRegister = $("add-register");
  const registerEmpty = $("register-empty");
  const registerValues = $("register-values");
  const formatEl = $("format");
  const statusEl = $("status");
  const sourceEl = $("source");
  const assemblyNoteEl = $("assembly-note");
  const assembleEl = $("assemble");
  const reloadEl = $("reload-assembly");
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
  function romKey(rom) { return JSON.stringify([rom.id, bitWidth(rom), addressWidth(rom), rom.data ?? [], savedIsa(rom)]); }
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
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.dataset.action = "remove-rule";
      head.append(keyword, remove); card.append(head);
      const palette = document.createElement("div"); palette.className = "isa-palette";
      for (const [value, label] of [["0", "0"], ["1", "1"], ["clear", "Erase"], ...rule.operands.map((operand, index) => [String(index), `${operand.kind === "register" ? "Register" : "Value"} ${index + 1}`])]) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = label;
        button.dataset.action = "select"; button.dataset.value = value;
        button.classList.toggle("selected", (draft.selected[ruleIndex] ?? "0") === value);
        palette.append(button);
      }
      const addRegister = document.createElement("button"); addRegister.type = "button"; addRegister.textContent = "+ Register"; addRegister.dataset.action = "add-register";
      const addValue = document.createElement("button"); addValue.type = "button"; addValue.textContent = "+ Value"; addValue.dataset.action = "add-value";
      palette.append(addRegister, addValue); card.append(palette);
      const grid = document.createElement("div"); grid.className = "isa-grid"; grid.setAttribute("role", "group"); grid.setAttribute("aria-label", `${rule.keyword || "Instruction"} bits`);
      for (let bit = rule.cells.length - 1; bit >= 0; bit--) {
        const cell = rule.cells[bit]; const button = document.createElement("button"); button.type = "button";
        button.dataset.action = "cell"; button.dataset.bit = String(bit);
        const position = typeof cell === "number" ? rule.operands[cell]?.bits.indexOf(bit) ?? -1 : -1;
        const label = cell === null ? "·" : typeof cell === "number" ? `${cell + 1}:${position + 1}` : cell;
        button.innerHTML = `<small>${bit}</small><strong>${label}</strong>`;
        button.setAttribute("aria-label", `Bit ${bit}: ${typeof cell === "number" ? `${rule.operands[cell]?.kind} ${cell + 1}, order ${position + 1}` : cell ?? "unassigned"}`);
        grid.append(button);
      }
      card.append(grid);
      rule.operands.forEach((operand, operandIndex) => {
        const row = document.createElement("div"); row.className = "isa-operand"; row.dataset.operand = String(operandIndex);
        const kind = document.createElement("select"); kind.dataset.action = "kind"; kind.setAttribute("aria-label", `Operand ${operandIndex + 1} type`);
        kind.replaceChildren(new Option("Register", "register"), new Option("Value", "value")); kind.value = operand.kind;
        const order = document.createElement("span"); order.className = "isa-order";
        operand.bits.forEach((bit, index) => {
          const chip = document.createElement("span"); chip.textContent = `${bit}`;
          const left = document.createElement("button"); left.type = "button"; left.textContent = "←"; left.dataset.action = "move-left"; left.dataset.index = String(index); left.disabled = index === 0;
          const right = document.createElement("button"); right.type = "button"; right.textContent = "→"; right.dataset.action = "move-right"; right.dataset.index = String(index); right.disabled = index === operand.bits.length - 1;
          chip.append(left, right); order.append(chip);
        });
        if (!operand.bits.length) order.textContent = "Assign bits in click order";
        const del = document.createElement("button"); del.type = "button"; del.textContent = "×"; del.dataset.action = "remove-operand"; del.setAttribute("aria-label", `Remove operand ${operandIndex + 1}`);
        row.append(kind, order, del); card.append(row);
      });
      isaRulesEl.append(card);
    });
  }
  function assemblyDraft(rom) {
    if (!rom) return null;
    let draft = drafts.get(rom.id);
    if (!draft) {
      draft = { text: disassemble(rom.data ?? [], bitWidth(rom), savedIsa(rom)), key: romKey(rom), dirty: false };
      drafts.set(rom.id, draft);
    }
    return draft;
  }
  function updateAssembly() {
    const rom = activeRom();
    const draft = assemblyDraft(rom);
    sourceEl.disabled = !rom;
    assembleEl.disabled = !rom || !draft?.dirty;
    reloadEl.disabled = !rom;
    if (!rom) {
      sourceEl.value = "";
      assemblyNoteEl.textContent = "Link a ROM in Program setup.";
      return;
    }
    const key = romKey(rom);
    if (!draft.dirty && draft.key !== key) {
      draft.text = disassemble(rom.data ?? [], bitWidth(rom), savedIsa(rom));
      draft.key = key;
    }
    if (sourceEl.dataset.rom !== rom.id || sourceEl.value !== draft.text) sourceEl.value = draft.text;
    sourceEl.dataset.rom = rom.id;
    assemblyNoteEl.textContent = draft.dirty
      ? draft.key === key ? "Unsaved assembly edits." : "ROM or ISA rules changed since this draft. Assembling will replace ROM contents."
      : "Assembly matches the linked ROM.";
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
  function pcValue() {
    const tag = component(config().pc);
    return tag?.t === "tag" ? getEditor().evaluation.states.get(tag.id)?.value ?? 0 : null;
  }
  function updatePc() {
    const pc = pcValue();
    $("pc-value").textContent = pc === null ? "—" : formatAddress(pc);
    const run = component(config().run);
    const playing = run?.t === "clock" && run.enable !== false;
    $("play").disabled = run?.t !== "clock" || playing;
    $("pause").disabled = run?.t !== "clock" || !playing;
    $("step-button").disabled = component(config().step)?.t !== "button";
    $("reset").disabled = ![config().resetPc, config().resetRegisters].every((id) => component(id)?.t === "button");
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
    }
    formatEl.value = config().format;
    updateAssembly();
    updateRegisters();
    updatePc();
  }
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
    if (event.target.dataset.action !== "keyword") return;
    const draft = isaDraft(isaRom());
    draft.rules[Number(event.target.closest("[data-rule]").dataset.rule)].keyword = event.target.value.toUpperCase();
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
    if (action === "select") { draft.selected[ruleIndex] = button.dataset.value; renderIsa(); return; }
    if (action === "remove-rule") { draft.rules.splice(ruleIndex, 1); draft.selected.splice(ruleIndex, 1); }
    else if (action === "add-register" || action === "add-value") {
      rule.operands.push({ kind: action === "add-register" ? "register" : "value", bits: [] });
      draft.selected[ruleIndex] = String(rule.operands.length - 1);
    } else if (action === "cell") {
      const bit = Number(button.dataset.bit); const selected = draft.selected[ruleIndex] ?? "0";
      for (const operand of rule.operands) operand.bits = operand.bits.filter((item) => item !== bit);
      rule.cells[bit] = selected === "clear" ? null : selected === "0" || selected === "1" ? selected : Number(selected);
      if (typeof rule.cells[bit] === "number") rule.operands[rule.cells[bit]].bits.push(bit);
    } else {
      const operandIndex = Number(button.closest("[data-operand]").dataset.operand);
      if (action === "remove-operand") {
        rule.cells = rule.cells.map((cell) => cell === operandIndex ? null : typeof cell === "number" && cell > operandIndex ? cell - 1 : cell);
        rule.operands.splice(operandIndex, 1); draft.selected[ruleIndex] = "0";
      } else {
        const bits = rule.operands[operandIndex].bits; const index = Number(button.dataset.index);
        const other = action === "move-left" ? index - 1 : index + 1;
        [bits[index], bits[other]] = [bits[other], bits[index]];
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
  sourceEl.addEventListener("input", () => {
    const rom = activeRom();
    if (!rom) return;
    const draft = assemblyDraft(rom);
    draft.text = sourceEl.value;
    draft.dirty = true;
    updateAssembly();
  });
  assembleEl.addEventListener("click", () => {
    const rom = activeRom();
    if (!rom) return;
    const draft = assemblyDraft(rom);
    try {
      const entries = assemble(draft.text, addressWidth(rom), bitWidth(rom), savedIsa(rom));
      if (JSON.stringify(entries) !== JSON.stringify(rom.data ?? [])) {
        if (!getEditor().setRomData(rom.id, entries)) throw new Error("ROM write could not be applied to the circuit.");
      }
      draft.key = romKey(rom);
      draft.dirty = false;
      render();
      status(`Assembled ${entries.length} nonzero words to ROM.`);
    } catch (error) { status(error.message, true); }
  });
  reloadEl.addEventListener("click", () => {
    const rom = activeRom();
    if (!rom) return;
    drafts.delete(rom.id);
    updateAssembly();
    status("Disassembled the current ROM contents.");
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
    const item = component(config().run);
    if (item?.t !== "clock") { status("Link a clock in Program setup.", true); return; }
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
    const ok = pulse([config().step]);
    status(ok ? "Stepped." : "Step button could not be pressed.", !ok);
  });
  $("reset").addEventListener("click", () => {
    const ok = pulse([config().resetPc, config().resetRegisters]);
    status(ok ? "PC and registers reset." : "Reset controls could not be pressed.", !ok);
  });
  function ensureBoard() {
    const board = getEditor().board;
    if (draftBoard === board) return;
    drafts.clear(); isaDrafts.clear(); draftBoard = board;
    sourceEl.dataset.rom = "";
    renderedIsaRoms = "";
  }
  return { render, renderIsa, reset() {
    for (const timer of registerHighlightTimers.values()) clearTimeout(timer);
    registerHighlightTimers.clear();
    previousRegisterValues.clear();
    renderedEditor = null; renderedComponents = ""; renderedConfig = ""; renderedIsaRoms = "";
    drafts.clear(); isaDrafts.clear(); draftBoard = null; sourceEl.dataset.rom = "";
    defaultBoard = null;
  } };
}
