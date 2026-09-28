import test from "node:test";
import assert from "node:assert/strict";
import { addComponent, createBoard, parseDocument, serialize } from "./public/model.js";
import { parseProject, serializeProject } from "./public/project-file.js";

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
  const text = serializeProject(board, { rom: [["rom", [[0, 2]]]], isa: [["rom", rules]], assembly: [["rom", "unfinished source"]] });
  const data = JSON.parse(text);
  assert.equal(data.version, 1);
  const loaded = parseProject(text);
  assert.equal(serialize(loaded.board), serialize(board));
  assert.deepEqual(loaded.drafts, { rom: [["c1", [[0, 2]]]], isa: [["c1", rules]], assembly: [["c1", "unfinished source"]] });
});

test("legacy board files import and unsupported or malformed project files fail", () => {
  const board = example();
  assert.equal(parseProject(serialize(board)).legacy, true);
  assert.equal(serialize(parseDocument(serialize(board)).board), serialize(board));
  const base = JSON.parse(serializeProject(board));
  for (const changed of [
    { ...base, version: 2 },
    { ...base, extra: true },
    { ...base, drafts: { ...base.drafts, rom: [[0, [[0, 999]]]] } },
    { ...base, drafts: { ...base.drafts, isa: [[0, [{ keyword: "X", cells: [0], operands: [] }]]] } },
    { ...base, drafts: { ...base.drafts, assembly: [[1, "x"]] } },
  ]) assert.throws(() => parseProject(JSON.stringify(changed)));
});
