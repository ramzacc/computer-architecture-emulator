import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEditor } from './public/editor.js';
import { parseDocument, serialize } from './public/model.js';

test('program bindings survive save and load and reject invalid signal types', () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place('rom', 0, 0);
  const pc = editor.place('tag', 6, 0);
  const run = editor.place('clock', 12, 0);
  const step = editor.place('button', 16, 0);
  const resetPc = editor.place('button', 20, 0);
  const resetRegisters = editor.place('button', 24, 0);
  const register = editor.place('register', 28, 0);
  const config = { rom: rom.id, pc: pc.id, run: run.id, step: step.id,
    resetPc: resetPc.id, resetRegisters: resetRegisters.id, registers: [register.id], offset: 64, format: 'binary' };
  assert.equal(editor.setProgramConfig(config), true);
  assert.deepEqual(parseDocument(serialize(editor.board)).board.program, {
    ...config, rom: 'c1', pc: 'c2', run: 'c3', step: 'c4', resetPc: 'c5', resetRegisters: 'c6', registers: ['c7'],
  });
  const document = JSON.parse(serialize(editor.board));
  document.program.step = 0;
  assert.throws(() => parseDocument(JSON.stringify(document)), /program.step/);
  document.program.step = 3;
  document.program.registers = [1, 1];
  assert.throws(() => parseDocument(JSON.stringify(document)), /unique registers/);
  document.program.registers = [6];
  document.components.push(['tag', 36, 0, 0, 1, 'Other tag']);
  document.program.registers = [7];
  assert.throws(() => parseDocument(JSON.stringify(document)), /unique registers/);
  document.program.registers = [6];
  document.components.push(['switch', 32, 0, 0, 0, 'Other switch']);
  document.program.run = 7;
  assert.throws(() => parseDocument(JSON.stringify(document)), /program.run/);
});

test('a ROM accepts one complete word per address at 8, 16, and 32 bits', () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place('rom', 0, 0);
  for (const width of [8, 16, 32]) {
    if (width !== 8) assert.equal(editor.resizeComponent(rom.id, width), true);
    const word = 2 ** width - 1;
    assert.equal(editor.setRomData(rom.id, [[3, word]]), true);
    assert.deepEqual(editor.component(rom.id).data, [[3, word]]);
  }
});

test('per-ROM ISA rules survive save and load', () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const first = editor.place('rom', 0, 0);
  const second = editor.place('rom', 8, 0);
  editor.setProgramConfig({ rom: first.id, pc: null, run: null, step: null,
    resetPc: null, resetRegisters: null, registers: [], offset: 0, format: 'hex',
    isa: { [first.id]: 'ADD | op 7-6=01 | address 5-4-3 | address 2-1-0', [second.id]: 'JMP | op 7-6=10 | address *' } });
  const saved = serialize(editor.board);
  assert.deepEqual(parseDocument(saved).board.program.isa, {
    [first.id]: 'ADD | op 7-6=01 | address 5-4-3 | address 2-1-0', [second.id]: 'JMP | op 7-6=10 | address *',
  });
  const invalid = JSON.parse(saved);
  invalid.program.isa[0][1] = 'BAD = 000';
  assert.throws(() => parseDocument(JSON.stringify(invalid)), /ISA line 1/);
  const legacy = JSON.parse(saved);
  legacy.program.isa[0][1] = 'ADD Rd, Rs = 01dddsss';
  assert.equal(parseDocument(JSON.stringify(legacy)).board.program.isa[first.id],
    'ADD | op 7-6=01 | address 5-4-3 | address 2-1-0');
  assert.equal(editor.resizeComponent(first.id, 16), true);
  assert.equal(editor.board.program.isa[first.id], undefined);
  assert.equal(editor.board.program.isa[second.id], 'JMP | op 7-6=10 | address *');
  assert.doesNotThrow(() => parseDocument(serialize(editor.board)));
});
