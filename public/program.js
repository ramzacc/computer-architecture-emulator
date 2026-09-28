import { addressWidth, bitWidth } from "./components.js";
import { formatValue } from "./value-format.js";

const PAGE_SIZE = 64;
const fields = { rom: "rom", pc: "tag", run: "clock", step: "button", resetPc: "button", resetRegisters: "button" };
const names = { rom: "Program ROM", pc: "PC", run: "Main Clock", step: "Manual Clock", resetPc: "RESET PC", resetRegisters: "Reset Registers" };
const $ = (id) => document.getElementById(`program-${id}`);

export function parseInstruction(text, format, width) {
  const clean = text.trim().replaceAll("_", "");
  if (!clean) return 0;
  const digits = format === "binary" ? clean.replace(/^0b/i, "") : clean.replace(/^0x/i, "");
  if (!(format === "binary" ? /^[01]+$/ : /^[0-9a-f]+$/i).test(digits)) return null;
  const value = Number.parseInt(digits, format === "binary" ? 2 : 16);
  return Number.isSafeInteger(value) && value < 2 ** width ? value : null;
}

export function instructionDigits(width, format) {
  return format === "binary" ? width : Math.ceil(width / 4);
}

export function createProgram({ getEditor }) {
  const selectEls = Object.fromEntries(Object.keys(fields).map((key) => [key, $(key === "resetPc" ? "reset-pc" : key === "resetRegisters" ? "reset-registers" : key)]));
  const registerOptions = $("register-options");
  const registerValues = $("register-values");
  const linesEl = $("lines");
  const offsetEl = $("offset");
  const formatEl = $("format");
  const statusEl = $("status");
  let renderedEditor = null;
  let renderedComponents = "";
  let renderedConfig = "";
  let renderedPage = "";
  let renderedRegisters = "";
  const previousRegisterValues = new Map();
  const registerHighlightTimers = new Map();
  let defaultConfig = null;
  let defaultBoard = null;
  let followPc = true;

  const components = () => getEditor().board.components;
  const component = (id) => components().find((item) => item.id === id);
  function config() {
    const board = getEditor().board;
    if (board.program) return board.program;
    if (defaultBoard !== board) {
      defaultBoard = board;
      defaultConfig = Object.fromEntries(Object.keys(fields).map((key) =>
        [key, components().find((item) => item.label === names[key] && [].concat(fields[key]).includes(item.t))?.id ?? null]));
      defaultConfig.registers = components().filter((item) => item.t === "tag" && /^R\d+$/i.test(item.label)).map((item) => item.id);
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
  function maxAddress() { const rom = activeRom(); return rom ? 2 ** addressWidth(rom) - 1 : 0; }
  function formatAddress(address) {
    return `0x${address.toString(16).toUpperCase().padStart(Math.max(2, Math.ceil(addressWidth(activeRom() ?? { addressSize: 8 }) / 4)), "0")}`;
  }
  function pageOffset() {
    const pc = pcValue();
    return followPc && activeRom() && pc !== null
      ? Math.min(Math.floor(pc / PAGE_SIZE) * PAGE_SIZE, Math.floor(maxAddress() / PAGE_SIZE) * PAGE_SIZE)
      : Math.min(config().offset, maxAddress());
  }
  function updateSelectors() {
    for (const [key, type] of Object.entries(fields)) {
      const select = selectEls[key];
      const current = config()[key];
      const allowed = components().filter((item) => [].concat(type).includes(item.t));
      select.replaceChildren(new Option("Select…", ""), ...allowed.map((item) => new Option(item.label || item.t, item.id)));
      select.value = allowed.some((item) => item.id === current) ? current : "";
    }
    registerOptions.replaceChildren();
    const tags = components().filter((item) => item.t === "tag");
    if (!tags.length) registerOptions.textContent = "Add tags on Canvas to watch registers.";
    for (const tag of tags) {
      const label = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.value = tag.id;
      check.checked = config().registers.includes(tag.id);
      label.append(check, document.createTextNode(tag.label || "Tag"));
      registerOptions.append(label);
    }
    formatEl.value = config().format;
    offsetEl.value = config().offset.toString(16).toUpperCase();
  }
  function updateRegisters(force = false) {
    const tags = config().registers.map(component).filter((item) => item?.t === "tag");
    const key = JSON.stringify(tags.map((item) => [item.id, item.label, bitWidth(item)]));
    if (force || key !== renderedRegisters) {
      for (const timer of registerHighlightTimers.values()) clearTimeout(timer);
      registerHighlightTimers.clear();
      registerValues.replaceChildren();
      renderedRegisters = key;
      if (!tags.length) registerValues.textContent = "Select register tags in Program setup.";
      for (const tag of tags) {
        const row = document.createElement("div");
        row.className = "program-register-row";
        const name = document.createElement("span");
        name.textContent = tag.label || "Tag";
        const value = document.createElement("output");
        value.dataset.tag = tag.id;
        row.append(name, value);
        registerValues.append(row);
      }
    }
    for (const output of registerValues.querySelectorAll("[data-tag]")) {
      const tag = component(output.dataset.tag);
      const value = getEditor().evaluation.states.get(tag.id)?.value ?? 0;
      const previous = previousRegisterValues.get(tag.id);
      if (previous !== undefined && previous !== value) {
        const row = output.parentElement;
        clearTimeout(registerHighlightTimers.get(tag.id));
        row.classList.add("updated");
        registerHighlightTimers.set(tag.id, setTimeout(() => {
          row.classList.remove("updated");
          registerHighlightTimers.delete(tag.id);
        }, 1200));
      }
      previousRegisterValues.set(tag.id, value);
      output.textContent = formatValue(value, bitWidth(tag), config().format);
    }
  }
  function pcValue() {
    const tag = component(config().pc);
    return tag?.t === "tag" ? getEditor().evaluation.states.get(tag.id)?.value ?? 0 : null;
  }
  function updatePc() {
    const pc = pcValue();
    $("pc-value").textContent = pc === null ? "—" : formatAddress(pc);
    for (const row of linesEl.querySelectorAll(".program-line[data-address]")) {
      const current = Number(row.dataset.address) === pc;
      row.classList.toggle("current", current);
      row.querySelector("[data-marker]").textContent = current ? "▶" : "";
    }
    const run = component(config().run);
    const playing = run?.t === "clock" && run.enable !== false;
    $("play").disabled = run?.t !== "clock" || playing;
    $("pause").disabled = run?.t !== "clock" || !playing;
    $("step-button").disabled = component(config().step)?.t !== "button";
    $("reset").disabled = ![config().resetPc, config().resetRegisters].every((id) => component(id)?.t === "button");
  }
  function renderLines(force = false) {
    const rom = activeRom();
    const offset = pageOffset();
    const key = rom ? `${rom.id}:${bitWidth(rom)}:${addressWidth(rom)}:${offset}:${config().format}:${JSON.stringify(rom.data)}` : "none";
    if (!force && key === renderedPage) return;
    renderedPage = key;
    linesEl.replaceChildren();
    $("prev").disabled = !rom || offset === 0;
    $("next").disabled = !rom || offset + PAGE_SIZE > maxAddress();
    offsetEl.disabled = !rom;
    if (!rom) {
      $("word-heading").textContent = "Instruction";
      linesEl.textContent = "Link a ROM to edit instructions.";
      return;
    }
    const words = new Map(rom.data ?? []);
    const width = bitWidth(rom);
    const digits = instructionDigits(width, config().format);
    $("word-heading").textContent = `${config().format === "binary" ? "Binary" : "Hex"} instruction · ${width} bits`;
    for (let address = offset; address <= Math.min(maxAddress(), offset + PAGE_SIZE - 1); address++) {
      const row = document.createElement("div");
      row.className = "program-line";
      row.dataset.address = String(address);
      const marker = document.createElement("span");
      marker.dataset.marker = "";
      marker.className = "program-line-marker";
      const addressEl = document.createElement("span");
      addressEl.textContent = formatAddress(address);
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "text";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.dataset.address = String(address);
      input.size = digits;
      input.maxLength = digits * 2 + 2;
      input.style.setProperty("--instruction-width", `${Math.max(6, digits + 2)}ch`);
      input.setAttribute("aria-label", `${width}-bit ${config().format} instruction at ${formatAddress(address)}`);
      const value = words.get(address) ?? 0;
      input.value = value.toString(config().format === "binary" ? 2 : 16).toUpperCase()
        .padStart(digits, "0");
      row.append(marker, addressEl, input);
      linesEl.append(row);
    }
    updatePc();
  }
  function render() {
    const editor = getEditor();
    const key = JSON.stringify(editor.board.components.map((item) => [item.id, item.t, item.label]));
    const configKey = JSON.stringify(config());
    if (renderedEditor !== editor || renderedComponents !== key || renderedConfig !== configKey) {
      if (renderedEditor !== editor) previousRegisterValues.clear();
      renderedEditor = editor;
      renderedComponents = key;
      renderedConfig = configKey;
      renderedPage = "";
      renderedRegisters = "";
      updateSelectors();
    }
    if (document.activeElement !== offsetEl) offsetEl.value = pageOffset().toString(16).toUpperCase();
    formatEl.value = config().format;
    renderLines();
    updateRegisters();
    updatePc();
  }
  for (const key of Object.keys(fields)) selectEls[key].addEventListener("change", () => setConfig({ [key]: selectEls[key].value || null }));
  registerOptions.addEventListener("change", () => {
    setConfig({ registers: [...registerOptions.querySelectorAll("input:checked")].map((input) => input.value) });
  });
  formatEl.addEventListener("change", () => { renderedPage = ""; setConfig({ format: formatEl.value }); });
  function setOffset(value) {
    followPc = false;
    $("follow").checked = false;
    if (!activeRom() || !/^(?:0x)?[0-9a-f]+$/i.test(value.trim())) { status("Enter a hexadecimal ROM address.", true); return; }
    const address = Number.parseInt(value.trim().replace(/^0x/i, ""), 16);
    if (address > maxAddress()) { status("Address exceeds the linked ROM.", true); return; }
    renderedPage = "";
    setConfig({ offset: address });
    status("");
  }
  offsetEl.addEventListener("change", () => setOffset(offsetEl.value));
  offsetEl.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); offsetEl.blur(); } });
  $("prev").addEventListener("click", () => setOffset(Math.max(0, pageOffset() - PAGE_SIZE).toString(16)));
  $("next").addEventListener("click", () => setOffset(Math.min(maxAddress(), pageOffset() + PAGE_SIZE).toString(16)));
  $("follow").addEventListener("change", () => { followPc = $("follow").checked; renderedPage = ""; render(); });
  linesEl.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-address]");
    if (!input) return;
    const rom = activeRom();
    if (!rom) return;
    const value = parseInstruction(input.value, config().format, bitWidth(rom));
    if (value === null) { status(`Use a ${bitWidth(rom)}-bit ${config().format} instruction.`, true); input.setAttribute("aria-invalid", "true"); return; }
    input.removeAttribute("aria-invalid");
    const entries = new Map(rom.data ?? []);
    const address = Number(input.dataset.address);
    if (value) entries.set(address, value); else entries.delete(address);
    const sorted = [...entries].sort((a, b) => a[0] - b[0]);
    if (JSON.stringify(sorted) !== JSON.stringify(rom.data ?? [])) {
      const previousKey = renderedPage;
      renderedPage = `${rom.id}:${bitWidth(rom)}:${addressWidth(rom)}:${pageOffset()}:${config().format}:${JSON.stringify(sorted)}`;
      if (!getEditor().setRomData(rom.id, sorted)) {
        renderedPage = previousKey;
        status("ROM write could not be applied to the circuit.", true);
        return;
      }
    }
    input.value = value.toString(config().format === "binary" ? 2 : 16).toUpperCase()
      .padStart(instructionDigits(bitWidth(rom), config().format), "0");
    status(`Saved ${formatAddress(address)} to ROM.`);
  });
  linesEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.target.tagName !== "INPUT") return;
    event.preventDefault();
    const address = Number(event.target.dataset.address);
    event.target.dispatchEvent(new Event("change", { bubbles: true }));
    const next = linesEl.querySelector(`input[data-address="${address + 1}"]`);
    next?.focus(); next?.select();
  });
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
  return { render, reset() {
    for (const timer of registerHighlightTimers.values()) clearTimeout(timer);
    registerHighlightTimers.clear();
    previousRegisterValues.clear();
    renderedEditor = null; renderedComponents = ""; renderedConfig = ""; renderedPage = "";
    defaultBoard = null; followPc = true; $("follow").checked = true;
  } };
}
