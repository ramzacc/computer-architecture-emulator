import { assemble, disassemble, sourceLineAddresses } from "./assembly.js";

// ROM words are authoritative. Only source that canonical disassembly cannot
// reproduce is stored here: extra lines, changed instruction text, and extent.
export function captureProgramSource(source, data, addressBits, wordBits, isa = "") {
  const lines = source.split(/\r?\n/);
  const addresses = sourceLineAddresses(source);
  const length = addresses.filter((address) => address !== null).length;
  if (length > 2 ** addressBits) throw new Error("Program exceeds ROM address space.");
  const canonical = disassemble(data, wordBits, isa, length).split("\n");
  const before = [];
  const overrides = [];
  let address = 0;
  for (const [index, line] of lines.entries()) {
    if (addresses[index] === null) {
      before.push([address, line]);
    } else {
      if (line !== canonical[address]) overrides.push([address, line]);
      address++;
    }
  }
  const natural = disassemble(data, wordBits, isa);
  const naturalLength = natural ? natural.split("\n").length : 0;
  if (!before.length && !overrides.length && length === naturalLength) return null;
  return { length, ...(before.length ? { before } : {}), ...(overrides.length ? { overrides } : {}) };
}

export function validProgramSource(source, addressBits) {
  if (!source || typeof source !== "object" || Array.isArray(source) ||
      Object.keys(source).some((key) => !["length", "before", "overrides"].includes(key)) ||
      !Number.isInteger(source.length) || source.length < 0 || source.length > 2 ** addressBits ||
      JSON.stringify(source).length > 1_000_000) return false;
  const validLines = (items, extra) => items === undefined || (Array.isArray(items) && items.every((entry) =>
    Array.isArray(entry) && entry.length === 2 && Number.isInteger(entry[0]) &&
    entry[0] >= 0 && entry[0] <= source.length - extra && typeof entry[1] === "string" &&
    !/[\r\n]/.test(entry[1]) && (!extra || !!entry[1].split(";", 1)[0].trim()) &&
    (extra || !entry[1].split(";", 1)[0].trim())));
  return validLines(source.before, 0) && validLines(source.overrides, 1) &&
    new Set((source.overrides ?? []).map(([address]) => address)).size === (source.overrides ?? []).length &&
    (source.before ?? []).every((entry, index, entries) => !index || entry[0] >= entries[index - 1][0]);
}

function matchingLine(line, word, addressBits, wordBits, isa) {
  try {
    const encoded = assemble(line, addressBits, wordBits, isa);
    return (encoded[0]?.[1] ?? 0) === word;
  } catch { return false; }
}

export function restoreProgramSource(source, data, addressBits, wordBits, isa = "") {
  if (!validProgramSource(source, addressBits)) throw new Error("Invalid Program source annotations.");
  const words = new Map(data);
  let length = source.length;
  for (const address of words.keys()) length = Math.max(length, address + 1);
  const lines = disassemble(data, wordBits, isa, length).split("\n");
  if (!length) lines.length = 0;
  for (const [address, line] of source.overrides ?? []) {
    if (matchingLine(line, words.get(address) ?? 0, addressBits, wordBits, isa)) lines[address] = line;
  }
  const output = [];
  let beforeIndex = 0;
  for (let address = 0; address <= length; address++) {
    while (source.before?.[beforeIndex]?.[0] === address) output.push(source.before[beforeIndex++][1]);
    if (address < length) output.push(lines[address]);
  }
  return output.join("\n");
}

export function reconcileProgramSource(source, data, addressBits, wordBits, isa = "") {
  if (!validProgramSource(source, addressBits)) return null;
  const words = new Map(data);
  const overrides = (source.overrides ?? []).filter(([address, line]) =>
    matchingLine(line, words.get(address) ?? 0, addressBits, wordBits, isa));
  let length = source.length;
  for (const address of words.keys()) length = Math.max(length, address + 1);
  return { length, ...(source.before?.length ? { before: source.before } : {}),
    ...(overrides.length ? { overrides } : {}) };
}
