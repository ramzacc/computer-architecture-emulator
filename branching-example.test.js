import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseProject } from "./public/project-file.js";
import { assemble } from "./public/assembly.js";
import { restoreProgramSource } from "./public/program-source.js";
import { evaluateBoard } from "./public/model.js";
import { BoardEditor } from "./public/editor.js";

function example() {
  return parseProject(readFileSync(new URL("./public/examples/branching-computer.json", import.meta.url), "utf8")).board;
}

test("branching computer ISA, arithmetic, branches, and halt", () => {
  const board = example();
  const get = (label) => board.components.find((component) => component.label === label);
  const rom = get("Program ROM");
  const isa = board.program.isa[rom.id];
  const source = restoreProgramSource(board.program.sources[rom.id], rom.data, 4, 8, isa);
  assert.deepEqual(assemble(source, 4, 8, isa), rom.data);
  assert.match(source, /JNZ 3/);
  assert.match(source, /JZ 14/);
  assert.match(source, /JMP 15/);

  for (const [pc, accumulator, result, nextPc, write] of [
    [1, 0, 5, 2, 1],     // LDI
    [2, 5, 8, 3, 1],     // ADD
    [3, 8, 7, 4, 1],     // SUB
    [4, 7, 0, 3, 0],     // JNZ taken
    [4, 0, 0, 5, 0],     // JNZ not taken
    [5, 7, 7, 6, 1],     // OR
    [6, 7, 4, 7, 1],     // XOR
    [7, 4, 11, 8, 1],    // NOT
    [8, 4, 15, 9, 1],    // NAND
    [9, 4, 10, 10, 1],   // NOR
    [12, 0, 0, 14, 0],   // JZ taken
    [12, 1, 0, 13, 0],   // JZ not taken
    [14, 0, 0, 15, 0],   // JMP
    [15, 9, 0, 0, 0],    // HALT suppresses PC write
  ]) {
    const values = new Map([[get("PC").id, pc], [get("ACC").id, accumulator]]);
    const { states, settled } = evaluateBoard(board, new Set([get("Step clock").id]), new Set(), values);
    assert.equal(settled, true, `PC ${pc} must settle`);
    assert.deepEqual(states.get(get("ACC").id).inputs.slice(0, 2), [result, write], `ACC at PC ${pc}`);
    assert.deepEqual(states.get(get("PC").id).inputs.slice(0, 2), [nextPc, Number(pc !== 15)], `PC at ${pc}`);
  }
});

test("branching computer loops until ACC reaches zero", () => {
  const board = example();
  const editor = new BoardEditor({ storage: null });
  editor.replaceBoard(board, { save: false });
  const id = (label) => board.components.find((component) => component.label === label).id;
  editor.registerValues.set(id("PC"), 3);
  editor.registerValues.set(id("ACC"), 2);
  editor.evaluate();
  const step = () => {
    assert.equal(editor.setButtonPressed(id("Step clock"), true), true);
    assert.equal(editor.setButtonPressed(id("Step clock"), false), true);
    return [editor.registerValues.get(id("PC")), editor.registerValues.get(id("ACC"))];
  };
  assert.deepEqual(step(), [4, 1]);
  assert.deepEqual(step(), [3, 1]);
  assert.deepEqual(step(), [4, 0]);
  assert.deepEqual(step(), [5, 0]);
});
