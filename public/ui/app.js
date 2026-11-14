import { BoardEditor } from "../core/editor.js";
import { addComponent, addWireEdge, createBoard } from "../core/model.js";
import { parseProject } from "../core/project-file.js";
import { createCanvasGestures } from "./canvas-gestures.js";
import { createCanvasInput } from "./canvas-input.js";
import { createView } from "./canvas-view.js";
import { createClockTimers } from "./clock-timers.js";
import { createContext } from "./context.js";
import { byId } from "./dom.js";
import { createInspector } from "./inspector.js";
import { createModuleLayout } from "./module-layout.js";
import { createModuleNav } from "./module-nav.js";
import { createMonitor } from "./monitor.js";
import { createProgram } from "./program.js";
import { createProjectIO } from "./project-io.js";
import { createRenderer } from "./renderer.js";
import { createRomEditor } from "./rom-editor.js";
import { createStatus } from "./status.js";
import { createTabs } from "./tabs.js";

/* ---------- Shared state and rendering ---------- */

const ctx = createContext();
const statusHooks = { renderComponents: () => {}, renderWires: () => {} };
const status = createStatus({ getState: () => ctx.board, hooks: statusHooks });
const { componentArt, renderComponents, renderPins, renderWires, edgeBox, applyBox } = createRenderer(
  byId("grid"),
  () => ctx.board,
  () => ctx.editor.evaluation,
  () => ctx.selectedIds,
  () => ctx.selectedWires,
  () => status.activeIssue,
);
statusHooks.renderComponents = renderComponents;
statusHooks.renderWires = renderWires;

const canvas = createView({ getState: () => ctx.board, getWireSize: () => ctx.newWireSize });
const renderer = { componentArt, renderComponents, renderPins, renderWires, edgeBox, applyBox };
const tabs = createTabs(document.querySelector(".view-tabs"), (panelId) => viewRenderers[panelId]?.());

const inspector = createInspector({
  ctx,
  status,
  onOpenModule: (id) => moduleNav.openModule(id),
  onOpenModuleLayout: (id) => moduleLayout.open(id),
  onOpenRom: (id) => romEditor.openRom(id),
});
const gestures = createCanvasGestures({
  ctx,
  canvas,
  status,
  render,
  renderer,
  openModule: (id) => moduleNav.openModule(id),
});
const input = createCanvasInput({
  ctx,
  status,
  gestures,
  canvas,
  renderer,
  render,
  renderProperties: inspector.renderProperties,
  syncActionButtons: inspector.syncActionButtons,
});
const moduleLayout = createModuleLayout({
  ctx,
  tabs,
  renderProperties: inspector.renderProperties,
  componentArt,
});
const romEditor = createRomEditor({ ctx, tabs, onSaved: (id) => program.syncRom(id) });
const program = createProgram({ getEditor: () => ctx.editor });
const monitor = createMonitor({
  getEditor: () => ctx.editor,
  signalsEl: byId("monitor-signals"),
  noTagsEl: byId("monitor-no-tags"),
  workspaceEl: document.querySelector(".monitor-workspace"),
  gridEl: byId("monitor-grid"),
  emptyEl: byId("monitor-empty"),
});
const clockTimers = createClockTimers({ getEditor: () => ctx.editor, getState: () => ctx.board });
const moduleNav = createModuleNav({
  ctx,
  tabs,
  render,
  resetView: canvas.resetView,
  status,
  clockTimers,
  romEditor,
  moduleLayout,
  onBoardChange: boardChanged,
});
const projectIO = createProjectIO({
  ctx,
  status,
  monitor,
  program,
  romEditor,
  moduleLayout,
  resetView: canvas.resetView,
  getModuleDepth: () => moduleNav.depth,
});

ctx.hooks.renderComponents = renderComponents;
ctx.hooks.renderWires = renderWires;
ctx.hooks.renderProperties = inspector.renderProperties;
ctx.hooks.renderPalette = input.renderPalette;
ctx.hooks.syncPlacingCursor = input.syncPlacingCursor;
ctx.hooks.clearWireGesture = gestures.clearWireGesture;

const viewRenderers = {
  "canvas-view": canvas.applyView,
  "monitor-view": monitor.render,
  "rom-view": romEditor.renderRomTab,
  "isa-view": program.renderIsa,
  "program-view": program.render,
  "module-layout-view": moduleLayout.renderModuleLayout,
};

function render() {
  const logic = ctx.editor.evaluation;
  renderWires(logic);
  renderComponents(logic);
  renderPins();
  inspector.renderProperties();
  viewRenderers[tabs.active]?.();
}

function boardChanged(board) {
  ctx.board = board;
  program.checkBreakpoint();
  clockTimers.sync();
  if (gestures.dragging) {
    // A clock or input update can arrive between pointer moves. Rebuild the
    // preview at its current offset so the normal render cannot snap it back.
    gestures.renderDragPreview();
    inspector.renderProperties();
    viewRenderers[tabs.active]?.();
  } else render();
}

/* ---------- Editor and persistence ---------- */

function seedLayout(board) {
  addComponent(board, { id: "c1", t: "input", x: 2, y: 0, r: 2, size: 1, value: 0, label: "A" });
  addComponent(board, { id: "c2", t: "output", x: 5, y: 0, r: 0, size: 1, label: "Result" });
  addWireEdge(board, { o: "H", x: 4, y: 1 });
}

function getStorage() {
  try { return globalThis.localStorage; }
  catch (error) { console.warn("Browser storage is unavailable:", error); return null; }
}

const editor = new BoardEditor({
  storage: getStorage(),
  onChange: boardChanged,
  onRuntimeError: status.reportRuntimeIssue,
  onStorageError: (error) => {
    console.warn("Could not save board:", error);
    queueMicrotask(() => status.busStatus("Board changed, but browser storage is unavailable. Download a copy to keep it.", true));
  },
});
ctx.editor = editor;
ctx.board = editor.board;

/* ---------- Boot ---------- */

input.renderPalette();
input.syncPlacingCursor();
projectIO.showLoading("Loading circuit", "Opening circuit…");
try {
  await projectIO.loadingPainted();
  let restored = null;
  try { restored = editor.loadSaved(); }
  catch (error) { console.warn("Saved document is invalid:", error); }
  if (restored) {
    editor.replaceBoard(restored.board, { save: false });
  } else {
    byId("import-detail").textContent = "Loading default example…";
    byId("import-name").textContent = "Demo computer";
    let board;
    try {
      const response = await fetch(new URL("../../demo-computer.json", import.meta.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      board = parseProject(await response.text()).board;
    } catch (error) {
      console.warn("Could not load the default example:", error);
      board = createBoard();
      seedLayout(board);
    }
    byId("import-detail").textContent = "Opening circuit…";
    await projectIO.loadingPainted();
    editor.replaceBoard(board, { save: false });
  }
  canvas.resetView();
} finally {
  projectIO.hideLoading();
}
