import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEditor } from './public/editor.js';
import { parseDocument, serialize } from './public/model.js';
import { instructionDigits, parseInstruction } from './public/program.js';

test('program bindings survive save and load and reject invalid signal types', () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place('rom', 0, 0);
  const pc = editor.place('tag', 6, 0);
  const run = editor.place('switch', 12, 0);
  const step = editor.place('button', 16, 0);
  const resetPc = editor.place('button', 20, 0);
  const resetRegisters = editor.place('button', 24, 0);
  const register = editor.place('tag', 28, 0);
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
  assert.throws(() => parseDocument(JSON.stringify(document)), /unique tags/);
});

test('instruction input accepts bounded binary and hex words', () => {
  assert.equal(parseInstruction('0xAF', 'hex', 8), 175);
  assert.equal(parseInstruction('1010_0101', 'binary', 8), 165);
  assert.equal(parseInstruction('', 'hex', 8), 0);
  assert.equal(parseInstruction('100000000', 'binary', 8), null);
  assert.equal(parseInstruction('GG', 'hex', 8), null);
  for (const width of [8, 16, 32]) {
    assert.equal(instructionDigits(width, 'hex'), width / 4);
    assert.equal(instructionDigits(width, 'binary'), width);
    const maximum = 2 ** width - 1;
    assert.equal(parseInstruction(maximum.toString(16), 'hex', width), maximum);
    assert.equal(parseInstruction(maximum.toString(2), 'binary', width), maximum);
    assert.equal(parseInstruction((2 ** width).toString(16), 'hex', width), null);
    assert.equal(parseInstruction((2 ** width).toString(2), 'binary', width), null);
  }
});

test('a ROM accepts one complete word per address at 8, 16, and 32 bits', () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place('rom', 0, 0);
  for (const width of [8, 16, 32]) {
    if (width !== 8) assert.equal(editor.resizeComponent(rom.id, width), true);
    const word = parseInstruction('F'.repeat(width / 4), 'hex', width);
    assert.equal(editor.setRomData(rom.id, [[3, word]]), true);
    assert.deepEqual(editor.component(rom.id).data, [[3, word]]);
  }
});
