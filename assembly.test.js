import test from "node:test";
import assert from "node:assert/strict";
import { assemble, disassemble, parseIsa, isaGrid, serializeIsaGrid, normalizeIsa } from "./public/assembly.js";

const sampleIsa = `NOT | op 7-6=00 | address 5-4-3 | address 2-1-0
ADD | op 7-6=01 | address 5-4-3 | address 2-1-0
AND | op 7-6=10 | address 5-4-3 | address 2-1-0
INC | op 7-6=11 | address 5-4-3 | address 2-1-0`;

test("keyword and numeric operands map through explicit bit positions", () => {
  assert.deepEqual(assemble("ADD 2 1\nAND 2 7\nINC 1 0", 8, 8, sampleIsa), [
    [0, 0x51], [1, 0x97], [2, 0xC8],
  ]);
  assert.equal(disassemble([[0, 0x51], [1, 0x97], [2, 0xC8]], 8, sampleIsa),
    "ADD 0x2 0x1\nAND 0x2 0x7\nINC 0x1 0x0");
});

test("the ISA tab's example rules can be saved together", () => {
  assert.equal(parseIsa(`ADD | op 7-6=01 | address 5-4-3 | address 2-1-0
LDI | op 7-6-5=110 | address 4-3 | immediate 2-1-0
JMP | op 7-6=10 | address *`, 8).length, 3);
});

test("noncontiguous opcode and operand tuples and remaining bits round trip", () => {
  const isa = "MOVE | op 0-3-5=101 | immediate 1-4-6 | address *";
  const data = assemble("MOVE 5 2", 8, 8, isa);
  assert.deepEqual(data, [[0, 0xE3]]);
  assert.deepEqual(assemble("MOVE 5 2", 8, 8,
    "MOVE | op 0,3,5=101 | immediate 1,4,6 | address *"), data);
  assert.deepEqual(assemble(disassemble(data, 8, isa), 8, 8, isa), data);
  const wide = "LDI | op 15-14-13-12=1010 | address 11-10-9-8 | immediate 7-6-5-4-3-2-1-0\nJMP | op 15-14-13-12=1100 | address *";
  const words = assemble("LDI 3 0x42\nJMP 0x321", 8, 16, wide);
  assert.deepEqual(words, [[0, 0xA342], [1, 0xC321]]);
  assert.deepEqual(assemble(disassemble(words, 16, wide), 8, 16, wide), words);
});

test("raw words and sparse ROM remain representable", () => {
  const data = [[1, 0x12], [17, 0xABCD], [255, 0xFFFF]];
  assert.deepEqual(assemble(disassemble(data, 16), 8, 16), data);
  assert.deepEqual(assemble("\n; reserved\n.word 0b1010\n.word 0", 8, 8), [[2, 10]]);
});

test("invalid mappings and source do not produce a ROM image", () => {
  assert.throws(() => parseIsa("BAD | op 7-6=01 | address 7-6-5-4-3-2-1-0", 8), /assigned twice/);
  assert.throws(() => parseIsa("A | op 7-6-5-4-3-2-1-0=00000000\nB | op 7-6-5-4-3-2-1-0=00000000", 8), /overlaps/);
  assert.throws(() => parseIsa("BAD | op 0-3-5=10", 8), /3 binary digits/);
  assert.throws(() => assemble("ADD 8 1", 8, 8, sampleIsa), /Line 1/);
  assert.throws(() => assemble(".org 0x10", 8, 8), /Line 1/);
  assert.throws(() => assemble(".word 0x100", 8, 8), /Line 1/);
  assert.throws(() => parseIsa("A | op 7-6=01 | value 5-4-3\nA | op 7-6=10 | value 5-4-3", 8), /duplicate instruction signature/);
});

test("visual grid preserves scattered operand click order and types", () => {
  const rules = [{ keyword: "MOV", cells: [0, 1, "1", 0, "0", 1, "0", "1"], operands: [
    { kind: "register", bits: [3, 0] }, { kind: "value", bits: [5, 1] },
  ] }];
  const isa = serializeIsaGrid(rules);
  assert.deepEqual(isaGrid(isa, 8), rules);
  assert.deepEqual(assemble("MOV R2 1", 8, 8, isa), [[0, 0x8E]]);
  assert.equal(disassemble([[0, 0x8E]], 8, isa), "MOV R2 0x1");
  assert.throws(() => assemble("MOV 2 1", 8, 8, isa), /operands do not match/);
});

test("keyword variants may differ by Register and Value signature", () => {
  const isa = "LOAD | op 7-6=01 | register 5-4-3 | value 2-1-0\nLOAD | op 7-6=10 | value 5-4-3 | register 2-1-0";
  assert.deepEqual(assemble("LOAD R2 1\nLOAD 2 R1", 8, 8, isa), [[0, 0x51], [1, 0x91]]);
});



test("physical lines reserve addresses and sparse ROM disassembles to blank lines", () => {
  const isa = "JMP | op 7=1 | value 6-5-4-3-2-1-0";
  assert.deepEqual(assemble("; comment\n\nJMP 3\n.word 0\n.word 0x4", 8, 8, isa), [[2, 0x83], [4, 4]]);
  assert.equal(disassemble([[2, 0x83], [4, 4]], 8, isa), "\n\nJMP 0x3\n\n.word 0x04");
  assert.deepEqual(assemble(disassemble([[2, 0x83], [4, 4]], 8, isa), 8, 8, isa), [[2, 0x83], [4, 4]]);
});

test("legacy saved letter rules become Register and Value fields", () => {
  const converted = normalizeIsa("MOV Rd,#v = 10ddvvvv", 8);
  const rules = isaGrid(converted, 8);
  assert.deepEqual(rules[0].operands.map((operand) => operand.kind), ["register", "value"]);
  assert.deepEqual(assemble("MOV R2 5", 8, 8, converted), [[0, 0xA5]]);
});

test("visual rules reject unassigned operands and inconsistent cells", () => {
  const empty = serializeIsaGrid([{ keyword: "BAD", cells: Array(8).fill("0"), operands: [{ kind: "value", bits: [] }] }]);
  assert.throws(() => parseIsa(empty, 8), /needs bits/);
  const wrong = serializeIsaGrid([{ keyword: "BAD", cells: Array(8).fill("0"), operands: [{ kind: "value", bits: [0] }] }]);
  assert.throws(() => parseIsa(wrong, 8), /disagree/);
});
