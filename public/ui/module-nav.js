import { BoardEditor } from "../core/editor.js";
import { moduleFaceParts, modulePorts } from "../core/components.js";
import { parseDocument } from "../core/model.js";
import { clearWireGesture } from "./canvas-gestures.js";
import { resetView } from "./canvas-view.js";
import { syncClockTimers } from "./clock-timers.js";
import { MODE, ctx, setMode, setSelection } from "./context.js";
import { byIds } from "./dom.js";
import { clearLayoutTarget, setLayoutTarget } from "./module-layout.js";
import { clearTarget as clearRomTarget } from "./rom-editor.js";
import { busStatus, reportRuntimeIssue } from "./status.js";
import { tabs, boardChanged, render } from "./views.js";

const $ = byIds("module-navigation", "module-back", "module-path");
const moduleStack = [];

export function showModulePath() {
  $.moduleNavigation.hidden = moduleStack.length === 0;
  $.modulePath.textContent = ["Canvas", ...moduleStack.map(({ name }) => name)].join(" / ");
}

export function openModule(id) {
  const component = ctx.editor.component(id);
  if (component?.t !== "module") return;
  if (moduleStack.length >= 8) {
    busStatus("Modules can be nested up to eight levels.", true);
    return;
  }
  const { board } = parseDocument(JSON.stringify(component.module));
  clearWireGesture();
  moduleStack.push({ editor: ctx.editor, id, name: component.label || "Module" });
  ctx.editor = new BoardEditor({
    storage: { setItem() {} },
    onChange: boardChanged,
    onRuntimeError: reportRuntimeIssue,
  });
  ctx.editor.replaceBoard(board, { save: false });
  ctx.board = ctx.editor.board;
  clearRomTarget();
  clearLayoutTarget();
  setSelection([]);
  setMode(MODE.PAN);
  showModulePath();
  tabs.show("canvas-view");
  syncClockTimers();
  render();
  resetView();
}

export function closeModule() {
  const parent = moduleStack.at(-1);
  if (!parent) return;
  const child = ctx.editor;
  clearWireGesture();
  ctx.editor = parent.editor;
  if (!ctx.editor.setModuleBoard(parent.id, child.board)) {
    ctx.editor = child;
    busStatus("The module cannot fit here. Check its pins, connected wire sizes, overlaps, and short circuits.", true);
    return;
  }
  moduleStack.pop();
  ctx.board = ctx.editor.board;
  clearRomTarget();
  setLayoutTarget(parent.id);
  setSelection([parent.id]);
  showModulePath();
  syncClockTimers();
  render();
  resetView();
  const component = ctx.editor.component(parent.id);
  if (component && (modulePorts(component).length || moduleFaceParts(component).length)) tabs.show("module-layout-view");
  busStatus("Module saved.");
}

export function moduleDepth() {
  return moduleStack.length;
}

$.moduleBack.addEventListener("click", closeModule);
