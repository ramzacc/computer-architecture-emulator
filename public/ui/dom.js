export const byId = (id) => document.getElementById(id);

/** Look up several ids at once, keyed by their camelCased id. */
export function byIds(...ids) {
  return Object.fromEntries(ids.map((id) => [
    id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
    document.getElementById(id),
  ]));
}

/** Build an element with properties, attributes, and children in one call. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "textContent") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style") Object.assign(node.style, value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

/** Show, hide, and error-mark the small status lines used across the UI. */
export function setStatus(element, message, error = false) {
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("error", error);
}

export function downloadText(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** "1 component" / "2 components" without repeating the ternary everywhere. */
export function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Duplicate names get an ordinal suffix, matching how the ROM and module
 * pickers distinguish repeated default labels.
 */
export function uniqueLabels(items, fallback) {
  const names = items.map((item) => item.label || fallback);
  return names.map((name, index) =>
    names.filter((other) => other === name).length > 1 ? `${name} ${index + 1}` : name);
}
