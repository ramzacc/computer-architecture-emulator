import { spec } from "../core/components.js";
import { renderComponents, renderWires } from "./canvas-render.js";
import { ctx } from "./context.js";
import { byIds, setStatus } from "./dom.js";

const $ = byIds("bus-status", "circuit-error");

/** Inspector status line and canvas circuit-error banner. */
export function busStatus(message, error = false, issue = null) {
  setStatus($.busStatus, message, error);
  ctx.activeIssue = error ? issue : null;
  if (error) {
    const names = (issue?.componentIds ?? []).map((id) => ctx.board.components.find((c) => c.id === id))
      .filter(Boolean).map((c) => c.label?.trim() || spec(c.t)?.label || c.t);
    const details = names.length
      ? ` Check ${[...new Set(names)].join(", ")}${issue?.wireKeys?.length ? " and the highlighted net" : ""}.`
      : issue?.wireKeys?.length ? " Check the highlighted net." : "";
    $.circuitError.textContent = `${message}${details}`;
  }
  $.circuitError.hidden = !error;
  renderWires();
  renderComponents();
}

export function reportRuntimeIssue(issue) {
  const active = ctx.activeIssue;
  if (active?.message === issue.message &&
      active.componentIds.join(",") === issue.componentIds.join(",") &&
      active.wireKeys.join(",") === issue.wireKeys.join(",")) return;
  busStatus(issue.message, true, issue);
}

export function isBusError() {
  return $.busStatus.classList.contains("error");
}
