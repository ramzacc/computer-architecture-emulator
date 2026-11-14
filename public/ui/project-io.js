import { createBoard } from "../core/model.js";
import { serializeProject } from "../core/project-file.js";
import { syncPlacingCursor, renderPalette } from "./canvas-input.js";
import { resetView } from "./canvas-view.js";
import { MODE, ctx, setMode, setSelection } from "./context.js";
import { byIds, downloadText, setStatus } from "./dom.js";
import { clearLayoutTarget } from "./module-layout.js";
import { moduleDepth } from "./module-nav.js";
import { exportDrafts as exportProgramDrafts, reset as resetProgram, restoreDrafts as restoreProgramDrafts } from "./program.js";
import { exportDrafts as exportRomDrafts, reset as resetRom, restoreDrafts as restoreRomDrafts } from "./rom-editor.js";
import { busStatus } from "./status.js";
import { monitor } from "./views.js";

const $ = byIds("file-input", "btn-import", "import-screen", "import-title", "import-detail",
  "import-name", "import-error", "btn-clear", "clear-screen", "clear-cancel", "clear-confirm",
  "btn-download");
const header = document.querySelector(".view-header");
const main = document.querySelector("main");
let importing = false;

function fileError(message) {
  setStatus($.importError, message);
}

export function loadBoard(board, drafts = { rom: [], isa: [], assembly: [], breakpoints: [] }) {
  resetRom();
  clearLayoutTarget();
  monitor.reset();
  resetProgram();
  setSelection([]);
  setMode(MODE.PAN);
  ctx.editor.replaceBoard(board);
  restoreRomDrafts(drafts.rom);
  restoreProgramDrafts(drafts);
  renderPalette();
  syncPlacingCursor();
  resetView();
}

function parseImport(text) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL("../core/import-worker.js", import.meta.url), { type: "module" }); }
    catch (error) { reject(error); return; }
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The document could not be validated."));
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error("The validated document could not be opened."));
    };
    try { worker.postMessage(text); }
    catch (error) { worker.terminate(); reject(error); }
  });
}

export function showLoading(title, detail, name = "", focus = false) {
  $.importTitle.textContent = title;
  $.importDetail.textContent = detail;
  $.importName.textContent = name;
  $.importScreen.hidden = false;
  header.inert = true;
  main.inert = true;
  if (focus) $.importScreen.focus();
}

export function hideLoading() {
  $.importScreen.hidden = true;
  header.inert = false;
  main.inert = false;
}

export function loadingPainted() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

$.btnDownload.addEventListener("click", () => {
  if (moduleDepth()) { fileError("Save & back from the module before saving the project."); return; }
  try {
    const drafts = { rom: exportRomDrafts(), ...exportProgramDrafts() };
    downloadText("computer-architecture-project.json", serializeProject(ctx.board, drafts), "application/json");
    fileError("");
  } catch (error) { fileError(`Could not save project: ${error.message}`); }
});

$.btnImport.addEventListener("click", () => {
  if (moduleDepth()) { fileError("Save & back from the module before importing a project."); return; }
  $.fileInput.click();
});

$.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";
  if (importing) return;
  importing = true;
  $.fileInput.disabled = true;
  fileError("");
  showLoading("Importing file", "Reading file…", file.name, true);
  try {
    const text = await file.text();
    $.importDetail.textContent = "Validating document…";
    const project = await parseImport(text);
    $.importDetail.textContent = "Opening circuit…";
    // Let the updated progress message paint before evaluation and rendering.
    await loadingPainted();
    hideLoading();
    if (!window.confirm(`Import ${file.name}? This replaces the current project and its browser save.`)) return;
    showLoading("Importing project", "Opening circuit…", file.name);
    loadBoard(project.board, project.drafts);
  } catch (error) {
    fileError(`Could not import ${file.name}: ${error.message}`);
  } finally {
    hideLoading();
    $.fileInput.disabled = false;
    importing = false;
    $.fileInput.focus();
  }
});

function openClearDialog() {
  $.clearScreen.hidden = false;
  header.inert = true;
  main.inert = true;
  $.clearCancel.focus();
}

function closeClearDialog() {
  $.clearScreen.hidden = true;
  header.inert = false;
  main.inert = false;
  $.btnClear.focus();
}

$.btnClear.addEventListener("click", openClearDialog);
$.clearCancel.addEventListener("click", closeClearDialog);
$.clearConfirm.addEventListener("click", () => {
  closeClearDialog();
  loadBoard(createBoard());
  busStatus("Canvas cleared.");
});

$.clearScreen.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeClearDialog();
});
