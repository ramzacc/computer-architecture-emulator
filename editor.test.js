import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEditor, STORAGE_KEY } from './editor.js';
import { edgeKey, parseDocument, serialize } from './model.js';
import { wireTitle } from './renderer.js';

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

test('ALU placement and resizing keep data and operation pin widths distinct', () => {
  const { editor } = setup();
  const alu = editor.place('alu', 0, 0);
  assert.equal(alu.size, 4);
  assert.equal(editor.addWire({ o: 'V', x: 5, y: -1, size: 2 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 3, y: 3, size: 4 }), true);
  assert.equal(editor.resizeComponent(alu.id, 8), false);
  assert.equal(editor.deleteNet('V:3,3'), true);
  assert.equal(editor.resizeComponent(alu.id, 8), true);
  assert.equal(editor.addWire({ o: 'V', x: 3, y: 3, size: 8 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 5, y: -2, size: 8 }), false);
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
