import { createBoard } from "../core/model.js";
import { serializeProject } from "../core/project-file.js";
import { MODE } from "./context.js";
import { byId, downloadText, setStatus } from "./dom.js";

/** Save, import, clear dialogs, and the blocking loading screen. */
export function createProjectIO({ ctx, status, monitor, program, romEditor, moduleLayout, resetView, getModuleDepth }) {
  const fileInputEl = byId("file-input");
  const importButtonEl = byId("btn-import");
  const importScreenEl = byId("import-screen");
  const importTitleEl = byId("import-title");
  const importDetailEl = byId("import-detail");
  const importNameEl = byId("import-name");
  const importErrorEl = byId("import-error");
  const headerEl = document.querySelector(".view-header");
  const mainEl = document.querySelector("main");
  const btnClearEl = byId("btn-clear");
  const clearScreenEl = byId("clear-screen");
  const clearCancelEl = byId("clear-cancel");
  const clearConfirmEl = byId("clear-confirm");
  let importing = false;

  function fileError(message) {
    setStatus(importErrorEl, message);
  }

  function loadBoard(board, drafts = { rom: [], isa: [], assembly: [], breakpoints: [] }) {
    romEditor.reset();
    moduleLayout.clearTarget();
    monitor.reset();
    program.reset();
    ctx.setSelection([]);
    ctx.setMode(MODE.PAN);
    ctx.editor.replaceBoard(board);
    romEditor.restoreDrafts(drafts.rom);
    program.restoreDrafts(drafts);
    ctx.hooks.renderPalette();
    ctx.hooks.syncPlacingCursor();
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

  function showLoading(title, detail, name = "", focus = false) {
    importTitleEl.textContent = title;
    importDetailEl.textContent = detail;
    importNameEl.textContent = name;
    importScreenEl.hidden = false;
    headerEl.inert = true;
    mainEl.inert = true;
    if (focus) importScreenEl.focus();
  }

  function hideLoading() {
    importScreenEl.hidden = true;
    headerEl.inert = false;
    mainEl.inert = false;
  }

  function loadingPainted() {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  byId("btn-download").addEventListener("click", () => {
    if (getModuleDepth()) { fileError("Save & back from the module before saving the project."); return; }
    try {
      const drafts = { rom: romEditor.exportDrafts(), ...program.exportDrafts() };
      downloadText("computer-architecture-project.json", serializeProject(ctx.board, drafts), "application/json");
      fileError("");
    } catch (error) { fileError(`Could not save project: ${error.message}`); }
  });

  importButtonEl.addEventListener("click", () => {
    if (getModuleDepth()) { fileError("Save & back from the module before importing a project."); return; }
    fileInputEl.click();
  });

  fileInputEl.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = "";
    if (importing) return;
    importing = true;
    fileInputEl.disabled = true;
    fileError("");
    showLoading("Importing file", "Reading file…", file.name, true);
    try {
      const text = await file.text();
      importDetailEl.textContent = "Validating document…";
      const project = await parseImport(text);
      importDetailEl.textContent = "Opening circuit…";
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
      fileInputEl.disabled = false;
      importing = false;
      fileInputEl.focus();
    }
  });

  function openClearDialog() {
    clearScreenEl.hidden = false;
    headerEl.inert = true;
    mainEl.inert = true;
    clearCancelEl.focus();
  }

  function closeClearDialog() {
    clearScreenEl.hidden = true;
    headerEl.inert = false;
    mainEl.inert = false;
    btnClearEl.focus();
  }

  btnClearEl.addEventListener("click", openClearDialog);
  clearCancelEl.addEventListener("click", closeClearDialog);
  clearConfirmEl.addEventListener("click", () => {
    closeClearDialog();
    loadBoard(createBoard());
    status.busStatus("Canvas cleared.");
  });

  clearScreenEl.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeClearDialog();
  });

  return { loadBoard, showLoading, hideLoading, loadingPainted };
}
