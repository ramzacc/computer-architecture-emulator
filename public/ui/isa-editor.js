import { bitWidth } from "../core/components.js";
import { assignIsaCell, isaGrid, parseIsa, serializeIsaGrid } from "../core/assembly.js";
import { byId, el } from "./dom.js";

const operandName = (index) => index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
const operandHue = (index) => (195 + index * 137.508) % 360;

/** The Assembly view's ISA rule editor, shared with the Program tab's ROM. */
export function createIsaEditor({ getEditor, getConfig, setConfig }) {
  const romEl = byId("isa-rom");
  const rulesEl = byId("isa-rules");
  const addEl = byId("isa-add");
  const saveEl = byId("isa-save");
  const noteEl = byId("isa-note");
  const drafts = new Map();
  let draftBoard = null;
  let renderedRoms = "";

  const components = () => getEditor().board.components;
  const component = (id) => components().find((item) => item.id === id);
  const activeRom = () => {
    const item = component(getConfig().rom);
    return item?.t === "rom" ? item : null;
  };
  const savedIsa = (rom) => getConfig().isa?.[rom.id] ?? "";

  function ensureBoard() {
    const board = getEditor().board;
    if (draftBoard === board) return;
    drafts.clear();
    draftBoard = board;
    renderedRoms = "";
  }

  function isaDraft(rom) {
    let draft = drafts.get(rom.id);
    if (!draft) {
      draft = { rules: isaGrid(savedIsa(rom), bitWidth(rom)), saved: savedIsa(rom), dirty: false, selected: [] };
      drafts.set(rom.id, draft);
    }
    if (!draft.dirty && draft.saved !== savedIsa(rom)) {
      draft.rules = isaGrid(savedIsa(rom), bitWidth(rom));
      draft.saved = savedIsa(rom);
    }
    return draft;
  }

  function markDirty(draft) {
    draft.dirty = true;
    noteEl.textContent = "Unsaved assembly rules.";
    noteEl.classList.remove("error");
  }

  function render() {
    ensureBoard();
    const roms = components().filter((item) => item.t === "rom");
    const key = JSON.stringify(roms.map((item) => [item.id, item.label, bitWidth(item)]));
    if (key !== renderedRoms) {
      renderedRoms = key;
      romEl.replaceChildren(new Option("Select ROM…", ""), ...roms.map((item) =>
        new Option(`${item.label || "ROM"} · ${bitWidth(item)} bits`, item.id)));
    }
    const rom = activeRom();
    romEl.value = rom?.id ?? "";
    addEl.disabled = !rom;
    saveEl.disabled = !rom;
    rulesEl.replaceChildren();
    if (!rom) {
      noteEl.textContent = roms.length ? "Select a ROM." : "Add a ROM on Canvas.";
      return;
    }
    let draft;
    try { draft = isaDraft(rom); }
    catch (error) {
      noteEl.textContent = error.message;
      noteEl.classList.add("error");
      return;
    }
    noteEl.textContent = draft.dirty ? "Unsaved assembly rules." : `${bitWidth(rom)}-bit ROM · rules saved.`;
    noteEl.classList.remove("error");
    draft.rules.forEach((rule, ruleIndex) => rulesEl.append(ruleCard(rule, ruleIndex, draft)));
  }

  function ruleCard(rule, ruleIndex, draft) {
    const keyword = el("input", {
      value: rule.keyword,
      placeholder: "KEYWORD",
      maxLength: 24,
      dataset: { action: "keyword" },
      "aria-label": `Instruction ${ruleIndex + 1} keyword`,
    });
    const comment = el("input", {
      value: rule.comment ?? "",
      placeholder: "Comment (optional)",
      maxLength: 160,
      dataset: { action: "comment" },
      "aria-label": `Instruction ${ruleIndex + 1} comment`,
    });
    const remove = el("button", { type: "button", textContent: "Remove", dataset: { action: "remove-rule" } });
    const head = el("div", { className: "isa-card-head" }, keyword, comment, remove);

    const palette = el("div", { className: "isa-palette" });
    for (const [index, operand] of rule.operands.entries()) {
      const value = `operand:${index}`;
      const button = el("button", {
        type: "button",
        textContent: `${operand.kind === "register" ? "Register" : "Value"} ${operandName(index)}`,
        dataset: { action: "select", value },
        "aria-pressed": String(draft.selected[ruleIndex] === value),
      });
      button.classList.add("isa-operand-color");
      button.classList.toggle("selected", draft.selected[ruleIndex] === value);
      button.style.setProperty("--isa-hue", operandHue(index));
      palette.append(button);
    }
    palette.append(
      el("button", { type: "button", textContent: "+ Register", dataset: { action: "add-register" } }),
      el("button", { type: "button", textContent: "+ Value", dataset: { action: "add-value" } }),
    );

    const operandList = el("div", { className: "isa-operand-list" });
    rule.operands.forEach((operand, operandIndex) => {
      const kind = el("select", { dataset: { action: "kind" }, "aria-label": `Operand ${operandIndex + 1} type` });
      kind.replaceChildren(new Option("Register", "register"), new Option("Value", "value"));
      kind.value = operand.kind;
      const name = el("span", { className: "isa-operand-name", textContent: operandName(operandIndex) });
      name.style.setProperty("--isa-hue", operandHue(operandIndex));
      const removeOperand = el("button", {
        type: "button",
        textContent: "×",
        dataset: { action: "remove-operand" },
        "aria-label": `Remove operand ${operandName(operandIndex)}`,
      });
      operandList.append(el("div", { className: "isa-operand", dataset: { operand: String(operandIndex) } },
        name, kind, removeOperand));
    });

    const grid = el("div", { className: "isa-grid", role: "group", "aria-label": `${rule.keyword || "Instruction"} bits` });
    for (let bit = rule.cells.length - 1; bit >= 0; bit--) {
      const cell = rule.cells[bit];
      const button = el("button", { type: "button", dataset: { action: "cell", bit: String(bit) } });
      button.classList.add(cell === null ? "empty-cell" : typeof cell === "number" ? "operand-cell" : "fixed-cell");
      if (typeof cell === "number") button.style.setProperty("--isa-hue", operandHue(cell));
      const position = typeof cell === "number" ? rule.operands[cell]?.bits.indexOf(bit) ?? -1 : -1;
      const label = cell === null ? "·" : typeof cell === "number" ? `${operandName(cell)}${rule.operands[cell].bits.length - position - 1}` : cell;
      button.innerHTML = `<small>${bit}</small><strong>${label}</strong>`;
      button.setAttribute("aria-label", `Bit ${bit}: ${typeof cell === "number"
        ? `${rule.operands[cell]?.kind} ${operandName(cell)} bit ${rule.operands[cell].bits.length - position - 1}`
        : cell ?? "unassigned"}`);
      grid.append(button);
    }

    const controls = el("div", { className: "isa-card-controls" }, palette, operandList);
    const card = el("section", { className: "isa-card", dataset: { rule: String(ruleIndex) } },
      head, el("div", { className: "isa-card-body" }, controls, grid));
    return card;
  }

  romEl.addEventListener("change", () => {
    setConfig({ rom: romEl.value || null });
    render();
  });
  addEl.addEventListener("click", () => {
    const rom = activeRom();
    if (!rom) return;
    const draft = isaDraft(rom);
    draft.rules.push({ keyword: "", cells: Array(bitWidth(rom)).fill(null), operands: [] });
    markDirty(draft);
    render();
    rulesEl.lastElementChild?.querySelector("input")?.focus();
  });
  rulesEl.addEventListener("input", (event) => {
    const action = event.target.dataset.action;
    if (action !== "keyword" && action !== "comment") return;
    const draft = isaDraft(activeRom());
    const rule = draft.rules[Number(event.target.closest("[data-rule]").dataset.rule)];
    rule[action] = action === "keyword" ? event.target.value.toUpperCase() : event.target.value;
    markDirty(draft);
  });
  rulesEl.addEventListener("change", (event) => {
    if (event.target.dataset.action !== "kind") return;
    const draft = isaDraft(activeRom());
    const card = event.target.closest("[data-rule]");
    draft.rules[Number(card.dataset.rule)].operands[Number(event.target.closest("[data-operand]").dataset.operand)].kind = event.target.value;
    markDirty(draft);
    render();
  });
  rulesEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const rom = activeRom();
    if (!rom) return;
    const draft = isaDraft(rom);
    const ruleIndex = Number(button.closest("[data-rule]").dataset.rule);
    const rule = draft.rules[ruleIndex];
    const action = button.dataset.action;
    if (action === "select") {
      draft.selected[ruleIndex] = draft.selected[ruleIndex] === button.dataset.value ? null : button.dataset.value;
      render();
      return;
    }
    if (action === "remove-rule") {
      draft.rules.splice(ruleIndex, 1);
      draft.selected.splice(ruleIndex, 1);
    } else if (action === "add-register" || action === "add-value") {
      rule.operands.push({ kind: action === "add-register" ? "register" : "value", bits: [] });
      draft.selected[ruleIndex] = `operand:${rule.operands.length - 1}`;
    } else if (action === "cell") {
      assignIsaCell(rule, draft.selected[ruleIndex] ?? null, Number(button.dataset.bit));
    } else {
      const operandIndex = Number(button.closest("[data-operand]").dataset.operand);
      if (action === "remove-operand") {
        rule.cells = rule.cells.map((cell) => cell === operandIndex ? null : typeof cell === "number" && cell > operandIndex ? cell - 1 : cell);
        rule.operands.splice(operandIndex, 1);
        draft.selected[ruleIndex] = null;
      }
    }
    markDirty(draft);
    render();
  });
  saveEl.addEventListener("click", () => {
    const rom = activeRom();
    if (!rom) return;
    const draft = isaDraft(rom);
    const source = serializeIsaGrid(draft.rules);
    try {
      parseIsa(source, bitWidth(rom));
      const isa = { ...(getConfig().isa ?? {}) };
      if (draft.rules.length) isa[rom.id] = source;
      else delete isa[rom.id];
      draft.dirty = false;
      draft.saved = isa[rom.id] ?? "";
      if (draft.saved !== savedIsa(rom)) setConfig({ isa });
      render();
      noteEl.textContent = "Assembly rules saved.";
    } catch (error) {
      noteEl.textContent = error.message;
      noteEl.classList.add("error");
    }
  });

  return {
    render,
    reset() {
      drafts.clear();
      draftBoard = null;
      renderedRoms = "";
    },
    exportDrafts() {
      return [...drafts].filter(([id, draft]) => draft.dirty && component(id)?.t === "rom")
        .map(([id, draft]) => [id, structuredClone(draft.rules)]);
    },
    restoreDrafts(entries) {
      for (const [id, rules] of entries) {
        const rom = component(id);
        drafts.set(id, { rules: structuredClone(rules), saved: savedIsa(rom), dirty: true, selected: [] });
      }
      renderedRoms = "";
    },
  };
}
