import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEditor, STORAGE_KEY } from './public/editor.js';
import { edgeKey, parseDocument, serialize } from './public/model.js';
import { wireTitle } from './public/renderer.js';

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

test('successful edits render and save once, while rejected edits do neither', () => {
  const ctx = setup();
  const { editor } = ctx;
  const power = editor.place('power', 0, 0);
  assert.ok(power);
  assert.equal(ctx.saves, 1);
  assert.equal(editor.place('led', 0, 0), null);
  assert.equal(editor.move(power.id, 0, 0), false);
  assert.equal(editor.addWire({ o: 'V', x: 1, y: 2 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 1, y: 2 }), false);
  assert.equal(editor.resizeWire('V:1,2', 2), false); // power pin is one bit
  assert.equal(ctx.saves, 2);
  assert.equal(ctx.renders, 2);
  assert.equal(editor.move(power.id, 3, 0), true);
  assert.equal(ctx.saves, 3); // completed drag
  assert.equal(editor.rotate(power.id), true);
  assert.equal(ctx.saves, 4);
  assert.equal(editor.removeWire('V:1,2'), true);
  assert.equal(ctx.saves, 5);
  assert.equal(editor.deleteComponent(power.id), true);
  assert.equal(ctx.saves, 6);
  assert.equal(ctx.renders, ctx.saves);
  assert.equal(JSON.parse(ctx.data.get(STORAGE_KEY)).version, 8);
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
  const wire = { o: 'V', x: 1, y: 2, size: 2 };
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
  assert.equal(editor.addWire({ o: 'V', x: 1, y: -1, size: 32 }), true);
  assert.equal(editor.resizeComponent(output.id, 8), false);
  assert.equal(editor.component(output.id).size, 32);
  assert.equal(editor.deleteNet('V:1,-1'), true);
  assert.equal(editor.resizeComponent(output.id, 8), true);
});

test('imports save only after successful parsing and older documents remain compatible', () => {
  const ctx = setup();
  const old = JSON.stringify({ version: 7, components: [{ t: 'power', x: 0, y: 1 }], wires: [{ o: 'V', x: 1, y: 2 }] });
  const result = ctx.editor.importText(old);
  assert.equal(result.board.components[0].y, 0);
  assert.equal(result.skipped.wires, 0);
  assert.equal(ctx.saves, 1);
  assert.equal(JSON.parse(ctx.data.get(STORAGE_KEY)).version, 8);
  assert.deepEqual(parseDocument(ctx.data.get(STORAGE_KEY)).skipped, { components: 0, wires: 0 });
  const before = serialize(ctx.editor.board);
  assert.throws(() => ctx.editor.importText('{'));
  assert.equal(serialize(ctx.editor.board), before);
  assert.equal(ctx.saves, 1);
  assert.equal(ctx.editor.loadSaved().board.components.length, 1);
});

test('storage errors leave the current board usable', () => {
  let errors = 0;
  const editor = new BoardEditor({ storage: { setItem() { throw Error('quota'); }, getItem() { throw Error('blocked'); } }, onStorageError: () => errors++ });
  assert.equal(editor.loadSaved(), null);
  assert.ok(editor.place('power', 0, 0));
  assert.equal(editor.board.components.length, 1);
  assert.equal(errors, 2);
});

test('wire hover text includes the evaluated value', () => {
  assert.equal(wireTitle({ size: 2 }, 3), '2 bit(s), value 3');
});

test('changing a constant cannot create a short circuit', () => {
  const ctx = setup();
  const { editor } = ctx;
  const a = editor.place('constant', 0, 0);
  const b = editor.place('constant', 4, 0);
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
  ctx.editor.place('power', 1, 0);
  const before = serialize(ctx.editor.board);
  assert.equal(ctx.editor.addWireRoute({ x: 0, y: 1 }, { x: 4, y: 1 }, 1).error,
    'Wire is blocked by a component.');
  assert.equal(serialize(ctx.editor.board), before);
  assert.equal(ctx.saves, 1);
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
  assert.deepEqual(first.map(({ x, y }) => [x, y]), [[2, 2], [7, 3]]);
  assert.equal(first[0].size, 3);
  assert.equal(first[0].value, 5);
  assert.equal(new Set(first.map((c) => c.id)).size, 2);
  assert.equal(ctx.saves, saves + 1);
  const second = editor.pasteComponents(copies);
  assert.deepEqual(second.map(({ x, y }) => [x, y]), [[4, 4], [9, 5]]);
  assert.equal(ctx.saves, saves + 2);
  assert.equal(editor.deleteComponents(first.map((c) => c.id)), true);
  assert.equal(ctx.saves, saves + 3);
  assert.equal(editor.board.components.length, 4);
  assert.equal(editor.deleteComponents(first.map((c) => c.id)), false);
  assert.equal(ctx.saves, saves + 3);
});

test('a failed group paste does not add some components or save', () => {
  const ctx = setup();
  const before = serialize(ctx.editor.board);
  const saves = ctx.saves;
  const pasted = ctx.editor.pasteComponents([
    { t: 'power', x: 0, y: 0, r: 0 },
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
