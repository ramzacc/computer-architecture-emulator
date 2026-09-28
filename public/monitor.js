import { bitWidth } from "./components.js";
import { formatValue, validValueFormat } from "./value-format.js";

// Cards stay in reading order across responsive rows. Blank space in a row
// maps to its end; space below the final row maps to the end of the list.
export function insertionIndex(rects, x, y) {
  let start = 0;
  while (start < rects.length) {
    let end = start + 1;
    while (end < rects.length && Math.abs(rects[end].top - rects[start].top) < 2) end++;
    const bottom = Math.max(...rects.slice(start, end).map((rect) => rect.bottom));
    if (y < rects[start].top) return start;
    if (y <= bottom) {
      for (let index = start; index < end; index++) {
        if (x < rects[index].left + rects[index].width / 2) return index;
      }
      return end;
    }
    start = end;
  }
  return rects.length;
}

export function dropPlacement(rects, breaks, x, y) {
  const index = insertionIndex(rects, x, y);
  if (!rects.length) return { index, newRow: false };
  const next = rects[index];
  const previousBottom = Math.max(-Infinity, ...rects.slice(0, index)
    .filter((rect) => !next || rect.top < next.top - 2).map((rect) => rect.bottom));
  return {
    index,
    newRow: (index > 0 && y > previousBottom && (!next || y < next.top)) ||
      Boolean(next && y >= next.top && breaks[index] === true),
  };
}

export function createMonitor({ getEditor, signalsEl, noTagsEl, workspaceEl, gridEl, emptyEl }) {
  let draggingId = null;
  let renderedScope = null;
  let renderedItems = "";
  let renderedLayout = "";

  function layout() {
    return getEditor().board.monitor;
  }

  function layoutKey() {
    const { ids, formats, breaks } = layout();
    return JSON.stringify(ids.map((id) => [id, formats.get(id), breaks.has(id)]));
  }

  function items() {
    return getEditor().board.components.filter((component) => ["tag", "button", "switch", "clock", "input", "output"].includes(component.t));
  }

  function add(id, index = layout().ids.length, newRow = false) {
    if (!items().some((item) => item.id === id)) return;
    const { ids, breaks } = layout();
    const previous = ids.indexOf(id);
    if (previous !== -1) {
      if (breaks.has(id) && ids[previous + 1]) breaks.add(ids[previous + 1]);
      breaks.delete(id);
      ids.splice(previous, 1);
    }
    if (previous !== -1 && previous < index) index--;
    if (newRow && ids[index]) breaks.delete(ids[index]);
    ids.splice(index, 0, id);
    if (newRow && index > 0) breaks.add(id);
    renderCards();
    getEditor().save();
  }

  function renderSignals(available) {
    signalsEl.replaceChildren();
    noTagsEl.hidden = available.length > 0;
    workspaceEl.hidden = available.length === 0;
    for (const item of available) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "monitor-signal";
      button.draggable = true;
      button.dataset.id = item.id;
      button.textContent = item.label || item.t;
      button.title = `${["tag", "input", "output"].includes(item.t) ? `${bitWidth(item)} bit${bitWidth(item) === 1 ? "" : "s"} ${item.t}` : item.t === "button" ? "Button" : item.t === "clock" ? "Clock" : "Switch"} · Click or drag to monitor`;
      signalsEl.append(button);
    }
  }

  function renderCards() {
    const available = new Map(items().map((item) => [item.id, item]));
    const { ids, formats, breaks } = layout();
    for (let index = ids.length - 1; index >= 0; index--) if (!available.has(ids[index])) {
      formats.delete(ids[index]);
      breaks.delete(ids[index]);
      ids.splice(index, 1);
    }
    gridEl.replaceChildren();
    emptyEl.hidden = ids.length > 0;
    gridEl.classList.toggle("is-empty", ids.length === 0);
    if (!ids.length) gridEl.append(emptyEl);
    for (const id of ids) {
      const item = available.get(id);
      const card = document.createElement("article");
      card.className = "monitor-card";
      card.classList.toggle("new-row", breaks.has(id));
      card.dataset.id = id;
      card.draggable = true;
      const header = document.createElement("div");
      header.className = "monitor-card-header";
      const name = document.createElement("h3");
      name.textContent = item.label || item.t;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "monitor-remove";
      remove.dataset.remove = id;
      remove.setAttribute("aria-label", `Remove ${item.label || item.t} from monitor`);
      remove.title = "Remove from monitor";
      remove.textContent = "×";
      header.append(name, remove);
      if (["tag", "input", "output"].includes(item.t)) {
        const value = document.createElement("output");
        value.className = "monitor-value";
        value.dataset.value = id;
        card.append(header, value);
        if (item.t === "input") {
          const bits = document.createElement("div");
          bits.className = "monitor-bits";
          for (let bit = bitWidth(item) - 1; bit >= 0; bit--) {
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.draggable = false;
            toggle.dataset.inputBit = String(bit);
            toggle.dataset.inputId = id;
            toggle.setAttribute("aria-label", `Toggle ${item.label || "Input"} bit ${bit}`);
            bits.append(toggle);
          }
          card.append(bits);
        }
        const footer = document.createElement("div");
        footer.className = "monitor-card-footer";
        const width = document.createElement("span");
        width.textContent = `${bitWidth(item)} bit${bitWidth(item) === 1 ? "" : "s"}`;
        const select = document.createElement("select");
        select.dataset.format = id;
        select.setAttribute("aria-label", `${item.label || item.t} value format`);
        for (const [format, label] of [["binary", "Binary"], ["hex", "Hex"], ["decimal", "Decimal"]]) {
          const option = document.createElement("option");
          option.value = format;
          option.textContent = label;
          select.append(option);
        }
        select.value = formats.get(id) ?? "binary";
        footer.append(width, select);
        card.append(footer);
      } else {
        const control = document.createElement("button");
        control.type = "button";
        control.className = "monitor-control";
        control.classList.add(item.t === "button" ? "monitor-push-button" : "monitor-switch");
        control.draggable = false;
        control.dataset.control = id;
        const art = document.createElement("span");
        art.className = "monitor-control-art";
        const center = document.createElement("span");
        center.className = "monitor-control-center";
        art.append(center);
        const status = document.createElement("span");
        status.className = "monitor-control-status";
        status.textContent = item.t === "button" ? "Press" : item.t === "clock" ? "Disabled" : "Off";
        control.append(art, status);
        control.setAttribute("aria-label", `${item.label || item.t} ${item.t}`);
        card.append(header, control);
      }
      gridEl.append(card);
    }
    updateValues();
    renderedLayout = layoutKey();
  }

  function updateValues() {
    const editor = getEditor();
    const available = new Map(items().map((item) => [item.id, item]));
    for (const value of gridEl.querySelectorAll("[data-value]")) {
      const item = available.get(value.dataset.value);
      if (!item) continue;
      const current = editor.evaluation.states.get(item.id)?.value ?? 0;
      value.textContent = formatValue(current, bitWidth(item), layout().formats.get(item.id) ?? "binary");
    }
    for (const toggle of gridEl.querySelectorAll("[data-input-bit]")) {
      const item = available.get(toggle.dataset.inputId);
      if (!item) continue;
      const active = ((item.value ?? 0) & (1 << Number(toggle.dataset.inputBit))) !== 0;
      toggle.textContent = active ? "1" : "0";
      toggle.classList.toggle("active", active);
      toggle.setAttribute("aria-pressed", String(active));
    }
    for (const control of gridEl.querySelectorAll("[data-control]")) {
      const item = available.get(control.dataset.control);
      if (!item) continue;
      const active = item.t === "button" ? editor.pressedButtons.has(item.id) : item.t === "clock" ? item.enable !== false : item.value === 1;
      control.classList.toggle("active", active);
      control.setAttribute("aria-pressed", String(active));
      control.querySelector(".monitor-control-status").textContent = item.t === "button" ? active ? "Pressed" : "Press" : item.t === "clock" ? active ? "Enabled" : "Disabled" : active ? "On" : "Off";
      if (item.t === "clock") control.setAttribute("aria-label", `${active ? "Disable" : "Enable"} ${item.label || "Clock"}`);
    }
  }

  function render() {
    const editor = getEditor();
    const available = items();
    const key = JSON.stringify(available.map((item) => [item.id, item.t, item.label, bitWidth(item)]));
    if (renderedScope !== editor || renderedItems !== key) {
      renderedScope = editor;
      renderedItems = key;
      renderSignals(available);
      renderCards();
    } else if (renderedLayout !== layoutKey()) renderCards();
    else updateValues();
  }

  function dropPosition(event) {
    const cards = [...gridEl.querySelectorAll(".monitor-card")];
    return dropPlacement(cards.map((card) => card.getBoundingClientRect()),
      cards.map((card) => card.classList.contains("new-row")), event.clientX, event.clientY);
  }

  function clearDropCue() {
    workspaceEl.classList.remove("drag-over");
    gridEl.classList.remove("drop-new-row");
    for (const card of gridEl.querySelectorAll(".monitor-card"))
      card.classList.remove("drop-before", "drop-after");
  }

  function showDropCue({ index, newRow }) {
    clearDropCue();
    workspaceEl.classList.add("drag-over");
    const cards = [...gridEl.querySelectorAll(".monitor-card")];
    if (newRow) {
      const gridTop = gridEl.getBoundingClientRect().top;
      const lineTop = index < cards.length
        ? cards[index].getBoundingClientRect().top - gridTop - 6
        : cards[cards.length - 1].getBoundingClientRect().bottom - gridTop + 6;
      gridEl.style.setProperty("--drop-line-top", `${lineTop}px`);
      gridEl.classList.add("drop-new-row");
      return;
    }
    if (index < cards.length) cards[index].classList.add("drop-before");
    else cards[cards.length - 1]?.classList.add("drop-after");
  }

  signalsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (button) add(button.dataset.id);
  });
  gridEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const { ids, formats, breaks } = layout();
    const index = ids.indexOf(button.dataset.remove);
    if (breaks.has(button.dataset.remove) && ids[index + 1]) breaks.add(ids[index + 1]);
    ids.splice(index, 1);
    formats.delete(button.dataset.remove);
    breaks.delete(button.dataset.remove);
    renderCards();
    getEditor().save();
  });
  gridEl.addEventListener("change", (event) => {
    const select = event.target.closest("[data-format]");
    if (!select || !validValueFormat(select.value)) return;
    layout().formats.set(select.dataset.format, select.value);
    updateValues();
    renderedLayout = layoutKey();
    getEditor().save();
  });
  gridEl.addEventListener("click", (event) => {
    const control = event.target.closest("[data-control]");
    if (control) {
      const item = getEditor().component(control.dataset.control);
      if (item?.t === "switch") getEditor().toggleSwitch(item.id);
      if (item?.t === "clock") getEditor().setClockEnabled(item.id, item.enable === false);
    }
    const bit = event.target.closest("[data-input-bit]");
    if (bit) getEditor().toggleInputBit(bit.dataset.inputId, Number(bit.dataset.inputBit));
  });
  gridEl.addEventListener("pointerdown", (event) => {
    const control = event.target.closest("[data-control]");
    if (!control || event.button !== 0 || getEditor().component(control.dataset.control)?.t !== "button") return;
    control.setPointerCapture(event.pointerId);
    getEditor().setButtonPressed(control.dataset.control, true);
  });
  function releaseButton(event) {
    const control = event.target.closest("[data-control]");
    if (control && getEditor().component(control.dataset.control)?.t === "button")
      getEditor().setButtonPressed(control.dataset.control, false);
  }
  gridEl.addEventListener("pointerup", releaseButton);
  gridEl.addEventListener("pointercancel", releaseButton);
  gridEl.addEventListener("lostpointercapture", releaseButton);
  gridEl.addEventListener("keydown", (event) => {
    const control = event.target.closest("[data-control]");
    if (control && (event.key === " " || event.key === "Enter") && !event.repeat &&
        getEditor().component(control.dataset.control)?.t === "button")
      getEditor().setButtonPressed(control.dataset.control, true);
  });
  gridEl.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") releaseButton(event);
  });
  gridEl.addEventListener("focusout", releaseButton);

  for (const source of [signalsEl, gridEl]) {
    source.addEventListener("dragstart", (event) => {
      if (event.target.closest(".monitor-control, .monitor-bits, .monitor-remove, select")) {
        event.preventDefault();
        return;
      }
      const item = event.target.closest(".monitor-signal, .monitor-card");
      if (!item) return;
      draggingId = item.dataset.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggingId);
    });
    source.addEventListener("dragend", () => { draggingId = null; clearDropCue(); });
  }
  workspaceEl.addEventListener("dragover", (event) => {
    if (!draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    showDropCue(dropPosition(event));
  });
  workspaceEl.addEventListener("dragleave", (event) => {
    if (!workspaceEl.contains(event.relatedTarget)) clearDropCue();
  });
  workspaceEl.addEventListener("drop", (event) => {
    if (!draggingId) return;
    event.preventDefault();
    const { index, newRow } = dropPosition(event);
    add(draggingId, index, newRow);
    draggingId = null;
    clearDropCue();
  });

  return { render, reset() { renderedScope = null; renderedLayout = ""; } };
}
