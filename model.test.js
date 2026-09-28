import { assemble, disassemble } from "./public/assembly.js";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { dimsOf, moduleFaceParts, pinsFor, spec } from "./public/components.js";
import { addComponent, addWireEdge, canPlaceEdge, computeNets, createBoard,
  edgeKey, edgePlacementError, evaluateBoard, isValidComponent, parseDocument, resizeNet,
  sanitizeWires, serialize, wireRoute } from "./public/model.js";

test("modules expose named ports and carry parent inputs through nested circuitry", () => {
  const inner = createBoard();
  assert.equal(addComponent(inner, { id: "c1", t: "input", x: 0, y: 0, r: 2, size: 1, value: 0, label: "A" }), true);
  assert.equal(addComponent(inner, { id: "c2", t: "output", x: 4, y: 0, r: 0, size: 1, label: "Y" }), true);
  for (const x of [2, 3]) assert.equal(addWireEdge(inner, { o: "H", x, y: 1, size: 1 }), true);

  const board = createBoard();
  assert.equal(addComponent(board, { id: "source", t: "input", x: -3, y: 0, r: 2, size: 1, value: 1, label: "Source" }), true);
  const module = { id: "module", t: "module", x: 0, y: 0, r: 0, label: "Pass through", module: JSON.parse(serialize(inner)) };
  assert.equal(addComponent(board, module), true);
  assert.deepEqual(pinsFor(module).map(({ role, name, size }) => ({ role, name, size })), [
    { role: "in", name: "A", size: 1 }, { role: "out", name: "Y", size: 1 },
  ]);
  assert.equal(addComponent(board, { id: "sink", t: "output", x: 5, y: 0, r: 0, size: 1, label: "Sink" }), true);
  assert.equal(addWireEdge(board, { o: "H", x: -1, y: 1, size: 1 }), true);
  assert.equal(addWireEdge(board, { o: "H", x: 4, y: 1, size: 1 }), true);
  assert.equal(evaluateBoard(board).states.get("sink").value, 1);
  assert.equal(evaluateBoard(parseDocument(serialize(board)).board).states.get("c3").value, 1);
  board.components[0].value = 0;
  assert.equal(evaluateBoard(board).states.get("sink").value, 0);
});

test("labels are required and unique within each component type", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "adder", t: "adder", x: 0, y: 0, label: "foo" }), true);
  assert.equal(addComponent(board, { id: "rom", t: "rom", x: 7, y: 0, label: "foo" }), true);
  assert.equal(addComponent(board, { id: "duplicate", t: "rom", x: 14, y: 0, label: "foo" }), false);
  const document = JSON.parse(serialize(board));
  document.components[1][document.components[1].length - 1] = "foo";
  assert.equal(parseDocument(JSON.stringify(document)).board.components.length, 2);
  document.components.push(["rom", 14, 0, 0, 8, 8, [], "foo"]);
  assert.throws(() => parseDocument(JSON.stringify(document)), /duplicates a rom label/);
  document.components.pop();
  document.components[0].pop();
  assert.throws(() => parseDocument(JSON.stringify(document)), /entries/);
});

test("a tag displays its label and observes a bus without driving it", () => {
  const board = createBoard();
  const source = { id: "source", t: "constant", x: 0, y: 0, r: 2, size: 4, value: 10 };
  const tag = { id: "tag", t: "tag", x: 6, y: 0, r: 0, size: 4, label: "DATA" };
  assert.equal(addComponent(board, source), true);
  assert.equal(addComponent(board, tag), true);
  assert.deepEqual(dimsOf(tag), { w: 4, h: 2 });
  assert.equal(pinsFor(tag)[0].size, 4);
  assert.equal(addWireEdge(board, { o: "H", x: 5, y: 1, size: 4 }), true);
  assert.equal(evaluateBoard(board).states.get("tag").inputs[0], 10);
  assert.equal(evaluateBoard(board).states.get("tag").value, 10);
  assert.equal(parseDocument(serialize(board)).board.components[1].label, "DATA");
});

test("a tag follows a clock as the circuit evaluation changes", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "clock", t: "clock", x: 0, y: 0, enable: true }), true);
  assert.equal(addComponent(board, { id: "tag", t: "tag", x: -1, y: 4, r: 1, size: 1, label: "CLK" }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 2 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 3 }), true);
  assert.equal(evaluateBoard(board).states.get("tag").value, 0);
  assert.equal(evaluateBoard(board, new Set(), new Set(["clock"])).states.get("tag").value, 1);
});

test("tag rotation moves only its pin around a fixed 4x2 body", () => {
  const tag = { t: "tag", x: 5, y: 7, size: 8, label: "DATA" };
  const expected = [[5, 8, "W"], [7, 7, "N"], [9, 8, "E"], [7, 9, "S"]];
  for (let r = 0; r < 4; r++) {
    tag.r = r;
    assert.deepEqual(dimsOf(tag), { w: 4, h: 2 });
    const { px, py, dir, size } = pinsFor(tag)[0];
    assert.deepEqual([px, py, dir, size], [...expected[r], 8]);
  }
});

test("module documents reject incomplete, corner, or duplicate pin layouts", () => {
  const inner = createBoard();
  assert.equal(addComponent(inner, { id: "c1", t: "input", x: 0, y: 0, r: 0, size: 1, value: 0, label: "A" }), true);
  assert.equal(addComponent(inner, { id: "c2", t: "output", x: 4, y: 0, r: 0, size: 1, label: "Y" }), true);
  const document = { components: [["module", 0, 0, 0, JSON.parse(serialize(inner)), null, null, 4, 3, "M"]], wires: [], junctions: [] };
  assert.throws(() => parseDocument(JSON.stringify({ ...document, components: [document.components[0].slice(0, 6)] })), /entries/);
  const withPins = structuredClone(document);
  withPins.components[0][5] = [["N", 2], ["E", 1]];
  assert.deepEqual(parseDocument(JSON.stringify(withPins)).board.components[0].pinLayout, [["N", 2], ["E", 1]]);
  for (const layout of [[['N', 0], ['E', 1]], [['N', 2], ['N', 2]], [['W', 3], ['E', 1]]]) {
    const invalid = structuredClone(document);
    invalid.components[0][5] = layout;
    assert.throws(() => parseDocument(JSON.stringify(invalid)), /invalid/);
  }
});

test("module face indicators reflect their internal circuit state", () => {
  const inner = createBoard();
  assert.equal(addComponent(inner, { id: "c1", t: "constant", x: 0, y: 0, r: 2, size: 1, value: 1 }), true);
  assert.equal(addComponent(inner, { id: "c2", t: "led", x: 4, y: 1, r: 0 }), true);
  for (const x of [2, 3, 4]) assert.equal(addWireEdge(inner, { o: "H", x, y: 1, size: 1 }), true);
  const board = createBoard();
  const module = { id: "m", t: "module", x: 0, y: 0, r: 0, label: "Lamp", module: JSON.parse(serialize(inner)), faceLayout: [[1, 2, 2]] };
  assert.equal(addComponent(board, module), true);
  assert.equal(evaluateBoard(board).states.get("m").faceStates.get("c2").lit, true);
  const saved = JSON.parse(serialize(board));
  saved.components[0][6] = [[1, 2, 2], [1, 3, 2]];
  assert.throws(() => parseDocument(JSON.stringify(saved)), /invalid/);
  saved.components[0][6] = [[1, 0, 2]];
  assert.throws(() => parseDocument(JSON.stringify(saved)), /invalid/);
});

test("module layout face parts retain labels from every supported component type", () => {
  const inner = createBoard();
  for (const [index, type, label] of [
    [0, "led", "Carry light"],
    [1, "sevenseg", "Digit"],
    [2, "debugdisplay", "Hex value"],
    [3, "output", "Result"],
    [4, "button", "Reset"],
  ]) {
    assert.equal(addComponent(inner, { id: `c${index + 1}`, t: type, x: index * 8, y: 0, r: 0, label }), true);
  }
  const module = { module: JSON.parse(serialize(inner)) };
  assert.deepEqual(moduleFaceParts(module).map(({ type, label }) => [type, label]), [
    ["led", "Carry light"],
    ["sevenseg", "Digit"],
    ["debugdisplay", "Hex value"],
    ["output", "Result"],
    ["button", "Reset"],
  ]);
});

test("portals with different labels observe separate buses", () => {
  const board = createBoard();
  for (const component of [
    { id: "source", t: "constant", x: -6, y: 0, r: 2, size: 4, value: 10 },
    { id: "a", t: "portal", x: 1, y: 0, r: 0, size: 4, label: "DATA" },
    { id: "b", t: "portal", x: 9, y: 0, r: 2, size: 4, label: "OTHER" },
    { id: "sink", t: "output", x: 13, y: 0, r: 0, size: 4, label: "Read" },
  ]) assert.equal(addComponent(board, component), true);
  for (const edge of [
    { o: "H", x: -1, y: 1, size: 4 }, { o: "H", x: 0, y: 1, size: 4 },
    { o: "H", x: 12, y: 1, size: 4 },
  ]) assert.equal(addWireEdge(board, edge), true);
  assert.equal(evaluateBoard(board).states.get("sink").value, 0);
  assert.equal(computeNets(board).size, 2);
  const restored = parseDocument(serialize(board)).board;
  assert.equal(restored.components[1].label, "DATA");
  assert.equal(evaluateBoard(restored).states.get(restored.components[3].id).value, 0);
  assert.equal(addComponent(board, { id: "another", t: "portal", x: 20, y: 0, size: 1, label: "DATA" }), true);
});

test("duplicate portal labels survive saving without joining their buses", () => {
  const board = createBoard();
  for (const component of [
    { id: "high", t: "constant", x: -3, y: 0, r: 2, value: 1 },
    { id: "a", t: "portal", x: 1, y: 0, label: "A" },
    { id: "b", t: "portal", x: 9, y: 0, r: 2, label: "B" },
    { id: "low", t: "constant", x: 13, y: 0, r: 0, value: 0 },
  ]) assert.equal(addComponent(board, component), true);
  assert.equal(addWireEdge(board, { o: "H", x: -1, y: 1 }), true);
  assert.equal(addWireEdge(board, { o: "H", x: 0, y: 1 }), true);
  assert.equal(addWireEdge(board, { o: "H", x: 12, y: 1 }), true);
  assert.equal(computeNets(board).size, 2);
  board.components[2].label = "A";
  const restored = parseDocument(serialize(board)).board;
  assert.deepEqual(restored.components.filter((component) => component.t === "portal").map((component) => component.label), ["A", "A"]);
  assert.equal(computeNets(restored).size, 2);
});

test("a button drives its one output HIGH only during an evaluation with its input pressed", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "button", t: "button", x: 0, y: 0 }), true);
  assert.equal(addComponent(board, { id: "led", t: "led", x: 0, y: 3 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 2 }), true);
  assert.deepEqual(pinsFor(board.components[0]).map(({ role, size }) => ({ role, size })),
    [{ role: "out", size: 1 }]);

  const released = evaluateBoard(board);
  assert.equal(released.states.get("button").value, 0);
  assert.equal(released.states.get("led").lit, false);
  const pressed = evaluateBoard(board, new Set(["button"]));
  assert.equal(pressed.states.get("button").value, 1);
  assert.equal(pressed.states.get("led").lit, true);
  assert.equal([...pressed.nets.values()][0].value, 1);
  assert.equal(evaluateBoard(board).states.get("led").lit, false);
  assert.equal(released.states.get("led").lit, false);

  const restored = parseDocument(serialize(board)).board;
  assert.equal(evaluateBoard(restored).states.get(restored.components[1].id).lit, false);
});

test("switch value is validated, drives a net and survives document round trip", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "bad", t: "switch", x: 4, y: 0, value: 2 }), false);
  assert.equal(addComponent(board, { id: "sw", t: "switch", x: 0, y: 0, value: 1 }), true);
  assert.equal(addComponent(board, { id: "led", t: "led", x: 0, y: 3 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 2 }), true);
  assert.equal(evaluateBoard(board).states.get("led").lit, true);
  assert.equal(JSON.parse(serialize(board)).components[0][4], 1);
  const restored = parseDocument(serialize(board));
  assert.equal(evaluateBoard(restored.board).states.get(restored.board.components[1].id).lit, true);
});

test("seven-segment display reads seven independent one-bit inputs", () => {
  const board = createBoard();
  const display = { id: "seven", t: "sevenseg", x: 0, y: 0, r: 0 };
  assert.equal(addComponent(board, display), true);
  assert.deepEqual(pinsFor(display).map(({ name, role, size }) => [name, role, size]),
    "ABCDEFG".split("").map((name) => [name, "in", 1]));
  assert.equal(addComponent(board, { id: "top", t: "constant", x: -1, y: -2, value: 1, r: 2 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: -1 }), true);
  assert.equal(addComponent(board, { id: "bottom", t: "constant", x: 1, y: 6, r: 0, value: 1 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 5 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 6 }), true);
  assert.deepEqual(evaluateBoard(board).states.get("seven").inputs, [1, 0, 0, 0, 1, 0, 0]);
  assert.deepEqual(pinsFor({ ...display, r: 1 }).map(({ name }) => name), "ABCDEFG".split(""));
  assert.equal(parseDocument(serialize(board)).board.components.length, board.components.length);
});

test("debug display reads exactly four bits and preserves its value through saving", () => {
  const board = createBoard();
  const source = { id: "source", t: "constant", x: -3, y: 1, size: 4, value: 10, r: 2 };
  const display = { id: "debug", t: "debugdisplay", x: 0, y: 4 };
  assert.equal(addComponent(board, source), true);
  assert.equal(addComponent(board, display), true);
  assert.deepEqual(pinsFor(display).map(({ name, role, size }) => [name, role, size]), [["HEX", "in", 4]]);
  assert.equal(addWireEdge(board, { o: "V", x: 2, y: 2, size: 1 }), false);
  assert.equal(addWireEdge(board, { o: "V", x: 2, y: 2, size: 4 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 2, y: 3, size: 4 }), true);
  assert.equal(evaluateBoard(board).states.get("debug").value, 10);
  assert.deepEqual(pinsFor({ ...display, r: 1 })[0].edge, { o: "H", x: 4, y: 6 });
  const restored = parseDocument(serialize(board));
  assert.equal(evaluateBoard(restored.board).states.get(restored.board.components[1].id).value, 10);
});

test("a clock drives its output from the supplied evaluation state and persists frequency", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "clock", t: "clock", x: 0, y: 0, frequency: 2.5 }), true);
  assert.equal(addComponent(board, { id: "led", t: "led", x: 0, y: 3 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 2 }), true);
  assert.equal(evaluateBoard(board).states.get("led").lit, false);
  const high = evaluateBoard(board, new Set(), new Set(["clock"]));
  assert.equal(high.states.get("clock").value, 1);
  assert.equal(high.states.get("led").lit, true);
  assert.equal(evaluateBoard(board).states.get("led").lit, false);
  assert.equal(parseDocument(serialize(board)).board.components[0].frequency, 2.5);
  assert.equal(addComponent(board, { id: "bad", t: "clock", x: 4, y: 0, frequency: 0 }), false);
  assert.throws(() => parseDocument(JSON.stringify({ components: [["clock", 0, 0, 0, 21, true, "Clock 1"]], wires: [], junctions: [] })), /frequency/);
});

test("a disabled clock stays low and its enable setting survives serialization", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "clock", t: "clock", x: 0, y: 0, enable: false }), true);
  assert.equal(evaluateBoard(board, new Set(), new Set(["clock"])).states.get("clock").value, 0);
  assert.equal(parseDocument(serialize(board)).board.components[0].enable, false);
  assert.throws(() => parseDocument(JSON.stringify({ components: [["clock", 0, 0, 0, 2]], wires: [], junctions: [] })), /entries/);
  assert.throws(() => parseDocument(JSON.stringify({ components: [["clock", 0, 0, 0, 2, 0, "Clock 1"]], wires: [], junctions: [] })), /boolean/);
  assert.equal(addComponent(board, { id: "bad", t: "clock", x: 3, y: 0, enable: 0 }), false);
});

test("a clock net cannot share another output driver", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "clock", t: "clock", x: 0, y: 0 }), true);
  assert.equal(addComponent(board, { id: "low", t: "constant", x: 3, y: 1, value: 0, r: 2 }), true);
  for (const wire of [
    { o: "V", x: 1, y: 2 }, { o: "V", x: 5, y: 2 },
    ...[1, 2, 3].map((x) => ({ o: "H", x, y: 3 })),
  ]) assert.equal(addWireEdge(board, wire), true);
  assert.match(edgePlacementError(board, { o: "H", x: 4, y: 3 }), /clock output/);
});

test("a wire cannot join HIGH and LOW drivers, including driven zero bits", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "low", t: "constant", x: -1, y: 1, value: 0, r: 2 }), true);
  assert.equal(addComponent(board, { id: "high", t: "constant", x: 3, y: 1, value: 1, r: 2 }), true);
  const wires = [
    { o: "V", x: 1, y: 2 }, { o: "V", x: 5, y: 2 },
    { o: "H", x: 1, y: 3 }, { o: "H", x: 2, y: 3 }, { o: "H", x: 3, y: 3 },
  ];
  for (const wire of wires) assert.equal(addWireEdge(board, wire), true);
  const last = { o: "H", x: 4, y: 3 };
  assert.match(edgePlacementError(board, last), /Short circuit/);
  assert.equal(addWireEdge(board, last), false);
  assert.equal(board.wires.size, wires.length);

  assert.throws(() => parseDocument(JSON.stringify({ components: [
    ["constant", -1, 1, 2, 1, 0, 0, "Low"],
    ["constant", 3, 1, 2, 1, 1, 0, "High"],
  ], wires: [...wires.map((wire) => [wire.o, wire.x, wire.y, 1]), [last.o, last.x, last.y, 1]], junctions: [] })), /Short circuit/);
});

test("a splitter carries short-circuit checks between a bus bit and its branch", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "bus", t: "constant", x: -2, y: 1, size: 2, value: 0, r: 2 }), true);
  assert.equal(addComponent(board, { id: "split", t: "splitter", x: 0, y: 4, size: 2 }), true);
  assert.equal(addComponent(board, { id: "high", t: "constant", value: 1, x: 5, y: 4, r: 0 }), true);
  for (const edge of [
    { o: "V", x: 1, y: 2, size: 2 }, { o: "V", x: 1, y: 3, size: 2 },
    { o: "H", x: 2, y: 5 }, { o: "H", x: 3, y: 5 },
  ]) assert.equal(addWireEdge(board, edge), true);
  const last = { o: "H", x: 4, y: 5 };
  assert.match(edgePlacementError(board, last), /Short circuit/);
  assert.equal(addWireEdge(board, last), false);
});

test("an inverter cannot feed its own output back into its input", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "inverter", t: "not", x: 0, y: 0 }), true);
  for (const edge of [
    { o: "V", x: 1, y: -1 },
    { o: "H", x: 1, y: -1 }, { o: "H", x: 2, y: -1 },
    { o: "V", x: 3, y: -1 }, { o: "V", x: 3, y: 0 }, { o: "V", x: 3, y: 1 },
    { o: "H", x: 2, y: 2 },
  ]) assert.equal(addWireEdge(board, edge), true, JSON.stringify(edge));
  const last = { o: "H", x: 1, y: 2 };
  // The final segment joins the return path to the output pin.
  assert.match(edgePlacementError(board, last), /feedback loop/);
  assert.equal(addWireEdge(board, last), false);
});

test("wire routes use a clear bend and reject blocked paths", () => {
  const board = createBoard();
  addComponent(board, { id: "p", t: "constant", value: 1, x: 1, y: 0, r: 0 });
  const route = wireRoute(board, { x: 0, y: 1 }, { x: 4, y: 3 }, 1);
  assert.equal(route.error, null);
  assert.deepEqual(route.edges.map(edgeKey), [
    "V:0,1", "V:0,2", "H:0,3", "H:1,3", "H:2,3", "H:3,3",
  ]);
  assert.equal(wireRoute(board, { x: 0, y: 1 }, { x: 4, y: 1 }, 1).error,
    "Wire is blocked by a component.");
  assert.equal(board.wires.size, 0);
});

test("orthogonal crossings stay separate, while explicit junctions join them", () => {
  const board = createBoard();
  for (const edge of [
    { o: "H", x: 0, y: 1, size: 1 }, { o: "H", x: 1, y: 1, size: 1 },
    { o: "V", x: 1, y: 0, size: 1 }, { o: "V", x: 1, y: 1, size: 1 },
  ]) assert.equal(addWireEdge(board, edge), true);
  assert.equal(computeNets(board).size, 2);
  assert.deepEqual(parseDocument(serialize(board)).board.junctions, new Set());
  board.junctions.add("1,1");
  assert.equal(computeNets(board).size, 1);
  assert.deepEqual(parseDocument(serialize(board)).board.junctions, new Set(["1,1"]));
  const withoutJunctions = JSON.stringify({ components: [], wires: JSON.parse(serialize(board)).wires });
  assert.throws(() => parseDocument(withoutJunctions), /junctions/);
});

test("extending a connected three-way branch into a cross keeps its junction", () => {
  const board = createBoard();
  for (const edge of [
    { o: "H", x: 0, y: 1 }, { o: "H", x: 1, y: 1 },
    { o: "V", x: 1, y: 1 },
  ]) assert.equal(addWireEdge(board, edge), true);
  assert.equal(computeNets(board).size, 1);
  const extension = wireRoute(board, { x: 1, y: -1 }, { x: 1, y: 1 }, 1);
  assert.equal(extension.error, null);
  assert.deepEqual(extension.junctions, ["1,1"]);
  for (const edge of extension.edges) board.wires.set(edgeKey(edge), edge);
  for (const key of extension.junctions) board.junctions.add(key);
  assert.equal(computeNets(board).size, 1);
  assert.deepEqual(parseDocument(serialize(board)).board.junctions, new Set(["1,1"]));
});

test("a whole route can cross a different width wire without joining it", () => {
  const board = createBoard();
  for (const x of [0, 1]) assert.equal(addWireEdge(board, { o: "H", x, y: 1, size: 1 }), true);
  const route = wireRoute(board, { x: 1, y: 0 }, { x: 1, y: 2 }, 2);
  assert.equal(route.error, null);
  assert.deepEqual(route.junctions, []);
  for (const edge of route.edges) board.wires.set(edgeKey(edge), edge);
  assert.equal(computeNets(board).size, 2);
  assert.deepEqual([...computeNets(board).values()].map((net) => net.size).sort(), [1, 2]);
  assert.equal(parseDocument(serialize(board)).board.wires.size, 4);
  board.junctions.add("1,1");
  assert.throws(() => parseDocument(serialize(board)), /bus size mismatch/);
});

test("component geometry rotates pins and rejects overlap", () => {
  const board = createBoard();
  const gate = { id: "c1", t: "and", x: 1, y: 1, r: 0 };
  assert.equal(addComponent(board, gate), true);
  assert.equal(addComponent(board, { id: "c2", t: "led", x: 2, y: 2, r: 0 }), false);
  assert.equal(isValidComponent(board, { id: "c2", t: "led", x: 5, y: 2.5, r: 0 }), false);
  assert.equal(spec("__proto__"), null);
  gate.r = 1;
  assert.deepEqual(dimsOf(gate), { w: 2, h: 4 });
  const input = pinsFor(gate).find((pin) => pin.role === "in" && pin.px === 3 && pin.py === 2);
  assert.deepEqual(input.edge, { o: "H", x: 3, y: 2 });

  gate.r = 2;
  assert.deepEqual(dimsOf(gate), { w: 4, h: 2 });
  assert.deepEqual(
    pinsFor(gate).map((pin) => [pin.px, pin.py, pin.dir]),
    [[4, 3, "S"], [2, 3, "S"], [3, 1, "N"]],
  );

  gate.r = 3;
  assert.deepEqual(dimsOf(gate), { w: 2, h: 4 });
  assert.deepEqual(
    pinsFor(gate).map((pin) => [pin.px, pin.py, pin.dir]),
    [[1, 4, "W"], [1, 2, "W"], [3, 3, "E"]],
  );
});

test("a high constant drives an LED and sanitizes after edits", () => {
  const board = createBoard();
  addComponent(board, { id: "p", t: "constant", value: 1, x: 0, y: 1, r: 2 }); // side pin meets V:2,2
  addComponent(board, { id: "l", t: "led", x: 1, y: 3, r: 0 });   // in edge V:2,2
  assert.equal(canPlaceEdge(board, { o: "H", x: 6, y: 6 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 2, y: 2 }), true);
  const [net] = computeNets(board).values();
  assert.equal(net.on, true);
  assert.equal(net.edges.length, 1);
  assert.equal(evaluateBoard(board).states.get("l").lit, true);
  board.components.push({ id: "x", t: "constant", value: 1, x: 1, y: 2, r: 0 });
  sanitizeWires(board);
  assert.equal(board.wires.has(edgeKey({ o: "V", x: 2, y: 2 })), false);
});

test("documents reject unsupported metadata and removed components", () => {
  for (const document of [
    { version: 9, components: [], wires: [], junctions: [] },
    { components: [["power", 0, 0, 0]], wires: [], junctions: [] },
  ]) assert.throws(() => parseDocument(JSON.stringify(document)));
  assert.equal(spec("power"), null);
});

test("documents reject coercion, unknown fields, and duplicate wires", () => {
  const base = { components: [], wires: [], junctions: [] };
  for (const change of [
    { components: [["led", "1", 0, 0]] },
    { components: [["led", 1.5, 0, 0]] },
    { components: [["led", 0, 0, 4]] },
    { components: [["led", 0, 0, 0, 1]] },
    { components: [["constant", 0, 0, 0, 1]] },
    { wires: [["H", 0, 0, 1, true]] },
    { wires: [["H", 0, 0, 1], ["H", 0, 0, 1]] },
    { grid: { cols: 64, rows: 44 } },
  ]) assert.throws(() => parseDocument(JSON.stringify({ ...base, ...change })));
  assert.throws(() => parseDocument(JSON.stringify({ components: [] })), /wires/);
  const board = createBoard();
  board.components.push({ t: "led", x: "1", y: 0 });
  assert.throws(() => serialize(board), /Cannot serialize invalid/);
  board.components.length = 0;
  board.wires.set("H:0,0", { o: "H", x: 0.5, y: 0 });
  assert.throws(() => serialize(board), /Cannot serialize invalid wire/);
});

test("straight wire runs save compactly and restore every edge and junction", () => {
  const board = createBoard();
  for (let x = -2; x < 258; x++) {
    const edge = { o: "H", x, y: 0, size: 2 };
    board.wires.set(edgeKey(edge), edge);
  }
  for (const [o, x, y] of [["V", 0, -1], ["V", 0, 0]]) {
    const edge = { o, x, y, size: 2 };
    board.wires.set(edgeKey(edge), edge);
  }
  board.junctions.add("0,0");
  const saved = serialize(board);
  const runs = JSON.parse(saved).wires;
  assert.deepEqual(runs, [["H", -2, 0, 2, 256], ["H", 254, 0, 2, 4], ["V", 0, -1, 2, 2]]);
  assert.equal(saved.length < JSON.stringify({ components: [], wires: [...board.wires.values()].map(({ o, x, y, size }) => [o, x, y, size]), junctions: [[0, 0]] }).length / 10, true);
  const restored = parseDocument(saved).board;
  assert.deepEqual(new Set(restored.wires.keys()), new Set(board.wires.keys()));
  assert.deepEqual(restored.junctions, board.junctions);
  assert.equal(serialize(restored), saved);
});

test("compact wire imports reject invalid lengths, overlaps and blocked segments", () => {
  const document = (wires, components = []) => JSON.stringify({ components, wires, junctions: [] });
  for (const length of [0, 1, 257, 2.5, "3", null]) {
    assert.throws(() => parseDocument(document([["H", 0, 0, 1, length]])), /wires\[0\]\[4\]/);
  }
  assert.throws(() => parseDocument(document([["H", 0, 0, 1, 3], ["H", 2, 0, 1]])), /duplicates/);
  assert.throws(() => parseDocument(document([["H", 0, 1, 1, 3]], [["led", 1, 0, 0, "LED 1"]])), /blocked/);
  assert.deepEqual([...parseDocument(document([["V", -2, -2, 1, 3]])).board.wires.keys()],
    ["V:-2,-2", "V:-2,-1", "V:-2,0"]);
});

test("wires can follow component borders but cannot cross their interiors", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "p", t: "constant", value: 1, x: 2, y: 2, r: 2 }), true);
  assert.equal(addComponent(board, { id: "l", t: "led", x: 4, y: 4, r: 0 }), true);

  // The constant pin reaches the LED's top edge, including a point that is not a pin.
  for (const edge of [
    { o: "V", x: 4, y: 3 },
    { o: "H", x: 4, y: 4 },
    { o: "H", x: 5, y: 4 },
    { o: "V", x: 6, y: 4 },
    { o: "V", x: 6, y: 5 },
    { o: "H", x: 5, y: 6 },
    { o: "H", x: 4, y: 6 },
    { o: "V", x: 4, y: 5 },
    { o: "V", x: 4, y: 4 },
  ]) assert.equal(addWireEdge(board, edge), true, JSON.stringify(edge));

  assert.equal(canPlaceEdge(board, { o: "V", x: 5, y: 4 }), false);
  assert.equal(canPlaceEdge(board, { o: "H", x: 4, y: 5 }), false);
  sanitizeWires(board);
  assert.equal(board.wires.size, 9);

  const { board: imported } = parseDocument(serialize(board));
  assert.equal(imported.wires.size, 9);
});

test("a wire can start anywhere on a component border", () => {
  const board = createBoard();
  assert.equal(addComponent(board, { id: "l", t: "led", x: 4, y: 4, r: 0 }), true);
  for (const edge of [
    { o: "H", x: 4, y: 4 }, { o: "H", x: 5, y: 4 },
    { o: "V", x: 6, y: 4 }, { o: "V", x: 6, y: 5 },
    { o: "H", x: 4, y: 6 }, { o: "H", x: 5, y: 6 },
    { o: "V", x: 4, y: 4 }, { o: "V", x: 4, y: 5 },
  ]) assert.equal(addWireEdge(board, edge), true, JSON.stringify(edge));
  assert.equal(board.wires.size, 8);
  assert.equal(canPlaceEdge(board, { o: "H", x: 4, y: 5 }), false);
});

test("gates compute their output from the input nets", () => {
  const board = createBoard();
  addComponent(board, { id: "p1", t: "constant", value: 1, x: -1, y: 0, r: 2 }); // out edge V:1,1
  addComponent(board, { id: "p2", t: "constant", value: 1, x: 1, y: 0, r: 2 }); // out edge V:3,1
  addComponent(board, { id: "g", t: "and", x: 0, y: 3, r: 0 });   // in V:1,2 V:3,2, out V:2,5
  addComponent(board, { id: "p3", t: "constant", value: 1, x: 5, y: 0, r: 2 }); // out edge V:7,1
  addComponent(board, { id: "p4", t: "constant", value: 1, x: 7, y: 0, r: 2 }); // out edge V:9,1
  addComponent(board, { id: "h", t: "nand", x: 6, y: 3, r: 0 });  // in V:7,2 V:9,2, out V:8,5
  for (const wire of [
    { o: "V", x: 1, y: 1 }, { o: "V", x: 1, y: 2 },
    { o: "V", x: 3, y: 1 }, { o: "V", x: 3, y: 2 },
    { o: "V", x: 7, y: 1 }, { o: "V", x: 7, y: 2 },
    { o: "V", x: 9, y: 1 }, { o: "V", x: 9, y: 2 },
  ]) assert.equal(addWireEdge(board, wire), true, `wire ${JSON.stringify(wire)}`);
  const { states } = evaluateBoard(board);
  assert.equal(states.get("g").value, 1);
  assert.equal(states.get("h").value, 0);
});

function wiredBlock(type, size, values, channels) {
  const board = createBoard();
  const block = { id: "block", t: type, x: 0, y: 0, r: 0, size,
    ...(channels === undefined ? {} : { channels }) };
  assert.equal(addComponent(board, block), true);
  const inputs = pinsFor(block).filter((pin) => pin.role === "in");
  const sources = inputs.map((pin, index) => {
    const source = { id: `source${index}`, t: "constant", x: pin.px - pin.size - 1,
      y: -5 - 3 * index, r: 2, size: pin.size, value: values[index] };
    assert.equal(addComponent(board, source), true);
    for (let y = source.y + 1; y < pin.py; y++)
      assert.equal(addWireEdge(board, { o: "V", x: pin.px, y, size: pin.size }), true);
    return source;
  });
  const outputPins = pinsFor(block).filter((pin) => pin.role === "out");
  for (const pin of outputPins) assert.equal(addWireEdge(board, { ...pin.edge, size: pin.size }), true);
  const outputValues = () => {
    const { nets } = evaluateBoard(board);
    return outputPins.map((pin) => [...nets.values()].find((net) =>
      net.edges.some((edge) => edgeKey(edge) === edgeKey(pin.edge)))?.value);
  };
  return { board, block, sources, outputValues };
}

test("mux and demux route sized data using a one-bit selector", () => {
  const mux = wiredBlock("mux", 4, [5, 10, 0]);
  assert.deepEqual(pinsFor(mux.block).map((pin) => pin.size), [4, 4, 1, 4]);
  assert.deepEqual(mux.outputValues(), [5]);
  mux.sources[2].value = 1;
  assert.deepEqual(mux.outputValues(), [10]);

  const demux = wiredBlock("demux", 4, [9, 0]);
  assert.deepEqual(demux.outputValues(), [9, 0]);
  demux.sources[1].value = 1;
  assert.deepEqual(demux.outputValues(), [0, 9]);
});

test("mux and demux expose 1–16 channels with a matching selector width", () => {
  const mux = wiredBlock("mux", 4, [1, 2, 4, 8, 2], 4);
  assert.deepEqual(pinsFor(mux.block).map((pin) => pin.size), [4, 4, 4, 4, 2, 4]);
  assert.deepEqual(dimsOf(mux.block), { w: 10, h: 3 });
  const rotated = { ...mux.block, r: 1 };
  assert.deepEqual(dimsOf(rotated), { w: 3, h: 10 });
  assert.deepEqual(pinsFor(rotated).map((pin) => pin.dir), ["E", "E", "E", "E", "E", "W"]);
  assert.deepEqual(mux.outputValues(), [4]);
  mux.sources[4].value = 7;
  assert.deepEqual(mux.outputValues(), [0]);

  const demux = wiredBlock("demux", 4, [9, 2], 4);
  assert.deepEqual(pinsFor(demux.block).map((pin) => pin.size), [4, 2, 4, 4, 4, 4]);
  assert.deepEqual(demux.outputValues(), [0, 0, 9, 0]);
  demux.sources[1].value = 3;
  assert.deepEqual(demux.outputValues(), [0, 0, 0, 9]);

  const sixteen = wiredBlock("mux", 4, [...Array(16).keys(), 15], 16);
  assert.deepEqual(sixteen.outputValues(), [15]);
  assert.equal(pinsFor(sixteen.block)[16].size, 4);
  assert.deepEqual(parseDocument(serialize(sixteen.board)).board.components[0].channels, 16);
});

test("adder wraps its sum and reports carry, including carry in", () => {
  const { board, sources, outputValues } = wiredBlock("adder", 4, [15, 1, 0]);
  assert.deepEqual(outputValues(), [1, 0]);
  sources[0].value = 7;
  sources[1].value = 3;
  sources[2].value = 1;
  assert.deepEqual(outputValues(), [0, 11]);
  assert.equal(evaluateBoard(board).states.get("block").value, 11);
});

test("two's complement, unsigned comparator, and logical shifts evaluate buses", () => {
  const twos = wiredBlock("twos", 4, [3]);
  assert.deepEqual(twos.outputValues(), [13]);
  twos.sources[0].value = 0;
  assert.deepEqual(twos.outputValues(), [0]);

  const cmp = wiredBlock("comparator", 4, [3, 7]);
  assert.deepEqual(cmp.outputValues(), [1, 0, 0]);
  cmp.sources[0].value = 7;
  assert.deepEqual(cmp.outputValues(), [0, 1, 0]);
  cmp.sources[0].value = 9;
  assert.deepEqual(cmp.outputValues(), [0, 0, 1]);

  const left = wiredBlock("shl", 4, [9, 1]);
  assert.deepEqual(left.outputValues(), [2]);
  left.sources[1].value = 4;
  assert.deepEqual(left.outputValues(), [0]);
  const right = wiredBlock("shr", 4, [9, 1]);
  assert.deepEqual(right.outputValues(), [4]);
});

test("NOR and XNOR complement their results at the selected width", () => {
  assert.deepEqual(wiredBlock("nor", 4, [0b0101, 0b0011]).outputValues(), [0b1000]);
  assert.deepEqual(wiredBlock("xnor", 4, [0b0101, 0b0011]).outputValues(), [0b1001]);
});

test("each output of a multi-output block participates in short-circuit checks", () => {
  const { board } = wiredBlock("demux", 4, [9, 0]);
  assert.equal(addComponent(board, { id: "sink", t: "constant", x: 7, y: 3, size: 4, value: 1, r: 0 }), true);
  // The first DEMUX output drives 9; the second drives 0. A distinct driver
  // on the zero output must still be rejected.
  for (const edge of [
    { o: "V", x: 7, y: 3, size: 4 }, { o: "H", x: 6, y: 4, size: 4 },
    { o: "H", x: 5, y: 4, size: 4 },
    { o: "H", x: 4, y: 4, size: 4 },
  ]) assert.equal(addWireEdge(board, edge), true);
  assert.match(edgePlacementError(board, { o: "H", x: 3, y: 4, size: 4 }), /Short circuit/);
});

test("new blocks persist their sizes and rotate pin widths", () => {
  const board = createBoard();
  const part = { id: "m", t: "mux", x: 0, y: 0, r: 1, size: 8 };
  assert.equal(addComponent(board, part), true);
  assert.deepEqual(dimsOf(part), { w: 3, h: 6 });
  assert.deepEqual(pinsFor(part).map(({ size }) => size), [8, 8, 1, 8]);
  const saved = serialize(board);
  assert.equal(parseDocument(saved).board.components.length, board.components.length);
  assert.deepEqual(JSON.parse(serialize(parseDocument(saved).board)), JSON.parse(saved));
});

test("documents persist all four orientations for rotatable components", () => {
  const board = createBoard();
  for (let r = 0; r < 4; r++)
    assert.equal(addComponent(board, { id: `led${r}`, t: "led", x: 3 * r, y: 1, r }), true);
  const saved = JSON.parse(serialize(board));
  assert.deepEqual(saved.components, [0, 1, 2, 3].map((r) => ["led", 3 * r, 1, r, `LED ${r + 1}`]));
  const { board: reloaded } = parseDocument(JSON.stringify(saved));
  assert.deepEqual(reloaded.components.map((component) => component.r), [0, 1, 2, 3]);
  assert.deepEqual(JSON.parse(serialize(reloaded)), saved);
});

test("imports reject overlap and malformed wires without returning a partial board", () => {
  const valid = JSON.parse(serialize(createBoard()));
  valid.components = [["and", 1, 1, 0, 1, "AND 1"], ["led", 2, 2, 0, "LED 1"]];
  assert.throws(() => parseDocument(JSON.stringify(valid)), /components\[1\]/);
  valid.components = [];
  valid.wires = [["H", 0, 9, 1], ["H", 4.5, 2, 1]];
  assert.throws(() => parseDocument(JSON.stringify(valid)), /wires\[1\]\[1\]/);
  valid.wires[1] = ["X", 1, 1, 1];
  assert.throws(() => parseDocument(JSON.stringify(valid)), /wires\[1\]\[0\]/);
});

test("wires reject endpoints outside the safe integer coordinate range", () => {
  const max = Number.MAX_SAFE_INTEGER;
  for (const o of ["H", "V"]) {
    const edge = { o, x: max, y: max, size: 1 };
    assert.equal(addWireEdge(createBoard(), edge), false);
    const document = JSON.stringify({ components: [], wires: [[o, max, max, 1]], junctions: [] });
    assert.throws(() => parseDocument(document), /endpoint must be a safe integer/);
  }
  const safe = JSON.stringify({ components: [], wires: [["H", max - 1, 0, 1]], junctions: [] });
  assert.equal(parseDocument(safe).board.wires.size, 1);
});

test("bus sizes must match connected wires and gate pins", () => {
  const board = createBoard();
  addComponent(board, { id: "g", t: "and", x: 0, y: 2, r: 0, size: 8 });
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 1, size: 1 }), false);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 1, size: 8 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 0, size: 4 }), false);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 0, size: 8 }), true);
  assert.equal(resizeNet(board, "V:1,1", 4), false);
  assert.equal(board.wires.get("V:1,1").size, 8);
  assert.equal(resizeNet(board, "V:1,1", 8), true);
  assert.equal(addWireEdge(board, { o: "V", x: 3, y: 1, size: 33 }), false);
});

test("32 bit NAND uses a full width mask and persists sizes", () => {
  const board = createBoard();
  addComponent(board, { id: "n", t: "nand", x: 0, y: 0, r: 0, size: 32 });
  assert.equal(addWireEdge(board, { o: "V", x: 2, y: 2, size: 32 }), true);
  const result = evaluateBoard(board);
  assert.equal(result.states.get("n").value, 0xffffffff);
  assert.equal([...result.nets.values()][0].value, 0xffffffff);
  const saved = JSON.parse(serialize(board));
  assert.equal(saved.components[0][4], 32);
  assert.equal(saved.wires[0][3], 32);
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);
});

test("NOT is a rotatable 2x2 gate and inverts every bit of its selected width", () => {
  const board = createBoard();
  const constant = { id: "k", t: "constant", x: -4, y: 1, r: 2, size: 4, value: 0b0101 };
  const inverter = { id: "n", t: "not", x: 0, y: 4, r: 0, size: 4 };
  assert.equal(addComponent(board, constant), true);
  assert.equal(addComponent(board, inverter), true);
  assert.deepEqual(dimsOf(inverter), { w: 2, h: 2 });
  assert.deepEqual(pinsFor(inverter).map(({ px, py, role, size }) => [px, py, role, size]),
    [[1, 4, "in", 4], [1, 6, "out", 4]]);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 2, size: 4 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 3, size: 4 }), true);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 6, size: 4 }), true);
  assert.equal(evaluateBoard(board).states.get("n").value, 0b1010);
  assert.equal([...computeNets(board).values()].find((net) => net.edges.some((edge) => edge.y === 6)).value, 0b1010);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 7, size: 1 }), false);
  const saved = JSON.parse(serialize(board));
  assert.deepEqual(saved.components[1], ["not", 0, 4, 0, 4, "NOT 1"]);
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);

  const wide = createBoard();
  const wideInverter = { id: "wide", t: "not", x: 3, y: 3, r: 1, size: 32 };
  assert.equal(addComponent(wide, wideInverter), true);
  assert.deepEqual(dimsOf(wideInverter), { w: 2, h: 2 });
  assert.deepEqual(pinsFor(wideInverter).map(({ px, py, dir }) => [px, py, dir]),
    [[5, 4, "E"], [3, 4, "W"]]);
  assert.equal(evaluateBoard(wide).states.get("wide").value, 0xffffffff);
});

test("constant drives its configured value and enforces its width and range", () => {
  const board = createBoard();
  const constant = { id: "k", t: "constant", x: -8, y: 1, r: 2, size: 8, value: 173 };
  assert.equal(addComponent(board, constant), true);
  assert.deepEqual(dimsOf(constant), { w: 9, h: 2 });
  assert.equal(pinsFor(constant)[0].size, 8);
  assert.deepEqual(pinsFor(constant)[0].edge, { o: "H", x: 1, y: 2 });
  assert.equal(addWireEdge(board, { o: "H", x: 1, y: 2, size: 1 }), false);
  assert.equal(addWireEdge(board, { o: "H", x: 1, y: 2, size: 8 }), true);
  assert.equal(evaluateBoard(board).states.get("k").value, 173);
  assert.equal([...computeNets(board).values()][0].value, 173);
  const saved = JSON.parse(serialize(board));
  assert.deepEqual(saved.components[0], ["constant", -8, 1, 2, 8, 173, 0, "Constant 1"]);
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);
  constant.value = 256;
  assert.equal(isValidComponent(board, constant), false);
  constant.value = -1;
  assert.equal(isValidComponent(board, constant), false);
  constant.value = 1.5;
  assert.equal(isValidComponent(board, constant), false);
  constant.value = 0;
  constant.size = 9;
  assert.equal(isValidComponent(board, constant), false);
  for (const component of [
    ["constant", 0, 0, 0, 9, 1, 0],
    ["constant", 3, 0, 0, 2, 4, 0],
  ]) assert.throws(() => parseDocument(JSON.stringify({ components: [component], wires: [], junctions: [] })));
});

test("output reads a matching bus without driving it and survives serialization", () => {
  const board = createBoard();
  const source = { id: "source", t: "constant", x: -8, y: 1, size: 8, value: 173, r: 2 };
  const output = { id: "out", t: "output", x: 1, y: 3, r: 0, size: 8 };
  assert.equal(addComponent(board, source), true);
  assert.equal(addComponent(board, output), true);
  assert.deepEqual(dimsOf(output), { w: 9, h: 2 });
  assert.deepEqual(pinsFor(output).map(({ role, size, edge }) => ({ role, size, edge })),
    [{ role: "in", size: 8, edge: { o: "H", x: 0, y: 4 } }]);
  assert.equal(addWireEdge(board, { o: "V", x: 1, y: 3, size: 1 }), false);
  for (const y of [2, 3]) assert.equal(addWireEdge(board, { o: "V", x: 1, y, size: 8 }), true);
  assert.equal(evaluateBoard(board).states.get("out").value, 173);
  assert.equal([...computeNets(board).values()][0].value, 173);
  const saved = JSON.parse(serialize(board));
  assert.deepEqual(saved.components[1], ["output", 1, 3, 0, 8, 0, "Output 1"]);
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);

  output.r = 2;
  assert.deepEqual(pinsFor(output)[0].edge, { o: "H", x: 10, y: 4 });
  assert.equal(evaluateBoard(board).states.get("out").value, 0);
  output.size = 33;
  assert.equal(isValidComponent(board, output), false);
});

test("imports reject unknown component types", () => {
  const data = { components: [["alu", 0, 0, 0, 4]], wires: [], junctions: [] };
  assert.throws(() => parseDocument(JSON.stringify(data)), /components\[0\]\.t/);
});

test("imports reject mixed width connections", () => {
  const data = { components: [["and", 0, 2, 0, 8, "AND 1"]], wires: [
    ["V", 1, 1, 8],
    ["V", 1, 0, 4],
  ], junctions: [] };
  assert.throws(() => parseDocument(JSON.stringify(data)), /wires\[1\] has a bus size mismatch/);
});

test("splitter has one ordered one-bit branch per bus bit", () => {
  const board = createBoard();
  const nand = { id: "n", t: "nand", x: 0, y: 0, r: 0, size: 4 };
  const splitter = { id: "s", t: "splitter", x: 0, y: 4, r: 0, size: 4 };
  assert.equal(addComponent(board, nand), true);
  assert.equal(addComponent(board, splitter), true);
  assert.deepEqual(dimsOf(splitter), { w: 2, h: 5 });
  assert.deepEqual(pinsFor(splitter).map(({ px, py, size, bit }) => [px, py, size, bit]),
    [[1, 4, 4, undefined], [2, 5, 1, 0], [2, 6, 1, 1], [2, 7, 1, 2], [2, 8, 1, 3]]);
  for (const edge of [
    { o: "V", x: 2, y: 2, size: 4 }, { o: "H", x: 1, y: 3, size: 4 },
    { o: "V", x: 1, y: 3, size: 4 },
    ...[5, 6, 7, 8].map((y) => ({ o: "H", x: 2, y, size: 1 })),
  ]) assert.equal(addWireEdge(board, edge), true, JSON.stringify(edge));
  assert.equal(addWireEdge(board, { o: "H", x: 3, y: 5, size: 4 }), false);
  const logic = evaluateBoard(board);
  assert.equal(logic.states.get("s").value, 15);
  for (const y of [5, 6, 7, 8]) {
    const net = [...logic.nets.values()].find((n) => n.edges.some((e) => edgeKey(e) === `H:2,${y}`));
    assert.equal(net.value, 1);
    assert.equal(net.size, 1);
  }
  const saved = JSON.parse(serialize(board));
  assert.equal(saved.components.find((c) => c[0] === "splitter")[4], 4);
  assert.deepEqual(JSON.parse(serialize(parseDocument(JSON.stringify(saved)).board)), saved);
});

test("splitter rotation and size changes adjust its footprint", () => {
  const board = createBoard();
  const splitter = { id: "s", t: "splitter", x: 0, y: 0, r: 1, size: 3 };
  assert.equal(addComponent(board, splitter), true);
  assert.deepEqual(dimsOf(splitter), { w: 4, h: 2 });
  assert.deepEqual(pinsFor(splitter).map(({ px, py, dir, size }) => [px, py, dir, size]),
    [[4, 1, "E", 3], [3, 2, "S", 1], [2, 2, "S", 1], [1, 2, "S", 1]]);
  splitter.size = 33;
  assert.equal(isValidComponent(board, splitter), false);
});

test("descendant splitter order reverses branch bits and persists", () => {
  const board = createBoard();
  const source = { id: "k", t: "constant", x: -4, y: 1, r: 2, size: 4, value: 1 };
  const splitter = { id: "s", t: "splitter", x: 0, y: 4, r: 0, size: 4, order: "descendant" };
  assert.equal(addComponent(board, source), true);
  assert.equal(addComponent(board, splitter), true);
  assert.deepEqual(pinsFor(splitter).slice(1).map(({ py, bit }) => [py, bit]),
    [[5, 3], [6, 2], [7, 1], [8, 0]]);
  for (const wire of [
    { o: "V", x: 1, y: 2, size: 4 }, { o: "V", x: 1, y: 3, size: 4 },
    ...[5, 6, 7, 8].map((y) => ({ o: "H", x: 2, y, size: 1 })),
  ]) assert.equal(addWireEdge(board, wire), true);
  const nets = computeNets(board);
  for (const y of [5, 6, 7, 8]) {
    const net = [...nets.values()].find((item) => item.edges.some((edge) => edgeKey(edge) === `H:2,${y}`));
    assert.equal(net.value, y === 8 ? 1 : 0);
  }
  const saved = JSON.parse(serialize(board));
  assert.equal(saved.components.find((component) => component[0] === "splitter")[5], 1);
  const { board: reloaded } = parseDocument(JSON.stringify(saved));
  assert.deepEqual(JSON.parse(serialize(reloaded)), saved);
  splitter.order = "backward";
  assert.equal(isValidComponent(board, splitter), false);
  assert.throws(() => parseDocument(JSON.stringify({ components: [["splitter", 0, 0, 0, 2]], wires: [], junctions: [] })), /entries/);
});


test("8-bit computer example decodes its ISA and writes only RB", () => {
  const text = readFileSync(new URL("./public/examples/8-bit-computer.json", import.meta.url), "utf8");
  const { board } = parseDocument(text);
  const byLabel = new Map(board.components.map((component) => [component.label, component]));
  const registerByLabel = new Map(board.components.filter((component) => component.t === "register")
    .map((component) => [component.label, component]));
  const registers = new Map([0x12, 0x56, 0xbc, 0x78, 0x9a, 0xbc, 0xde, 0]
    .map((value, index) => [registerByLabel.get(`R${index}`).id, value]));
  const rom = byLabel.get("Program ROM");
  const counter = byLabel.get("Counter 1");
  const step = byLabel.get("Manual Clock").id;
  const clock = byLabel.get("Main Clock");
  const result = byLabel.get("Result: 00 NOT, 01 SUM, 10 AND, 11 INC").id;

  assert.equal(board.components.filter((component) => component.t === "register").length, 8);
  assert.equal(clock.enable, false);
  assert.equal(byLabel.has("Clock Guard"), false);
  assert.equal(byLabel.has("AND 1"), false);
  assert.equal(board.monitor.ids.includes(clock.id), true);
  assert.equal(rom.data.length, 255);
  clock.enable = false;
  const isa = board.program.isa[rom.id];
  assert.equal(disassemble([[1, 0x97]], 8, isa), "NOT R0 R0\nAND R2 R7");
  assert.deepEqual(assemble("AND R2 R7", 8, 8, isa), [[0, 0x97]]);
  for (const [pc, instruction, destination, expected] of [
    [1, 0x97, 7, 0],
    [2, 0x51, 1, 0x12],
    [3, 0x10, 0, 0x43],
    [4, 0xc8, 0, 0x57],
  ]) {
    const values = new Map(registers).set(counter.id, pc);
    const { states, settled } = evaluateBoard(board, new Set([step]), new Set(), values);
    assert.equal(settled, true);
    assert.equal(states.get(rom.id).value, instruction);
    assert.equal(states.get(result).value, expected);
    assert.equal(states.get(counter.id).inputs[0], 1);
    for (let index = 0; index < 8; index++) {
      const [data, clock] = states.get(registerByLabel.get(`R${index}`).id).inputs;
      assert.equal(data, expected);
      assert.equal(clock, Number(index === destination));
    }
  }
  clock.enable = true;
  const running = evaluateBoard(board, new Set(), new Set([clock.id]),
    new Map(registers).set(counter.id, 1));
  assert.equal(running.states.get(counter.id).inputs[0], 1);
  assert.equal(running.states.get(registerByLabel.get("R7").id).inputs[1], 1);
  clock.enable = false;
  assert.deepEqual(JSON.parse(serialize(board)), JSON.parse(text));
});
