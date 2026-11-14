import { dimsOf } from "../core/components.js";
import { edgePlacementError } from "../core/model.js";
import { ctx } from "./context.js";
import { byIds } from "./dom.js";

export const CELL = 48;
export const ZOOM_STEP = 1.2;
const GAP = 3;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

/**
 * The lattice is unbounded: `view` maps world pixels onto the viewport with
 * translate(view.x, view.y) then scale(view.zoom), anchored at the top-left.
 */
export const view = { x: 0, y: 0, zoom: 1 };
const $ = byIds("canvas-wrap", "grid", "zoom-level");

export function viewportFromEvent(ev) {
  const rect = $.canvasWrap.getBoundingClientRect();
  return {
    x: ev.clientX - rect.left - $.canvasWrap.clientLeft,
    y: ev.clientY - rect.top - $.canvasWrap.clientTop,
  };
}

export function worldFromViewport(p) {
  return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
}

export function worldFromEvent(ev) {
  return worldFromViewport(viewportFromEvent(ev));
}

export function cellFromEvent(ev) {
  const world = worldFromEvent(ev);
  return { x: Math.floor(world.x / CELL), y: Math.floor(world.y / CELL) };
}

export function pointFromEvent(ev) {
  const world = worldFromEvent(ev);
  return { x: Math.round(world.x / CELL), y: Math.round(world.y / CELL) };
}

export function edgeFromEvent(ev) {
  const world = worldFromEvent(ev);
  const fx = world.x / CELL;
  const fy = world.y / CELL;
  const hEdge = { o: "H", x: Math.floor(fx), y: Math.round(fy) };
  const vEdge = { o: "V", x: Math.round(fx), y: Math.floor(fy) };
  const hDist = Math.abs(fy - hEdge.y);
  const vDist = Math.abs(fx - vEdge.x);
  const nearest = hDist <= vDist ? hEdge : vEdge;
  const alternate = nearest === hEdge ? vEdge : hEdge;
  const alternateDist = nearest === hEdge ? vDist : hDist;
  const size = ctx.newWireSize;
  // Near a component outline, the closest grid line can run through its body.
  // Prefer the nearby border edge when the closest edge is blocked.
  if (alternateDist <= 0.25 &&
      edgePlacementError(ctx.board, { ...nearest, size }) === "Wire is blocked by a component." &&
      edgePlacementError(ctx.board, { ...alternate, size }) === null) return alternate;
  return nearest;
}

export function applyView() {
  $.grid.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  const step = CELL * view.zoom;
  $.canvasWrap.style.backgroundSize = `${step}px ${step}px`;
  $.canvasWrap.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $.zoomLevel.textContent = `${Math.round(view.zoom * 100)}%`;
}

export function zoomAt(factor, cx, cy) {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  if (Math.abs(next - view.zoom) < 1e-6) return;
  if (cx === undefined) {
    const rect = $.canvasWrap.getBoundingClientRect();
    cx = rect.width / 2;
    cy = rect.height / 2;
  }
  // Keep the world point under the anchor fixed while the scale changes.
  const wx = (cx - view.x) / view.zoom;
  const wy = (cy - view.y) / view.zoom;
  view.zoom = next;
  view.x = cx - wx * next;
  view.y = cy - wy * next;
  applyView();
}

function contentCenter() {
  if (!ctx.board.components.length) return { x: 0, y: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of ctx.board.components) {
    const d = dimsOf(c);
    if (!d) continue;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + d.w);
    maxY = Math.max(maxY, c.y + d.h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 };
  return { x: ((minX + maxX) / 2) * CELL, y: ((minY + maxY) / 2) * CELL };
}

export function resetView() {
  view.zoom = 1;
  const rect = $.canvasWrap.getBoundingClientRect();
  const center = contentCenter();
  view.x = rect.width / 2 - center.x;
  view.y = rect.height / 2 - center.y;
  applyView();
}

export function flashInvalid(cell) {
  const marker = document.createElement("div");
  marker.className = "comp invalid";
  marker.style.left = cell.x * CELL + "px";
  marker.style.top = cell.y * CELL + "px";
  marker.style.width = CELL - GAP + "px";
  marker.style.height = CELL - GAP + "px";
  marker.style.background = "transparent";
  marker.style.pointerEvents = "none";
  $.grid.appendChild(marker);
  setTimeout(() => marker.remove(), 250);
}

export const canvasWrap = $.canvasWrap;
export const grid = $.grid;
