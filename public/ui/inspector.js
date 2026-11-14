import { DEFAULT_CLOCK_FREQUENCY, addressWidth, bitWidth, channelCount, isSizable, moduleFaceParts, modulePorts, selectWidth, spec } from "../core/components.js";
import { netContaining } from "../core/model.js";
import { formatValue, parseValue } from "../core/value-format.js";
import { MODE, ctx } from "./context.js";
import { byIds } from "./dom.js";
import { openModuleLayout } from "./module-layout.js";
import { openModule } from "./module-nav.js";
import { openRom } from "./rom-editor.js";
import { busStatus, isBusError } from "./status.js";

const $ = byIds(
  "new-wire-row", "selected-properties-heading", "inspector-empty", "selected-size-row",
  "selected-size-label", "selected-size", "rom-data-size-row", "rom-data-size",
  "rom-address-size-row", "rom-address-size", "channels-row", "channels",
  "splitter-order-row", "splitter-order", "selected-value-row", "selected-value-label",
  "selected-value", "constant-value-row", "constant-value", "source-value-label",
  "component-label-row", "component-label", "rom-open", "value-format-row",
  "value-format", "clock-frequency-row", "clock-frequency", "clock-enable-row",
  "clock-enable", "module-open", "module-layout-open", "btn-copy", "btn-paste",
  "btn-delete", "btn-undo", "btn-redo",
);

let inspectorSelectionKey = null;

/** The inspector card: shows and edits the selected component or wire net. */
export function syncActionButtons() {
  $.btnUndo.disabled = !ctx.editor.canUndo;
  $.btnRedo.disabled = !ctx.editor.canRedo;
  $.btnCopy.disabled = ctx.selectedIds.size === 0 && ctx.selectedWires.size === 0;
  $.btnPaste.disabled = ctx.copiedSelection.components.length === 0 && ctx.copiedSelection.wires.length === 0;
  $.btnDelete.disabled = ctx.selectedIds.size === 0 && ctx.selectedWires.size === 0;
}

export function renderProperties() {
  const component = ctx.board.components.find((c) => c.id === ctx.selectedId);
  const net = ctx.selectedWire ? netContaining(ctx.board, ctx.selectedWire, ctx.editor.evaluation) : null;
  const selectionKey = component ? `component:${component.id}` : net ? `wire:${ctx.selectedWire}` : null;
  const preserveDraft = selectionKey !== null && selectionKey === inspectorSelectionKey;
  const setFieldValue = (field, value) => {
    if (!preserveDraft || document.activeElement !== field) field.value = value;
  };
  const setField = (row, field, visible, disabled, value) => {
    $[row].hidden = !visible;
    $[field].disabled = disabled;
    setFieldValue($[field], value);
  };
  const selectionCount = ctx.selectedIds.size + ctx.selectedWires.size;
  const size = component && (isSizable(component) || component.t === "debugdisplay") ? bitWidth(component) : net?.size;
  const memory = component?.t === "rom" || component?.t === "ram";
  const plexer = component?.t === "mux" || component?.t === "demux";
  const splitter = component?.t === "splitter";
  const source = component?.t === "constant" || component?.t === "input";
  const rom = component?.t === "rom";
  const valueFormat = source || component?.t === "output";
  const clock = component?.t === "clock";
  const output = component?.t === "output" || component?.t === "debugdisplay";
  const stored = component?.t === "register" || component?.t === "counter" || component?.t === "ram";

  $.selectedPropertiesHeading.textContent = selectionCount > 1 ? `${selectionCount} items selected` : component ? spec(component.t).label : net ? "Wire" : ctx.mode === MODE.WIRE ? "Wire tool" : "Inspector";
  $.newWireRow.hidden = ctx.mode !== MODE.WIRE;
  $.inspectorEmpty.hidden = selectionCount > 0 || ctx.mode === MODE.WIRE;
  $.inspectorEmpty.textContent = ctx.placingType ? "Click the canvas to place the selected component." : "Select a component or wire to edit its properties.";

  $.selectedSizeLabel.textContent = memory || plexer ? "Data size (bits)" : "Selected size (bits)";
  $.selectedSize.max = ["constant", "input"].includes(component?.t) ? "8" : "32";
  setField("selectedSizeRow", "selectedSize", size !== undefined && !memory,
    size === undefined || component?.t === "debugdisplay", size === undefined ? "" : String(size));
  setField("romDataSizeRow", "romDataSize", memory, !memory, memory ? String(bitWidth(component)) : "8");
  setField("channelsRow", "channels", plexer, !plexer, plexer ? String(channelCount(component)) : "");
  setField("splitterOrderRow", "splitterOrder", splitter, !splitter, splitter ? component.order ?? "ascendant" : "ascendant");
  $.sourceValueLabel.textContent = component?.t === "input" ? "Input value" : "Constant value";
  setField("constantValueRow", "constantValue", source, !source,
    source ? formatValue(component.value ?? 0, bitWidth(component), component.format) : "");
  setField("componentLabelRow", "componentLabel", !!component, !component, component?.label ?? "");
  setField("romAddressSizeRow", "romAddressSize", memory, !memory, memory ? String(addressWidth(component)) : "");
  setField("valueFormatRow", "valueFormat", valueFormat, !valueFormat,
    valueFormat ? component.format ?? "decimal" : "decimal");
  setField("clockFrequencyRow", "clockFrequency", clock, !clock,
    clock ? String(component.frequency ?? DEFAULT_CLOCK_FREQUENCY) : "");
  $.clockEnableRow.hidden = !clock;
  $.clockEnable.disabled = !clock;
  $.clockEnable.checked = clock && component.enable !== false;
  $.moduleOpen.hidden = component?.t !== "module";
  $.moduleLayoutOpen.hidden = component?.t !== "module" ||
    (!modulePorts(component).length && !moduleFaceParts(component).length);
  $.romOpen.hidden = !rom;

  const displayedValue = output || stored ? ctx.editor.evaluation.states.get(component.id)?.value ?? 0 : net?.value;
  const displayedSize = output || stored ? bitWidth(component) : net?.size;
  $.selectedValueRow.hidden = !net && !output && !stored;
  $.selectedValueLabel.textContent = component?.t === "ram" ? "Data at address" : stored ? "Stored value (Q)" : component?.t === "debugdisplay" ? "Debug value" : output ? "Output value" : "Selected bus value";
  $.selectedValue.textContent = displayedValue === undefined ? "—" : output
    ? formatValue(displayedValue, displayedSize, component.t === "debugdisplay" ? "hex" : component.format)
    : displayedSize === 1 ? `${displayedValue} (${displayedValue ? "HIGH" : "LOW"})`
      : `${displayedValue} (0b${displayedValue.toString(2).padStart(displayedSize, "0")})`;

  if (size !== undefined && !isBusError()) {
    busStatus(component ? `${spec(component.t).label}: ${size} bit${size === 1 ? "" : "s"}${plexer ? `, ${channelCount(component)} channels, ${selectWidth(component)} selector bit${selectWidth(component) === 1 ? "" : "s"}` : ""}.` :
      `Selected bus: ${size} bit${size === 1 ? "" : "s"}.`);
  }
  if (clock && !isBusError())
    busStatus(`Clock: ${component.frequency ?? DEFAULT_CLOCK_FREQUENCY} Hz, ${component.enable === false ? "disabled" : "enabled"}.`);
  if (memory && !isBusError()) {
    const inputs = ctx.editor.evaluation.states.get(component.id)?.inputs ?? [];
    const value = ctx.editor.evaluation.states.get(component.id)?.value ?? 0;
    busStatus(`${component.t.toUpperCase()} address ${(inputs[0] ?? 0).toString(16).toUpperCase().padStart(Math.ceil(addressWidth(component) / 4), "0")}: ${value.toString(16).toUpperCase()}.`);
  }
  inspectorSelectionKey = selectionKey;
  syncActionButtons();
}

for (const field of [$.selectedSize, $.romDataSize, $.channels, $.splitterOrder,
  $.constantValue, $.componentLabel, $.romAddressSize, $.valueFormat, $.clockFrequency]) {
  field.addEventListener("blur", () => renderProperties());
}

$.selectedSize.addEventListener("change", () => {
  const size = Number($.selectedSize.value);
  const component = ctx.editor.component(ctx.selectedId);
  const current = component ? bitWidth(component) : ctx.selectedWire ? netContaining(ctx.board, ctx.selectedWire, ctx.editor.evaluation)?.size : undefined;
  if (size === current) return;
  const changed = component ? ctx.editor.resizeComponent(ctx.selectedId, size) : ctx.editor.resizeWire(ctx.selectedWire, size);
  if (!changed) busStatus(["constant", "input"].includes(component?.t)
    ? "Source width must be 1–8 bits and match connected wires."
    : component?.t === "rom" ? "ROM data width must be 1, 2, 4, 8, 16, or 32 bits and match connected wires."
    : "Bus size mismatch or invalid size (use 1–32 bits).", true);
  else busStatus(`Size set to ${size} bits.`);
  renderProperties();
});

$.romDataSize.addEventListener("change", () => {
  const size = Number($.romDataSize.value);
  const kind = ctx.editor.component(ctx.selectedId)?.t.toUpperCase() ?? "Memory";
  if (ctx.editor.resizeComponent(ctx.selectedId, size)) busStatus(`${kind} data size set to ${size} bits.`);
  else busStatus(`${kind} data size must match connected wires.`, true);
  renderProperties();
});

$.romAddressSize.addEventListener("change", () => {
  const size = Number($.romAddressSize.value);
  const kind = ctx.editor.component(ctx.selectedId)?.t;
  const changed = ctx.editor.resizeMemoryAddress(ctx.selectedId, size);
  if (changed) busStatus(`${kind.toUpperCase()} address size set to ${size} bits.`);
  else busStatus(`${kind?.toUpperCase() ?? "Memory"} address width must be 1, 2, 4, 8, or 16 bits and fit connected wires${kind === "rom" ? ", and include every stored address" : ""}.`, true);
  renderProperties();
});

$.channels.addEventListener("change", () => {
  const channels = Number($.channels.value);
  if (ctx.editor.setChannelCount(ctx.selectedId, channels))
    busStatus(`Set ${channels} data channels; selector uses ${selectWidth(ctx.editor.component(ctx.selectedId))} bit(s).`);
  else busStatus("Channel count must be 1–16 and fit without overlapping other components or mismatched wires.", true);
  renderProperties();
});

$.splitterOrder.addEventListener("change", () => {
  if (ctx.editor.setSplitterOrder(ctx.selectedId, $.splitterOrder.value))
    busStatus(`Splitter order set to ${$.splitterOrder.value}.`);
  else renderProperties();
});

$.constantValue.addEventListener("change", () => {
  const component = ctx.editor.component(ctx.selectedId);
  if (!component || !["constant", "input"].includes(component.t)) return;
  const value = parseValue($.constantValue.value, component.format);
  if (value === component.value) { renderProperties(); return; }
  if (value !== null && ctx.editor.setConstantValue(ctx.selectedId, value)) {
    busStatus(`Constant set to ${value}.`);
  } else {
    if (!ctx.activeIssue) busStatus(`Enter a valid ${component.format ?? "decimal"} whole number from 0 to ${2 ** bitWidth(component) - 1}; the value must not short circuit another output.`, true);
    renderProperties();
  }
});

$.componentLabel.addEventListener("change", () => {
  const component = ctx.editor.component(ctx.selectedId);
  if (!ctx.editor.setLabel(ctx.selectedId, $.componentLabel.value)) {
    if (component && component.label !== $.componentLabel.value)
      busStatus(component.t === "portal"
        ? "Portal labels must be at most 80 characters."
        : `Each ${spec(component.t).label} needs a unique label of at most 80 characters.`, true);
    renderProperties();
  }
});

$.valueFormat.addEventListener("change", () => {
  if (ctx.editor.setValueFormat(ctx.selectedId, $.valueFormat.value))
    busStatus(`Value format set to ${$.valueFormat.selectedOptions[0].textContent}.`);
  else renderProperties();
});

$.clockFrequency.addEventListener("change", () => {
  const frequency = Number($.clockFrequency.value);
  if (ctx.editor.setClockFrequency(ctx.selectedId, frequency))
    busStatus(`Clock set to ${frequency} Hz.`);
  else if (ctx.editor.component(ctx.selectedId)?.frequency !== frequency)
    busStatus("Frequency must be between 0.1 and 20 Hz.", true);
  renderProperties();
});

$.clockEnable.addEventListener("change", () => {
  if (ctx.editor.setClockEnabled(ctx.selectedId, $.clockEnable.checked))
    busStatus(`Clock ${$.clockEnable.checked ? "enabled" : "disabled"}.`);
  renderProperties();
});

$.moduleOpen.addEventListener("click", () => openModule(ctx.selectedId));
$.moduleLayoutOpen.addEventListener("click", () => openModuleLayout(ctx.selectedId));
$.romOpen.addEventListener("click", () => openRom(ctx.selectedId));
