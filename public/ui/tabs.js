export function createTabs(tablist, onShow = () => {}) {
  const entries = [...tablist.querySelectorAll('[role="tab"]')].map((tab) => {
    const panel = tablist.ownerDocument.getElementById(tab.getAttribute("aria-controls"));
    if (!panel || panel.getAttribute("role") !== "tabpanel")
      throw new Error(`Tab ${tab.id} has no panel.`);
    return { tab, panel };
  });
  if (!entries.length) throw new Error("Tab list is empty.");

  let active;
  function show(panelId, { focus = false, notify = true } = {}) {
    const next = entries.find(({ tab, panel }) => panel.id === panelId && !tab.hidden);
    if (!next) throw new Error(`No visible tab controls ${panelId}.`);
    for (const { tab, panel } of entries) {
      const selected = tab === next.tab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
    }
    active = panelId;
    if (notify) onShow(panelId);
    if (focus) next.tab.focus();
  }

  const initial = entries.find(({ tab }) => tab.getAttribute("aria-selected") === "true" && !tab.hidden)
    ?? entries.find(({ tab }) => !tab.hidden);
  if (!initial) throw new Error("Tab list has no visible tabs.");
  show(initial.panel.id, { notify: false });

  function entryFor(target) {
    return entries.find(({ tab }) => tab === target || tab.contains(target));
  }

  tablist.addEventListener("click", (event) => {
    const entry = entryFor(event.target);
    if (entry && !entry.tab.hidden) show(entry.panel.id);
  });
  tablist.addEventListener("keydown", (event) => {
    const entry = entryFor(event.target);
    if (!entry) return;
    const visible = entries.filter(({ tab }) => !tab.hidden);
    const index = visible.indexOf(entry);
    let next;
    switch (event.key) {
      case "ArrowRight": next = visible[(index + 1) % visible.length]; break;
      case "ArrowLeft": next = visible[(index - 1 + visible.length) % visible.length]; break;
      case "Home": next = visible[0]; break;
      case "End": next = visible.at(-1); break;
      default: return;
    }
    event.preventDefault();
    show(next.panel.id, { focus: true });
  });

  return { show, get active() { return active; } };
}
