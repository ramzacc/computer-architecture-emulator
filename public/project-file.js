import { bitWidth, addressWidth, validRom } from "./components.js";
import { parseDocument, serialize } from "./model.js";

export const PROJECT_VERSION = 1;
export const PROJECT_FORMAT = "computer-architecture-project";

function object(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`${name} has unsupported fields.`);
}

function draftEntries(entries, board, kind, validate) {
  if (!Array.isArray(entries)) throw new Error(`Project ${kind} drafts must be an array.`);
  const seen = new Set();
  return entries.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) ||
        board.components[entry[0]]?.t !== "rom" || seen.has(entry[0]))
      throw new Error(`Project ${kind} draft must refer to a unique ROM.`);
    seen.add(entry[0]);
    const rom = board.components[entry[0]];
    validate(entry[1], rom);
    return [rom.id, entry[1]];
  });
}

function validIsaRules(rules, width) {
  return Array.isArray(rules) && rules.length <= 256 && rules.every((rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
        Object.keys(rule).some((key) => !["keyword", "comment", "cells", "operands"].includes(key)) ||
        typeof rule.keyword !== "string" || rule.keyword.length > 24 ||
        (rule.comment !== undefined && (typeof rule.comment !== "string" || rule.comment.length > 160)) ||
        !Array.isArray(rule.cells) || rule.cells.length !== width || !Array.isArray(rule.operands) ||
        rule.operands.length > width) return false;
    const used = new Set();
    if (!rule.operands.every((operand, index) => operand && typeof operand === "object" && !Array.isArray(operand) &&
      Object.keys(operand).every((key) => ["kind", "bits"].includes(key)) &&
      ["register", "value"].includes(operand.kind) && Array.isArray(operand.bits) &&
      operand.bits.every((bit) => Number.isInteger(bit) && bit >= 0 && bit < width &&
        rule.cells[bit] === index && !used.has(bit) && (used.add(bit), true)))) return false;
    return rule.cells.every((cell, bit) => cell === null || cell === "0" || cell === "1" ||
      (Number.isInteger(cell) && cell >= 0 && cell < rule.operands.length && used.has(bit)));
  });
}

export function serializeProject(board, drafts = {}) {
  const document = JSON.parse(serialize(board));
  const indexes = new Map(board.components.map((component, index) => [component.id, index]));
  const encode = (entries, kind) => (entries ?? []).map(([id, value]) => {
    const index = indexes.get(id);
    if (index === undefined) throw new Error(`Cannot save ${kind} draft for a missing component.`);
    return [index, value];
  });
  const result = { format: PROJECT_FORMAT, version: PROJECT_VERSION, document, drafts: {
    rom: encode(drafts.rom, "ROM"),
    isa: encode(drafts.isa, "ISA"),
    assembly: encode(drafts.assembly, "assembly"),
    breakpoints: encode(drafts.breakpoints, "breakpoint"),
  } };
  // Use the same validation path for files we write and files we open.
  parseProject(JSON.stringify(result));
  return JSON.stringify(result);
}

export function parseProject(text) {
  const data = JSON.parse(text);
  object(data, "Project", ["format", "version", "document", "drafts"]);
  if (data.format !== PROJECT_FORMAT) throw new Error("File is not a Computer Architecture project.");
  if (data.version !== PROJECT_VERSION) throw new Error(`Unsupported project version ${String(data.version)}.`);
  const { board } = parseDocument(JSON.stringify(data.document));
  const drafts = data.drafts;
  object(drafts, "Project drafts", ["rom", "isa", "assembly", "breakpoints"]);
  if (!Array.isArray(drafts.rom) || !Array.isArray(drafts.isa) ||
      !Array.isArray(drafts.assembly) || !Array.isArray(drafts.breakpoints))
    throw new Error("Project drafts must include ROM, ISA, assembly, and breakpoint arrays.");
  return { board, drafts: {
    rom: draftEntries(drafts.rom, board, "ROM", (entries, rom) => {
      if (!validRom({ t: "rom", size: bitWidth(rom), addressSize: addressWidth(rom), data: entries }))
        throw new Error("Project ROM draft has invalid data.");
    }),
    isa: draftEntries(drafts.isa, board, "ISA", (rules, rom) => {
      if (!validIsaRules(rules, bitWidth(rom))) throw new Error("Project ISA draft is invalid.");
    }),
    assembly: draftEntries(drafts.assembly, board, "assembly", (source) => {
      if (typeof source !== "string" || source.length > 1_000_000)
        throw new Error("Project assembly draft is invalid.");
    }),
    breakpoints: draftEntries(drafts.breakpoints, board, "breakpoint", (addresses, rom) => {
      if (!Array.isArray(addresses) || addresses.some((address) =>
        !Number.isInteger(address) || address < 0 || address >= 2 ** addressWidth(rom)) ||
        new Set(addresses).size !== addresses.length)
        throw new Error("Project breakpoints are invalid.");
    }),
  } };
}
