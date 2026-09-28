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
      return `${field.startsWith("R") ? "register" : "value"} ${bits.join("-")}`;
    });
    return `${match[1]} | op ${opBits.join("-")}=${opValue}${clauses.map((part) => ` | ${part}`).join("")}${comment.length ? ` ;${comment.join(";")}` : ""}`;
  }).join("\n");
}

function parseLegacyIsa(source, wordBits) {
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
      const operand = /^(address|addr|immediate|imm|value|register|reg)\s+(\*|[^\s]+)$/i.exec(clause);
      if (!operand) throw new Error(`ISA line ${lineNumber}: invalid clause “${clause}”.`);
      const kind = /^(?:reg)/i.test(operand[1]) ? "register" : "value";
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

export function parseIsa(source, wordBits) {
  let raw;
  if (source.trim().startsWith("{")) {
    let document;
    try { document = JSON.parse(source); }
    catch { throw new Error("ISA: invalid saved bit grid."); }
    if (document.version !== 2 || !Array.isArray(document.rules)) throw new Error("ISA: invalid saved bit grid.");
    raw = document.rules.map((rule) => {
      if (!Array.isArray(rule.cells) || rule.cells.length !== wordBits || !Array.isArray(rule.operands))
        throw new Error("ISA: bit grid does not match ROM width.");
      const fixed = new Map();
      for (const [bit, cell] of rule.cells.entries()) {
        if (cell === "0" || cell === "1") fixed.set(bit, Number(cell));
        else if (cell !== null && (!Number.isInteger(cell) || cell < 0 || cell >= rule.operands.length))
          throw new Error(`ISA ${rule.keyword}: invalid cell assignment.`);
      }
      for (const [operandIndex, item] of rule.operands.entries()) {
        if (!Array.isArray(item.bits)) throw new Error(`ISA ${rule.keyword}: invalid operand bits.`);
        for (const bit of item.bits) if (rule.cells[bit] !== operandIndex)
          throw new Error(`ISA ${rule.keyword}: bit grid and operand order disagree.`);
      }
      for (const [bit, cell] of rule.cells.entries()) if (typeof cell === "number" && !rule.operands[cell].bits.includes(bit))
        throw new Error(`ISA ${rule.keyword}: bit grid and operand order disagree.`);
      return { keyword: rule.keyword, fixed, operands: rule.operands.map((item) => ({ kind: item.kind, bits: item.bits })) };
    });
  } else raw = parseLegacyIsa(source, wordBits);
  const rules = [];
  const signatures = new Set();
  for (const [index, rule] of raw.entries()) {
    const label = `ISA rule ${index + 1}`;
    if (!/^[A-Z][A-Z0-9_]*$/.test(rule.keyword)) throw new Error(`${label}: invalid keyword.`);
    const used = new Set();
    for (const bit of rule.fixed.keys()) {
      if (!Number.isInteger(bit) || bit < 0 || bit >= wordBits) throw new Error(`${label}: invalid bit position.`);
      used.add(bit);
    }
    for (const operand of rule.operands) {
      if (!["register", "value"].includes(operand.kind) || !Array.isArray(operand.bits) || !operand.bits.length)
        throw new Error(`${label}: every Register or Value operand needs bits.`);
      for (const bit of operand.bits) {
        if (!Number.isInteger(bit) || bit < 0 || bit >= wordBits || used.has(bit))
          throw new Error(`${label}: bit ${bit} is assigned twice or outside the ROM word.`);
        used.add(bit);
      }
    }
    const signature = `${rule.keyword}:${rule.operands.map((item) => item.kind).join(",")}`;
    if (signatures.has(signature)) throw new Error(`${label}: duplicate instruction signature ${rule.keyword}.`);
    signatures.add(signature);
    for (let bit = 0; bit < wordBits; bit++) if (!used.has(bit)) rule.fixed.set(bit, 0);
    for (const prior of rules) {
      if ([...rule.fixed].every(([bit, value]) => !prior.fixed.has(bit) || prior.fixed.get(bit) === value))
        throw new Error(`${label}: encoding overlaps ${prior.keyword}.`);
    }
    rules.push(rule);
  }
  return rules;
}

export function isaGrid(source, wordBits) {
  return parseIsa(source, wordBits).map((rule) => {
    const cells = Array(wordBits).fill(null);
    for (const [bit, value] of rule.fixed) cells[bit] = String(value);
    rule.operands.forEach((operand, index) => operand.bits.forEach((bit) => { cells[bit] = index; }));
    return { keyword: rule.keyword, cells, operands: rule.operands.map((operand) => ({ kind: operand.kind, bits: [...operand.bits] })) };
  });
}

export function serializeIsaGrid(rules) { return JSON.stringify({ version: 2, rules }); }

function sourceOperand(token) {
  const register = /^R(0x[0-9a-f]+|0b[01]+|[0-9]+)$/i.exec(token);
  if (register) return { kind: "register", value: number(register[1]) };
  return { kind: "value", value: number(token) };
}

export function assemble(source, addressBits, wordBits, isa = "") {
  const rules = parseIsa(isa, wordBits);
  const entries = new Map();
  const capacity = 2 ** addressBits;
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = original.split(";", 1)[0].trim();
    if (index >= capacity) throw new Error(`Line ${index + 1}: instruction exceeds ROM address space.`);
    if (!line) continue;
    const [command, ...tokens] = line.split(/[\s,]+/).filter(Boolean);
    const name = command.toUpperCase();
    const fail = (message) => { throw new Error(`Line ${index + 1}: ${message}`); };
    if (name === ".ORG") fail(".org is unavailable; each physical line has one ROM address.");
    let value;
    if (name === ".WORD") {
      value = tokens.length === 1 ? number(tokens[0]) : NaN;
      if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** wordBits) fail(`word must fit ${wordBits} bits.`);
    } else {
      const candidates = rules.filter((rule) => rule.keyword === name);
      if (!candidates.length) fail(`unknown instruction ${command}. Define it in ISA or use .word.`);
      const operands = tokens.map(sourceOperand);
      const rule = candidates.find((candidate) => candidate.operands.length === operands.length &&
        operands.every((operand, i) => operand.kind === candidate.operands[i].kind &&
          Number.isSafeInteger(operand.value) && operand.value >= 0 && operand.value < 2 ** candidate.operands[i].bits.length));
      if (!rule) fail(`operands do not match ${name} or do not fit its bit fields.`);
      value = encode(rule, operands.map((operand) => operand.value));
    }
    entries.set(index, value);
  }
  return [...entries].filter(([, value]) => value !== 0).sort((a, b) => a[0] - b[0]);
}

function decode(rule, value) {
  for (const [bit, expected] of rule.fixed)
    if (Math.floor(value / 2 ** bit) % 2 !== expected) return null;
  const operands = rule.operands.map(({ bits, kind }) => {
    const decoded = bits.reduce((result, bit) => result * 2 + Math.floor(value / 2 ** bit) % 2, 0);
    return `${kind === "register" ? "R" : ""}0x${decoded.toString(16).toUpperCase()}`;
  });
  return `${rule.keyword}${operands.length ? ` ${operands.join(" ")}` : ""}`;
}

export function disassemble(data, wordBits, isa = "") {
  const rules = parseIsa(isa, wordBits);
  const lines = [];
  let next = 0;
  for (const [address, value] of [...data].sort((a, b) => a[0] - b[0])) {
    if (value === 0) continue;
    while (next < address) { lines.push(""); next++; }
    lines.push(rules.map((rule) => decode(rule, value)).find((item) => item !== null)
      ?? `.word 0x${value.toString(16).toUpperCase().padStart(Math.ceil(wordBits / 4), "0")}`);
    next = address + 1;
  }
  return lines.join("\n");
}
