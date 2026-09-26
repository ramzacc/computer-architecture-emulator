import { validRomAddressWidth, validRomWidth } from "./components.js";

export function validHexWord(text, width) {
  return validRomWidth(width) && (text === "" ||
    (new RegExp(`^[0-9a-f]{1,${Math.ceil(width / 4)}}$`, "i").test(text) && parseInt(text, 16) < 2 ** width));
}

function checkWidths(addressSize, dataSize) {
  if (!validRomAddressWidth(addressSize) || !validRomWidth(dataSize))
    throw new Error("ROM address width must be at most 16 bits and data width at most 32 bits, both powers of two.");
}

// One uninterrupted string of fixed-width hex words, starting at address zero.
export function serializeRomFile(entries, addressSize, dataSize) {
  checkWidths(addressSize, dataSize);
  const words = new Map();
  let lastAddress = -1;
  for (const [address, value] of entries) {
    if (!Number.isInteger(address) || address < 0 || address >= 2 ** addressSize)
      throw new Error("ROM contents exceed the address width.");
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** dataSize)
      throw new Error(`Value at address ${address.toString(16).toUpperCase()} exceeds ${dataSize} bits.`);
    if (value === 0) continue;
    words.set(address, value);
    lastAddress = Math.max(lastAddress, address);
  }
  const digits = Math.ceil(dataSize / 4);
  const packed = [];
  for (let address = 0; address <= lastAddress; address++)
    packed.push((words.get(address) ?? 0).toString(16).toUpperCase().padStart(digits, "0"));
  return packed.join("");
}

export function parseRomFile(text, addressSize, dataSize) {
  checkWidths(addressSize, dataSize);
  const packed = text.replace(/\r?\n$/, "");
  if (!/^[0-9a-f]*$/i.test(packed)) throw new Error("ROM file must contain one uninterrupted line of hexadecimal digits.");
  const digits = Math.ceil(dataSize / 4);
  if (packed.length % digits !== 0)
    throw new Error(`ROM file length must be a multiple of ${digits} hex digits per word.`);
  const wordCount = packed.length / digits;
  if (wordCount > 2 ** addressSize)
    throw new Error(`ROM file extends beyond the ${addressSize}-bit address space.`);
  const entries = [];
  for (let address = 0; address < wordCount; address++) {
    const value = parseInt(packed.slice(address * digits, (address + 1) * digits), 16);
    if (value >= 2 ** dataSize) throw new Error(`Word ${address + 1} exceeds ${dataSize} bits.`);
    if (value) entries.push([address, value]);
  }
  return entries;
}
