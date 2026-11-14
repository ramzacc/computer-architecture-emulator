import { spec } from "../core/components.js";
import { byId, setStatus } from "./dom.js";

/**
 * Owns the inspector status line and the canvas circuit-error banner.
 * Rendering hooks are filled in after the renderer exists.
 */
export function createStatus({ getState, hooks }) {
  const busStatusEl = byId("bus-status");
  const circuitErrorEl = byId("circuit-error");
  let activeIssue = null;

  function busStatus(message, error = false, issue = null) {
    setStatus(busStatusEl, message, error);
    activeIssue = error ? issue : null;
    if (error) {
      const names = (issue?.componentIds ?? []).map((id) => getState().components.find((c) => c.id === id))
        .filter(Boolean).map((c) => c.label?.trim() || spec(c.t)?.label || c.t);
      const details = names.length
        ? ` Check ${[...new Set(names)].join(", ")}${issue?.wireKeys?.length ? " and the highlighted net" : ""}.`
        : issue?.wireKeys?.length ? " Check the highlighted net." : "";
      circuitErrorEl.textContent = `${message}${details}`;
    }
    circuitErrorEl.hidden = !error;
    hooks.renderWires();
    hooks.renderComponents();
  }

  function reportRuntimeIssue(issue) {
    if (activeIssue?.message === issue.message &&
        activeIssue.componentIds.join(",") === issue.componentIds.join(",") &&
        activeIssue.wireKeys.join(",") === issue.wireKeys.join(",")) return;
    busStatus(issue.message, true, issue);
  }

  return {
    busStatus,
    reportRuntimeIssue,
    isError: () => busStatusEl.classList.contains("error"),
    get activeIssue() { return activeIssue; },
  };
}
