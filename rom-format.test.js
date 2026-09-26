import test from "node:test";
import assert from "node:assert/strict";
import { parseRomFile, serializeRomFile, validHexWord } from "./public/rom-format.js";
import { BoardEditor } from "./public/editor.js";
import { parseDocument } from "./public/model.js";

test("ROM text files pack ordered words into a single hex string", () => {
  assert.equal(serializeRomFile([[2, 0xA5], [0, 0xFF]], 8, 8), "FF00A5");
  assert.equal(serializeRomFile([[2, 0], [0, 0xFF]], 8, 8), "FF");
  assert.deepEqual(parseRomFile("FF00A5", 8, 8), [[0, 0xFF], [2, 0xA5]]);
  assert.deepEqual(parseRomFile("FF00A5\n", 8, 8), [[0, 0xFF], [2, 0xA5]]);
  assert.equal(serializeRomFile([], 8, 8), "");
  assert.deepEqual(parseRomFile("", 8, 8), []);
});

test("ROM text uses the component's data width", () => {
  assert.equal(serializeRomFile([[1, 0xFFFFFFFF]], 8, 32), "00000000FFFFFFFF");
  assert.deepEqual(parseRomFile("00000000FFFFFFFF", 8, 32), [[1, 0xFFFFFFFF]]);
  assert.throws(() => parseRomFile("100", 8, 8), /multiple of 2/);
  assert.throws(() => parseRomFile("GG", 8, 8), /uninterrupted line/);
  assert.throws(() => parseRomFile("00\n00", 8, 8), /uninterrupted line/);
  assert.throws(() => parseRomFile("\n00", 8, 8), /uninterrupted line/);
  assert.throws(() => parseRomFile("000000", 1, 8), /extends beyond/);
  assert.throws(() => parseRomFile("00".repeat(65_537), 16, 8), /extends beyond/);
  assert.throws(() => serializeRomFile([[0xFFFF, 1]], 32, 8), /at most 16 bits/);
});

test("ROM address and data widths use powers of two", () => {
  const editor = new BoardEditor();
  const rom = editor.place("rom", 0, 0);
  assert.equal(editor.resizeComponent(rom.id, 3), false);
  assert.equal(editor.resizeRomAddress(rom.id, 3), false);
  assert.equal(editor.resizeRomAddress(rom.id, 32), false);
  assert.equal(editor.resizeComponent(rom.id, 32), true);
  assert.equal(editor.resizeComponent(rom.id, 16), true);
  assert.equal(editor.resizeRomAddress(rom.id, 16), true);
  assert.throws(() => parseDocument(JSON.stringify({ components: [["rom", 0, 0, 0, 3, 8, []]], wires: [] })), /power of two/);
  assert.throws(() => parseDocument(JSON.stringify({ components: [["rom", 0, 0, 0, 8, 3, []]], wires: [] })), /power of two/);
  const wide = JSON.stringify({ components: [["rom", 0, 0, 0, 32, 32, [[0xFFFFFFFF, 1]]]], wires: [] });
  assert.throws(() => parseDocument(wide), /1–16/);
  const storage = { getItem: () => wide };
  assert.throws(() => new BoardEditor({ storage }).loadSaved(), /1–16/);
  assert.throws(() => new BoardEditor().importText(wide), /1–16/);
});

test("ROM value cells accept only hex digits that fit their data width", () => {
  assert.equal(validHexWord("", 8), true);
  assert.equal(validHexWord("aF", 8), true);
  assert.equal(validHexWord("G", 8), false);
  assert.equal(validHexWord("1F2", 8), false);
  assert.equal(validHexWord("2", 1), false);
  assert.equal(validHexWord("3", 2), true);
  assert.equal(validHexWord("FFFFFFFF", 32), true);
  assert.equal(validHexWord("100000000", 32), false);
});
