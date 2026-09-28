import test from "node:test";
import assert from "node:assert/strict";
import { addComponent, createBoard, serialize } from "../public/model.js";
import { parseProject, serializeProject } from "../public/project-file.js";

function example() {
  const board = createBoard();
  addComponent(board, { id: "rom", t: "rom", x: 0, y: 0, r: 0, size: 8, addressSize: 8, data: [[0, 1]], label: "ROM" });
  board.program = { rom: "rom", pc: null, run: null, step: null, resetPc: null,
    resetRegisters: null, registers: [], offset: 0, format: "hex" };
  return board;
}

test("v1 project round trips the full board and pending ROM, ISA, and assembly drafts", () => {
  const board = example();
  const rules = [{ keyword: "", cells: Array(8).fill(null), operands: [], comment: "unfinished" }];
  const text = serializeProject(board, { rom: [["rom", [[0, 2]]]], isa: [["rom", rules]],
    assembly: [["rom", "unfinished source"]], breakpoints: [["rom", [2, 5]]] });
  const data = JSON.parse(text);
  assert.equal(data.format, "computer-architecture-project");
  assert.equal(data.version, 1);
  const loaded = parseProject(text);
  assert.equal(serialize(loaded.board), serialize(board));
  assert.deepEqual(loaded.drafts, { rom: [["c1", [[0, 2]]]], isa: [["c1", rules]],
    assembly: [["c1", "unfinished source"]], breakpoints: [["c1", [2, 5]]] });
});

test("unsupported or malformed project files fail", () => {
  const board = example();
  const base = JSON.parse(serializeProject(board));
  for (const changed of [
    { ...base, version: 2 },
    { ...base, format: "another-format" },
    { ...base, drafts: undefined },
    { ...base, extra: true },
    { ...base, drafts: { ...base.drafts, rom: [[0, [[0, 999]]]] } },
    { ...base, drafts: { ...base.drafts, isa: [[0, [{ keyword: "X", cells: [0], operands: [] }]]] } },
    { ...base, drafts: { ...base.drafts, assembly: [[1, "x"]] } },
    { ...base, drafts: { ...base.drafts, breakpoints: [[0, [300]]] } },
  ]) assert.throws(() => parseProject(JSON.stringify(changed)));
});
