import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProject } from './public/project-file.js';
import { BoardEditor } from './public/editor.js';

const projectText = readFileSync(new URL('./examples/odd-even-sorter.json', import.meta.url), 'utf8');

function openSorter() {
  const { board } = parseProject(projectText);
  const editor = new BoardEditor();
  editor.replaceBoard(board, { save: false });
  const id = (label) => board.components.find((part) => part.label === label)?.id;
  const values = () => Array.from({ length: 8 }, (_, i) => editor.registerValues.get(id(`R${i}`)));
  const pulse = (label) => {
    assert.equal(editor.setButtonPressed(id(label), true), true);
    assert.equal(editor.setButtonPressed(id(label), false), true);
  };
  return { editor, id, values, pulse };
}

test('native sorter loads inputs, alternates compare/swap phases, pauses, and resets', () => {
  const { editor, id, values, pulse } = openSorter();
  pulse('RESET');
  assert.deepEqual(values(), Array(8).fill(0));

  assert.equal(editor.toggleSwitch(id('LOAD')), true);
  pulse('STEP clock');
  assert.deepEqual(values(), [7, 2, 6, 1, 5, 0, 4, 3]);
  assert.equal(editor.registerValues.get(id('Phase')), 0);
  assert.equal(editor.toggleSwitch(id('LOAD')), true);

  // No active RUN lock: clock edges do not change the registers.
  pulse('STEP clock');
  assert.deepEqual(values(), [7, 2, 6, 1, 5, 0, 4, 3]);
  assert.equal(editor.toggleSwitch(id('RUN lock')), true);

  const expected = [7, 2, 6, 1, 5, 0, 4, 3];
  for (let phase = 0; phase < 8; phase++) {
    for (let i = phase % 2; i < 7; i += 2) {
      if (expected[i] > expected[i + 1]) [expected[i], expected[i + 1]] = [expected[i + 1], expected[i]];
    }
    pulse('STEP clock');
    assert.deepEqual(values(), expected, `phase ${phase}`);
    assert.equal(editor.registerValues.get(id('Phase')), (phase + 1) % 2);
  }
  assert.deepEqual(values(), [0, 1, 2, 3, 4, 5, 6, 7]);

  assert.equal(editor.toggleSwitch(id('RUN lock')), true);
  pulse('STEP clock');
  assert.deepEqual(values(), expected);
  pulse('RESET');
  assert.deepEqual(values(), Array(8).fill(0));
  assert.equal(editor.registerValues.get(id('Phase')), 0);
});
