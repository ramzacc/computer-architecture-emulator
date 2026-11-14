import { dimsOf, moduleFaceParts, modulePinLayout, modulePorts, spec } from "../core/components.js";
import { componentArt } from "./canvas-render.js";
import { ctx } from "./context.js";
import { byIds, setStatus, uniqueLabels } from "./dom.js";
import { renderProperties } from "./inspector.js";
import { tabs } from "./views.js";

const MODULE_LAYOUT_STEP = 80;

const $ = byIds("module-layout", "module-layout-title", "module-layout-list",
  "module-layout-empty", "module-layout-scroll", "module-layout-status",
  "module-layout-stage", "module-layout-board", "module-layout-next",
  "module-layout-next-right", "module-layout-resize", "module-layout-target",
  "module-layout-tray", "module-layout-items", "module-layout-open");
const moduleLayoutTrayHeading = $.moduleLayoutTray.querySelector("h3");
let layoutTargetId = null;
let dragging = false;

function status(message, error = false) {
  setStatus($.moduleLayoutStatus, message, error);
}

export function renderModuleLayout() {
  if (dragging) return;
  let component = ctx.editor.component(layoutTargetId);
  const modules = ctx.board.components.filter((item) => item.t === "module");
  if (component?.t !== "module") {
    component = modules[0] ?? null;
    layoutTargetId = component?.id ?? null;
  }
  const names = uniqueLabels(modules, "Module");
  $.moduleLayoutList.replaceChildren();
  modules.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = names[index];
    button.className = "module-layout-module";
    button.classList.toggle("active", item.id === layoutTargetId);
    button.setAttribute("aria-pressed", String(item.id === layoutTargetId));
    button.addEventListener("click", () => {
      layoutTargetId = item.id;
      status("");
      renderModuleLayout();
    });
    $.moduleLayoutList.append(button);
  });
  $.moduleLayoutEmpty.hidden = !!component;
  $.moduleLayoutEmpty.textContent = "Add a module on Canvas";
  $.moduleLayoutScroll.hidden = !component;
  $.moduleLayoutTray.hidden = !component;
  if (!component) return;
  const ports = modulePorts(component);
  const parts = moduleFaceParts(component);
  $.moduleLayoutTitle.textContent = component.label || "Module";

  const local = { ...component, x: 0, y: 0, r: 0 };
  const { w, h } = dimsOf(local);
  const step = MODULE_LAYOUT_STEP;
  $.moduleLayoutStage.style.width = `${(w + 2) * step}px`;
  $.moduleLayoutStage.style.height = `${(h + 2) * step}px`;
  $.moduleLayoutBoard.style.width = `${w * step}px`;
  $.moduleLayoutBoard.style.height = `${h * step}px`;
  $.moduleLayoutBoard.innerHTML = componentArt(local, spec("module"), 0, [], ctx.editor.evaluation.states.get(component.id));
  $.moduleLayoutNext.style.top = `${h * step}px`;
  $.moduleLayoutNext.style.height = `${2 * step}px`;
  $.moduleLayoutNext.style.width = `${(w + 2) * step}px`;
  $.moduleLayoutNextRight.style.left = `${w * step}px`;
  $.moduleLayoutNextRight.style.width = `${2 * step}px`;
  $.moduleLayoutNextRight.style.height = `${h * step}px`;
  $.moduleLayoutResize.style.left = `${w * step}px`;
  $.moduleLayoutResize.style.top = `${h * step}px`;
  $.moduleLayoutStage.querySelectorAll(".module-layout-pin, .module-layout-face").forEach((item) => item.remove());
  $.moduleLayoutTarget.hidden = true;

  modulePinLayout(component).forEach(([side, position], index) => {
    const port = ports[index];
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `module-layout-pin ${port.role}`;
    pin.dataset.kind = "pin";
    pin.dataset.index = String(index);
    pin.style.left = `${(side === "W" ? 0 : side === "E" ? w : position) * step}px`;
    pin.style.top = `${(side === "N" ? 0 : side === "S" ? h : position) * step}px`;
    pin.title = `${port.name || `Pin ${index + 1}`} · ${port.role === "in" ? "Input" : "Output"}`;
    pin.setAttribute("aria-label", `Move ${pin.title}`);
    $.moduleLayoutStage.append(pin);
  });

  $.moduleLayoutTray.hidden = parts.every((part) => component.faceLayout?.some(([index]) => index === part.index));
  moduleLayoutTrayHeading.textContent = "Available components";
  $.moduleLayoutItems.replaceChildren();
  for (const part of parts) {
    const slot = component.faceLayout?.find(([index]) => index === part.index);
    const name = part.label || `${spec(part.type).label} #${part.index + 1}`;
    const item = document.createElement("button");
    item.type = "button";
    item.className = slot ? "module-layout-face" : "module-layout-chip";
    item.dataset.kind = "face";
    item.dataset.index = String(part.index);
    item.title = name;
    item.setAttribute("aria-label", slot ? `Move ${name}` : `Place ${name}`);
    if (slot) {
      item.style.left = `${slot[1] * step}px`;
      item.style.top = `${slot[2] * step}px`;
      $.moduleLayoutStage.append(item);
    } else {
      item.textContent = name;
      const entry = document.createElement("div");
      entry.className = "module-layout-entry";
      const add = document.createElement("button");
      add.type = "button";
      add.className = "module-layout-add";
      add.textContent = "Place";
      add.title = `Add ${name} to module face`;
      add.setAttribute("aria-label", add.title);
      add.addEventListener("click", () => addModuleFacePart(component.id, part.index));
      entry.append(item, add);
      $.moduleLayoutItems.append(entry);
    }
  }
}

function addModuleFacePart(id, index) {
  const component = ctx.editor.component(id);
  if (component?.t !== "module") return;
  const { w, h } = dimsOf({ ...component, r: 0 });
  const cells = [];
  for (let y = 2; y <= Math.min(32, h + 1); y++) for (let x = 1; x <= Math.min(19, w + 1); x++)
    cells.push([x, y]);
  cells.sort((a, b) => Math.abs(a[0] - w / 2) + Math.abs(a[1] - 2) -
    Math.abs(b[0] - w / 2) - Math.abs(b[1] - 2));
  for (const [x, y] of cells) {
    if (ctx.editor.setModuleFacePart(id, index, x, y)) {
      status("");
      renderProperties();
      return;
    }
  }
  status("No available space for this component.", true);
}

function candidate(kind, index, clientX, clientY) {
  const component = ctx.editor.component(layoutTargetId);
  if (component?.t !== "module") return null;
  const step = MODULE_LAYOUT_STEP;
  const rect = $.moduleLayoutStage.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const { w, h } = dimsOf({ ...component, r: 0 });
  const boardHeight = h * step;
  if (kind === "face" && $.moduleLayoutTray.getBoundingClientRect().left <= clientX &&
      $.moduleLayoutTray.getBoundingClientRect().right >= clientX &&
      $.moduleLayoutTray.getBoundingClientRect().top <= clientY &&
      $.moduleLayoutTray.getBoundingClientRect().bottom >= clientY) return { hidden: true };
  if (kind === "resize") {
    const width = Math.max(4, Math.min(20, w + 2, Math.round(x / step)));
    const height = Math.max(3, Math.min(32, h + 2, Math.round(y / step)));
    return { width, height, x: width * step, y: height * step };
  }
  if (x < 0 || x > (w + (kind === "face" ? 2 : 0)) * step ||
      y < 0 || y > (h + (kind === "face" ? 2 : 0)) * step) return null;
  if (kind === "pin") {
    const distances = [["N", y], ["E", w * step - x], ["S", boardHeight - y], ["W", x]];
    const side = distances.sort((a, b) => a[1] - b[1])[0][0];
    const maximum = side === "N" || side === "S" ? w - 1 : h - 1;
    const position = Math.max(1, Math.min(maximum, Math.round((side === "N" || side === "S" ? x : y) / step)));
    if (modulePinLayout(component).some(([usedSide, usedPosition], other) =>
      other !== index && usedSide === side && usedPosition === position)) return null;
    return { side, position, x: (side === "W" ? 0 : side === "E" ? w : position) * step,
      y: (side === "N" ? 0 : side === "S" ? h : position) * step };
  }
  const cellX = Math.max(1, Math.min(19, w + 1, Math.round(x / step)));
  const cellY = Math.max(2, Math.min(32, h + 1, Math.round(y / step)));
  if ((component.faceLayout ?? []).some(([partIndex, placedX, placedY]) =>
    partIndex !== index && placedX === cellX && placedY === cellY)) return null;
  return { cellX, cellY, x: cellX * step, y: cellY * step };
}

$.moduleLayout.addEventListener("pointerdown", (event) => {
  const source = event.target.closest("[data-kind]");
  if (!source || event.button !== 0) return;
  event.preventDefault();
  const kind = source.dataset.kind, index = Number(source.dataset.index);
  const ghost = source.cloneNode(true);
  ghost.className = "module-layout-ghost";
  ghost.removeAttribute("id");
  ghost.textContent = source.title;
  ghost.style.left = `${event.clientX}px`;
  ghost.style.top = `${event.clientY}px`;
  document.body.append(ghost);
  source.classList.add("dragging");
  source.setPointerCapture(event.pointerId);
  dragging = true;
  if (kind === "face" && source.classList.contains("module-layout-face")) {
    $.moduleLayoutTray.hidden = false;
    if (!$.moduleLayoutItems.childElementCount) moduleLayoutTrayHeading.textContent = "Remove component";
  }
  let placement = null;
  const move = (nextEvent) => {
    ghost.style.left = `${nextEvent.clientX}px`;
    ghost.style.top = `${nextEvent.clientY}px`;
    placement = candidate(kind, index, nextEvent.clientX, nextEvent.clientY);
    $.moduleLayoutTarget.hidden = !placement || placement.hidden;
    if (placement && !placement.hidden) {
      $.moduleLayoutTarget.className = `module-layout-target ${kind}`;
      $.moduleLayoutTarget.style.left = `${placement.x}px`;
      $.moduleLayoutTarget.style.top = `${placement.y}px`;
    }
    $.moduleLayoutTray.classList.toggle("drop-target", !!placement?.hidden);
  };
  const finish = (nextEvent) => {
    source.removeEventListener("pointermove", move);
    source.removeEventListener("pointerup", finish);
    source.removeEventListener("pointercancel", cancel);
    ghost.remove();
    dragging = false;
    source.classList.remove("dragging");
    $.moduleLayoutTarget.hidden = true;
    $.moduleLayoutTray.classList.remove("drop-target");
    if (nextEvent.type === "pointercancel") { renderProperties(); return; }
    placement = candidate(kind, index, nextEvent.clientX, nextEvent.clientY);
    if (!placement) { renderProperties(); return; }
    const id = layoutTargetId;
    const changed = kind === "pin" ? ctx.editor.setModulePin(id, index, placement.side, placement.position)
      : kind === "resize" ? ctx.editor.setModuleSize(id, placement.width, placement.height)
      : ctx.editor.setModuleFacePart(id, index, placement.hidden ? null : placement.cellX, placement.hidden ? null : placement.cellY);
    if (!changed) status("That placement is blocked by a wire, another component, or the module boundary.", true);
    else status("");
    renderProperties();
  };
  const cancel = (nextEvent) => finish(nextEvent);
  source.addEventListener("pointermove", move);
  source.addEventListener("pointerup", finish);
  source.addEventListener("pointercancel", cancel);
});

$.moduleLayoutOpen.addEventListener("click", () => openModuleLayout(ctx.selectedId));

export function openModuleLayout(id) {
  layoutTargetId = id;
  tabs.show("module-layout-view", { focus: true });
}

export function setLayoutTarget(id) {
  layoutTargetId = id;
}

export function clearLayoutTarget() {
  layoutTargetId = null;
}
