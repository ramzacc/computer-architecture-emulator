import { bitWidth, isSizable, validBitWidth, validConstant, validSplitterOrder } from "./components.js";
import { addComponent, addWireEdge, createBoard, edgeKey, isValidComponent,
  netContaining, parseDocument, resizeNet, sanitizeWires, serialize, shortCircuitError, wireRoute } from "./model.js";

export const STORAGE_KEY = "grid-canvas-prototype-v5";

// Board edits live here so the browser only has to manage gestures and selection.
export class BoardEditor {
  constructor({ storage = null, onChange = () => {}, onStorageError = () => {} } = {}) {
    this.board = createBoard();
    this.storage = storage;
    this.onChange = onChange;
    this.onStorageError = onStorageError;
    this.nextComponentId = 1;
  }

  commit() {
    this.onChange(this.board);
    try {
      if (!this.storage) throw new Error("Browser storage is unavailable.");
      this.storage.setItem(STORAGE_KEY, serialize(this.board));
    }
    catch (error) { this.onStorageError(error); }
  }

  commitComponentEdit() {
    sanitizeWires(this.board);
    this.commit();
  }

  loadSaved() {
    let saved;
    try { saved = this.storage?.getItem(STORAGE_KEY); }
    catch (error) { this.onStorageError(error); return null; }
    if (!saved) return null;
    return parseDocument(saved);
  }

  replaceBoard(board, { save = true } = {}) {
    this.board = board;
    this.nextComponentId = board.components.length + 1;
    if (save) this.commit();
    else this.onChange(this.board);
  }

  importText(text) {
    const result = parseDocument(text);
    this.replaceBoard(result.board);
    return result;
  }

  component(id) { return this.board.components.find((c) => c.id === id); }

  place(type, x, y) {
    let id;
    do { id = `c${this.nextComponentId++}`; } while (this.component(id));
    const component = { id, t: type, x, y, r: 0,
      ...(type === "splitter" ? { size: 4, order: "ascendant" } : {}),
      ...(type === "constant" ? { size: 1, value: 0 } : {}),
      ...(type === "output" ? { size: 1 } : {}) };
    if (type === "alu") component.size = 4;
    if (!addComponent(this.board, component)) return null;
    this.commitComponentEdit();
    return component;
  }

  addWire(edge) {
    if (!addWireEdge(this.board, edge)) return false;
    this.commit();
    return true;
  }

  addWireRoute(start, end, size) {
    const route = wireRoute(this.board, start, end, size);
    if (route.error) return route;
    let changed = false;
    for (const edge of route.edges) {
      if (this.board.wires.has(edgeKey(edge))) continue;
      this.board.wires.set(edgeKey(edge), edge);
      changed = true;
    }
    if (changed) this.commit();
    return route;
  }

  removeWire(key) {
    if (!this.board.wires.delete(key)) return false;
    this.commit();
    return true;
  }

  move(id, x, y) {
    const component = this.component(id);
    if (!component || (component.x === x && component.y === y)) return false;
    const old = { x: component.x, y: component.y };
    component.x = x;
    component.y = y;
    if (!isValidComponent(this.board, component)) {
      Object.assign(component, old);
      return false;
    }
    this.commitComponentEdit();
    return true;
  }

  rotate(id) {
    const component = this.component(id);
    if (!component) return false;
    const old = component.r ?? 0;
    for (let step = 1; step <= 3; step++) {
      component.r = (old + step) % 4;
      if (isValidComponent(this.board, component)) { this.commitComponentEdit(); return true; }
    }
    component.r = old;
    return false;
  }

  resizeComponent(id, size) {
    const component = this.component(id);
    if (!component || !isSizable(component) || !validBitWidth(size) ||
        (component.t === "constant" && size > 8)) return false;
    const oldSize = bitWidth(component), oldValue = component.value;
    if (oldSize === size) return false;
    component.size = size;
    if (component.t === "constant") component.value = Math.min(component.value ?? 0, 2 ** size - 1);
    if (!isValidComponent(this.board, component)) {
      component.size = oldSize;
      component.value = oldValue;
      return false;
    }
    this.commitComponentEdit();
    return true;
  }

  resizeWire(key, size) {
    const net = netContaining(this.board, key);
    if (!net || net.size === size || !resizeNet(this.board, key, size)) return false;
    this.commit();
    return true;
  }

  setSplitterOrder(id, order) {
    const component = this.component(id);
    if (!component || component.t !== "splitter" || !validSplitterOrder(order) || component.order === order) return false;
    const old = component.order;
    component.order = order;
    if (shortCircuitError(this.board)) { component.order = old; return false; }
    this.commit();
    return true;
  }

  setConstantValue(id, value) {
    const component = this.component(id);
    if (!component || component.t !== "constant" || component.value === value ||
        !validConstant({ ...component, value })) return false;
    const old = component.value;
    component.value = value;
    if (shortCircuitError(this.board)) { component.value = old; return false; }
    this.commit();
    return true;
  }

  deleteComponent(id) {
    const index = this.board.components.findIndex((c) => c.id === id);
    if (index < 0) return false;
    this.board.components.splice(index, 1);
    this.commit();
    return true;
  }

  deleteComponents(ids) {
    const selected = new Set(ids);
    const before = this.board.components.length;
    this.board.components = this.board.components.filter((component) => !selected.has(component.id));
    if (this.board.components.length === before) return false;
    this.commit();
    return true;
  }

  deleteSelection(ids, wireKeys) {
    const selected = new Set(ids);
    const edges = new Set();
    for (const key of wireKeys) {
      const net = netContaining(this.board, key);
      if (net) for (const edge of net.edges) edges.add(edgeKey(edge));
    }
    const before = this.board.components.length;
    this.board.components = this.board.components.filter((component) => !selected.has(component.id));
    for (const key of edges) this.board.wires.delete(key);
    if (this.board.components.length === before && !edges.size) return false;
    this.commit();
    return true;
  }

  copyComponents(ids) {
    const selected = new Set(ids);
    return this.board.components.filter((component) => selected.has(component.id))
      .map(({ id, ...component }) => ({ ...component }));
  }

  pasteComponents(copies) {
    if (!copies?.length) return [];
    // Search outward while keeping the copied layout together. Validate the
    // complete group on a trial board so a failed paste changes nothing.
    for (let offset = 2; offset <= 200; offset += 2) {
      const trial = { ...this.board, components: [...this.board.components] };
      const added = [];
      let nextId = this.nextComponentId;
      let valid = true;
      for (const copy of copies) {
        let id;
        do { id = `c${nextId++}`; } while (trial.components.some((c) => c.id === id));
        const component = { ...copy, id, x: copy.x + offset, y: copy.y + offset };
        if (!addComponent(trial, component)) { valid = false; break; }
        added.push(component);
      }
      if (!valid) continue;
      this.nextComponentId = nextId;
      this.board.components.push(...added);
      this.commit();
      return added;
    }
    return [];
  }

  deleteNet(key) {
    const net = netContaining(this.board, key);
    if (!net) return false;
    for (const edge of net.edges) this.board.wires.delete(edgeKey(edge));
    this.commit();
    return true;
  }
}
