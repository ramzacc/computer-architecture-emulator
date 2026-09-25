import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEditor, STORAGE_KEY } from './public/editor.js';
import { spec } from './public/components.js';
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

test('successful edits render and save once, while rejected edits do neither', () => {
  const ctx = setup();
  const { editor } = ctx;
  const constant = editor.place('constant', 0, 0);
  assert.ok(constant);
  assert.equal(ctx.saves, 1);
  assert.equal(editor.place('led', 0, 0), null);
  assert.equal(editor.move(constant.id, 0, 0), false);
  assert.equal(editor.addWire({ o: 'V', x: 1, y: 2 }), true);
  assert.equal(editor.addWire({ o: 'V', x: 1, y: 2 }), false);
  assert.equal(editor.resizeWire('V:1,2', 2), false); // connected constant pin is one bit
  assert.equal(ctx.saves, 2);
  assert.equal(ctx.renders, 2);
  assert.equal(editor.move(constant.id, 3, 0), true);
  assert.equal(ctx.saves, 3); // completed drag
  assert.equal(editor.rotate(constant.id), true);
  assert.equal(ctx.saves, 4);
  assert.equal(editor.removeWire('V:1,2'), true);
  assert.equal(ctx.saves, 5);
  assert.equal(editor.deleteComponent(constant.id), true);
  assert.equal(ctx.saves, 6);
  assert.equal(ctx.renders, ctx.saves);
  assert.equal(JSON.parse(ctx.data.get(STORAGE_KEY)).version, 9);
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
  assert.equal((svg.match(/fill="#f2bb85"/g) ?? []).length, 2);
  assert.equal((svg.match(/fill="#3b3840"/g) ?? []).length, 5);
  assert.match(svg, />A<\/text>/);
  assert.match(svg, />G<\/text>/);
});

test('debug display decodes the four-bit value and carries a distinct label', () => {
  const art = createRenderer(null, () => null, () => new Set(), () => new Set()).componentArt;
  const zero = art({ t: 'debugdisplay' }, spec('debugdisplay'), 0);
  const f = art({ t: 'debugdisplay' }, spec('debugdisplay'), 15);
  assert.match(zero, />DBG<\/text>/);
  assert.equal((zero.match(/fill="#f2bb85"/g) ?? []).length, 6);
  assert.equal((f.match(/fill="#f2bb85"/g) ?? []).length, 4);
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
  const output = editor.place('output', 4, 0);
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
  assert.match(art({ t: 'output', size: 32, format: 'binary' }, spec('output'), 0xffffffff), />0b11111111<\/text>/);
});

test('imports save only after successful parsing and older documents remain compatible', () => {
  const ctx = setup();
  const old = JSON.stringify({ version: 7, components: [{ t: 'power', x: 0, y: 1 }], wires: [{ o: 'V', x: 1, y: 2 }] });
  const result = ctx.editor.importText(old);
  assert.equal(result.board.components[0].y, 0);
  assert.equal(result.board.components[0].t, 'constant');
  assert.equal(result.board.components[0].value, 1);
  assert.equal(result.skipped.wires, 0);
  assert.equal(ctx.saves, 1);
  assert.equal(JSON.parse(ctx.data.get(STORAGE_KEY)).version, 9);
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

test('accepted events publish a fresh evaluation; explicit evaluation does not save', () => {
  const published = [];
  let saves = 0;
  const editor = new BoardEditor({
    storage: { setItem: () => saves++ },
    onChange: (board, evaluation) => published.push({ board, evaluation }),
  });
  const initial = editor.evaluation;
  const constant = editor.place('constant', 0, 0);
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
  editor.replaceBoard(parseDocument(serialize(editor.board)).board, { save: false });
  assert.equal(editor.highClocks.size, 0);
  assert.equal(editor.evaluation.states.get(editor.board.components[1].id).lit, false);
});

test('a register captures its data on rising edges and holds it on falling edges', () => {
  const ctx = setup();
  const { editor } = ctx;
  const data = editor.place('constant', 0, 0);
  const clock = editor.place('clock', 2, 0);
  const register = editor.place('register', 0, 5);
  assert.equal(register.size, 4);
  assert.deepEqual(editor.evaluation.states.get(register.id).inputs, [0, 0]);
  assert.equal(editor.resizeComponent(data.id, 4), true);
  assert.equal(editor.setConstantValue(data.id, 9), true);
  for (const y of [2, 3, 4]) {
    assert.equal(editor.addWire({ o: 'V', x: 1, y, size: 4 }), true);
    assert.equal(editor.addWire({ o: 'V', x: 3, y }), true);
  }
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

test('cascaded registers on one clock capture the previous Q simultaneously', () => {
  const { editor } = setup();
  const source = editor.place('constant', 0, 0);
  const clock = editor.place('clock', 2, 0);
  const first = editor.place('register', 0, 5);
  const second = editor.place('register', 0, 14);
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
