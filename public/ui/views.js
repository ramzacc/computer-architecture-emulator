import { renderComponents, renderPins, renderWires } from "./canvas-render.js";
import { isDragging, renderDragPreview } from "./canvas-gestures.js";
import { applyView } from "./canvas-view.js";
import { syncClockTimers } from "./clock-timers.js";
import { ctx } from "./context.js";
import { byIds } from "./dom.js";
import { renderProperties } from "./inspector.js";
import { renderModuleLayout } from "./module-layout.js";
import { createMonitor } from "./monitor.js";
import { checkBreakpoint, render as renderProgram, renderIsa } from "./program.js";
import { renderRomTab } from "./rom-editor.js";
import { createTabs } from "./tabs.js";

const $ = byIds("monitor-signals", "monitor-no-tags", "monitor-grid", "monitor-empty");

export const monitor = createMonitor({
  getEditor: () => ctx.editor,
  signalsEl: $.monitorSignals,
  noTagsEl: $.monitorNoTags,
  workspaceEl: document.querySelector(".monitor-workspace"),
  gridEl: $.monitorGrid,
  emptyEl: $.monitorEmpty,
});

const viewRenderers = {
  "canvas-view": applyView,
  "monitor-view": monitor.render,
  "rom-view": renderRomTab,
  "isa-view": renderIsa,
  "program-view": renderProgram,
  "module-layout-view": renderModuleLayout,
};
export const tabs = createTabs(document.querySelector(".view-tabs"), (panelId) => viewRenderers[panelId]?.());

export function render() {
  const logic = ctx.editor.evaluation;
  renderWires(logic);
  renderComponents(logic);
  renderPins();
  renderProperties();
  viewRenderers[tabs.active]?.();
}

export function boardChanged(board) {
  ctx.board = board;
  checkBreakpoint();
  syncClockTimers();
  if (isDragging()) {
    // A clock or input update can arrive between pointer moves. Rebuild the
    // preview at its current offset so the normal render cannot snap it back.
    renderDragPreview();
    renderProperties();
    viewRenderers[tabs.active]?.();
  } else render();
}
