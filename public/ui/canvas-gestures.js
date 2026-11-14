import { dimsOf } from "../core/components.js";
import { edgeKey, evaluateBoard, netContaining, wireRoute } from "../core/model.js";
import { CELL, ZOOM_STEP } from "./canvas-view.js";
import { MODE } from "./context.js";
import { countLabel } from "./dom.js";

/**
 * Pointer gestures on the canvas: panning, marquee selection, moving the
 * selection, wiring, and the transient previews that follow the pointer.
 */
export function createCanvasGestures({ ctx, canvas, status, render, renderer, openModule }) {
  const { renderComponents, renderPins, renderWires, edgeBox, applyBox } = renderer;
  const transform = canvas.view;
  const { canvasWrapEl, gridEl } = canvas;

  let drag = null;
  let dragPreviewFrame = null;
  let pendingDragPoint = null;
  let pressedButton = null;
  let pan = null;
  let marquee = null;
  let wireStart = null;
  let wirePreviewFrame = null;
  let pendingWirePreviewPoint = null;
  let lastWirePreviewKey = null;

  const describeSelection = () =>
    `${countLabel(ctx.selectedIds.size, "component")} and ${countLabel(ctx.selectedWires.size, "wire net")} selected.`;

  function selectWire(key) {
    const net = netContaining(ctx.board, key, ctx.editor.evaluation);
    ctx.setSelection([], [net ? edgeKey(net.edges[0]) : key]);
    status.busStatus("Wire net selected.");
  }

  function beginSelectionDrag(e) {
    const world = canvas.worldFromEvent(e);
    drag = { kind: "selection", pointerId: e.pointerId, startX: world.x, startY: world.y,
      ids: [...ctx.selectedIds], wires: [...ctx.selectedWires], dx: 0, dy: 0, valid: true };
    canvasWrapEl.setPointerCapture(e.pointerId);
  }

  function pointerDown(e) {
    if (e.button === 2) return;

    const wireEl = e.target.closest(".wire");
    const compEl = e.target.closest(".comp");
    const cell = canvas.cellFromEvent(e);

    if (ctx.mode === MODE.WIRE) {
      handleWirePointer(e);
      return;
    }

    if (ctx.mode === MODE.SELECT) {
      handleSelectPointer(e, compEl, wireEl);
      return;
    }

    if (wireEl) {
      selectWire(wireEl.dataset.key);
      return;
    }

    if (compEl) {
      handleComponentPointer(e, compEl);
      return;
    }

    if (ctx.placingType) {
      const comp = ctx.editor.place(ctx.placingType, cell.x, cell.y);
      if (comp) {
        ctx.setSelection([comp.id]);
        status.busStatus("Component selected.");
      } else {
        status.busStatus("Cannot place component here. Check overlaps, bus sizes, and short circuits.", true);
        canvas.flashInvalid(cell);
      }
      return;
    }

    // Pan mode: drag empty canvas to pan; a plain click clears the selection.
    pan = {
      startX: e.clientX,
      startY: e.clientY,
      originX: transform.x,
      originY: transform.y,
      moved: false,
    };
    canvasWrapEl.classList.add("panning");
    canvasWrapEl.setPointerCapture(e.pointerId);
  }

  function handleWirePointer(e) {
    const point = canvas.pointFromEvent(e);
    if (e.shiftKey) {
      clearWireGesture();
      const changed = ctx.editor.toggleJunction(point.x, point.y);
      status.busStatus(changed
        ? "Crossing connection changed. Shift-click to toggle it again."
        : "No compatible four-way crossing here, or joining it would short the circuit.",
      !changed);
      return;
    }
    if (!wireStart) {
      wireStart = point;
      ctx.setSelection([]);
      status.busStatus("Click to place a corner or endpoint. Shift-click a crossing to join or separate it. Double-click or right-click to finish; Esc cancels.");
    } else if (point.x !== wireStart.x || point.y !== wireStart.y) {
      const result = ctx.editor.addWireRoute(wireStart, point, ctx.newWireSize);
      if (result.error) status.busStatus(result.error, true, result.issue);
      else {
        wireStart = point;
        status.busStatus("Corner placed. Click to continue, or double-click/right-click to finish.");
      }
    }
    if (wirePreviewFrame !== null) cancelAnimationFrame(wirePreviewFrame);
    wirePreviewFrame = null;
    pendingWirePreviewPoint = null;
    lastWirePreviewKey = null;
    updateWirePreview(point);
  }

  function handleSelectPointer(e, compEl, wireEl) {
    if (compEl) {
      const id = compEl.dataset.id;
      if (e.shiftKey) {
        const ids = new Set(ctx.selectedIds);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        ctx.setSelection(ids, ctx.selectedWires);
      } else {
        if (!ctx.selectedIds.has(id)) ctx.setSelection([id]);
        beginSelectionDrag(e);
      }
      status.busStatus(describeSelection());
    } else if (wireEl) {
      const net = netContaining(ctx.board, wireEl.dataset.key, ctx.editor.evaluation);
      const key = net ? edgeKey(net.edges[0]) : wireEl.dataset.key;
      if (e.shiftKey) {
        const wires = new Set(ctx.selectedWires);
        if (wires.has(key)) wires.delete(key);
        else wires.add(key);
        ctx.setSelection(ctx.selectedIds, wires);
        status.busStatus(describeSelection());
      } else {
        if (!ctx.selectedWires.has(key)) selectWire(key);
        beginSelectionDrag(e);
      }
    } else {
      const world = canvas.worldFromEvent(e);
      marquee = { startX: world.x, startY: world.y, endX: world.x, endY: world.y,
        additive: e.shiftKey, initial: new Set(ctx.selectedIds), initialWires: new Set(ctx.selectedWires), moved: false };
      canvasWrapEl.setPointerCapture(e.pointerId);
    }
  }

  function handleComponentPointer(e, compEl) {
    const comp = ctx.board.components.find((c) => c.id === compEl.dataset.id);
    if (!comp) return;
    const faceButton = e.target.closest?.("[data-face-button]");
    if (comp.t === "module" && faceButton && !ctx.placingType && !e.shiftKey && !pressedButton) {
      const id = `${comp.id}/${faceButton.dataset.faceButton}`;
      pressedButton = { id, pointerId: e.pointerId };
      canvasWrapEl.setPointerCapture(e.pointerId);
      if (!ctx.editor.setButtonPressed(id, true) && !status.activeIssue)
        status.busStatus("Button cannot press: conflicting outputs share a net.", true);
      return;
    }
    const tile = e.target.closest?.(".bit-tile[data-bit]");
    if (comp.t === "input" && tile && !ctx.placingType && !e.shiftKey) {
      if (!ctx.editor.toggleInputBit(comp.id, Number(tile.dataset.bit)) && !status.activeIssue)
        status.busStatus("Input bit cannot toggle: conflicting outputs share a net.", true);
      return;
    }
    if (comp.t === "switch" && !ctx.placingType && !e.shiftKey) {
      if (!ctx.editor.toggleSwitch(comp.id) && !status.activeIssue)
        status.busStatus("Switch cannot toggle: conflicting outputs share a net.", true);
      return;
    }
    if (comp.t === "clock" && !ctx.placingType && !e.shiftKey) {
      const enabled = comp.enable === false;
      if (ctx.editor.setClockEnabled(comp.id, enabled)) status.busStatus(`Clock ${enabled ? "enabled" : "disabled"}.`);
      return;
    }
    if (comp.t === "button" && !ctx.placingType && !e.shiftKey && !pressedButton) {
      pressedButton = { id: comp.id, pointerId: e.pointerId };
      canvasWrapEl.setPointerCapture(e.pointerId);
      ctx.editor.setButtonPressed(comp.id, true);
      return;
    }
    ctx.setSelection([comp.id]);
    status.busStatus("Component selected.");

    const world = canvas.worldFromEvent(e);
    drag = {
      pointerId: e.pointerId,
      id: comp.id,
      originX: comp.x,
      originY: comp.y,
      x: comp.x,
      y: comp.y,
      grabbedX: world.x - comp.x * CELL,
      grabbedY: world.y - comp.y * CELL,
      valid: true,
    };
    canvasWrapEl.setPointerCapture(e.pointerId);
  }

  function pointerMove(e) {
    if (marquee) {
      const world = canvas.worldFromEvent(e);
      marquee.endX = world.x;
      marquee.endY = world.y;
      marquee.moved ||= Math.abs(world.x - marquee.startX) > 3 || Math.abs(world.y - marquee.startY) > 3;
      drawMarquee();
      return;
    }
    if (pan) {
      if (Math.abs(e.clientX - pan.startX) > 3 || Math.abs(e.clientY - pan.startY) > 3) {
        pan.moved = true;
      }
      transform.x = pan.originX + (e.clientX - pan.startX);
      transform.y = pan.originY + (e.clientY - pan.startY);
      canvas.applyView();
      return;
    }

    if (ctx.mode === MODE.WIRE && !drag) {
      scheduleWirePreview(canvas.pointFromEvent(e));
      return;
    }

    if (!drag || e.pointerId !== drag.pointerId) return;
    pendingDragPoint = { x: e.clientX, y: e.clientY };
    if (dragPreviewFrame !== null) return;
    dragPreviewFrame = requestAnimationFrame(() => {
      dragPreviewFrame = null;
      const point = pendingDragPoint;
      pendingDragPoint = null;
      if (point) updateDragPreview(point.x, point.y);
    });
  }

  function renderDragPreview() {
    if (!drag) return;
    const evaluatePreview = (trial) => evaluateBoard(trial, ctx.editor.pressedButtons,
      ctx.editor.highClocks, ctx.editor.registerValues, ctx.editor.ramValues);
    if (drag.kind === "selection") {
      const { dx, dy } = drag;
      const trial = ctx.editor.translatedSelection(drag.ids, drag.wires, dx, dy);
      drag.valid = !!trial || (!dx && !dy);
      ctx.board = trial ?? ctx.editor.board;
      ctx.selectedWires = new Set(trial ? drag.wires.map((key) => {
        const edge = ctx.editor.board.wires.get(key);
        return edge ? edgeKey({ ...edge, x: edge.x + dx, y: edge.y + dy }) : key;
      }) : drag.wires);
      const logic = trial ? evaluatePreview(trial) : ctx.editor.evaluation;
      renderComponents(logic);
      renderPins();
      renderWires(logic);
      return;
    }
    const nx = drag.x, ny = drag.y;
    const trial = ctx.editor.previewMove(drag.id, nx, ny);
    drag.valid = !!trial;
    ctx.board = trial ?? { ...ctx.editor.board, components: ctx.editor.board.components.map((item) =>
      item.id === drag.id ? { ...item, x: nx, y: ny } : item) };
    const logic = trial && trial !== ctx.editor.board ? evaluatePreview(trial) : ctx.editor.evaluation;
    renderComponents(logic);
    renderPins();
    renderWires(logic);
    if (!trial) gridEl.querySelector(`.comp[data-id="${drag.id}"]`)?.classList.add("invalid");
  }

  function updateDragPreview(clientX, clientY) {
    if (!drag) return;
    const world = canvas.worldFromEvent({ clientX, clientY });
    if (drag.kind === "selection") {
      const dx = Math.round((world.x - drag.startX) / CELL);
      const dy = Math.round((world.y - drag.startY) / CELL);
      if (dx === drag.dx && dy === drag.dy) return;
      drag.dx = dx;
      drag.dy = dy;
    } else {
      const nx = Math.round((world.x - drag.grabbedX) / CELL);
      const ny = Math.round((world.y - drag.grabbedY) / CELL);
      if (nx === drag.x && ny === drag.y) return;
      drag.x = nx;
      drag.y = ny;
    }
    renderDragPreview();
  }

  function endDrag(e) {
    if (drag && e.pointerId !== drag.pointerId) return;
    if (dragPreviewFrame !== null) cancelAnimationFrame(dragPreviewFrame);
    dragPreviewFrame = null;
    pendingDragPoint = null;
    if (drag && e.type !== "pointercancel") updateDragPreview(e.clientX, e.clientY);
    if (pressedButton?.pointerId === e.pointerId) {
      releasePressedButton();
      if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) canvasWrapEl.releasePointerCapture(e.pointerId);
      return;
    }
    if (marquee) {
      finishMarquee(e);
      return;
    }
    if (pan) {
      const wasClick = !pan.moved;
      pan = null;
      canvasWrapEl.classList.remove("panning");
      if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) {
        canvasWrapEl.releasePointerCapture(e.pointerId);
      }
      if (wasClick) {
        ctx.setSelection([]);
      }
      return;
    }
    if (!drag) return;
    if (drag.kind === "selection") {
      finishSelectionDrag(e);
      return;
    }
    const { id, originX, originY, x, y, valid } = drag;
    drag = null;
    ctx.board = ctx.editor.board;
    if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) {
      canvasWrapEl.releasePointerCapture(e.pointerId);
    }
    if (e.type !== "pointercancel" && (x !== originX || y !== originY)) {
      if (!valid || !ctx.editor.move(id, x, y)) {
        status.busStatus("Cannot move component here. Check overlaps, bus sizes, and short circuits.", true);
        render();
      }
    } else render();
  }

  function finishMarquee(e) {
    const { startX, startY, endX, endY, moved, additive, initial, initialWires } = marquee;
    marquee = null;
    gridEl.querySelector(".selection-box")?.remove();
    if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) canvasWrapEl.releasePointerCapture(e.pointerId);
    if (e.type === "pointercancel") return;
    const ids = new Set(additive ? initial : []);
    const wires = new Set(additive ? initialWires : []);
    if (moved) {
      const left = Math.min(startX, endX), right = Math.max(startX, endX);
      const top = Math.min(startY, endY), bottom = Math.max(startY, endY);
      for (const component of ctx.board.components) {
        const { w, h } = dimsOf(component);
        if (component.x * CELL < right && (component.x + w) * CELL > left &&
            component.y * CELL < bottom && (component.y + h) * CELL > top) ids.add(component.id);
      }
      for (const net of ctx.editor.evaluation.nets.values()) {
        if (net.edges.some((edge) => {
          const box = edgeBox(edge);
          const x = parseFloat(box.left), y = parseFloat(box.top);
          return x < right && x + parseFloat(box.width) > left &&
            y < bottom && y + parseFloat(box.height) > top;
        })) wires.add(edgeKey(net.edges[0]));
      }
    }
    ctx.setSelection(ids, wires);
    status.busStatus(`${countLabel(ids.size, "component")} and ${countLabel(wires.size, "wire net")} selected.`);
  }

  function finishSelectionDrag(e) {
    const { ids, wires, dx, dy, valid } = drag;
    const movedWireKeys = wires.map((key) => {
      const edge = ctx.editor.board.wires.get(key);
      return edge ? edgeKey({ ...edge, x: edge.x + dx, y: edge.y + dy }) : key;
    });
    drag = null;
    ctx.board = ctx.editor.board;
    ctx.selectedWires = new Set(wires);
    if (canvasWrapEl.hasPointerCapture?.(e.pointerId)) canvasWrapEl.releasePointerCapture(e.pointerId);
    if (e.type === "pointercancel" || (!dx && !dy)) { render(); return; }
    if (!valid || !ctx.editor.moveSelection(ids, wires, dx, dy)) {
      status.busStatus("Cannot move selection here. Check overlaps, bus sizes, and short circuits.", true);
      render();
      return;
    }
    ctx.selectedWires = new Set(movedWireKeys);
    ctx.selectedWire = ctx.selectedWires.size === 1 && !ctx.selectedIds.size ? movedWireKeys[0] : null;
    render();
  }

  function drawMarquee() {
    let box = gridEl.querySelector(".selection-box");
    if (!box) {
      box = document.createElement("div");
      box.className = "selection-box";
      gridEl.appendChild(box);
    }
    box.style.left = Math.min(marquee.startX, marquee.endX) + "px";
    box.style.top = Math.min(marquee.startY, marquee.endY) + "px";
    box.style.width = Math.abs(marquee.endX - marquee.startX) + "px";
    box.style.height = Math.abs(marquee.endY - marquee.startY) + "px";
  }

  function releasePressedButton() {
    if (!pressedButton) return;
    const { id } = pressedButton;
    pressedButton = null;
    ctx.editor.setButtonPressed(id, false);
  }

  function clearWireGesture() {
    wireStart = null;
    if (wirePreviewFrame !== null) cancelAnimationFrame(wirePreviewFrame);
    wirePreviewFrame = null;
    pendingWirePreviewPoint = null;
    lastWirePreviewKey = null;
    gridEl.querySelectorAll(".wire-preview, .wire-anchor").forEach((el) => el.remove());
  }

  function scheduleWirePreview(point) {
    pendingWirePreviewPoint = point;
    if (wirePreviewFrame !== null) return;
    wirePreviewFrame = requestAnimationFrame(() => {
      wirePreviewFrame = null;
      const next = pendingWirePreviewPoint;
      pendingWirePreviewPoint = null;
      if (next) updateWirePreview(next);
    });
  }

  function updateWirePreview(point) {
    if (ctx.mode !== MODE.WIRE) return;
    const key = `${wireStart?.x},${wireStart?.y}:${point.x},${point.y}:${ctx.newWireSize}`;
    if (key === lastWirePreviewKey) return;
    lastWirePreviewKey = key;
    gridEl.querySelectorAll(".wire-preview, .wire-anchor").forEach((el) => el.remove());
    const anchor = wireStart ?? point;
    const marker = document.createElement("div");
    marker.className = "wire-anchor";
    marker.style.left = anchor.x * CELL + "px";
    marker.style.top = anchor.y * CELL + "px";
    gridEl.appendChild(marker);
    if (!wireStart) return;
    const route = wireRoute(ctx.board, wireStart, point, ctx.newWireSize);
    for (const edge of route.edges) {
      const preview = document.createElement("div");
      preview.className = `wire-preview ${route.error ? "invalid" : "valid"}`;
      applyBox(preview, edgeBox(edge));
      preview.title = route.error ?? `${ctx.newWireSize} bit wire`;
      gridEl.appendChild(preview);
    }
  }

  function contextMenu(e) {
    if (ctx.mode === MODE.WIRE && wireStart) {
      e.preventDefault();
      clearWireGesture();
      status.busStatus("Wire finished.");
      return;
    }
    const wireEl = e.target.closest(".wire");
    let key = wireEl ? wireEl.dataset.key : null;
    if (!key && ctx.mode === MODE.WIRE) key = edgeKey(canvas.edgeFromEvent(e));
    if (key && ctx.board.wires.has(key)) {
      e.preventDefault();
      ctx.editor.removeWire(key);
      ctx.setSelection(ctx.selectedIds);
    }
  }

  function doubleClick(e) {
    const id = e.target.closest?.(".comp")?.dataset.id;
    if (id && ctx.editor.component(id)?.t === "module") {
      e.preventDefault();
      openModule(id);
      return;
    }
    if (ctx.mode !== MODE.WIRE || !wireStart) return;
    e.preventDefault();
    clearWireGesture();
    status.busStatus("Wire finished.");
  }

  canvasWrapEl.addEventListener("pointerdown", pointerDown);
  canvasWrapEl.addEventListener("pointermove", pointerMove);
  canvasWrapEl.addEventListener("pointerup", endDrag);
  canvasWrapEl.addEventListener("pointercancel", endDrag);
  canvasWrapEl.addEventListener("contextmenu", contextMenu);
  canvasWrapEl.addEventListener("dblclick", doubleClick);
  canvasWrapEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const p = canvas.viewportFromEvent(e);
      canvas.zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, p.x, p.y);
    } else {
      // Two-finger / wheel scroll pans the infinite canvas.
      transform.x -= e.deltaX;
      transform.y -= e.deltaY;
      canvas.applyView();
    }
  }, { passive: false });
  canvasWrapEl.addEventListener("lostpointercapture", (e) => {
    if (pressedButton?.pointerId === e.pointerId) releasePressedButton();
  });
  canvasWrapEl.addEventListener("pointerleave", () => {
    if (wirePreviewFrame !== null) cancelAnimationFrame(wirePreviewFrame);
    wirePreviewFrame = null;
    pendingWirePreviewPoint = null;
    lastWirePreviewKey = null;
    gridEl.querySelectorAll(".wire-preview").forEach((el) => el.remove());
  });
  window.addEventListener("blur", releasePressedButton);

  return {
    clearWireGesture,
    renderDragPreview,
    hasWire: () => wireStart !== null,
    get dragging() { return drag !== null; },
  };
}
