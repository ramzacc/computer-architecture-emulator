import { bitWidth, DEFAULT_CLOCK_FREQUENCY, isSizable, validBitWidth, validChannelCount, validClockFrequency, validConstant, validSplitterOrder } from "./components.js";
import { addComponent, addWireEdge, createBoard, edgeKey, edgePlacementError, isValidComponent,
  evaluateBoard, netContaining, parseDocument, resizeNet, sanitizeWires, serialize, shortCircuitError, wireRoute } from "./model.js";
import { validValueFormat } from "./value-format.js";

export const STORAGE_KEY = "grid-canvas-document";

// Board edits live here so the browser only has to manage gestures and selection.
export class BoardEditor {
  constructor({ storage = null, onChange = () => {}, onStorageError = () => {} } = {}) {
    this.board = createBoard();
    this.pressedButtons = new Set();
    this.highClocks = new Set();
    this.registerValues = new Map();
    this.evaluation = evaluateBoard(this.board);
    this.storage = storage;
    this.onChange = onChange;
    this.onStorageError = onStorageError;
    this.nextComponentId = 1;
  }

  commit() {
    this.evaluate();
    try {
      if (!this.storage) throw new Error("Browser storage is unavailable.");
      this.storage.setItem(STORAGE_KEY, serialize(this.board));
    }
    catch (error) { this.onStorageError(error); }
  }

  // An accepted edit produces one snapshot for every reader of circuit state.
  // Trial boards used by validation remain separate from this published result.
  evaluate(captureEdges = false) {
    const buttonIds = new Set(this.board.components.filter((component) => component.t === "button")
      .map((component) => component.id));
    for (const id of this.pressedButtons) if (!buttonIds.has(id)) this.pressedButtons.delete(id);
    const clockIds = new Set(this.board.components.filter((component) => component.t === "clock")
      .map((component) => component.id));
    for (const id of this.highClocks) if (!clockIds.has(id)) this.highClocks.delete(id);
    const registers = this.board.components.filter((component) => component.t === "register");
    const registerIds = new Set(registers.map((component) => component.id));
    for (const id of this.registerValues.keys()) if (!registerIds.has(id)) this.registerValues.delete(id);
    for (const register of registers) {
      const width = bitWidth(register);
      const mask = width === 32 ? 0xffffffff : 2 ** width - 1;
      this.registerValues.set(register.id, ((this.registerValues.get(register.id) ?? 0) & mask) >>> 0);
    }
    const next = evaluateBoard(this.board, this.pressedButtons, this.highClocks, this.registerValues);
    if (captureEdges) {
      const captured = new Map();
      for (const register of registers) {
        const before = this.evaluation.states.get(register.id)?.inputs[1];
        const after = next.states.get(register.id)?.inputs[1] ?? 0;
        if (before === 0 && after !== 0)
          captured.set(register.id, next.states.get(register.id).inputs[0] >>> 0);
      }
      if (captured.size) {
        for (const [id, value] of captured) this.registerValues.set(id, value);
        this.evaluation = evaluateBoard(this.board, this.pressedButtons, this.highClocks, this.registerValues);
      } else this.evaluation = next;
    } else this.evaluation = next;
    this.onChange(this.board, this.evaluation);
    return this.evaluation;
  }

  setButtonPressed(id, pressed) {
    if (this.component(id)?.t !== "button" || this.pressedButtons.has(id) === pressed) return false;
    if (pressed) this.pressedButtons.add(id);
    else this.pressedButtons.delete(id);
    this.evaluate(true);
    return true;
  }

  tickClock(id) {
    if (this.component(id)?.t !== "clock") return false;
    if (this.highClocks.has(id)) this.highClocks.delete(id);
    else this.highClocks.add(id);
    this.evaluate(true);
    return true;
  }

  setClockFrequency(id, frequency) {
    const component = this.component(id);
    if (component?.t !== "clock" || !validClockFrequency(frequency) ||
        (component.frequency ?? DEFAULT_CLOCK_FREQUENCY) === frequency) return false;
    component.frequency = frequency;
    this.commit();
    return true;
  }

  commitComponentEdit() {
    sanitizeWires(this.board);
    this.commit();
  }

  editComponent(component, changes, { validate = isValidComponent, sanitize = false } = {}) {
    const previous = { ...component };
    Object.assign(component, changes);
    if (!validate(this.board, component)) {
      for (const key of Object.keys(changes)) {
        if (!Object.hasOwn(previous, key)) delete component[key];
        else component[key] = previous[key];
      }
      return false;
    }
    if (sanitize) this.commitComponentEdit();
    else this.commit();
    return true;
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
    this.pressedButtons.clear();
    this.highClocks.clear();
    this.registerValues.clear();
    this.nextComponentId = board.components.length + 1;
    if (save) this.commit();
    else this.evaluate();
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
      ...(type === "switch" ? { value: 0 } : {}),
      ...(type === "clock" ? { frequency: DEFAULT_CLOCK_FREQUENCY } : {}),
      ...(type === "output" ? { size: 1 } : {}),
      ...(["mux", "demux"].includes(type) ? { channels: 2 } : {}) };
    if (["mux", "demux", "adder", "twos", "comparator", "shl", "shr", "register"].includes(type)) component.size = 4;
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
    return this.editComponent(component, { x, y }, { sanitize: true });
  }

  translatedSelection(ids, wireKeys, dx, dy) {
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || (!dx && !dy)) return null;
    const selected = new Set(ids);
    const moving = this.board.components.filter((component) => selected.has(component.id));
    const edges = new Map();
    for (const key of wireKeys) {
      const net = netContaining(this.board, key, this.evaluation);
      if (net) for (const edge of net.edges) edges.set(edgeKey(edge), edge);
    }
    if (!moving.length && !edges.size) return null;

    const trial = {
      ...this.board,
      components: this.board.components.map((component) => selected.has(component.id)
        ? { ...component, x: component.x + dx, y: component.y + dy } : component),
      wires: new Map(this.board.wires),
    };
    for (const key of edges.keys()) trial.wires.delete(key);
    const movedEdges = [];
    for (const edge of edges.values()) {
      const moved = { ...edge, x: edge.x + dx, y: edge.y + dy };
      const key = edgeKey(moved);
      if (trial.wires.has(key)) return null;
      trial.wires.set(key, moved);
      movedEdges.push(moved);
    }
    for (const component of trial.components) {
      if (selected.has(component.id) && !isValidComponent(trial, component)) return null;
    }
    for (const edge of movedEdges) {
      const key = edgeKey(edge);
      trial.wires.delete(key);
      const error = edgePlacementError(trial, edge);
      trial.wires.set(key, edge);
      if (error) return null;
    }
    return trial;
  }

  moveSelection(ids, wireKeys, dx, dy) {
    const trial = this.translatedSelection(ids, wireKeys, dx, dy);
    if (!trial) return false;
    this.board.components = trial.components;
    this.board.wires = trial.wires;
    this.commit();
    return true;
  }

  rotate(id) {
    const component = this.component(id);
    if (!component) return false;
    const old = component.r ?? 0;
    for (let step = 1; step <= 3; step++) {
      if (this.editComponent(component, { r: (old + step) % 4 }, { sanitize: true })) return true;
    }
    return false;
  }

  resizeComponent(id, size) {
    const component = this.component(id);
    if (!component || !isSizable(component) || !validBitWidth(size) ||
        (component.t === "constant" && size > 8)) return false;
    if (bitWidth(component) === size) return false;
    const changes = { size };
    if (component.t === "constant") changes.value = Math.min(component.value ?? 0, 2 ** size - 1);
    return this.editComponent(component, changes, { sanitize: true });
  }

  setChannelCount(id, channels) {
    const component = this.component(id);
    if (!component || !["mux", "demux"].includes(component.t) ||
        !validChannelCount(channels) || (component.channels ?? 2) === channels) return false;
    return this.editComponent(component, { channels }, { sanitize: true });
  }

  resizeWire(key, size) {
    const net = netContaining(this.board, key, this.evaluation);
    if (!net || net.size === size || !resizeNet(this.board, key, size)) return false;
    this.commit();
    return true;
  }

  setSplitterOrder(id, order) {
    const component = this.component(id);
    if (!component || component.t !== "splitter" || !validSplitterOrder(order) || component.order === order) return false;
    return this.editComponent(component, { order }, { validate: (board) => !shortCircuitError(board) });
  }

  setConstantValue(id, value) {
    const component = this.component(id);
    if (!component || component.t !== "constant" || component.value === value ||
        !validConstant({ ...component, value })) return false;
    return this.editComponent(component, { value }, { validate: (board) => !shortCircuitError(board) });
  }

  toggleSwitch(id) {
    const component = this.component(id);
    if (component?.t !== "switch") return false;
    return this.editComponent(component, { value: component.value === 1 ? 0 : 1 },
      { validate: (board) => !shortCircuitError(board) });
  }

  setValueFormat(id, format) {
    const component = this.component(id);
    if (!component || !["constant", "output"].includes(component.t) ||
        !validValueFormat(format) || (component.format ?? "decimal") === format) return false;
    component.format = format;
    this.commit();
    return true;
  }

  deleteComponent(id) {
    return this.deleteSelection([id], []);
  }

  deleteComponents(ids) {
    return this.deleteSelection(ids, []);
  }

  deleteSelection(ids, wireKeys) {
    const selected = new Set(ids);
    const edges = new Set();
    for (const key of wireKeys) {
      const net = netContaining(this.board, key, this.evaluation);
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
    return this.copySelection(ids, []).components;
  }

  pasteComponents(copies) {
    return this.pasteSelection({ components: copies, wires: [], wireKeys: [] })?.components ?? [];
  }

  copySelection(ids, wireKeys) {
    const selected = new Set(ids);
    const components = this.board.components.filter((component) => selected.has(component.id))
      .map(({ id, ...component }) => ({ ...component }));
    const wires = new Map();
    const copiedNetIds = new Set();
    const netKeys = [];
    for (const key of wireKeys) {
      const net = netContaining(this.board, key, this.evaluation);
      if (!net || copiedNetIds.has(net.id)) continue;
      copiedNetIds.add(net.id);
      netKeys.push(edgeKey(net.edges[0]));
      for (const edge of net.edges) wires.set(edgeKey(edge), { ...edge });
    }
    return { components, wires: [...wires.values()], wireKeys: netKeys };
  }

  pasteSelection(copies) {
    if (!copies || (!copies.components?.length && !copies.wires?.length)) return null;
    // Search outward while keeping the copied layout together. Validate the
    // complete group on a trial board so a failed paste changes nothing.
    for (let offset = 2; offset <= 200; offset += 2) {
      const trial = { ...this.board, components: [...this.board.components], wires: new Map(this.board.wires) };
      const components = [];
      const wires = [];
      let nextId = this.nextComponentId;
      let valid = true;
      for (const copy of copies.components ?? []) {
        let id;
        do { id = `c${nextId++}`; } while (trial.components.some((c) => c.id === id));
        const component = { ...copy, id, x: copy.x + offset, y: copy.y + offset };
        if (!addComponent(trial, component)) { valid = false; break; }
        components.push(component);
      }
      if (!valid) continue;
      for (const copy of copies.wires ?? []) {
        const wire = { ...copy, x: copy.x + offset, y: copy.y + offset };
        if (!addWireEdge(trial, wire)) { valid = false; break; }
        wires.push(trial.wires.get(edgeKey(wire)));
      }
      if (!valid) continue;
      this.nextComponentId = nextId;
      this.board.components = trial.components;
      this.board.wires = trial.wires;
      this.commit();
      return { components, wires, wireKeys: (copies.wireKeys ?? []).map((key) => {
        const source = copies.wires.find((wire) => edgeKey(wire) === key);
        return source ? edgeKey({ ...source, x: source.x + offset, y: source.y + offset }) : null;
      }).filter(Boolean) };
    }
    return null;
  }

  deleteNet(key) {
    return this.deleteSelection([], [key]);
  }
}
