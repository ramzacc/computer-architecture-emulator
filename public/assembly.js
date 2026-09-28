// ISA rule: KEYWORD | op 7-6=01 | address 5-3 | immediate 2-0
// Bit 0 is the least significant bit. Positions are listed most-significant
// field bit first; `*` assigns every remaining bit, from high to low.
function number(token) {
  const clean = token.replaceAll("_", "");
  if (/^0x[0-9a-f]+$/i.test(clean)) return Number.parseInt(clean.slice(2), 16);
  if (/^0b[01]+$/i.test(clean)) return Number.parseInt(clean.slice(2), 2);
  if (/^[0-9]+$/.test(clean)) return Number.parseInt(clean, 10);
  return NaN;
}

function positions(text, wordBits, line) {
  if (!/^\d+(?:[-,]\d+)*$/.test(text))
    throw new Error(`ISA line ${line}: use bit positions such as 7-6 or 0,3,5.`);
  const bits = text.split(/[-,]/).map(Number);
  if (new Set(bits).size !== bits.length || bits.some((bit) => bit >= wordBits))
    throw new Error(`ISA line ${line}: bit positions must be unique and between 0 and ${wordBits - 1}.`);
  return bits;
}

// Documents saved by the first assembly prototype used letter-filled bit
// patterns. Convert them when loading so existing boards keep their ISA.
export function normalizeIsa(source, wordBits) {
  return source.split(/\r?\n/).map((original) => {
    const [body, ...comment] = original.split(";");
    const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(.*?)\s*=\s*([01a-z]+)\s*$/i.exec(body);
    if (!match || match[3].length !== wordBits) return original;
    const fields = match[2].trim() ? match[2].split(",").map((part) => part.trim()) : [];
    if (fields.some((part) => !/^(?:R|#)?[a-z]$/i.test(part))) return original;
    const pattern = match[3].toLowerCase();
    const opBits = [];
    let opValue = "";
    for (const [index, char] of [...pattern].entries()) if (char === "0" || char === "1") {
      opBits.push(wordBits - index - 1);
      opValue += char;
    }
    if (!opBits.length) return original;
    const clauses = fields.map((field) => {
      const letter = field.at(-1).toLowerCase();
      const bits = [...pattern].flatMap((char, index) => char === letter ? [wordBits - index - 1] : []);
      return `${field.startsWith("#") ? "immediate" : "address"} ${bits.join("-")}`;
    });
    return `${match[1]} | op ${opBits.join("-")}=${opValue}${clauses.map((part) => ` | ${part}`).join("")}${comment.length ? ` ;${comment.join(";")}` : ""}`;
  }).join("\n");
}

export function parseIsa(source, wordBits) {
  const rules = [];
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = original.split(";", 1)[0].trim();
    if (!line) continue;
    const lineNumber = index + 1;
    const clauses = line.split("|").map((part) => part.trim());
    const keyword = clauses.shift()?.toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(keyword) || !clauses.length)
      throw new Error(`ISA line ${lineNumber}: use KEYWORD | op bits=value | address bits | immediate bits.`);
    const fixed = new Map();
    const operands = [];
    const used = new Set();
    let opcode = false;
    let restOperand = null;
    for (const clause of clauses) {
      const op = /^(?:op|opcode)\s+([^\s=]+)\s*=\s*([01]+)$/i.exec(clause);
      if (op) {
        if (opcode) throw new Error(`ISA line ${lineNumber}: define one opcode per rule.`);
        opcode = true;
        const bits = positions(op[1], wordBits, lineNumber);
        if (bits.length !== op[2].length)
          throw new Error(`ISA line ${lineNumber}: opcode value needs ${bits.length} binary digits.`);
        for (const [i, bit] of bits.entries()) {
          if (used.has(bit)) throw new Error(`ISA line ${lineNumber}: bit ${bit} is assigned twice.`);
          used.add(bit);
          fixed.set(bit, Number(op[2][i]));
        }
        continue;
      }
      const operand = /^(address|addr|immediate|imm)\s+(\*|[^\s]+)$/i.exec(clause);
      if (!operand) throw new Error(`ISA line ${lineNumber}: invalid clause “${clause}”.`);
      const kind = /^addr/i.test(operand[1]) ? "address" : "immediate";
      if (operand[2] === "*") {
        if (restOperand) throw new Error(`ISA line ${lineNumber}: only one operand can use *.`);
        restOperand = { kind, bits: [] };
        operands.push(restOperand);
        continue;
      }
      const bits = positions(operand[2], wordBits, lineNumber);
      for (const bit of bits) {
        if (used.has(bit)) throw new Error(`ISA line ${lineNumber}: bit ${bit} is assigned twice.`);
        used.add(bit);
      }
      operands.push({ kind, bits });
    }
    if (!opcode) throw new Error(`ISA line ${lineNumber}: define an opcode with op bits=value.`);
    if (restOperand) {
      restOperand.bits = Array.from({ length: wordBits }, (_, bit) => wordBits - bit - 1).filter((bit) => !used.has(bit));
      if (!restOperand.bits.length) throw new Error(`ISA line ${lineNumber}: no bits remain for *.`);
      for (const bit of restOperand.bits) used.add(bit);
    }
    // Unassigned bits are reserved zero bits.
    for (let bit = 0; bit < wordBits; bit++) if (!used.has(bit)) fixed.set(bit, 0);
    for (const prior of rules) {
      const overlaps = [...fixed].every(([bit, value]) => !prior.fixed.has(bit) || prior.fixed.get(bit) === value);
      if (overlaps) throw new Error(`ISA line ${lineNumber}: encoding overlaps ${prior.keyword}.`);
    }
    rules.push({ keyword, fixed, operands });
  }
  return rules;
}

function encode(rule, values) {
  let word = 0;
  for (const [bit, value] of rule.fixed) word += value * 2 ** bit;
  for (const [index, operand] of rule.operands.entries()) {
    const value = values[index];
    for (const [offset, bit] of operand.bits.entries())
      word += Math.floor(value / 2 ** (operand.bits.length - offset - 1)) % 2 * 2 ** bit;
  }
  return word;
}

export function assemble(source, addressBits, wordBits, isa = "") {
  const rules = parseIsa(isa, wordBits);
  const entries = new Map();
  const capacity = 2 ** addressBits;
  let address = 0;
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = original.split(";", 1)[0].trim();
    if (!line) continue;
    const [command, ...tokens] = line.split(/[\s,]+/).filter(Boolean);
    const name = command.toUpperCase();
    const fail = (message) => { throw new Error(`Line ${index + 1}: ${message}`); };
    if (name === ".ORG") {
      const value = tokens.length === 1 ? number(tokens[0]) : NaN;
      if (!Number.isInteger(value) || value < 0 || value >= capacity) fail(`address must be 0–${capacity - 1}.`);
      address = value;
      continue;
    }
    if (address >= capacity) fail("instruction exceeds ROM address space.");
    if (entries.has(address)) fail(`address 0x${address.toString(16).toUpperCase()} is written twice.`);
    let value;
    if (name === ".WORD") {
      value = tokens.length === 1 ? number(tokens[0]) : NaN;
      if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** wordBits) fail(`word must fit ${wordBits} bits.`);
    } else {
      const candidates = rules.filter((rule) => rule.keyword === name);
      if (!candidates.length) fail(`unknown instruction ${command}. Define it in ISA or use .word.`);
      const values = tokens.map(number);
      const rule = candidates.find((candidate) => candidate.operands.length === values.length &&
        values.every((operand, i) => Number.isSafeInteger(operand) && operand >= 0 && operand < 2 ** candidate.operands[i].bits.length));
      if (!rule) fail(`operands do not fit ${name}; use numeric addresses and immediates.`);
      value = encode(rule, values);
    }
    entries.set(address++, value);
  }
  return [...entries].filter(([, value]) => value !== 0).sort((a, b) => a[0] - b[0]);
}

function decode(rule, value) {
  for (const [bit, expected] of rule.fixed)
    if (Math.floor(value / 2 ** bit) % 2 !== expected) return null;
  const operands = rule.operands.map(({ bits }) => bits.reduce((result, bit) => result * 2 + Math.floor(value / 2 ** bit) % 2, 0));
  return `${rule.keyword}${operands.length ? ` ${operands.map((item) => `0x${item.toString(16).toUpperCase()}`).join(" ")}` : ""}`;
}

export function disassemble(data, wordBits, isa = "") {
  const rules = parseIsa(isa, wordBits);
  const lines = [];
  let next = 0;
  for (const [address, value] of [...data].sort((a, b) => a[0] - b[0])) {
    if (value === 0) continue;
    if (address !== next) lines.push(`.org 0x${address.toString(16).toUpperCase()}`);
    lines.push(rules.map((rule) => decode(rule, value)).find((item) => item !== null)
      ?? `.word 0x${value.toString(16).toUpperCase().padStart(Math.ceil(wordBits / 4), "0")}`);
    next = address + 1;
  }
  return lines.join("\n");
}
