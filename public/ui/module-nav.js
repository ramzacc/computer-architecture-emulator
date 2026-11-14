import { BoardEditor } from "../core/editor.js";
import { moduleFaceParts, modulePorts } from "../core/components.js";
import { parseDocument } from "../core/model.js";
import { MODE } from "./context.js";
import { byId } from "./dom.js";

/** Entering a module board and saving it back onto the parent board. */
export function createModuleNav({ ctx, tabs, render, resetView, status, clockTimers, romEditor, moduleLayout, onBoardChange }) {
  const navigationEl = byId("module-navigation");
  const backEl = byId("module-back");
  const pathEl = byId("module-path");
  const moduleStack = [];

  function showPath() {
    navigationEl.hidden = moduleStack.length === 0;
    pathEl.textContent = ["Canvas", ...moduleStack.map(({ name }) => name)].join(" / ");
  }

  function openModule(id) {
    const component = ctx.editor.component(id);
    if (component?.t !== "module") return;
    if (moduleStack.length >= 8) {
      status.busStatus("Modules can be nested up to eight levels.", true);
      return;
    }
    const { board } = parseDocument(JSON.stringify(component.module));
    ctx.hooks.clearWireGesture();
    moduleStack.push({ editor: ctx.editor, id, name: component.label || "Module" });
    ctx.editor = new BoardEditor({
      storage: { setItem() {} },
      onChange: onBoardChange,
      onRuntimeError: status.reportRuntimeIssue,
    });
    ctx.editor.replaceBoard(board, { save: false });
    ctx.board = ctx.editor.board;
    romEditor.clearTarget();
    moduleLayout.clearTarget();
    ctx.setSelection([]);
    ctx.setMode(MODE.PAN);
    showPath();
    tabs.show("canvas-view");
    clockTimers.sync();
    render();
    resetView();
  }

  function closeModule() {
    const parent = moduleStack.at(-1);
    if (!parent) return;
    const child = ctx.editor;
    ctx.hooks.clearWireGesture();
    ctx.editor = parent.editor;
    if (!ctx.editor.setModuleBoard(parent.id, child.board)) {
      ctx.editor = child;
      status.busStatus("The module cannot fit here. Check its pins, connected wire sizes, overlaps, and short circuits.", true);
      return;
    }
    moduleStack.pop();
    ctx.board = ctx.editor.board;
    romEditor.clearTarget();
    moduleLayout.setTarget(parent.id);
    ctx.setSelection([parent.id]);
    showPath();
    clockTimers.sync();
    render();
    resetView();
    const component = ctx.editor.component(parent.id);
    if (component && (modulePorts(component).length || moduleFaceParts(component).length)) tabs.show("module-layout-view");
    status.busStatus("Module saved.");
  }

  backEl.addEventListener("click", closeModule);

  return {
    openModule,
    closeModule,
    showPath,
    get depth() { return moduleStack.length; },
  };
}
