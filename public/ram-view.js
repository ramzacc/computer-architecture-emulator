import { addressWidth, bitWidth } from "./components.js";
import { formatValue } from "./value-format.js";

const WORDS_PER_ROW = 4;
const ROWS_PER_PAGE = 8;
const PAGE_SIZE = WORDS_PER_ROW * ROWS_PER_PAGE;

export function parseRamAddress(text) {
  const input = text.trim();
  if (!/^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)$/.test(input)) return null;
  const value = input.startsWith("0x") || input.startsWith("0X") ? Number.parseInt(input.slice(2), 16)
    : input.startsWith("0b") || input.startsWith("0B") ? Number.parseInt(input.slice(2), 2) : Number(input);
  return Number.isSafeInteger(value) ? value : null;
}

export function createRamViewer(root, { getEditor, getRam, getFormat, setFormat }) {
  let start = 0;
  let renderedKey = "";
  const controls = document.createElement("div");
  controls.className = "ram-controls";
  const form = document.createElement("form");
  form.className = "ram-go-form";
  const address = document.createElement("input");
  address.type = "text";
  address.inputMode = "text";
  address.placeholder = "0x00 or 42";
  address.setAttribute("aria-label", "Go to RAM address");
  const go = document.createElement("button");
  go.type = "submit";
  go.textContent = "Go";
  form.append(address, go);
  const format = document.createElement("select");
  format.setAttribute("aria-label", "RAM value format");
  for (const [value, label] of [["hex", "Hex"], ["binary", "Binary"], ["decimal", "Decimal"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    format.append(option);
  }
  controls.append(form, format);
  const error = document.createElement("p");
  error.className = "ram-error";
  error.setAttribute("role", "status");
  const lines = document.createElement("div");
  lines.className = "ram-lines";
  const navigation = document.createElement("div");
  navigation.className = "ram-navigation";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "← Previous";
  const range = document.createElement("span");
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Next →";
  navigation.append(previous, range, next);
  root.replaceChildren(controls, error, lines, navigation);

  function render() {
    const ram = getRam();
    const count = ram ? 2 ** addressWidth(ram) : 0;
    if (!count) {
      lines.textContent = "Add a RAM on Canvas to view its memory.";
      renderedKey = "";
      navigation.hidden = true;
      controls.hidden = true;
      error.textContent = "";
      return;
    }
    controls.hidden = false;
    navigation.hidden = count <= PAGE_SIZE;
    start = Math.min(start, Math.floor((count - 1) / WORDS_PER_ROW) * WORDS_PER_ROW);
    const words = getEditor().ramValues.get(ram.id) ?? new Map();
    format.value = getFormat();
    const key = JSON.stringify([ram.id, bitWidth(ram), addressWidth(ram), start, format.value]);
    if (key !== renderedKey) {
      const rows = [];
      for (let base = start; base < Math.min(start + PAGE_SIZE, count); base += WORDS_PER_ROW) {
        const row = document.createElement("div");
        row.className = "ram-line";
        const label = document.createElement("span");
        label.className = "ram-line-address";
        label.textContent = formatValue(base, addressWidth(ram), "hex");
        row.append(label);
        for (let index = base; index < Math.min(base + WORDS_PER_ROW, count); index++) {
          const word = document.createElement("span");
          word.className = "ram-word";
          word.dataset.address = String(index);
          word.title = `Address ${formatValue(index, addressWidth(ram), "hex")}`;
          row.append(word);
        }
        rows.push(row);
      }
      lines.replaceChildren(...rows);
      renderedKey = key;
    }
    for (const word of lines.querySelectorAll(".ram-word")) {
      const value = formatValue(words.get(Number(word.dataset.address)) ?? 0, bitWidth(ram), format.value);
      if (word.textContent !== value) word.textContent = value;
    }
    previous.disabled = start === 0;
    next.disabled = start + PAGE_SIZE >= count;
    range.textContent = `${formatValue(start, addressWidth(ram), "hex")}–${formatValue(Math.min(start + PAGE_SIZE - 1, count - 1), addressWidth(ram), "hex")}`;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const ram = getRam();
    const target = parseRamAddress(address.value);
    if (!ram || target === null || target >= 2 ** addressWidth(ram)) {
      error.textContent = `Enter an address from 0 to ${ram ? formatValue(2 ** addressWidth(ram) - 1, addressWidth(ram), "hex") : "the end of RAM"}.`;
      return;
    }
    error.textContent = "";
    start = Math.floor(target / WORDS_PER_ROW) * WORDS_PER_ROW;
    render();
  });
  previous.addEventListener("click", () => { start = Math.max(0, start - PAGE_SIZE); render(); });
  next.addEventListener("click", () => { start += PAGE_SIZE; render(); });
  format.addEventListener("change", () => { setFormat(format.value); render(); });
  return { render, reset() { start = 0; renderedKey = ""; error.textContent = ""; render(); } };
}
