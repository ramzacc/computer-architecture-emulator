import test from "node:test";
import assert from "node:assert/strict";
import { BoardEditor } from "./public/editor.js";
import { assemble } from "./public/assembly.js";
import { captureProgramSource, reconcileProgramSource, restoreProgramSource, validProgramSource } from "./public/program-source.js";
import { parseDocument, serialize } from "./public/model.js";

const isa = "ADD | op 7-6=01 | register 5-4-3 | value 2-1-0";

test("Program stores only noncanonical lines and preserves comments, blanks, and trailing zero words", () => {
  const source = "; header\n\nADD R2 0x1 ; inline\nADD R1 0x2\n; between\n.word 0\n\n; trailing";
  const data = assemble(source, 8, 8, isa);
  const annotations = captureProgramSource(source, data, 8, 8, isa);
  assert.deepEqual(annotations, {
    length: 3,
    before: [[0, "; header"], [0, ""], [2, "; between"], [3, ""], [3, "; trailing"]],
    overrides: [[0, "ADD R2 0x1 ; inline"], [2, ".word 0"]],
  });
  assert.equal(restoreProgramSource(annotations, data, 8, 8, isa), source);
});

test("saved Program annotations survive a document round trip and ROM words stay authoritative", () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place("rom", 0, 0);
  editor.setProgramConfig({ rom: rom.id, pc: null, run: null, step: null, resetPc: null,
    resetRegisters: null, registers: [], offset: 0, format: "hex", isa: { [rom.id]: isa } });
  const source = "ADD R2 1 ; original\n.word 0";
  const words = assemble(source, 8, 8, isa);
  assert.equal(editor.saveProgramSource(rom.id, words, source), true);
  const saved = JSON.parse(serialize(editor.board));
  assert.deepEqual(saved.program.sources, [[0, { length: 2, overrides: [[0, "ADD R2 1 ; original"], [1, ".word 0"]] }]]);
  const loaded = parseDocument(JSON.stringify(saved)).board;
  assert.deepEqual(loaded.components[0].data, words);
  assert.equal(restoreProgramSource(loaded.program.sources[loaded.program.rom], words, 8, 8, isa), source);
  loaded.components[0].data = [[0, 0x52]];
  assert.equal(restoreProgramSource(loaded.program.sources[loaded.program.rom], loaded.components[0].data, 8, 8, isa),
    "ADD R2 0x2\n.word 0");
});

test("Program annotations reject invalid addresses, duplicate overrides, and code in comment slots", () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place("rom", 0, 0);
  editor.saveProgramSource(rom.id, [[0, 1]], ".word 1");
  const saved = JSON.parse(serialize(editor.board));
  saved.program.sources[0][1].overrides = [[0, ".word 1"], [0, ".word 1"]];
  assert.throws(() => parseDocument(JSON.stringify(saved)), /invalid annotations/);
  saved.program.sources[0][1].overrides = [];
  saved.program.sources[0][1].before = [[0, ".word 1"]];
  assert.throws(() => parseDocument(JSON.stringify(saved)), /invalid annotations/);
});

test("direct ROM edits discard source text that no longer encodes the word", () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place("rom", 0, 0);
  editor.saveProgramSource(rom.id, [[0, 1]], ".word 1 ; note");
  assert.deepEqual(editor.board.program.sources[rom.id].overrides, [[0, ".word 1 ; note"]]);
  assert.equal(editor.setRomData(rom.id, [[0, 2]]), true);
  assert.equal(editor.board.program.sources[rom.id].overrides, undefined);
  assert.equal(restoreProgramSource(editor.board.program.sources[rom.id], [[0, 2]], 8, 8), ".word 0x02");
  assert.throws(() => editor.saveProgramSource(rom.id, [[0, 2]], ".word 1"), /does not match/);
});

test("comment-only changes save even when ROM bytes do not change", () => {
  const saved = [];
  const editor = new BoardEditor({ storage: { setItem(_key, value) { saved.push(value); } } });
  const rom = editor.place("rom", 0, 0);
  editor.saveProgramSource(rom.id, [[0, 1]], ".word 1 ; first");
  const before = saved.length;
  editor.saveProgramSource(rom.id, [[0, 1]], ".word 1 ; second");
  assert.equal(saved.length, before + 1);
  const loaded = parseDocument(saved.at(-1)).board;
  assert.equal(restoreProgramSource(loaded.program.sources[loaded.program.rom], [[0, 1]], 8, 8),
    ".word 1 ; second");
});

test("shrinking a ROM address space drops source that no longer fits", () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place("rom", 0, 0);
  editor.saveProgramSource(rom.id, [[0, 1]], ".word 1\n.word 0\n.word 0\n.word 0\n.word 0");
  assert.equal(editor.board.program.sources[rom.id].length, 5);
  assert.equal(editor.resizeMemoryAddress(rom.id, 2), true);
  assert.equal(editor.board.program.sources[rom.id], undefined);
  assert.equal(restoreProgramSource({ length: 1 }, [[0, 1]], 2, 8), ".word 0x01");
});

test("canonical source adds no Program payload", () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place("rom", 0, 0);
  editor.saveProgramSource(rom.id, [[0, 1]], ".word 0x01");
  assert.equal(JSON.parse(serialize(editor.board)).program.sources, undefined);
});

test("Program annotation validation enforces comment and override slots, order, and extent", () => {
  assert.equal(validProgramSource({ length: 0 }, 8), true);
  assert.equal(validProgramSource({ length: 2, before: [[0, "; header"], [2, ""]], overrides: [[0, "NOP"], [1, ".word 1"]] }, 8), true);
  assert.equal(validProgramSource({ length: 256 }, 8), true);
  for (const source of [
    null, [], { length: 0, extra: 1 }, { length: -1 }, { length: 257 },
    { length: 1, before: [[0, "NOP"]] },
    { length: 1, overrides: [[0, "; comment"]] },
    { length: 2, before: [[1, "; a"], [0, "; b"]] },
    { length: 2, overrides: [[0, "a"], [0, "b"]] },
    { length: 1, overrides: [[1, "a"]] },
    { length: 1, before: [[0, 0]] },
    { length: 1, before: [[0, "a\nb"]] },
  ]) assert.equal(validProgramSource(source, 8), false, JSON.stringify(source));
});

test("reconcile keeps matching overrides, drops stale ones, and extends along ROM words", () => {
  const isa = "ADD | op 7-6=01 | register 5-4-3 | value 2-1-0";
  assert.equal(reconcileProgramSource(null, [[0, 0x51]], 8, 8, isa), null);
  const source = { length: 3, before: [[0, "; header"]], overrides: [[0, "ADD R2 1 ; inline"], [2, "ADD R1 2"]] };
  assert.deepEqual(reconcileProgramSource(source, [[0, 0x51]], 8, 8, isa),
    { length: 3, before: [[0, "; header"]], overrides: [[0, "ADD R2 1 ; inline"]] });
  assert.deepEqual(reconcileProgramSource({ length: 0 }, [[5, 0x51]], 8, 8, isa), { length: 6 });
  assert.deepEqual(reconcileProgramSource({ length: 2 }, [[0, 0], [1, 0]], 8, 8, isa), { length: 2 });
});

test("restoreProgramSource rejects invalid annotations and ignores overrides that no longer match", () => {
  const isa = "ADD | op 7-6=01 | register 5-4-3 | value 2-1-0";
  assert.throws(() => restoreProgramSource({ length: 1, before: [[0, "NOP"]] }, [[0, 0]], 8, 8), /Invalid Program source/);
  assert.equal(restoreProgramSource({ length: 1, overrides: [[0, "ADD R2 1"]] }, [[0, 0x50]], 8, 8, isa),
    "ADD R2 0x0");
  assert.equal(restoreProgramSource({ length: 2, before: [[0, "; header"], [2, "; trailing"]] }, [[0, 0x51]], 8, 8, isa),
    "; header\nADD R2 0x1\n.word 0x00\n; trailing");
});

test("changing ISA drops line overrides that no longer assemble", () => {
  const editor = new BoardEditor({ storage: { setItem() {} } });
  const rom = editor.place("rom", 0, 0);
  editor.setProgramConfig({ rom: rom.id, pc: null, run: null, step: null, resetPc: null,
    resetRegisters: null, registers: [], offset: 0, format: "hex", isa: { [rom.id]: isa } });
  editor.saveProgramSource(rom.id, [[0, 0x51]], "ADD R2 1 ; note");
  assert.equal(editor.board.program.sources[rom.id].overrides.length, 1);
  editor.setProgramConfig({ ...editor.board.program, isa: {} });
  assert.equal(editor.board.program.sources[rom.id].overrides, undefined);
  assert.equal(restoreProgramSource(editor.board.program.sources[rom.id], [[0, 0x51]], 8, 8), ".word 0x51");
});
