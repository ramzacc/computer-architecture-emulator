import { bitWidth } from "./components.js";
import { formatValue, validValueFormat } from "./value-format.js";

export function createMonitor({ getEditor, signalsEl, noSignalsEl, gridEl, emptyEl }) {
  const layouts = new WeakMap();
  let draggingId = null;
  let renderedScope = null;
  let renderedTags = "";

  function layout() {
    const editor = getEditor();
    if (!layouts.has(editor)) layouts.set(editor, { ids: [], formats: new Map() });
    return layouts.get(editor);
  }

  function tags() {
    return getEditor().board.components.filter((component) => component.t === "tag");
  }

  function add(id, index = layout().ids.length) {
    if (!tags().some((tag) => tag.id === id)) return;
    const ids = layout().ids;
    const previous = ids.indexOf(id);
    if (previous !== -1) ids.splice(previous, 1);
    if (previous !== -1 && previous < index) index--;
    ids.splice(index, 0, id);
    renderCards();
  }

  function renderSignals(available) {
    signalsEl.replaceChildren();
    noSignalsEl.hidden = available.length > 0;
    for (const tag of available) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "monitor-signal";
      button.draggable = true;
      button.dataset.id = tag.id;
      button.textContent = tag.label || "Tag";
      button.title = `${bitWidth(tag)} bit${bitWidth(tag) === 1 ? "" : "s"} · Click or drag to monitor`;
      signalsEl.append(button);
    }
  }

  function renderCards() {
    const available = new Map(tags().map((tag) => [tag.id, tag]));
    const { ids, formats } = layout();
    for (let index = ids.length - 1; index >= 0; index--) if (!available.has(ids[index])) {
      formats.delete(ids[index]);
      ids.splice(index, 1);
    }
    gridEl.replaceChildren();
    emptyEl.hidden = ids.length > 0;
    gridEl.classList.toggle("is-empty", ids.length === 0);
    if (!ids.length) gridEl.append(emptyEl);
    for (const id of ids) {
      const tag = available.get(id);
      const card = document.createElement("article");
      card.className = "monitor-card";
      card.dataset.id = id;
      card.draggable = true;
      const header = document.createElement("div");
      header.className = "monitor-card-header";
      const name = document.createElement("h3");
      name.textContent = tag.label || "Tag";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "monitor-remove";
      remove.dataset.remove = id;
      remove.setAttribute("aria-label", `Remove ${tag.label || "Tag"} from monitor`);
      remove.title = "Remove from monitor";
      remove.textContent = "×";
      header.append(name, remove);
      const value = document.createElement("output");
      value.className = "monitor-value";
      value.dataset.value = id;
      const footer = document.createElement("div");
      footer.className = "monitor-card-footer";
      const width = document.createElement("span");
      width.textContent = `${bitWidth(tag)} bit${bitWidth(tag) === 1 ? "" : "s"}`;
      const select = document.createElement("select");
      select.dataset.format = id;
      select.setAttribute("aria-label", `${tag.label || "Tag"} value format`);
      for (const [format, label] of [["binary", "Binary"], ["hex", "Hex"], ["decimal", "Decimal"]]) {
        const option = document.createElement("option");
        option.value = format;
        option.textContent = label;
        select.append(option);
      }
      select.value = formats.get(id) ?? "binary";
      footer.append(width, select);
      card.append(header, value, footer);
      gridEl.append(card);
    }
    updateValues();
  }

  function updateValues() {
    const editor = getEditor();
    const available = new Map(tags().map((tag) => [tag.id, tag]));
    for (const value of gridEl.querySelectorAll("[data-value]")) {
      const tag = available.get(value.dataset.value);
      if (!tag) continue;
      const current = editor.evaluation.states.get(tag.id)?.value ?? 0;
      value.textContent = formatValue(current, bitWidth(tag), layout().formats.get(tag.id) ?? "binary");
    }
  }

  function render() {
    const editor = getEditor();
    const available = tags();
    const key = JSON.stringify(available.map((tag) => [tag.id, tag.label, bitWidth(tag)]));
    if (renderedScope !== editor || renderedTags !== key) {
      renderedScope = editor;
      renderedTags = key;
      renderSignals(available);
      renderCards();
    } else updateValues();
  }

  signalsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (button) add(button.dataset.id);
  });
  gridEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const { ids, formats } = layout();
    ids.splice(ids.indexOf(button.dataset.remove), 1);
    formats.delete(button.dataset.remove);
    renderCards();
  });
  gridEl.addEventListener("change", (event) => {
    const select = event.target.closest("[data-format]");
    if (!select || !validValueFormat(select.value)) return;
    layout().formats.set(select.dataset.format, select.value);
    updateValues();
  });

  for (const source of [signalsEl, gridEl]) {
    source.addEventListener("dragstart", (event) => {
      const item = event.target.closest("[data-id]");
      if (!item) return;
      draggingId = item.dataset.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggingId);
    });
    source.addEventListener("dragend", () => { draggingId = null; gridEl.classList.remove("drag-over"); });
  }
  gridEl.addEventListener("dragover", (event) => {
    if (!draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    gridEl.classList.add("drag-over");
  });
  gridEl.addEventListener("dragleave", (event) => {
    if (!gridEl.contains(event.relatedTarget)) gridEl.classList.remove("drag-over");
  });
  gridEl.addEventListener("drop", (event) => {
    if (!draggingId) return;
    event.preventDefault();
    const card = event.target.closest(".monitor-card");
    let index = layout().ids.length;
    if (card) {
      index = layout().ids.indexOf(card.dataset.id);
      if (event.clientX > card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2) index++;
    }
    add(draggingId, index);
    draggingId = null;
    gridEl.classList.remove("drag-over");
  });

  return { render, reset() { layouts.delete(getEditor()); renderedScope = null; } };
}
