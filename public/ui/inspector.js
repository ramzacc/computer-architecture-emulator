import { DEFAULT_CLOCK_FREQUENCY, addressWidth, bitWidth, channelCount, isSizable, moduleFaceParts, modulePorts, selectWidth, spec } from "../core/components.js";
import { netContaining } from "../core/model.js";
import { formatValue, parseValue } from "../core/value-format.js";
import { MODE } from "./context.js";
import { byId } from "./dom.js";

/** The inspector card: shows and edits the selected component or wire net. */
export function createInspector({ ctx, status, onOpenModule, onOpenModuleLayout, onOpenRom }) {
  const newWireRowEl = byId("new-wire-row");
  const selectedPropertiesHeadingEl = byId("selected-properties-heading");
  const inspectorEmptyEl = byId("inspector-empty");
  const selectedSizeRowEl = byId("selected-size-row");
  const selectedSizeLabelEl = byId("selected-size-label");
  const selectedSizeEl = byId("selected-size");
  const romDataSizeRowEl = byId("rom-data-size-row");
  const romDataSizeEl = byId("rom-data-size");
  const romAddressSizeRowEl = byId("rom-address-size-row");
  const romAddressSizeEl = byId("rom-address-size");
  const channelsRowEl = byId("channels-row");
  const channelsEl = byId("channels");
  const splitterOrderRowEl = byId("splitter-order-row");
  const splitterOrderEl = byId("splitter-order");
  const selectedValueRowEl = byId("selected-value-row");
  const selectedValueLabelEl = byId("selected-value-label");
  const selectedValueEl = byId("selected-value");
  const constantValueRowEl = byId("constant-value-row");
  const constantValueEl = byId("constant-value");
  const sourceValueLabelEl = byId("source-value-label");
  const componentLabelRowEl = byId("component-label-row");
  const componentLabelEl = byId("component-label");
  const romOpenEl = byId("rom-open");
  const valueFormatRowEl = byId("value-format-row");
  const valueFormatEl = byId("value-format");
  const clockFrequencyRowEl = byId("clock-frequency-row");
  const clockFrequencyEl = byId("clock-frequency");
  const clockEnableRowEl = byId("clock-enable-row");
  const clockEnableEl = byId("clock-enable");
  const moduleOpenEl = byId("module-open");
  const moduleLayoutOpenEl = byId("module-layout-open");
  const btnCopy = byId("btn-copy");
  const btnPaste = byId("btn-paste");
  const btnDelete = byId("btn-delete");
  const btnUndo = byId("btn-undo");
  const btnRedo = byId("btn-redo");
  let inspectorSelectionKey = null;

  function syncActionButtons() {
    btnUndo.disabled = !ctx.editor.canUndo;
    btnRedo.disabled = !ctx.editor.canRedo;
    btnCopy.disabled = ctx.selectedIds.size === 0 && ctx.selectedWires.size === 0;
    btnPaste.disabled = ctx.copiedSelection.components.length === 0 && ctx.copiedSelection.wires.length === 0;
    btnDelete.disabled = ctx.selectedIds.size === 0 && ctx.selectedWires.size === 0;
  }

  function renderProperties() {
    const component = ctx.board.components.find((c) => c.id === ctx.selectedId);
    const net = ctx.selectedWire ? netContaining(ctx.board, ctx.selectedWire, ctx.editor.evaluation) : null;
    const selectionKey = component ? `component:${component.id}` : net ? `wire:${ctx.selectedWire}` : null;
    const preserveDraft = selectionKey !== null && selectionKey === inspectorSelectionKey;
    const setFieldValue = (field, value) => {
      if (!preserveDraft || document.activeElement !== field) field.value = value;
    };
    const selectionCount = ctx.selectedIds.size + ctx.selectedWires.size;
    selectedPropertiesHeadingEl.textContent = selectionCount > 1 ? `${selectionCount} items selected` : component ? spec(component.t).label : net ? "Wire" : ctx.mode === MODE.WIRE ? "Wire tool" : "Inspector";
    newWireRowEl.hidden = ctx.mode !== MODE.WIRE;
    inspectorEmptyEl.hidden = selectionCount > 0 || ctx.mode === MODE.WIRE;
    inspectorEmptyEl.textContent = ctx.placingType ? "Click the canvas to place the selected component." : "Select a component or wire to edit its properties.";
    const size = component && (isSizable(component) || component.t === "debugdisplay") ? bitWidth(component) : net?.size;
    const memory = component?.t === "rom" || component?.t === "ram";
    selectedSizeRowEl.hidden = size === undefined || memory;
    selectedSizeLabelEl.textContent = memory || component?.t === "mux" || component?.t === "demux" ? "Data size (bits)" : "Selected size (bits)";
    selectedSizeEl.disabled = size === undefined || component?.t === "debugdisplay";
    setFieldValue(selectedSizeEl, size === undefined ? "" : String(size));
    selectedSizeEl.max = ["constant", "input"].includes(component?.t) ? "8" : "32";
    romDataSizeRowEl.hidden = !memory;
    romDataSizeEl.disabled = !memory;
    setFieldValue(romDataSizeEl, memory ? String(bitWidth(component)) : "8");
    const plexer = component?.t === "mux" || component?.t === "demux";
    channelsRowEl.hidden = !plexer;
    channelsEl.disabled = !plexer;
    setFieldValue(channelsEl, plexer ? String(channelCount(component)) : "");
    const splitter = component?.t === "splitter";
    splitterOrderRowEl.hidden = !splitter;
    splitterOrderEl.disabled = !splitter;
    setFieldValue(splitterOrderEl, splitter ? component.order ?? "ascendant" : "ascendant");
    const source = component?.t === "constant" || component?.t === "input";
    constantValueRowEl.hidden = !source;
    constantValueEl.disabled = !source;
    sourceValueLabelEl.textContent = component?.t === "input" ? "Input value" : "Constant value";
    setFieldValue(constantValueEl, source ? formatValue(component.value ?? 0, bitWidth(component), component.format) : "");
    componentLabelRowEl.hidden = !component;
    componentLabelEl.disabled = !component;
    setFieldValue(componentLabelEl, component?.label ?? "");
    moduleOpenEl.hidden = component?.t !== "module";
    moduleLayoutOpenEl.hidden = component?.t !== "module" ||
      (!modulePorts(component).length && !moduleFaceParts(component).length);
    const rom = component?.t === "rom";
    romAddressSizeRowEl.hidden = !memory;
    romAddressSizeEl.disabled = !memory;
    setFieldValue(romAddressSizeEl, memory ? String(addressWidth(component)) : "");
    romOpenEl.hidden = !rom;
    const valueFormat = source || component?.t === "output";
    valueFormatRowEl.hidden = !valueFormat;
    valueFormatEl.disabled = !valueFormat;
    setFieldValue(valueFormatEl, valueFormat ? component.format ?? "decimal" : "decimal");
    const clock = component?.t === "clock";
    clockFrequencyRowEl.hidden = !clock;
    clockFrequencyEl.disabled = !clock;
    setFieldValue(clockFrequencyEl, clock ? String(component.frequency ?? DEFAULT_CLOCK_FREQUENCY) : "");
    clockEnableRowEl.hidden = !clock;
    clockEnableEl.disabled = !clock;
    clockEnableEl.checked = clock && component.enable !== false;
    const output = component?.t === "output" || component?.t === "debugdisplay";
    const stored = component?.t === "register" || component?.t === "counter" || component?.t === "ram";
    const displayedValue = output || stored ? ctx.editor.evaluation.states.get(component.id)?.value ?? 0 : net?.value;
    const displayedSize = output || stored ? bitWidth(component) : net?.size;
    selectedValueRowEl.hidden = !net && !output && !stored;
    selectedValueLabelEl.textContent = component?.t === "ram" ? "Data at address" : stored ? "Stored value (Q)" : component?.t === "debugdisplay" ? "Debug value" : output ? "Output value" : "Selected bus value";
    selectedValueEl.textContent = displayedValue === undefined ? "—" : output
      ? formatValue(displayedValue, displayedSize, component.t === "debugdisplay" ? "hex" : component.format)
      : displayedSize === 1 ? `${displayedValue} (${displayedValue ? "HIGH" : "LOW"})`
        : `${displayedValue} (0b${displayedValue.toString(2).padStart(displayedSize, "0")})`;
    if (size !== undefined && !status.isError()) {
      status.busStatus(component ? `${spec(component.t).label}: ${size} bit${size === 1 ? "" : "s"}${plexer ? `, ${channelCount(component)} channels, ${selectWidth(component)} selector bit${selectWidth(component) === 1 ? "" : "s"}` : ""}.` :
        `Selected bus: ${size} bit${size === 1 ? "" : "s"}.`);
    }
    if (clock && !status.isError())
      status.busStatus(`Clock: ${component.frequency ?? DEFAULT_CLOCK_FREQUENCY} Hz, ${component.enable === false ? "disabled" : "enabled"}.`);
    if (memory && !status.isError()) {
      const inputs = ctx.editor.evaluation.states.get(component.id)?.inputs ?? [];
      const value = ctx.editor.evaluation.states.get(component.id)?.value ?? 0;
      status.busStatus(`${component.t.toUpperCase()} address ${(inputs[0] ?? 0).toString(16).toUpperCase().padStart(Math.ceil(addressWidth(component) / 4), "0")}: ${value.toString(16).toUpperCase()}.`);
    }
    inspectorSelectionKey = selectionKey;
    syncActionButtons();
  }

  for (const field of [selectedSizeEl, romDataSizeEl, channelsEl, splitterOrderEl,
    constantValueEl, componentLabelEl, romAddressSizeEl, valueFormatEl, clockFrequencyEl]) {
    field.addEventListener("blur", () => renderProperties());
  }

  selectedSizeEl.addEventListener("change", () => {
    const size = Number(selectedSizeEl.value);
    const component = ctx.editor.component(ctx.selectedId);
    const current = component ? bitWidth(component) : ctx.selectedWire ? netContaining(ctx.board, ctx.selectedWire, ctx.editor.evaluation)?.size : undefined;
    if (size === current) return;
    const changed = component ? ctx.editor.resizeComponent(ctx.selectedId, size) : ctx.editor.resizeWire(ctx.selectedWire, size);
    if (!changed) status.busStatus(["constant", "input"].includes(component?.t)
      ? "Source width must be 1–8 bits and match connected wires."
      : component?.t === "rom" ? "ROM data width must be 1, 2, 4, 8, 16, or 32 bits and match connected wires."
      : "Bus size mismatch or invalid size (use 1–32 bits).", true);
    else status.busStatus(`Size set to ${size} bits.`);
    renderProperties();
  });

  romDataSizeEl.addEventListener("change", () => {
    const size = Number(romDataSizeEl.value);
    const kind = ctx.editor.component(ctx.selectedId)?.t.toUpperCase() ?? "Memory";
    if (ctx.editor.resizeComponent(ctx.selectedId, size)) status.busStatus(`${kind} data size set to ${size} bits.`);
    else status.busStatus(`${kind} data size must match connected wires.`, true);
    renderProperties();
  });

  romAddressSizeEl.addEventListener("change", () => {
    const size = Number(romAddressSizeEl.value);
    const kind = ctx.editor.component(ctx.selectedId)?.t;
    const changed = ctx.editor.resizeMemoryAddress(ctx.selectedId, size);
    if (changed) status.busStatus(`${kind.toUpperCase()} address size set to ${size} bits.`);
    else status.busStatus(`${kind?.toUpperCase() ?? "Memory"} address width must be 1, 2, 4, 8, or 16 bits and fit connected wires${kind === "rom" ? ", and include every stored address" : ""}.`, true);
    renderProperties();
  });

  channelsEl.addEventListener("change", () => {
    const channels = Number(channelsEl.value);
    if (ctx.editor.setChannelCount(ctx.selectedId, channels))
      status.busStatus(`Set ${channels} data channels; selector uses ${selectWidth(ctx.editor.component(ctx.selectedId))} bit(s).`);
    else status.busStatus("Channel count must be 1–16 and fit without overlapping other components or mismatched wires.", true);
    renderProperties();
  });

  splitterOrderEl.addEventListener("change", () => {
    if (ctx.editor.setSplitterOrder(ctx.selectedId, splitterOrderEl.value))
      status.busStatus(`Splitter order set to ${splitterOrderEl.value}.`);
    else renderProperties();
  });

  constantValueEl.addEventListener("change", () => {
    const component = ctx.editor.component(ctx.selectedId);
    if (!component || !["constant", "input"].includes(component.t)) return;
    const value = parseValue(constantValueEl.value, component.format);
    if (value === component.value) { renderProperties(); return; }
    if (value !== null && ctx.editor.setConstantValue(ctx.selectedId, value)) {
      status.busStatus(`Constant set to ${value}.`);
    } else {
      if (!status.activeIssue) status.busStatus(`Enter a valid ${component.format ?? "decimal"} whole number from 0 to ${2 ** bitWidth(component) - 1}; the value must not short circuit another output.`, true);
      renderProperties();
    }
  });

  componentLabelEl.addEventListener("change", () => {
    const component = ctx.editor.component(ctx.selectedId);
    if (!ctx.editor.setLabel(ctx.selectedId, componentLabelEl.value)) {
      if (component && component.label !== componentLabelEl.value)
        status.busStatus(component.t === "portal"
          ? "Portal labels must be at most 80 characters."
          : `Each ${spec(component.t).label} needs a unique label of at most 80 characters.`, true);
      renderProperties();
    }
  });

  valueFormatEl.addEventListener("change", () => {
    if (ctx.editor.setValueFormat(ctx.selectedId, valueFormatEl.value))
      status.busStatus(`Value format set to ${valueFormatEl.selectedOptions[0].textContent}.`);
    else renderProperties();
  });

  clockFrequencyEl.addEventListener("change", () => {
    const frequency = Number(clockFrequencyEl.value);
    if (ctx.editor.setClockFrequency(ctx.selectedId, frequency))
      status.busStatus(`Clock set to ${frequency} Hz.`);
    else if (ctx.editor.component(ctx.selectedId)?.frequency !== frequency)
      status.busStatus("Frequency must be between 0.1 and 20 Hz.", true);
    renderProperties();
  });

  clockEnableEl.addEventListener("change", () => {
    if (ctx.editor.setClockEnabled(ctx.selectedId, clockEnableEl.checked))
      status.busStatus(`Clock ${clockEnableEl.checked ? "enabled" : "disabled"}.`);
    renderProperties();
  });

  moduleOpenEl.addEventListener("click", () => onOpenModule(ctx.selectedId));
  moduleLayoutOpenEl.addEventListener("click", () => onOpenModuleLayout(ctx.selectedId));
  romOpenEl.addEventListener("click", () => onOpenRom(ctx.selectedId));

  return { renderProperties, syncActionButtons };
}
