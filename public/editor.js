import { bitWidth, DEFAULT_CLOCK_FREQUENCY, isSizable, pinsFor, validBitWidth, validChannelCount, validClockFrequency, validConstant, validRom, validRomAddressWidth, validRomWidth, validSplitterOrder } from "./components.js";
import { addComponent, addWireEdge, createBoard, crossingAt, edgeKey, isValidComponent,
  evaluateBoard, netContaining, parseDocument, pruneJunctions, resizeNet, sanitizeWires, serialize, shortCircuitError, wireLayoutError, wireRoute } from "./model.js";
import { validValueFormat } from "./value-format.js";

export const STORAGE_KEY = "grid-canvas-document";

function attachedWires(board, pin) {
  const { px: x, py: y } = pin;
  return [`H:${x - 1},${y}`, `H:${x},${y}`, `V:${x},${y - 1}`, `V:${x},${y}`]
    .filter((key) => board.wires.has(key));
}

function extendMovedPins(original, trial, moved, movingWireKeys = new Set()) {
  for (const component of moved) {
    const next = trial.components.find((item) => item.id === component.id);
    const oldPins = pinsFor(component);
    const newPins = pinsFor(next);
    for (let index = 0; index < oldPins.length; index++) {
      const pin = oldPins[index];
      if (!attachedWires(original, pin).some((key) => !movingWireKeys.has(key))) continue;
      const destination = newPins[index];
      const route = wireRoute(trial, { x: pin.px, y: pin.py },
        { x: destination.px, y: destination.py }, pin.size);
      if (route.error) return false;
      for (const edge of route.edges) trial.wires.set(edgeKey(edge), edge);
    }
  }
  return !wireLayoutError(trial);
}

// Board edits live here so the browser only has to manage gestures and selection.
export class BoardEditor {
  constructor({ storage = null, onChange = () => {}, onStorageError = () => {} } = {}) {
    this.board = createBoard();
    this.pressedButtons = new Set();
    this.highClocks = new Set();
    this.registerValues = new Map();
    this.ramValues = new Map();
    this.evaluation = evaluateBoard(this.board);
    this.storage = storage;
    this.onChange = onChange;
    this.onStorageError = onStorageError;
    this.nextComponentId = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.snapshot = structuredClone(this.board);
  }

  commit(captureEdges = false) {
    pruneJunctions(this.board);
    this.undoStack.push(this.snapshot);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.snapshot = structuredClone(this.board);
    this.evaluate(captureEdges);
    this.save();
  }

  save() {
    try {
      if (!this.storage) throw new Error("Browser storage is unavailable.");
      this.storage.setItem(STORAGE_KEY, serialize(this.board));
    }
    catch (error) { this.onStorageError(error); }
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  restoreHistory(board) {
    this.board = structuredClone(board);
    this.pressedButtons.clear();
    this.highClocks.clear();
    this.registerValues.clear();
    this.ramValues.clear();
    this.nextComponentId = this.board.components.length + 1;
    this.evaluate();
    this.save();
  }

  undo() {
    if (!this.canUndo) return false;
    this.redoStack.push(this.snapshot);
    this.snapshot = this.undoStack.pop();
    this.restoreHistory(this.snapshot);
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.undoStack.push(this.snapshot);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.snapshot = this.redoStack.pop();
    this.restoreHistory(this.snapshot);
    return true;
  }

  // An accepted edit produces one snapshot for every reader of circuit state.
  // Trial boards used by validation remain separate from this published result.
  evaluate(captureEdges = false) {
    const buttonIds = new Set(this.board.components.filter((component) => component.t === "button")
      .map((component) => component.id));
    for (const id of this.pressedButtons) if (!buttonIds.has(id)) this.pressedButtons.delete(id);
    const clockIds = new Set(this.board.components.filter((component) => component.t === "clock" && component.enable !== false)
      .map((component) => component.id));
    for (const id of this.highClocks) if (!clockIds.has(id)) this.highClocks.delete(id);
    const stored = this.board.components.filter((component) => component.t === "register" || component.t === "counter");
    const storedIds = new Set(stored.map((component) => component.id));
    for (const id of this.registerValues.keys()) if (!storedIds.has(id)) this.registerValues.delete(id);
    for (const component of stored) {
      const width = bitWidth(component);
      const mask = width === 32 ? 0xffffffff : 2 ** width - 1;
      this.registerValues.set(component.id, ((this.registerValues.get(component.id) ?? 0) & mask) >>> 0);
    }
    const ramComponents = this.board.components.filter((component) => component.t === "ram");
    const ramIds = new Set(ramComponents.map((component) => component.id));
    for (const id of this.ramValues.keys()) if (!ramIds.has(id)) this.ramValues.delete(id);
    for (const component of ramComponents) {
      const words = this.ramValues.get(component.id) ?? new Map();
      const maxAddress = 2 ** component.addressSize;
      const maxValue = 2 ** component.size;
      for (const [address, value] of words) {
        if (address >= maxAddress) words.delete(address);
        else words.set(address, value % maxValue);
      }
      this.ramValues.set(component.id, words);
    }
    const next = evaluateBoard(this.board, this.pressedButtons, this.highClocks, this.registerValues, this.ramValues);
    const captured = new Map();
    for (const component of stored) {
      const inputs = next.states.get(component.id).inputs;
      if (component.t === "counter") {
        if (inputs[1]) captured.set(component.id, 0);
        else if (captureEdges && (this.evaluation.states.get(component.id)?.inputs[0] ?? 0) === 0 && inputs[0] !== 0) {
          const width = bitWidth(component);
          const mask = width === 32 ? 0xffffffff : 2 ** width - 1;
          captured.set(component.id, (((this.registerValues.get(component.id) ?? 0) + 1) & mask) >>> 0);
        }
      } else if (captureEdges && (this.evaluation.states.get(component.id)?.inputs[1] ?? 0) === 0 && inputs[1] !== 0) {
        captured.set(component.id, inputs[0] >>> 0);
      }
    }
    for (const [id, value] of captured) this.registerValues.set(id, value);
    let wroteRam = false;
    if (captureEdges) for (const component of ramComponents) {
      const inputs = next.states.get(component.id).inputs;
      if ((this.evaluation.states.get(component.id)?.inputs[2] ?? 0) === 0 && inputs[2] !== 0) {
        this.ramValues.get(component.id).set(inputs[0], inputs[1] >>> 0);
        wroteRam = true;
      }
    }
    this.evaluation = captured.size || wroteRam
      ? evaluateBoard(this.board, this.pressedButtons, this.highClocks, this.registerValues, this.ramValues)
      : next;
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
    const component = this.component(id);
    if (component?.t !== "clock" || component.enable === false) return false;
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

  setClockEnabled(id, enable) {
    const component = this.component(id);
    if (component?.t !== "clock" || typeof enable !== "boolean" || (component.enable !== false) === enable) return false;
    component.enable = enable;
    if (!enable) this.highClocks.delete(id);
    this.commit();
    return true;
  }

  commitComponentEdit() {
    sanitizeWires(this.board);
    this.commit();
  }

  editComponent(component, changes, { validate = isValidComponent, sanitize = false, captureEdges = false } = {}) {
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
    else this.commit(captureEdges);
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
    this.undoStack = [];
    this.redoStack = [];
    this.snapshot = structuredClone(board);
    this.pressedButtons.clear();
    this.highClocks.clear();
    this.registerValues.clear();
    this.ramValues.clear();
    this.nextComponentId = board.components.length + 1;
    this.evaluate();
    if (save) this.save();
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
      ...(["constant", "input"].includes(type) ? { size: 1, value: 0 } : {}),
      ...(type === "rom" ? { size: 8, addressSize: 8, data: [] } : {}),
      ...(type === "ram" ? { size: 8, addressSize: 8 } : {}),
      ...(type === "switch" ? { value: 0 } : {}),
      ...(type === "clock" ? { frequency: DEFAULT_CLOCK_FREQUENCY, enable: false } : {}),
      ...(["output", "portal"].includes(type) ? { size: 1 } : {}),
      ...(["input", "output", "portal"].includes(type) ? { label: "" } : {}),
      ...(["mux", "demux"].includes(type) ? { channels: 2 } : {}) };
    if (["mux", "demux", "adder", "twos", "comparator", "shl", "shr", "register", "counter"].includes(type)) component.size = 4;
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

  toggleJunction(x, y) {
    if (!crossingAt(this.board, x, y)) return false;
    const key = `${x},${y}`;
    if (this.board.junctions.has(key)) this.board.junctions.delete(key);
    else {
      this.board.junctions.add(key);
      if (wireLayoutError(this.board)) {
        this.board.junctions.delete(key);
        return false;
      }
    }
    this.commit();
    return true;
  }

  removeWire(key) {
    if (!this.board.wires.delete(key)) return false;
    this.commit();
    return true;
  }

  move(id, x, y) {
    const component = this.component(id);
    if (!component || (component.x === x && component.y === y)) return false;
    const trial = this.previewMove(id, x, y);
    if (!trial) return false;
    this.board.components = trial.components;
    this.board.wires = trial.wires;
    this.board.junctions = trial.junctions;
    this.commit();
    return true;
  }

  previewMove(id, x, y) {
    const component = this.component(id);
    if (!component || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
    if (component.x === x && component.y === y) return this.board;
    const trial = {
      ...this.board,
      components: this.board.components.map((item) => item.id === id ? { ...item, x, y } : item),
      wires: new Map(this.board.wires),
      junctions: new Set(this.board.junctions),
    };
    const next = trial.components.find((item) => item.id === id);
    if (!isValidComponent(trial, next) || !extendMovedPins(this.board, trial, [component])) return null;
    return trial;
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
      junctions: new Set(this.board.junctions),
    };
    for (const key of this.board.junctions) {
      const [x, y] = key.split(",").map(Number);
      if ([`H:${x - 1},${y}`, `H:${x},${y}`, `V:${x},${y - 1}`, `V:${x},${y}`]
        .every((edgeKey) => edges.has(edgeKey))) {
        trial.junctions.delete(key);
        trial.junctions.add(`${x + dx},${y + dy}`);
      }
    }
    for (const key of edges.keys()) trial.wires.delete(key);
    for (const edge of edges.values()) {
      const moved = { ...edge, x: edge.x + dx, y: edge.y + dy };
      const key = edgeKey(moved);
      if (trial.wires.has(key)) return null;
      trial.wires.set(key, moved);
    }
    for (const component of trial.components) {
      if (selected.has(component.id) && !isValidComponent(trial, component)) return null;
    }
    pruneJunctions(trial);
    if (wireLayoutError(trial) || !extendMovedPins(this.board, trial, moving, edges)) return null;
    return trial;
  }

  moveSelection(ids, wireKeys, dx, dy) {
    const trial = this.translatedSelection(ids, wireKeys, dx, dy);
    if (!trial) return false;
    this.board.components = trial.components;
    this.board.wires = trial.wires;
    this.board.junctions = trial.junctions;
    this.commit();
    return true;
  }

  rotate(id) {
    const component = this.component(id);
    if (!component) return false;
    const old = component.r ?? 0;
    if (["constant", "input", "output"].includes(component.t))
      return this.editComponent(component, { r: old === 2 ? 0 : 2 }, { sanitize: true });
    for (let step = 1; step <= 3; step++) {
      if (this.editComponent(component, { r: (old + step) % 4 }, { sanitize: true })) return true;
    }
    return false;
  }

  resizeComponent(id, size) {
    const component = this.component(id);
    if (!component || !isSizable(component) || !validBitWidth(size) ||
        (["constant", "input"].includes(component.t) && size > 8) ||
        (["rom", "ram"].includes(component.t) && !validRomWidth(size))) return false;
    if (bitWidth(component) === size) return false;
    const changes = { size };
    if (["constant", "input"].includes(component.t)) changes.value = Math.min(component.value ?? 0, 2 ** size - 1);
    if (component.t === "rom") changes.data = (component.data ?? [])
      .map(([address, value]) => [address, value % (2 ** size)])
      .filter(([, value]) => value !== 0);
    return this.editComponent(component, changes, { sanitize: true });
  }

  setRomData(id, data) {
    const component = this.component(id);
    if (component?.t !== "rom" || !validRom({ ...component, data })) return false;
    const sorted = data.map(([address, value]) => [address, value]).sort((a, b) => a[0] - b[0]);
    if (JSON.stringify(component.data ?? []) === JSON.stringify(sorted)) return false;
    return this.editComponent(component, { data: sorted }, { validate: (board) => !shortCircuitError(board) });
  }

  resizeRomAddress(id, addressSize) {
    const component = this.component(id);
    if (component?.t !== "rom" || !validRomAddressWidth(addressSize) ||
        (component.addressSize ?? 8) === addressSize) return false;
    return this.editComponent(component, { addressSize }, { sanitize: true });
  }

  resizeRamAddress(id, addressSize) {
    const component = this.component(id);
    if (component?.t !== "ram" || !validRomAddressWidth(addressSize) ||
        (component.addressSize ?? 8) === addressSize) return false;
    return this.editComponent(component, { addressSize }, { sanitize: true });
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
    if (!component || !["constant", "input"].includes(component.t) || component.value === value ||
        !validConstant({ ...component, value })) return false;
    return this.editComponent(component, { value }, { validate: (board) => !shortCircuitError(board), captureEdges: true });
  }

  toggleSwitch(id) {
    const component = this.component(id);
    if (component?.t !== "switch") return false;
    return this.editComponent(component, { value: component.value === 1 ? 0 : 1 },
      { validate: (board) => !shortCircuitError(board), captureEdges: true });
  }

  toggleInputBit(id, bit) {
    const component = this.component(id);
    if (component?.t !== "input" || !Number.isInteger(bit) || bit < 0 || bit >= bitWidth(component)) return false;
    return this.setConstantValue(id, (component.value ?? 0) ^ (1 << bit));
  }

  setLabel(id, label) {
    const component = this.component(id);
    if (!component || !["input", "output", "portal"].includes(component.t) || typeof label !== "string" || label.length > 80 || component.label === label) return false;
    return this.editComponent(component, { label });
  }

  setValueFormat(id, format) {
    const component = this.component(id);
    if (!component || !["constant", "input", "output"].includes(component.t) ||
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
    const junctions = [...this.board.junctions].filter((key) => {
      const [x, y] = key.split(",").map(Number);
      return [`H:${x - 1},${y}`, `H:${x},${y}`, `V:${x},${y - 1}`, `V:${x},${y}`]
        .every((edgeKey) => wires.has(edgeKey));
    });
    return { components, wires: [...wires.values()], wireKeys: netKeys, junctions };
  }

  pasteSelection(copies) {
    if (!copies || (!copies.components?.length && !copies.wires?.length)) return null;
    // Search outward while keeping the copied layout together. Validate the
    // complete group on a trial board so a failed paste changes nothing.
    for (let offset = 2; offset <= 200; offset += 2) {
      const trial = { ...this.board, components: [...this.board.components], wires: new Map(this.board.wires),
        junctions: new Set(this.board.junctions) };
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
        if (trial.wires.has(edgeKey(wire))) { valid = false; break; }
        trial.wires.set(edgeKey(wire), wire);
        wires.push(wire);
      }
      if (!valid) continue;
      for (const key of copies.junctions ?? []) {
        const [x, y] = key.split(",").map(Number);
        trial.junctions.add(`${x + offset},${y + offset}`);
      }
      if (wireLayoutError(trial)) continue;
      this.nextComponentId = nextId;
      this.board.components = trial.components;
      this.board.wires = trial.wires;
      this.board.junctions = trial.junctions;
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
