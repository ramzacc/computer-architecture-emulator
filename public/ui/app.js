import { BoardEditor } from "../core/editor.js";
import { addComponent, addWireEdge, createBoard } from "../core/model.js";
import { parseProject } from "../core/project-file.js";
import { renderPalette, syncPlacingCursor } from "./canvas-input.js";
import { resetView } from "./canvas-view.js";
import { ctx } from "./context.js";
import { byId } from "./dom.js";
import { hideLoading, loadingPainted, showLoading } from "./project-io.js";
import { busStatus, reportRuntimeIssue } from "./status.js";
import { boardChanged } from "./views.js";

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
  onRuntimeError: reportRuntimeIssue,
  onStorageError: (error) => {
    console.warn("Could not save board:", error);
    queueMicrotask(() => busStatus("Board changed, but browser storage is unavailable. Download a copy to keep it.", true));
  },
});
ctx.editor = editor;
ctx.board = editor.board;

renderPalette();
syncPlacingCursor();
showLoading("Loading circuit", "Opening circuit…");
try {
  await loadingPainted();
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
    await loadingPainted();
    editor.replaceBoard(board, { save: false });
  }
  resetView();
} finally {
  hideLoading();
}
