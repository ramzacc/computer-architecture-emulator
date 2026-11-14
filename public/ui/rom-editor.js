import { addressWidth, bitWidth } from "../core/components.js";
import { parseRomFile, serializeRomFile, validHexWord } from "../core/rom-format.js";
import { ctx } from "./context.js";
import { byIds, downloadText, setStatus, uniqueLabels } from "./dom.js";
import { syncRom } from "./program.js";
import { tabs } from "./views.js";

const ROM_COLUMN_SIZE = 16;
const ROM_PAGE_SIZE = ROM_COLUMN_SIZE * 4;

const $ = byIds("rom-rows", "rom-range", "rom-prev", "rom-next", "rom-jump", "rom-go",
  "rom-save", "rom-file-input", "rom-export", "rom-list", "rom-widths", "rom-actions",
  "rom-empty", "rom-editor-wrap", "rom-status");
const romDrafts = new Map();
let romTargetId = null;
let romPageStart = 0;
let romRenderedKey = null;

function romTarget() {
  const component = ctx.editor.component(romTargetId);
  return component?.t === "rom" ? component : null;
}

function romStatus(message, error = false) {
  setStatus($.romStatus, message, error);
}

function romEntries(component) {
  const draft = romDrafts.get(component.id);
  if (!draft) return new Map(component.data ?? []);
  const addressSize = addressWidth(component);
  const dataSize = bitWidth(component);
  if (draft.addressSize !== addressSize || draft.dataSize !== dataSize) {
    draft.entries = new Map([...draft.entries]
      .filter(([address]) => address < 2 ** addressSize)
      .map(([address, value]) => [address, value % (2 ** dataSize)])
      .filter(([, value]) => value !== 0));
    draft.addressSize = addressSize;
    draft.dataSize = dataSize;
  }
  return draft.entries;
}

function romLocked(component) {
  if (!component || ctx.board.program?.rom !== component.id) return false;
  const run = ctx.board.components.find((item) => item.id === ctx.board.program.run);
  return run?.t === "clock" && run.enable !== false;
}

function editRomEntry(component, address, value) {
  if (romLocked(component)) return;
  if (!romDrafts.has(component.id)) romDrafts.set(component.id, {
    entries: new Map(component.data ?? []), addressSize: addressWidth(component), dataSize: bitWidth(component),
  });
  const entries = romEntries(component);
  if (value) entries.set(address, value);
  else entries.delete(address);
  romStatus("Unsaved ROM edits.");
}

function addressLabel(address, width) {
  return address.toString(16).toUpperCase().padStart(Math.max(2, Math.ceil(width / 4)), "0");
}

function constrainHexInput(input, width) {
  const currentWidth = () => typeof width === "function" ? width() : width;
  input.addEventListener("beforeinput", (event) => {
    if (event.data === null || event.isComposing) return;
    const next = input.value.slice(0, input.selectionStart) + event.data + input.value.slice(input.selectionEnd);
    if (!validHexWord(next, currentWidth())) {
      event.preventDefault();
      romStatus(`Use hexadecimal digits that fit ${currentWidth()} bits.`, true);
    }
  });
  input.addEventListener("input", () => {
    if (validHexWord(input.value, currentWidth())) {
      input.dataset.valid = input.value;
      delete input.dataset.rejected;
    } else {
      input.value = input.dataset.valid ?? "";
      input.dataset.rejected = "true";
      romStatus(`Use hexadecimal digits that fit ${currentWidth()} bits.`, true);
    }
  });
}

function renderRomRows(force = false) {
  const component = romTarget();
  if (!component) {
    $.romRows.replaceChildren();
    $.romRange.textContent = "";
    $.romPrev.disabled = true;
    $.romNext.disabled = true;
    romRenderedKey = null;
    return;
  }
  const count = 2 ** addressWidth(component);
  romPageStart = Math.min(romPageStart, Math.floor((count - 1) / ROM_PAGE_SIZE) * ROM_PAGE_SIZE);
  const key = `${component.id}:${addressWidth(component)}:${bitWidth(component)}:${romPageStart}:${romLocked(component)}`;
  if (!force && key === romRenderedKey) return;
  romRenderedKey = key;
  const end = Math.min(romPageStart + ROM_PAGE_SIZE, count);
  $.romRange.textContent = `${addressLabel(romPageStart, addressWidth(component))}–${addressLabel(end - 1, addressWidth(component))} of ${addressLabel(count - 1, addressWidth(component))}`;
  $.romPrev.disabled = romPageStart === 0;
  $.romNext.disabled = end === count;
  const entries = romEntries(component);
  const digits = Math.ceil(bitWidth(component) / 4);
  const fragment = document.createDocumentFragment();
  for (let columnStart = romPageStart; columnStart < end; columnStart += ROM_COLUMN_SIZE) {
    const column = document.createElement("div");
    column.className = "rom-column";
    const header = document.createElement("div");
    header.className = "rom-column-head";
    const addressHead = document.createElement("span");
    addressHead.textContent = "Address";
    const valueHead = document.createElement("span");
    valueHead.textContent = "Hex value";
    header.append(addressHead, valueHead);
    column.appendChild(header);
    for (let address = columnStart; address < Math.min(columnStart + ROM_COLUMN_SIZE, end); address++) {
      const row = document.createElement("div");
      row.className = "rom-row";
      const label = document.createElement("span");
      label.className = "rom-address";
      label.textContent = addressLabel(address, addressWidth(component));
      const input = document.createElement("input");
      input.type = "text";
      input.disabled = romLocked(component);
      input.inputMode = "text";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.maxLength = digits;
      input.dataset.address = String(address);
      input.placeholder = "0".padStart(digits, "0");
      input.setAttribute("aria-label", `Value at address ${label.textContent}`);
      input.value = entries.has(address) ? entries.get(address).toString(16).toUpperCase().padStart(digits, "0") : "";
      input.dataset.valid = input.value;
      constrainHexInput(input, bitWidth(component));
      input.addEventListener("input", () => {
        if (input.dataset.rejected === "true") { delete input.dataset.rejected; return; }
        if (romTarget() !== component || !validHexWord(input.value, bitWidth(component))) return;
        input.value = input.value.toUpperCase();
        input.dataset.valid = input.value;
        editRomEntry(component, address, input.value ? parseInt(input.value, 16) : 0);
      });
      input.addEventListener("keydown", (event) => {
        const direction = event.key === "ArrowDown" || event.key === "Enter" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        if (!direction) return;
        const next = $.romRows.querySelector(`input[data-address="${address + direction}"]`);
        if (next) { event.preventDefault(); next.focus(); next.select(); }
      });
      row.append(label, input);
      column.append(row);
    }
    fragment.append(column);
  }
  $.romRows.replaceChildren(fragment);
}

export function renderRomTab() {
  const roms = ctx.board.components.filter((item) => item.t === "rom");
  if (!romTarget()) romTargetId = roms[0]?.id ?? null;
  const component = romTarget();
  const ready = !!component;
  $.romList.replaceChildren();
  const names = uniqueLabels(roms, "ROM");
  roms.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = names[index];
    button.className = "rom-list-item";
    button.classList.toggle("active", item.id === romTargetId);
    button.setAttribute("aria-pressed", String(item.id === romTargetId));
    button.addEventListener("click", () => openRom(item.id));
    $.romList.append(button);
  });
  $.romEmpty.hidden = ready;
  $.romEditorWrap.hidden = !ready;
  $.romActions.hidden = !ready;
  if (!ready) romStatus("");
  $.romWidths.textContent = ready ? `${addressWidth(component)}-bit address · ${bitWidth(component)}-bit data` : "";
  $.romWidths.hidden = !ready;
  $.romSave.disabled = !ready || romLocked(component);
  $.romFileInput.disabled = !ready || romLocked(component);
  $.romExport.disabled = !ready;
  $.romJump.disabled = !ready;
  $.romGo.disabled = !ready;
  if (ready && !validHexWord($.romJump.value, addressWidth(component))) {
    $.romJump.value = "";
    $.romJump.dataset.valid = "";
  }
  renderRomRows();
}

export function openRom(id) {
  const component = ctx.editor.component(id);
  if (component?.t !== "rom") return;
  romTargetId = component.id;
  romPageStart = 0;
  romRenderedKey = null;
  $.romJump.value = "";
  $.romJump.dataset.valid = "";
  romStatus(romDrafts.has(component.id) ? "Unsaved ROM edits." : "");
  tabs.show("rom-view");
  $.romRows.querySelector("input")?.focus();
}

$.romPrev.addEventListener("click", () => { romPageStart -= ROM_PAGE_SIZE; renderRomRows(true); });
$.romNext.addEventListener("click", () => { romPageStart += ROM_PAGE_SIZE; renderRomRows(true); });
constrainHexInput($.romJump, () => romTarget() ? addressWidth(romTarget()) : 1);
$.romJump.addEventListener("keydown", (event) => { if (event.key === "Enter") $.romGo.click(); });
$.romGo.addEventListener("click", () => {
  const component = romTarget();
  if (!component || !$.romJump.value) return;
  const address = parseInt($.romJump.value, 16);
  if (address >= 2 ** addressWidth(component)) {
    romStatus(`Address must fit ${addressWidth(component)} bits.`, true);
    return;
  }
  romPageStart = Math.floor(address / ROM_PAGE_SIZE) * ROM_PAGE_SIZE;
  renderRomRows(true);
  $.romRows.querySelector(`input[data-address="${address}"]`)?.focus();
});

$.romSave.addEventListener("click", () => {
  const component = romTarget();
  if (!component || romLocked(component)) return;
  try {
    const entries = [...romEntries(component)].sort((a, b) => a[0] - b[0]);
    const changed = JSON.stringify(entries) !== JSON.stringify(component.data ?? []);
    if (changed && !ctx.editor.setRomData(component.id, entries))
      throw new Error("ROM contents conflict with a connected output.");
    romDrafts.delete(component.id);
    if (changed) syncRom(component.id);
    romStatus("ROM changes saved.");
  } catch (error) { romStatus(error.message, true); }
});

$.romFileInput.addEventListener("change", async () => {
  const file = $.romFileInput.files[0];
  $.romFileInput.value = "";
  const component = romTarget();
  if (!file || !component || romLocked(component)) return;
  try {
    const contents = await file.text();
    if (romTarget() !== component || romLocked(component)) return;
    const entries = parseRomFile(contents, addressWidth(component), bitWidth(component));
    romDrafts.set(component.id, { entries: new Map(entries), addressSize: addressWidth(component), dataSize: bitWidth(component) });
    renderRomRows(true);
    romStatus("ROM file loaded. Save to apply it to the component.");
  } catch (error) { romStatus(error.message, true); }
});

$.romExport.addEventListener("click", () => {
  const component = romTarget();
  if (!component) return;
  try {
    const entries = [...romEntries(component)].sort((a, b) => a[0] - b[0]);
    downloadText(`${component.id}.txt`, serializeRomFile(entries, addressWidth(component), bitWidth(component)));
    romStatus("ROM file exported.");
  } catch (error) { romStatus(error.message, true); }
});


export function clearTarget() {
  romTargetId = null;
}

export function reset() {
  romTargetId = null;
  romDrafts.clear();
  romPageStart = 0;
  romRenderedKey = null;
  $.romJump.value = "";
  $.romJump.dataset.valid = "";
  romStatus("");
}

export function exportDrafts() {
  return [...romDrafts].filter(([id]) => ctx.editor.component(id)?.t === "rom")
    .map(([id]) => [id, [...romEntries(ctx.editor.component(id))]]);
}

export function restoreDrafts(entries) {
  for (const [id, values] of entries) {
    const component = ctx.editor.component(id);
    romDrafts.set(id, { entries: new Map(values), addressSize: addressWidth(component), dataSize: bitWidth(component) });
  }
}
