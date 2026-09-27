import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEditor, STORAGE_KEY } from './public/editor.js';
import { dimsOf, pinsFor, spec } from './public/components.js';
import { edgeKey, parseDocument, serialize } from './public/model.js';
import { createRenderer, wireTitle } from './public/renderer.js';
import { formatValue, parseValue } from './public/value-format.js';

function setup() {
  const data = new Map();
  let renders = 0;
  let saves = 0;
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { saves++; data.set(key, value); },
  };
  const editor = new BoardEditor({ storage, onChange: () => renders++ });
  return { editor, data, get renders() { return renders; }, get saves() { return saves; } };
}

test('module edits save atomically and reject incompatible parent wiring', () => {
  const ctx = setup();
  const module = ctx.editor.place('module', 0, 0);
  assert.ok(module);
  const child = new BoardEditor();
  assert.ok(child.place('output', 5, 0));
  assert.equal(ctx.editor.setModuleBoard(module.id, child.board), true);
  assert.deepEqual(pinsFor(ctx.editor.component(module.id)).map((pin) => pin.size), [1]);
  assert.equal(ctx.editor.addWire({ o: 'H', x: 4, y: 1, size: 1 }), true);
  const before = ctx.saves;
  assert.equal(child.resizeComponent(child.board.components[0].id, 2), true);
  assert.equal(ctx.editor.setModuleBoard(module.id, child.board), false);
  assert.equal(ctx.saves, before);
  assert.deepEqual(pinsFor(ctx.editor.component(module.id)).map((pin) => pin.size), [1]);
});

test('module pin layout persists and rejects rotation, occupied or connected positions', () => {
  const ctx = setup();
  const module = ctx.editor.place('module', 0, 0);
  const child = new BoardEditor();
  assert.ok(child.place('input', 0, 0));
  assert.ok(child.place('output', 4, 0));
  assert.equal(ctx.editor.setModuleBoard(module.id, child.board), true);
  assert.equal(ctx.editor.setModulePin(module.id, 0, 'N', 2), true);
  assert.equal(ctx.editor.setModulePin(module.id, 1, 'N', 2), false);
  assert.equal(ctx.editor.setModulePin(module.id, 1, 'N', 0), false);
  assert.deepEqual(pinsFor(ctx.editor.component(module.id)).map(({ px, py, dir }) => [px, py, dir]),
    [[2, 0, 'N'], [4, 1, 'E']]);
  const restored = parseDocument(serialize(ctx.editor.board)).board.components[0];
  assert.deepEqual(restored.pinLayout, [['N', 2], ['E', 1]]);
  assert.equal(ctx.editor.rotate(module.id), false);
  assert.equal(ctx.editor.component(module.id).r, 0);
  assert.equal(ctx.editor.addWire({ o: 'V', x: 2, y: -1, size: 1 }), true);
  assert.equal(ctx.editor.setModulePin(module.id, 0, 'W', 2), false);
});

test('module face displays can be placed and moved without changing the port interface', () => {
  const { editor } = setup();
  const module = editor.place('module', 0, 0);
  const child = new BoardEditor();
  assert.ok(child.place('led', 0, 0));
  assert.ok(child.place('sevenseg', 3, 0));
  assert.equal(editor.setModuleBoard(module.id, child.board), true);
  assert.equal(editor.setModuleFacePart(module.id, 0, 2, 2), true);
  assert.equal(editor.setModuleFacePart(module.id, 1, 2, 2), false);
  assert.equal(editor.setModuleFacePart(module.id, 1, 3, 2), true);
  assert.deepEqual(dimsOf(module), { w: 4, h: 3 });
  assert.deepEqual(parseDocument(serialize(editor.board)).board.components[0].faceLayout, [[0, 2, 2], [1, 3, 2]]);
  const art = createRenderer(null, () => null, () => null, () => new Set(), () => new Set())
    .componentArt(module, spec('module'), 0, [], { faceStates: new Map([
      ['c1', { lit: true }], ['c2', { inputs: [1, 0, 0, 0, 0, 0, 0] }],
    ]) });
  assert.match(art, /var\(--lamp-lit\)/);
  assert.match(art, /var\(--part-segment-on\)/);
  assert.equal(editor.setModuleFacePart(module.id, 1, 5, 2), true);
  assert.equal(dimsOf(module).w, 6);
  assert.equal(editor.setModuleFacePart(module.id, 1, null, null), true);
  assert.equal(editor.setModuleSize(module.id, 4, 3), true);
  assert.equal(dimsOf(module).w, 4);
  assert.equal(editor.undo(), true);
  assert.equal(dimsOf(editor.component(module.id)).w, 6);
});

test('debug display can be placed on a module face without external ports', () => {
  const { editor } = setup();
  const module = editor.place('module', 0, 0);
  const child = new BoardEditor();
  assert.ok(child.place('debugdisplay', 0, 0));
  assert.equal(editor.setModuleBoard(module.id, child.board), true);
  assert.equal(editor.setModuleFacePart(module.id, 0, 2, 2), true);
  assert.deepEqual(editor.component(module.id).faceLayout, [[0, 2, 2]]);
  assert.equal(editor.evaluation.states.get(module.id).faceStates.get('c1').value, 0);
});

test('successful edits render and save once, while rejected edits do neither', () => {
  const ctx = setup();
  const { editor } = ctx;
  const constant = editor.place('constant', 0, 0);
  assert.ok(constant);
  assert.equal(ctx.saves, 1);
  assert.equal(editor.place('led', 0, 0), null);
  assert.equal(editor.move(constant.id, 0, 0), false);
  assert.equal(editor.addWire({ o: 'H', x: -1, y: 1 }), true);
  assert.equal(editor.addWire({ o: 'H', x: -1, y: 1 }), false);
  assert.equal(editor.resizeWire('H:-1,1', 2), false); // connected constant pin is one bit
  assert.equal(ctx.saves, 2);
  assert.equal(ctx.renders, 2);
  assert.equal(editor.move(constant.id, 3, 0), true);
  assert.equal(ctx.saves, 3); // completed drag
  assert.equal(editor.rotate(constant.id), true);
  assert.equal(ctx.saves, 4);
  assert.equal(editor.removeWire('H:-1,1'), true);
  assert.equal(ctx.saves, 5);
  assert.equal(editor.deleteComponent(constant.id), true);
  assert.equal(ctx.saves, 6);
  assert.equal(ctx.renders, ctx.saves);
});

test('undo and redo restore committed board edits and saved state', () => {
  const ctx = setup();
  const { editor, data } = ctx;
  const first = editor.place('constant', 0, 0);
  const second = editor.place('led', 3, 0);
  assert.equal(editor.move(first.id, 1, 0), true);
  assert.equal(editor.canUndo, true);
  assert.equal(editor.canRedo, false);
  assert.equal(editor.undo(), true);
  assert.equal(editor.component(first.id).x, 0);
  assert.equal(editor.undo(), true);
  assert.equal(editor.component(second.id), undefined);
  assert.equal(editor.redo(), true);
  assert.equal(editor.component(second.id).t, 'led');
  assert.equal(editor.redo(), true);
  assert.equal(editor.component(first.id).x, 1);
  assert.equal(data.get(STORAGE_KEY), serialize(editor.board));
  assert.equal(editor.redo(), false);
  assert.equal(editor.undo(), true);
  assert.equal(editor.place('led', 6, 0) !== null, true);
  assert.equal(editor.canRedo, false);
});

test('replacing a document starts a new undo history', () => {
  const { editor } = setup();
  editor.place('led', 0, 0);
  editor.replaceBoard(parseDocument(serialize(editor.board)).board);
  assert.equal(editor.canUndo, false);
  assert.equal(editor.undo(), false);
  editor.place('led', 3, 0);
  assert.equal(editor.undo(), true);
  assert.equal(editor.board.components.length, 1);
});

test('ROM reads an eight-bit address, drives a sized word, and persists its contents', () => {
  const { editor } = setup();
  const address = editor.place('constant', -7, 1);
  const rom = editor.place('rom', 0, 3);
  const output = editor.place('output', 2, 6);
  assert.equal(editor.rotate(address.id), true);
  assert.equal(editor.resizeComponent(address.id, 8), true);
  assert.equal(editor.resizeComponent(output.id, 8), true);
  assert.equal(editor.addWire({ o: 'V', x: 2, y: 2, size: 8 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 2, y: 6, size: 8 }), true);
  assert.equal(editor.setRomData(rom.id, [[255, 0xA5], [1, 0x3C]]), true);
  assert.deepEqual(rom.data, [[1, 0x3C], [255, 0xA5]]);
  assert.equal(editor.evaluation.states.get(output.id).value, 0);
  assert.equal(editor.setConstantValue(address.id, 1), true);
  assert.equal(editor.evaluation.states.get(output.id).value, 0x3C);
  assert.equal(editor.setConstantValue(address.id, 255), true);
  assert.equal(editor.evaluation.states.get(output.id).value, 0xA5);
  assert.equal(editor.setConstantValue(address.id, 2), true);
  assert.equal(editor.evaluation.states.get(output.id).value, 0);
  const restored = parseDocument(serialize(editor.board)).board;
  assert.deepEqual(restored.components.find((component) => component.t === 'rom').data, rom.data);
  assert.equal(editor.setRomData(rom.id, [[1, 256]]), false);
  assert.equal(editor.setRomData(rom.id, [[1, 1], [1, 2]]), false);
  assert.equal(editor.resizeComponent(rom.id, 32), false); // output bus is connected
});

test('ROM labels can be edited and saved', () => {
  const { editor } = setup();
  const first = editor.place('rom', 0, 0);
  const second = editor.place('rom', 5, 0);
  assert.equal(first.label, 'ROM 1');
  assert.equal(second.label, 'ROM 2');
  assert.equal(editor.setLabel(second.id, 'Boot program'), true);
  assert.equal(editor.setLabel(second.id, 'x'.repeat(81)), false);
  assert.equal(parseDocument(serialize(editor.board)).board.components[1].label, 'Boot program');
  assert.equal(editor.undo(), true);
  assert.equal(editor.component(second.id).label, 'ROM 2');
});

test('ROM address and data sizes edit independently and preserve valid contents', () => {
  const { editor } = setup();
  const rom = editor.place('rom', 0, 0);
  assert.equal(editor.resizeMemoryAddress(rom.id, 16), true);
  assert.equal(editor.resizeComponent(rom.id, 32), true);
  assert.equal(editor.setRomData(rom.id, [[0, 0xFFFFFFFF], [0xFFFF, 0x12345678]]), true);
  assert.deepEqual(pinsFor(rom).map((pin) => pin.size), [16, 32]);
  assert.equal(editor.resizeMemoryAddress(rom.id, 8), false);
  assert.equal(editor.setRomData(rom.id, [[0, 0xFFFFFFFF]]), true);
  assert.equal(editor.resizeMemoryAddress(rom.id, 8), true);
  assert.equal(editor.evaluation.states.get(rom.id).value, 0xFFFFFFFF);
  assert.deepEqual(pinsFor(rom).map((pin) => pin.size), [8, 32]);
  assert.equal(editor.resizeComponent(rom.id, 4), true);
  assert.deepEqual(rom.data, [[0, 15]]);
  assert.deepEqual(pinsFor(rom).map((pin) => pin.size), [8, 4]);
  const restored = parseDocument(serialize(editor.board)).board.components[0];
  assert.equal(restored.addressSize, 8);
  assert.deepEqual(restored.data, [[0, 15]]);
});

test('ROM imports reject malformed memory entries', () => {
  const document = (data) => JSON.stringify({ components: [['rom', 0, 0, 0, 8, 8, data, '']], wires: [], junctions: [] });
  for (const data of [null, [[256, 1]], [[0, 256]], [[1, 1], [1, 2]], [[0, -1]]])
    assert.throws(() => parseDocument(document(data)), /ROM width/);
});

test('ROM imports require every tuple field', () => {
  const incomplete = JSON.stringify({ components: [['rom', 0, 0, 0, 8, [[255, 42]]]], wires: [], junctions: [] });
  assert.throws(() => parseDocument(incomplete), /8 entries/);
});

test('ROM address size must match its connected bus', () => {
  const { editor } = setup();
  const rom = editor.place('rom', 0, 0);
  assert.equal(editor.addWire({ o: 'V', x: 2, y: -1, size: 8 }), true);
  assert.equal(editor.resizeMemoryAddress(rom.id, 16), false);
  assert.equal(editor.removeWire('V:2,-1'), true);
  assert.equal(editor.resizeMemoryAddress(rom.id, 16), true);
  assert.equal(editor.addWire({ o: 'V', x: 2, y: -1, size: 8 }), false);
  assert.equal(editor.addWire({ o: 'V', x: 2, y: -1, size: 16 }), true);
});

test('ROM uses address bits beyond the original byte', () => {
  const { editor } = setup();
  const address = editor.place('register', 0, 0);
  const rom = editor.place('rom', 0, 4);
  assert.equal(editor.resizeComponent(address.id, 16), true);
  assert.equal(editor.resizeMemoryAddress(rom.id, 16), true);
  assert.equal(editor.setRomData(rom.id, [[0x1234, 0xA5]]), true);
  assert.equal(editor.addWire({ o: 'V', x: 2, y: 3, size: 16 }), true);
  editor.registerValues.set(address.id, 0x1234);
  editor.evaluate();
  assert.equal(editor.evaluation.states.get(rom.id).value, 0xA5);
});

test('RAM writes on a rising WR edge, reads continuously, and resets on reload', () => {
  const { editor } = setup();
  const ram = editor.place('ram', 0, 4);
  const data = editor.place('constant', -7, 1);
  const write = editor.place('button', 3, 0);
  assert.deepEqual(pinsFor(ram).map((pin) => [pin.name, pin.size]),
    [['ADDR', 8], ['DIN', 8], ['WR', 1], ['DATA', 8]]);
  assert.equal(editor.rotate(data.id), true);
  assert.equal(editor.resizeComponent(data.id, 8), true);
  for (const edge of [{ o: 'V', x: 2, y: 2, size: 8 }, { o: 'V', x: 2, y: 3, size: 8 },
    { o: 'V', x: 4, y: 2 }, { o: 'H', x: 3, y: 3 }, { o: 'V', x: 3, y: 3 }])
    assert.equal(editor.addWire(edge), true);
  assert.equal(editor.setConstantValue(data.id, 0xA5), true);
  assert.equal(editor.evaluation.states.get(ram.id).value, 0);
  assert.equal(editor.setButtonPressed(write.id, true), true);
  assert.equal(editor.evaluation.states.get(ram.id).value, 0xA5);
  assert.equal(editor.setConstantValue(data.id, 0x3C), true);
  assert.equal(editor.evaluation.states.get(ram.id).value, 0xA5);
  editor.setButtonPressed(write.id, false);
  editor.setButtonPressed(write.id, true);
  assert.equal(editor.evaluation.states.get(ram.id).value, 0x3C);
  assert.equal(JSON.parse(serialize(editor.board)).components.find((entry) => entry[0] === 'ram').length, 6);
  const restored = parseDocument(serialize(editor.board)).board;
  editor.replaceBoard(restored);
  assert.equal(editor.evaluation.states.get(restored.components.find((component) => component.t === 'ram').id).value, 0);
});

test('RAM width rules match ROM and resizing trims simulation contents', () => {
  const { editor } = setup();
  const ram = editor.place('ram', 0, 0);
  assert.equal(editor.resizeComponent(ram.id, 3), false);
  assert.equal(editor.resizeMemoryAddress(ram.id, 3), false);
  assert.equal(editor.resizeMemoryAddress(ram.id, 16), true);
  assert.equal(editor.resizeComponent(ram.id, 32), true);
  editor.ramValues.get(ram.id).set(0x1234, 0xFFFFFFFF);
  editor.evaluate();
  assert.equal(editor.evaluation.states.get(ram.id).value, 0);
  assert.equal(editor.resizeMemoryAddress(ram.id, 8), true);
  assert.equal(editor.ramValues.get(ram.id).has(0x1234), false);
  editor.ramValues.get(ram.id).set(0, 0xFFFFFFFF);
  assert.equal(editor.resizeComponent(ram.id, 8), true);
  assert.equal(editor.evaluation.states.get(ram.id).value, 0xFF);
  assert.deepEqual(pinsFor(ram).map((pin) => pin.size), [8, 8, 1, 8]);
  assert.throws(() => parseDocument(JSON.stringify({ components: [['ram', 0, 0, 0, 3, 8]], wires: [], junctions: [] })), /power of two/);
});

test('moving a selection translates components and complete wire nets in one edit', () => {
  const ctx = setup();
  const first = ctx.editor.place('led', 0, 0);
  const second = ctx.editor.place('led', 3, 0);
  assert.equal(ctx.editor.addWireRoute({ x: 0, y: 5 }, { x: 2, y: 5 }, 1).error, null);
  const saves = ctx.saves;
  assert.equal(ctx.editor.move(first.id, 3, 0), false);
  assert.equal(ctx.editor.moveSelection([first.id, second.id], ['H:0,5'], 3, 1), true);
  assert.deepEqual([first, second].map((c) => [ctx.editor.component(c.id).x, ctx.editor.component(c.id).y]), [[3, 1], [6, 1]]);
  assert.deepEqual([...ctx.editor.board.wires.keys()], ['H:3,6', 'H:4,6']);
  assert.equal(ctx.saves, saves + 1);
});

test('moving a connected component extends its attached wire and undoes as one edit', () => {
  const ctx = setup();
  const source = ctx.editor.place('constant', 0, 0);
  assert.equal(ctx.editor.addWire({ o: 'H', x: -1, y: 1 }), true);
  const before = serialize(ctx.editor.board);
  const saves = ctx.saves;
  const preview = ctx.editor.previewMove(source.id, 3, 0);
  assert.ok(preview);
  assert.deepEqual([...preview.wires.keys()], ['H:-1,1', 'H:0,1', 'H:1,1', 'H:2,1']);
  assert.equal(serialize(ctx.editor.board), before);
  assert.equal(ctx.editor.move(source.id, 3, 0), true);
  assert.equal(ctx.saves, saves + 1);
  assert.deepEqual([...ctx.editor.board.wires.keys()], [...preview.wires.keys()]);
  assert.equal(ctx.editor.undo(), true);
  assert.equal(serialize(ctx.editor.board), before);
});

test('a diagonal component move adds a valid bend to an attached bus', () => {
  const { editor } = setup();
  const source = editor.place('constant', 0, 0);
  assert.equal(editor.resizeComponent(source.id, 2), true);
  assert.equal(editor.addWire({ o: 'H', x: -1, y: 1, size: 2 }), true);
  assert.equal(editor.move(source.id, 4, 2), true);
  const pin = pinsFor(editor.component(source.id))[0];
  assert.deepEqual([pin.px, pin.py], [4, 3]);
  assert.equal(editor.board.wires.get('H:3,1').size, 2);
  assert.equal(editor.board.wires.get('V:4,2').size, 2);
  assert.deepEqual(new Set(parseDocument(serialize(editor.board)).board.wires.keys()),
    new Set(editor.board.wires.keys()));
});

test('selection moves extend stationary attached wires but carry selected nets', () => {
  const { editor } = setup();
  const source = editor.place('constant', 0, 0);
  assert.equal(editor.addWire({ o: 'H', x: -1, y: 1 }), true);
  assert.equal(editor.moveSelection([source.id], [], 2, 0), true);
  assert.deepEqual([...editor.board.wires.keys()], ['H:-1,1', 'H:0,1', 'H:1,1']);
  assert.equal(editor.moveSelection([source.id], ['H:-1,1'], 2, 0), true);
  assert.deepEqual([...editor.board.wires.keys()], ['H:1,1', 'H:2,1', 'H:3,1']);
});

test('a blocked connection extension rejects the move without changing the board', () => {
  const ctx = setup();
  const source = ctx.editor.place('constant', 0, 0);
  assert.equal(ctx.editor.addWire({ o: 'H', x: -1, y: 1 }), true);
  const before = serialize(ctx.editor.board);
  const saves = ctx.saves;
  assert.equal(ctx.editor.previewMove(source.id, -1, 0), null);
  assert.equal(ctx.editor.move(source.id, -1, 0), false);
  assert.equal(serialize(ctx.editor.board), before);
  assert.equal(ctx.saves, saves);
});

test('moving a component closer along a straight wire removes the covered edges', () => {
  const ctx = setup();
  const output = ctx.editor.place('output', -8, 0);
  assert.equal(ctx.editor.rotate(output.id), true);
  const source = ctx.editor.place('constant', 0, 0);
  assert.equal(ctx.editor.setConstantValue(source.id, 1), true);
  assert.equal(ctx.editor.addWireRoute({ x: -6, y: 1 }, { x: 0, y: 1 }, 1).error, null);
  const before = serialize(ctx.editor.board);
  const saves = ctx.saves;
  const preview = ctx.editor.previewMove(source.id, -3, 0);
  assert.deepEqual([...preview.wires.keys()], ['H:-6,1', 'H:-5,1', 'H:-4,1']);
  assert.equal(ctx.editor.move(source.id, -3, 0), true);
  assert.equal(ctx.saves, saves + 1);
  assert.deepEqual([...ctx.editor.board.wires.keys()], [...preview.wires.keys()]);
  assert.equal(ctx.editor.evaluation.states.get(output.id).value, 1);
  assert.equal(ctx.editor.undo(), true);
  assert.equal(serialize(ctx.editor.board), before);
});

test('selection moves shorten the same straight connection', () => {
  const { editor } = setup();
  const source = editor.place('constant', 0, 0);
  assert.equal(editor.addWireRoute({ x: -5, y: 1 }, { x: 0, y: 1 }, 1).error, null);
  assert.equal(editor.moveSelection([source.id], [], -2, 0), true);
  assert.deepEqual([...editor.board.wires.keys()], ['H:-5,1', 'H:-4,1', 'H:-3,1']);
});

test('a branch on the covered span prevents automatic shortening', () => {
  const ctx = setup();
  const source = ctx.editor.place('constant', 0, 0);
  assert.equal(ctx.editor.addWireRoute({ x: -5, y: 1 }, { x: 0, y: 1 }, 1).error, null);
  assert.equal(ctx.editor.addWire({ o: 'V', x: -1, y: 1 }), true);
  const before = serialize(ctx.editor.board);
  assert.equal(ctx.editor.move(source.id, -2, 0), false);
  assert.equal(serialize(ctx.editor.board), before);
});

test('a rejected selection move preserves the entire board and does not save', () => {
  const ctx = setup();
  const moving = ctx.editor.place('led', 0, 0);
  const blocker = ctx.editor.place('led', 4, 0);
  assert.equal(ctx.editor.addWire({ o: 'H', x: 0, y: 5 }), true);
  assert.equal(ctx.editor.addWire({ o: 'H', x: 4, y: 5 }), true);
  const before = serialize(ctx.editor.board);
  const saves = ctx.saves;
  assert.equal(ctx.editor.moveSelection([moving.id], ['H:0,5'], 4, 0), false);
  assert.equal(serialize(ctx.editor.board), before);
  assert.equal(ctx.saves, saves);
  assert.equal(ctx.editor.component(blocker.id).x, 4);
});

test('property edits validate width, value, order and connected wires', () => {
  const { editor } = setup();
  const constant = editor.place('constant', 0, 0);
  assert.equal(editor.resizeComponent(constant.id, 3), true);
  assert.equal(editor.setConstantValue(constant.id, 7), true);
  assert.equal(editor.resizeComponent(constant.id, 2), true);
  assert.equal(editor.component(constant.id).value, 3);
  assert.equal(editor.setConstantValue(constant.id, 4), false);
  assert.equal(editor.resizeComponent(constant.id, 9), false);
  const splitter = editor.place('splitter', 6, 0);
  assert.equal(editor.setSplitterOrder(splitter.id, 'descendant'), true);
  assert.equal(editor.setSplitterOrder(splitter.id, 'bogus'), false);
  const wire = { o: 'H', x: -1, y: 1, size: 2 };
  assert.equal(editor.addWire(wire), true);
  assert.equal(editor.resizeComponent(constant.id, 1), false);
  assert.equal(editor.component(constant.id).size, 2);
  assert.equal(editor.deleteNet(edgeKey(wire)), true);
});

test('output width is configurable and must match its connected net', () => {
  const { editor } = setup();
  const output = editor.place('output', 0, 0);
  assert.equal(output.size, 1);
  assert.equal(editor.resizeComponent(output.id, 32), true);
  assert.equal(editor.addWire({ o: 'H', x: -1, y: 1, size: 32 }), true);
  assert.equal(editor.resizeComponent(output.id, 8), false);
  assert.equal(editor.component(output.id).size, 32);
  assert.equal(editor.deleteNet('H:-1,1'), true);
  assert.equal(editor.resizeComponent(output.id, 8), true);
});

test('portal names and widths edit together and survive undo', () => {
  const { editor } = setup();
  const first = editor.place('portal', 0, 0);
  const second = editor.place('portal', 5, 0);
  assert.ok(first && second);
  assert.equal(editor.setLabel(first.id, 'DATA'), true);
  assert.equal(editor.setLabel(second.id, 'DATA'), true);
  assert.equal(editor.resizeComponent(first.id, 8), false);
  assert.equal(editor.component(first.id).size, 1);
  assert.equal(editor.setLabel(second.id, 'OTHER'), true);
  assert.equal(editor.resizeComponent(first.id, 8), true);
  assert.equal(editor.setLabel(second.id, 'DATA'), false);
  assert.equal(editor.component(second.id).label, 'OTHER');
  assert.equal(editor.undo(), true);
  assert.equal(editor.component(first.id).size, 1);
  assert.equal(parseDocument(serialize(editor.board)).board.components[0].label, 'DATA');
});

test('toggle switch drives a persistent one-bit value and rejects conflicting toggles', () => {
  const ctx = setup();
  const { editor } = ctx;
  const toggle = editor.place('switch', 0, 0);
  const led = editor.place('led', 0, 3);
  assert.ok(toggle && led);
  assert.equal(editor.addWire({ o: 'V', x: 1, y: 2 }), true);
  assert.equal(editor.evaluation.states.get(led.id).lit, false);
  assert.equal(editor.toggleSwitch(toggle.id), true);
  assert.equal(editor.evaluation.states.get(led.id).lit, true);
  assert.equal(parseDocument(serialize(editor.board)).board.components[0].value, 1);
  assert.equal(editor.toggleSwitch(toggle.id), true);
  assert.equal(editor.evaluation.states.get(led.id).lit, false);
  assert.equal(editor.toggleSwitch(led.id), false);
  assert.equal(ctx.saves, 5);
});

test('seven-segment art lights only the supplied inputs', () => {
  const art = createRenderer(null, () => null, () => new Set(), () => new Set()).componentArt;
  const svg = art({ t: 'sevenseg', r: 0 }, spec('sevenseg'), 0, [1, 0, 0, 0, 1, 0, 0]);
  assert.equal((svg.match(/fill="var\(--part-segment-on\)"/g) ?? []).length, 2);
  assert.equal((svg.match(/fill="var\(--part-segment-off\)"/g) ?? []).length, 5);
  assert.match(svg, />A<\/text>/);
  assert.match(svg, />G<\/text>/);
});

test('debug display decodes the four-bit value and carries a distinct label', () => {
  const art = createRenderer(null, () => null, () => new Set(), () => new Set()).componentArt;
  const zero = art({ t: 'debugdisplay' }, spec('debugdisplay'), 0);
  const f = art({ t: 'debugdisplay' }, spec('debugdisplay'), 15);
  assert.match(zero, />DBG<\/text>/);
  assert.equal((zero.match(/fill="var\(--part-segment-on\)"/g) ?? []).length, 6);
  assert.equal((f.match(/fill="var\(--part-segment-on\)"/g) ?? []).length, 4);
  const { editor } = setup();
  const display = editor.place('debugdisplay', 0, 0);
  assert.ok(display);
  assert.equal(editor.resizeComponent(display.id, 8), false);
  assert.equal(editor.setValueFormat(display.id, 'decimal'), false);
});

test('constant and output formats convert existing values and survive saving', () => {
  const { editor } = setup();
  const constant = editor.place('constant', 0, 0);
  editor.resizeComponent(constant.id, 8);
  editor.setConstantValue(constant.id, 173);
  const output = editor.place('output', 12, 0);
  assert.equal(editor.setValueFormat(constant.id, 'binary'), true);
  assert.equal(formatValue(constant.value, constant.size, constant.format), '0b10101101');
  assert.equal(editor.setValueFormat(constant.id, 'hex'), true);
  assert.equal(formatValue(constant.value, constant.size, constant.format), '0xAD');
  assert.equal(constant.value, 173);
  assert.equal(editor.setValueFormat(output.id, 'hex'), true);
  assert.equal(editor.setValueFormat(output.id, 'invalid'), false);
  assert.equal(editor.setValueFormat(constant.id, 'hex'), false);
  const restored = parseDocument(serialize(editor.board)).board.components;
  assert.equal(restored[0].format, 'hex');
  assert.equal(restored[0].value, 173);
  assert.equal(restored[1].format, 'hex');
  const copies = editor.copyComponents([constant.id, output.id]);
  assert.deepEqual(copies.map(({ format }) => format), ['hex', 'hex']);
});

test('value parser accepts selected radix and rejects malformed or empty input', () => {
  assert.equal(parseValue('0b10101101', 'binary'), 173);
  assert.equal(parseValue('10101101', 'binary'), 173);
  assert.equal(parseValue('0xAD', 'hex'), 173);
  assert.equal(parseValue('AD', 'hex'), 173);
  assert.equal(parseValue('173', 'decimal'), 173);
  for (const input of ['', '0b102', '0b', '-1', '1.5'])
    assert.equal(parseValue(input, 'binary'), null);
  assert.equal(parseValue('0xGG', 'hex'), null);
  assert.equal(parseValue('0xAD', 'decimal'), null);
});

test('constant and output canvas art uses the selected value format', () => {
  const art = createRenderer(null, () => null, () => new Set(), () => new Set()).componentArt;
  assert.match(art({ t: 'constant', size: 8, value: 173, format: 'binary' }, spec('constant')), />0b10101101<\/text>/);
  assert.match(art({ t: 'output', size: 8, format: 'hex' }, spec('output'), 173), />0xAD<\/text>/);
  assert.match(art({ t: 'output', size: 32, format: 'binary' }, spec('output'), 0xffffffff), />0b11111111111111111111111111111111<\/text>/);
});

test('imports save only after a complete valid document is parsed', () => {
  const ctx = setup();
  const document = JSON.stringify({ components: [['constant', 0, 0, 0, 1, 1, 0]], wires: [['V', 1, 2, 1]], junctions: [] });
  const result = ctx.editor.importText(document);
  assert.equal(result.board.components[0].y, 0);
  assert.equal(result.board.components[0].t, 'constant');
  assert.equal(result.board.components[0].value, 1);
  assert.equal(result.board.wires.size, 1);
  assert.equal(ctx.saves, 1);
  assert.equal(parseDocument(ctx.data.get(STORAGE_KEY)).board.wires.size, 1);
  const before = serialize(ctx.editor.board);
  assert.throws(() => ctx.editor.importText('{'));
  assert.throws(() => ctx.editor.importText(JSON.stringify({ components: [['led', 0, 0, 0]], wires: [['X', 0, 0, 1]] })));
  assert.equal(serialize(ctx.editor.board), before);
  assert.equal(ctx.saves, 1);
  assert.equal(ctx.editor.loadSaved().board.components.length, 1);
});

test('storage errors leave the current board usable', () => {
  let errors = 0;
  const editor = new BoardEditor({ storage: { setItem() { throw Error('quota'); }, getItem() { throw Error('blocked'); } }, onStorageError: () => errors++ });
  assert.equal(editor.loadSaved(), null);
  assert.ok(editor.place('constant', 0, 0));
  assert.equal(editor.board.components.length, 1);
  assert.equal(errors, 2);
});

test('wire hover text includes the evaluated value', () => {
  assert.equal(wireTitle({ size: 2 }, 3), '2 bit(s), value 3');
});

test('mux and demux render labeled chips at their generated widths', () => {
  const art = createRenderer(null, () => null, () => new Set(), () => new Set()).componentArt;
  for (const type of ['mux', 'demux']) {
    const svg = art({ t: type, x: 0, y: 0, r: 0, size: 4, channels: 4 }, spec(type));
    assert.match(svg, /<path d="M/);
    assert.match(svg, type === 'mux' ? />MUX<\/text>/ : />DEMUX<\/text>/);
    assert.match(svg, />4 CHANNELS<\/text>/);
    assert.match(svg, /viewBox="0 0 (400|320) 120"/);
  }
});

test('rendered component footprints stay on the pin lattice as parts grow and rotate', () => {
  const originalDocument = globalThis.document;
  const elements = [];
  globalThis.document = {
    createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, toggle() {} } }),
  };
  try {
    for (const type of ['mux', 'demux', 'splitter', 'and']) {
      for (const size of type === 'mux' || type === 'demux' ? [1, 2, 4, 16] : type === 'splitter' ? [1, 4, 32] : [1]) {
        for (const r of [0, 1, 2, 3]) {
          const component = { id: 'part', t: type, x: 5, y: 7, r, size,
            channels: size };
          elements.length = 0;
          const grid = { querySelectorAll: () => [], appendChild: (el) => elements.push(el) };
          const renderer = createRenderer(grid, () => ({ components: [component] }),
            () => ({ states: new Map() }), () => new Set(), () => new Set());
          renderer.renderComponents();
          const [element] = elements;
          const dims = dimsOf(component);
          assert.equal(element.style.width, `${dims.w * 48}px`, `${type} size ${size} rotation ${r} width`);
          assert.equal(element.style.height, `${dims.h * 48}px`, `${type} size ${size} rotation ${r} height`);
          assert.match(element.innerHTML, new RegExp(`viewBox="0 0 ${dims.w * 40} ${dims.h * 40}"`));
          for (const pin of pinsFor(component)) {
            assert.ok(pin.px >= component.x && pin.px <= component.x + dims.w);
            assert.ok(pin.py >= component.y && pin.py <= component.y + dims.h);
          }
        }
      }
    }
  } finally {
    globalThis.document = originalDocument;
  }
});

test('component labels use the final footprint while display faces stay upright', () => {
  const art = createRenderer(null, () => null, () => new Set(), () => new Set()).componentArt;
  for (const type of ['button', 'and', 'mux', 'demux', 'splitter', 'sevenseg', 'debugdisplay']) {
    for (const r of [1, 2, 3]) {
      const svg = art({ t: type, x: 0, y: 0, r, size: 4, channels: 4 }, spec(type));
      const labels = svg.match(/<text\b[^>]*>/g) ?? [];
      assert.ok(labels.length > 0, `${type} has labels`);
      if (['and', 'mux', 'demux', 'splitter'].includes(type)) {
        assert.match(svg, new RegExp(`rotate\\(${r * 90}\\)`), `${type} chassis rotates`);
        assert.ok(svg.indexOf('<text') > svg.lastIndexOf('</g>'), `${type} labels follow the final footprint`);
      } else {
        assert.doesNotMatch(svg, /rotate\(/, `${type} face stays upright`);
      }
    }
  }
  const sidewaysMux = art({ t: 'mux', x: 0, y: 0, r: 1, channels: 4 }, spec('mux'));
  assert.match(sidewaysMux, /<text x="60" y="135"[^>]*>MULTIPLEXER<\/text>/);
  assert.match(sidewaysMux, /<text x="60" y="152"[^>]*>4 CHANNELS<\/text>/);
  const sidewaysDisplay = art({ t: 'sevenseg', x: 0, y: 0, r: 1 }, spec('sevenseg'));
  assert.match(sidewaysDisplay, /viewBox="0 0 200 240"/);
  assert.match(sidewaysDisplay, /transform="translate\(-20 20\)"/);
});

test('accepted events publish a fresh evaluation; explicit evaluation does not save', () => {
  const published = [];
  let saves = 0;
  const editor = new BoardEditor({
    storage: { setItem: () => saves++ },
    onChange: (board, evaluation) => published.push({ board, evaluation }),
  });
  const initial = editor.evaluation;
  const constant = editor.place('constant', 1, 1);
  editor.setConstantValue(constant.id, 1);
  const led = editor.place('led', 0, 3);
  assert.equal(published.length, 3);
  assert.notEqual(editor.evaluation, initial);
  assert.equal(editor.evaluation.states.get(led.id).lit, false);

  editor.addWire({ o: 'V', x: 1, y: 2 });
  const powered = editor.evaluation;
  assert.equal(powered.states.get(led.id).lit, true);
  assert.equal([...powered.nets.values()][0].value, 1);
  assert.equal(published.at(-1).evaluation, powered);

  editor.deleteComponent(constant.id);
  assert.equal(editor.evaluation.states.get(led.id).lit, false);
  assert.equal(powered.states.get(led.id).lit, true); // prior snapshot stays valid
  const before = saves;
  const refreshed = editor.evaluate(); // future momentary input events can use this path
  assert.equal(refreshed, editor.evaluation);
  assert.equal(published.at(-1).evaluation, refreshed);
  assert.equal(saves, before);
  assert.equal(published.length, 6);
});

test('button press and release reevaluate without saving, and reset on board replacement', () => {
  const ctx = setup();
  const { editor } = ctx;
  const button = editor.place('button', 0, 0);
  const led = editor.place('led', 0, 3);
  assert.equal(editor.addWire({ o: 'V', x: 1, y: 2 }), true);
  const saves = ctx.saves;
  const renders = ctx.renders;
  assert.equal(editor.evaluation.states.get(led.id).lit, false);
  assert.equal(editor.setButtonPressed(button.id, true), true);
  assert.equal(editor.evaluation.states.get(led.id).lit, true);
  assert.equal(editor.setButtonPressed(button.id, true), false);
  assert.equal(editor.setButtonPressed(led.id, true), false);
  assert.equal(ctx.saves, saves);
  assert.equal(ctx.renders, renders + 1);
  assert.equal(editor.setButtonPressed(button.id, false), true);
  assert.equal(editor.evaluation.states.get(led.id).lit, false);
  assert.equal(ctx.saves, saves);
  assert.equal(ctx.renders, renders + 2);

  editor.setButtonPressed(button.id, true);
  editor.replaceBoard(parseDocument(serialize(editor.board)).board, { save: false });
  assert.equal(editor.pressedButtons.size, 0);
  assert.equal(editor.evaluation.states.get(editor.board.components[1].id).lit, false);
});

test('clock ticks reevaluate without saving and frequency edits persist', () => {
  const ctx = setup();
  const { editor } = ctx;
  const clock = editor.place('clock', 0, 0);
  const led = editor.place('led', 0, 3);
  editor.addWire({ o: 'V', x: 1, y: 2 });
  assert.equal(clock.frequency, 1);
  assert.equal(clock.enable, false);
  assert.equal(editor.tickClock(clock.id), false);
  assert.equal(editor.evaluation.states.get(led.id).lit, false);
  assert.equal(editor.setClockEnabled(clock.id, true), true);
  const saves = ctx.saves;
  assert.equal(editor.tickClock(clock.id), true);
  assert.equal(editor.evaluation.states.get(led.id).lit, true);
  assert.equal(editor.tickClock(clock.id), true);
  assert.equal(editor.evaluation.states.get(led.id).lit, false);
  assert.equal(ctx.saves, saves);
  assert.equal(editor.tickClock(led.id), false);
  assert.equal(editor.setClockFrequency(clock.id, 2.5), true);
  assert.equal(editor.setClockFrequency(clock.id, 0), false);
  assert.equal(editor.setClockFrequency(clock.id, 21), false);
  assert.equal(parseDocument(ctx.data.get(STORAGE_KEY)).board.components[0].frequency, 2.5);
  editor.tickClock(clock.id);
  assert.equal(editor.setClockEnabled(clock.id, false), true);
  assert.equal(editor.evaluation.states.get(led.id).lit, false);
  assert.equal(editor.highClocks.has(clock.id), false);
  assert.equal(editor.tickClock(clock.id), false);
  assert.equal(parseDocument(ctx.data.get(STORAGE_KEY)).board.components[0].enable, false);
  editor.replaceBoard(parseDocument(serialize(editor.board)).board, { save: false });
  assert.equal(editor.highClocks.size, 0);
  assert.equal(editor.evaluation.states.get(editor.board.components[1].id).lit, false);
});

test('a register captures its data on rising edges and holds it on falling edges', () => {
  const ctx = setup();
  const { editor } = ctx;
  const data = editor.place('constant', -4, 1);
  const clock = editor.place('clock', 2, 0);
  const register = editor.place('register', 0, 5);
  assert.equal(register.size, 4);
  assert.deepEqual(editor.evaluation.states.get(register.id).inputs, [0, 0]);
  assert.equal(editor.rotate(data.id), true);
  assert.equal(editor.resizeComponent(data.id, 4), true);
  assert.equal(editor.setConstantValue(data.id, 9), true);
  for (const y of [2, 3, 4]) {
    assert.equal(editor.addWire({ o: 'V', x: 1, y, size: 4 }), true);
    assert.equal(editor.addWire({ o: 'V', x: 3, y }), true);
  }
  assert.equal(editor.setClockEnabled(clock.id, true), true);
  const saved = ctx.saves;
  assert.equal(editor.evaluation.states.get(register.id).value, 0);
  assert.equal(editor.tickClock(clock.id), true);
  assert.equal(editor.evaluation.states.get(register.id).value, 9);
  assert.equal(editor.setConstantValue(data.id, 3), true);
  assert.equal(editor.evaluation.states.get(register.id).value, 9);
  assert.equal(editor.tickClock(clock.id), true);
  assert.equal(editor.evaluation.states.get(register.id).value, 9);
  assert.equal(editor.tickClock(clock.id), true);
  assert.equal(editor.evaluation.states.get(register.id).value, 3);
  assert.equal(ctx.saves, saved + 1);
  assert.equal(editor.resizeComponent(register.id, 1), false); // connected four-bit data
  editor.replaceBoard(parseDocument(serialize(editor.board)).board, { save: false });
  assert.equal(editor.evaluation.states.get(editor.board.components[2].id).value, 0);
});

test('a counter increments on rising edges, wraps at its bit width, and resets while RST is high', () => {
  const ctx = setup();
  const { editor } = ctx;
  const clock = editor.place('button', 0, 0);
  const reset = editor.place('switch', 4, 0);
  const counter = editor.place('counter', 0, 5);
  assert.equal(counter.size, 4);
  assert.deepEqual(pinsFor(counter).map(({ name, size }) => [name, size]), [['CLK', 1], ['RST', 1], ['Q', 4]]);
  const art = createRenderer(null, () => null, () => new Set(), () => new Set()).componentArt(counter, spec('counter'));
  assert.match(art, /COUNTER/);
  assert.match(art, /\+1/);
  assert.equal(editor.resizeComponent(counter.id, 2), true);
  for (const y of [2, 3, 4]) assert.equal(editor.addWire({ o: 'V', x: 1, y }), true);
  assert.equal(editor.addWire({ o: 'V', x: 5, y: 2 }), true);
  for (const x of [3, 4]) assert.equal(editor.addWire({ o: 'H', x, y: 3 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 3, y: 3 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 3, y: 4 }), true);
  const saves = ctx.saves;
  for (const expected of [1, 2, 3, 0, 1]) {
    assert.equal(editor.setButtonPressed(clock.id, true), true);
    assert.equal(editor.evaluation.states.get(counter.id).value, expected);
    assert.equal(editor.setButtonPressed(clock.id, false), true);
    assert.equal(editor.evaluation.states.get(counter.id).value, expected);
  }
  assert.equal(ctx.saves, saves);
  assert.equal(editor.toggleSwitch(reset.id), true);
  assert.equal(editor.evaluation.states.get(counter.id).value, 0);
  editor.setButtonPressed(clock.id, true);
  assert.equal(editor.evaluation.states.get(counter.id).value, 0);
  editor.setButtonPressed(clock.id, false);
  editor.toggleSwitch(reset.id);
  editor.setButtonPressed(clock.id, true);
  assert.equal(editor.evaluation.states.get(counter.id).value, 1);
  const restored = parseDocument(serialize(editor.board)).board;
  assert.equal(restored.components[2].size, 2);
  editor.replaceBoard(restored, { save: false });
  assert.equal(editor.evaluation.states.get(restored.components[2].id).value, 0);
});

test('a counter recognizes a rising edge from an edited source', () => {
  const { editor } = setup();
  const source = editor.place('constant', 1, 1);
  const counter = editor.place('counter', 0, 5);
  for (const y of [2, 3, 4]) assert.equal(editor.addWire({ o: 'V', x: 1, y }), true);
  assert.equal(editor.setConstantValue(source.id, 1), true);
  assert.equal(editor.evaluation.states.get(counter.id).value, 1);
  assert.equal(editor.setConstantValue(source.id, 0), true);
  assert.equal(editor.evaluation.states.get(counter.id).value, 1);
  assert.equal(editor.setConstantValue(source.id, 1), true);
  assert.equal(editor.evaluation.states.get(counter.id).value, 2);
});

test('cascaded registers on one clock capture the previous Q simultaneously', () => {
  const { editor } = setup();
  const source = editor.place('constant', -4, 1);
  const clock = editor.place('clock', 2, 0);
  const first = editor.place('register', 0, 5);
  const second = editor.place('register', 0, 14);
  assert.equal(editor.rotate(source.id), true);
  assert.equal(editor.resizeComponent(source.id, 4), true);
  assert.equal(editor.setConstantValue(source.id, 9), true);
  for (const y of [2, 3, 4]) {
    assert.equal(editor.addWire({ o: 'V', x: 1, y, size: 4 }), true);
    assert.equal(editor.addWire({ o: 'V', x: 3, y }), true);
  }
  for (const x of [3, 4]) assert.equal(editor.addWire({ o: 'H', x, y: 3 }), true);
  for (let y = 3; y < 13; y++) assert.equal(editor.addWire({ o: 'V', x: 5, y }), true);
  for (const x of [3, 4]) assert.equal(editor.addWire({ o: 'H', x, y: 13 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 3, y: 13 }), true);
  for (let y = 8; y < 13; y++) assert.equal(editor.addWire({ o: 'V', x: 2, y, size: 4 }), true);
  assert.equal(editor.addWire({ o: 'H', x: 1, y: 13, size: 4 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 1, y: 13, size: 4 }), true);
  assert.equal(editor.setClockEnabled(clock.id, true), true);
  assert.equal(editor.tickClock(clock.id), true);
  assert.equal(editor.evaluation.states.get(first.id).value, 9);
  assert.equal(editor.evaluation.states.get(second.id).value, 0);
  editor.tickClock(clock.id);
  editor.tickClock(clock.id);
  assert.equal(editor.evaluation.states.get(first.id).value, 9);
  assert.equal(editor.evaluation.states.get(second.id).value, 9);
});

test('register feedback through an inverter forms a one-bit counter', () => {
  const { editor } = setup();
  const clock = editor.place('clock', 2, 0);
  const register = editor.place('register', 0, 5);
  const inverter = editor.place('not', -4, 5);
  assert.equal(editor.resizeComponent(register.id, 1), true);
  assert.equal(editor.rotate(inverter.id), true);
  assert.equal(editor.rotate(inverter.id), true);
  for (const y of [2, 3, 4]) assert.equal(editor.addWire({ o: 'V', x: 3, y }), true);
  for (const edge of [
    { o: 'V', x: 2, y: 8 },
    ...[-3, -2, -1, 0, 1].map((x) => ({ o: 'H', x, y: 9 })),
    { o: 'V', x: -3, y: 7 }, { o: 'V', x: -3, y: 8 },
    { o: 'V', x: -3, y: 4 },
    ...[-3, -2, -1, 0].map((x) => ({ o: 'H', x, y: 4 })),
    { o: 'V', x: 1, y: 4 },
  ]) assert.equal(editor.addWire(edge), true, JSON.stringify(edge));
  assert.equal(editor.evaluation.states.get(register.id).value, 0);
  assert.equal(editor.evaluation.states.get(register.id).inputs[0], 1);
  assert.equal(editor.setClockEnabled(clock.id, true), true);
  editor.tickClock(clock.id);
  assert.equal(editor.evaluation.states.get(register.id).value, 1);
  assert.equal(editor.evaluation.states.get(register.id).inputs[0], 0);
  editor.tickClock(clock.id);
  assert.equal(editor.evaluation.states.get(register.id).value, 1);
  editor.tickClock(clock.id);
  assert.equal(editor.evaluation.states.get(register.id).value, 0);
});

test('changing a constant cannot create a short circuit', () => {
  const ctx = setup();
  const { editor } = ctx;
  const a = editor.place('constant', 1, 1);
  const b = editor.place('constant', 5, 1);
  for (const edge of [
    { o: 'V', x: 1, y: 2 }, { o: 'V', x: 5, y: 2 },
    ...[1, 2, 3, 4].map((x) => ({ o: 'H', x, y: 3 })),
  ]) assert.equal(editor.addWire(edge), true);
  const saves = ctx.saves;
  assert.equal(editor.setConstantValue(a.id, 1), false);
  assert.equal(editor.component(a.id).value, 0);
  assert.equal(ctx.saves, saves);
  assert.equal(editor.removeWire('H:4,3'), true);
  assert.equal(editor.setConstantValue(a.id, 1), true);
  assert.equal(editor.component(b.id).value, 0);
  assert.equal(ctx.saves, saves + 2);
});

test('new data-path parts start at four bits and keep control pins fixed while resizing', () => {
  const { editor } = setup();
  const mux = editor.place('mux', 0, 0);
  const adder = editor.place('adder', 8, 0);
  assert.equal(mux.size, 4);
  assert.equal(adder.size, 4);
  assert.equal(editor.addWire({ o: 'V', x: 5, y: -1, size: 1 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 3, y: 3, size: 4 }), true);
  assert.equal(editor.resizeComponent(mux.id, 8), false);
  assert.equal(editor.deleteNet('V:3,3'), true);
  assert.equal(editor.resizeComponent(mux.id, 8), true);
  assert.equal(editor.addWire({ o: 'V', x: 5, y: -2, size: 8 }), false);
  assert.equal(editor.addWire({ o: 'V', x: 9, y: 3, size: 1 }), true);
  assert.equal(editor.resizeComponent(adder.id, 16), true);
});

test('mux channel counts are editable, validated, and saved', () => {
  const { editor, data } = setup();
  const mux = editor.place('mux', 0, 0);
  assert.equal(mux.channels, 2);
  assert.equal(editor.setChannelCount(mux.id, 16), true);
  assert.equal(editor.component(mux.id).channels, 16);
  assert.equal(editor.setChannelCount(mux.id, 17), false);
  assert.equal(editor.setChannelCount(mux.id, 0), false);
  assert.equal(editor.setChannelCount(mux.id, 2.5), false);
  assert.equal(parseDocument(data.get(STORAGE_KEY)).board.components[0].channels, 16);
  const demux = editor.place('demux', 40, 0);
  assert.equal(editor.setChannelCount(demux.id, 4), true);
  assert.ok(editor.place('output', 50, 0));
  assert.equal(editor.setChannelCount(demux.id, 16), false); // overlaps output
  assert.equal(demux.channels, 4);
});

test('a wire route places all segments in one saved edit and reuses existing segments', () => {
  const ctx = setup();
  const start = { x: -2, y: 0 };
  const corner = { x: 1, y: 2 };
  assert.equal(ctx.editor.addWireRoute(start, corner, 1).error, null);
  assert.deepEqual([...ctx.editor.board.wires.keys()], [
    'H:-2,0', 'H:-1,0', 'H:0,0', 'V:1,0', 'V:1,1',
  ]);
  assert.equal(ctx.saves, 1);
  assert.equal(ctx.editor.addWireRoute(corner, { x: 1, y: 4 }, 1).error, null);
  assert.equal(ctx.editor.board.wires.size, 7);
  assert.equal(ctx.saves, 2);
  assert.equal(ctx.editor.addWireRoute(start, corner, 1).error, null);
  assert.equal(ctx.saves, 2);
  assert.equal(ctx.editor.addWireRoute(start, corner, 2).error, 'Bus size mismatch.');
  assert.equal(ctx.saves, 2);
  assert.equal(ctx.editor.board.wires.size, 7);
});

test('a blocked wire route leaves the board untouched', () => {
  const ctx = setup();
  ctx.editor.place('constant', 1, 0);
  const before = serialize(ctx.editor.board);
  assert.equal(ctx.editor.addWireRoute({ x: 0, y: 1 }, { x: 4, y: 1 }, 1).error,
    'Wire is blocked by a component.');
  assert.equal(serialize(ctx.editor.board), before);
  assert.equal(ctx.saves, 1);
});

test('wire crossing junctions toggle, save, and move with their net', () => {
  const { editor } = setup();
  for (const edge of [
    { o: 'H', x: 0, y: 1 }, { o: 'H', x: 1, y: 1 },
    { o: 'V', x: 1, y: 0 }, { o: 'V', x: 1, y: 1 },
  ]) assert.equal(editor.addWire(edge), true);
  assert.equal(editor.evaluation.nets.size, 2);
  assert.equal(editor.toggleJunction(1, 1), true);
  assert.equal(editor.evaluation.nets.size, 1);
  assert.deepEqual(editor.board.junctions, new Set(['1,1']));
  assert.equal(editor.moveSelection([], ['H:0,1'], 4, 3), true);
  assert.deepEqual(editor.board.junctions, new Set(['5,4']));
  const copy = editor.copySelection([], ['H:4,4']);
  assert.deepEqual(copy.junctions, ['5,4']);
  assert.ok(editor.pasteSelection(copy));
  assert.equal(editor.board.junctions.has('7,6'), true);
  assert.equal(editor.toggleJunction(5, 4), true);
  assert.equal(editor.evaluation.nets.size, 3);
});

test('copy and paste preserve component properties and relative positions', () => {
  const ctx = setup();
  const { editor } = ctx;
  const constant = editor.place('constant', 0, 0);
  editor.resizeComponent(constant.id, 3);
  editor.setConstantValue(constant.id, 5);
  const led = editor.place('led', 5, 1);
  const copies = editor.copyComponents([constant.id, led.id]);
  assert.deepEqual(copies.map(({ x, y }) => [x, y]), [[0, 0], [5, 1]]);
  const saves = ctx.saves;
  const first = editor.pasteComponents(copies);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map(({ x, y }) => [x, y]), [[1, 2], [6, 3]]);
  assert.equal(first[0].size, 3);
  assert.equal(first[0].value, 5);
  assert.equal(new Set(first.map((c) => c.id)).size, 2);
  assert.equal(ctx.saves, saves + 1);
  const second = editor.pasteComponents(copies);
  assert.deepEqual(second.map(({ x, y }) => [x, y]), [[2, 4], [7, 5]]);
  assert.equal(ctx.saves, saves + 2);
  assert.equal(editor.deleteComponents(first.map((c) => c.id)), true);
  assert.equal(ctx.saves, saves + 3);
  assert.equal(editor.board.components.length, 4);
  assert.equal(editor.deleteComponents(first.map((c) => c.id)), false);
  assert.equal(ctx.saves, saves + 3);
});

test('paste searches around the requested viewport center and uses open space above', () => {
  const { editor } = setup();
  const source = editor.place('led', -20, -20);
  const copies = editor.copySelection([source.id], []);
  for (let x = 0; x <= 20; x += 2) {
    for (let y = 10; y <= 20; y += 2) assert.ok(editor.place('led', x, y));
  }
  const pasted = editor.pasteSelection(copies, { x: 11, y: 12 });
  assert.ok(pasted);
  assert.equal(pasted.components.length, 1);
  assert.ok(pasted.components[0].y < 10);
  assert.ok(Math.abs(pasted.components[0].x + 1 - 11) <= 2);
});

test('copy and paste preserve selected complete wire nets with components', () => {
  const ctx = setup();
  const { editor } = ctx;
  const led = editor.place('led', 0, 0);
  assert.equal(editor.addWireRoute({ x: 0, y: 5 }, { x: 2, y: 5 }, 2).error, null);
  assert.equal(editor.addWire({ o: 'V', x: 8, y: 5, size: 1 }), true);
  const copies = editor.copySelection([led.id], ['H:0,5', 'H:1,5']);
  assert.equal(copies.components.length, 1);
  assert.deepEqual(copies.wires.map(edgeKey), ['H:0,5', 'H:1,5']);
  assert.deepEqual(copies.wireKeys, ['H:0,5']);
  const saves = ctx.saves;
  const first = editor.pasteSelection(copies);
  assert.ok(first);
  assert.deepEqual(first.components.map(({ x, y }) => [x, y]), [[2, 2]]);
  assert.deepEqual(first.wires.map(edgeKey), ['H:2,7', 'H:3,7']);
  assert.deepEqual(first.wires.map(({ size }) => size), [2, 2]);
  assert.deepEqual(first.wireKeys, ['H:2,7']);
  assert.equal(ctx.saves, saves + 1);
  const second = editor.pasteSelection(copies);
  assert.ok(second);
  assert.deepEqual(second.wires.map(edgeKey), ['H:2,5', 'H:3,5']);
  assert.equal(ctx.saves, saves + 2);
  assert.equal(editor.board.wires.has('V:8,5'), true);
});

test('pasted components stay connected through their selected wire net', () => {
  const { editor } = setup();
  const constant = editor.place('constant', 1, 1);
  const led = editor.place('led', 0, 3);
  assert.equal(editor.setConstantValue(constant.id, 1), true);
  assert.equal(editor.addWire({ o: 'V', x: 1, y: 2 }), true);
  const copies = editor.copySelection([constant.id, led.id], ['V:1,2']);
  const pasted = editor.pasteSelection(copies);
  assert.ok(pasted);
  assert.deepEqual(pasted.wires.map(edgeKey), ['V:3,4']);
  assert.equal(editor.evaluation.states.get(pasted.components[1].id).lit, true);
});

test('wire-only selections paste and an invalid mixed group leaves the board unchanged', () => {
  const ctx = setup();
  const { editor } = ctx;
  assert.equal(editor.addWire({ o: 'V', x: 0, y: 0, size: 3 }), true);
  const wiresOnly = editor.copySelection([], ['V:0,0']);
  const pasted = editor.pasteSelection(wiresOnly);
  assert.ok(pasted);
  assert.deepEqual(pasted.wires.map(edgeKey), ['V:2,2']);
  assert.deepEqual(pasted.wireKeys, ['V:2,2']);

  const before = serialize(editor.board);
  const saves = ctx.saves;
  const invalid = editor.pasteSelection({
    components: [{ t: 'led', x: 0, y: 0, r: 0 }],
    wires: [{ o: 'H', x: 0, y: 1, size: 1 }],
    wireKeys: ['H:0,1'],
  });
  assert.equal(invalid, null);
  assert.equal(serialize(editor.board), before);
  assert.equal(ctx.saves, saves);
});

test('a failed group paste does not add some components or save', () => {
  const ctx = setup();
  const before = serialize(ctx.editor.board);
  const saves = ctx.saves;
  const pasted = ctx.editor.pasteComponents([
    { t: 'constant', value: 1, x: 0, y: 0, r: 0 },
    { t: 'led', x: 0, y: 0, r: 0 },
  ]);
  assert.deepEqual(pasted, []);
  assert.equal(serialize(ctx.editor.board), before);
  assert.equal(ctx.saves, saves);
});

test('deleting a mixed selection removes components and complete wire nets in one edit', () => {
  const ctx = setup();
  const component = ctx.editor.place('led', 6, 2);
  assert.equal(ctx.editor.addWireRoute({ x: 0, y: 0 }, { x: 2, y: 0 }, 1).error, null);
  assert.equal(ctx.editor.addWire({ o: 'V', x: 8, y: 0 }), true);
  const saves = ctx.saves;
  assert.equal(ctx.editor.deleteSelection([component.id], ['H:0,0', 'H:1,0']), true);
  assert.equal(ctx.editor.board.components.length, 0);
  assert.deepEqual([...ctx.editor.board.wires.keys()], ['V:8,0']);
  assert.equal(ctx.saves, saves + 1);
  assert.equal(ctx.editor.deleteSelection([component.id], ['H:0,0']), false);
  assert.equal(ctx.saves, saves + 1);
});
