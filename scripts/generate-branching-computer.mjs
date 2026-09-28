// Rebuild public/examples/branching-computer.json with:
// node scripts/generate-branching-computer.mjs
import { writeFileSync } from "node:fs";
import { pinsFor, documentFields, dimsOf } from "../public/components.js";
import { assemble } from "../public/assembly.js";
import { captureProgramSource } from "../public/program-source.js";
import { parseProject, serializeProject } from "../public/project-file.js";

const components = [];
const named = new Map();
let nextX = 200;
function part(type, label, options = {}, x = null, y = 0, r = 0) {
  const component = { id: `c${components.length + 1}`, t: type, x: x ?? nextX, y, r,
    size: 4, label, ...options };
  if (x === null) nextX += 60;
  named.set(label, component);
  components.push(component);
  return component;
}
function pin(label, name) {
  const component = named.get(label);
  const found = pinsFor(component).find((item) => item.name === name);
  if (!found) throw new Error(`Missing ${label}.${name}`);
  return { ...found, component };
}
const rom = part("rom", "Program ROM", { size: 8, addressSize: 4, data: [] }, 0);
const bits = part("splitter", "Instruction bits", { size: 8, order: "ascendant" }, 60);
const imm = part("splitter", "Immediate", { order: "descendant" }, 120, -10, 2);
const op = part("splitter", "Opcode", { order: "descendant" }, 140, 4, 2);
part("register", "PC");
part("tag", "PC address");
part("register", "ACC");
part("clock", "Run clock", { frequency: 1, enable: false });
part("button", "Step clock");
part("button", "Reset PC");
part("button", "Reset registers");
part("or", "Clock source", { size: 1 });
part("constant", "One", { value: 1 });
part("constant", "Fifteen", { value: 15 });
part("constant", "Zero", { value: 0 });
for (const value of [12, 13, 14, 15]) part("constant", `Opcode ${value}`, { value });
part("adder", "PC + 1");
part("comparator", "ACC zero test");
for (const value of [12, 13, 14, 15]) part("comparator", `Decode ${value}`);
part("and", "JZ and zero", { size: 1 });
part("and", "JNZ and nonzero", { size: 1 });
part("or", "Jump or JZ", { size: 1 });
part("or", "Branch selected", { size: 1 });
part("mux", "Next PC", { channels: 2 });
part("and", "ACC write clock", { size: 1 });
part("and", "PC write clock", { size: 1 });
part("adder", "ADD");
part("twos", "Negate immediate");
part("adder", "SUB");
for (const type of ["and", "or", "xor", "not", "nand", "nor"])
  part(type, `${type.toUpperCase()} result`);
part("adder", "INC");
part("adder", "DEC");
part("mux", "ALU result", { channels: 16 });

const connections = new Map();
function connect(net, label, name) {
  const point = pin(label, name);
  if (!connections.has(net)) connections.set(net, []);
  connections.get(net).push(point);
}
function wiresFor(net, ...pins) { for (const [label, name] of pins) connect(net, label, name); }
wiresFor("pc", ["PC", "Q"], ["PC address", undefined], ["Program ROM", "ADDR"], ["PC + 1", "A"]);
wiresFor("acc", ["ACC", "Q"], ["ACC zero test", "A"], ["ADD", "A"], ["SUB", "A"],
  ["INC", "A"], ["DEC", "A"]);
// The gate pins have no names, so assign A/B by index below.
for (const [net, label, indexes] of [
  ["acc", "AND result", [0]], ["acc", "OR result", [0]], ["acc", "XOR result", [0]],
  ["acc", "NOT result", [0]], ["acc", "NAND result", [0]], ["acc", "NOR result", [0]],
]) for (const index of indexes) connections.get(net)?.push({ ...pinsFor(named.get(label))[index], component: named.get(label) });
wiresFor("imm", ["Immediate", undefined], ["Next PC", "D1"], ["ALU result", "D0"],
  ["ADD", "B"], ["Negate immediate", "A"]);
for (const label of ["AND result", "OR result", "XOR result", "NAND result", "NOR result"])
  connections.get("imm").push({ ...pinsFor(named.get(label))[1], component: named.get(label) });
wiresFor("opcode", ["Opcode", undefined], ["ALU result", "S"],
  ...[12, 13, 14, 15].map((value) => [`Decode ${value}`, "A"]));
wiresFor("one", ["One", undefined], ["PC + 1", "B"], ["INC", "B"]);
wiresFor("fifteen", ["Fifteen", undefined], ["DEC", "B"]);
wiresFor("zero", ["Zero", undefined], ["ACC zero test", "B"], ["ALU result", "D11"]);
for (const value of [12, 13, 14, 15]) wiresFor(`op${value}`, [`Opcode ${value}`, undefined], [`Decode ${value}`, "B"]);
wiresFor("pcInc", ["PC + 1", "SUM"], ["Next PC", "D0"]);
wiresFor("pcNext", ["Next PC", "Y"], ["PC", "D"]);
wiresFor("alu", ["ALU result", "Y"], ["ACC", "D"]);
wiresFor("negativeImm", ["Negate immediate", "−A"], ["SUB", "B"]);
for (const [net, source, channel] of [
  ["sum", "ADD", 1], ["difference", "SUB", 2], ["andValue", "AND result", 3],
  ["orValue", "OR result", 4], ["xorValue", "XOR result", 5],
  ["notValue", "NOT result", 6], ["nandValue", "NAND result", 7],
  ["norValue", "NOR result", 8], ["increment", "INC", 9], ["decrement", "DEC", 10],
]) {
  const output = pinsFor(named.get(source)).find((p) => p.role === "out" && p.size === 4);
  connections.set(net, [{ ...output, component: named.get(source) }, pin("ALU result", `D${channel}`)]);
}

function bare(label, index) {
  const component = named.get(label);
  return { ...pinsFor(component)[index], component };
}
function link(net, ...terminals) { connections.set(net, terminals.map(([label, index]) => bare(label, index))); }
link("clock", ["Run clock", 0], ["Clock source", 0]);
link("step", ["Step clock", 0], ["Clock source", 1]);
link("tick", ["Clock source", 2], ["ACC write clock", 0], ["PC write clock", 0]);
link("accEnable", ["Decode 12", 2], ["ACC write clock", 1]); // LT 12
link("pcEnable", ["Decode 15", 2], ["PC write clock", 1]); // LT 15
link("accClock", ["ACC write clock", 2], ["ACC", 1]);
link("pcClock", ["PC write clock", 2], ["PC", 1]);
link("resetPc", ["Reset PC", 0], ["PC", 3]);
link("resetAcc", ["Reset registers", 0], ["ACC", 3]);
link("zeroFlag", ["ACC zero test", 3], ["JZ and zero", 1]);
link("nonzeroFlag", ["ACC zero test", 4], ["JNZ and nonzero", 1]);
link("isJump", ["Decode 12", 3], ["Jump or JZ", 0]);
link("isJz", ["Decode 13", 3], ["JZ and zero", 0]);
link("isJnz", ["Decode 14", 3], ["JNZ and nonzero", 0]);
link("jzTaken", ["JZ and zero", 2], ["Jump or JZ", 1]);
link("anyJump", ["Jump or JZ", 2], ["Branch selected", 0]);
link("jnzTaken", ["JNZ and nonzero", 2], ["Branch selected", 1]);
link("branch", ["Branch selected", 2], ["Next PC", 2]);

// Keep 4-bit data buses above the components and 1-bit control buses below.
// Each pin receives its own vertical stem. Crossing stems stay separate because
// neither crossing has a junction; the horizontal lane joins each stem at a T.
const edges = new Map();
function segment(x1, y1, x2, y2, size) {
  if (x1 !== x2 && y1 !== y2) throw new Error("Diagonal wire");
  const o = x1 !== x2 ? "H" : "V";
  const start = o === "H" ? Math.min(x1, x2) : Math.min(y1, y2);
  const end = o === "H" ? Math.max(x1, x2) : Math.max(y1, y2);
  for (let p = start; p < end; p++) {
    const key = `${o}:${o === "H" ? p : x1},${o === "V" ? p : y1}`;
    const previous = edges.get(key);
    if (previous && previous[3] !== size) throw new Error(`Width conflict at ${key}`);
    edges.set(key, [o, o === "H" ? p : x1, o === "V" ? p : y1, size]);
  }
}
function routePin(point, lane) {
  const { px: x, py: y, dir, size, component } = point;
  const { w } = dimsOf(component);
  const index = pinsFor(component).findIndex((p) => p.px === x && p.py === y && p.name === point.name);
  let anchor;
  if (size === 4) {
    if (dir === "N") anchor = x;
    else if (dir === "S") {
      anchor = component.x - 10 - index * 2;
      const exit = component.y + 12 + index;
      segment(x, y, x, exit, size);
      segment(x, exit, anchor, exit, size);
    } else {
      anchor = dir === "W" ? component.x - 10 : component.x + w + 10;
      segment(x, y, anchor, y, size);
    }
    segment(anchor, dir === "N" ? y : dir === "S" ? component.y + 12 + index : y, anchor, lane, size);
  } else {
    if (dir === "S") {
      anchor = x;
      segment(x, y, anchor, lane, size);
    } else if (dir === "N") {
      const hasWideInput = pinsFor(component).some((p) => p.role === "in" && p.size === 4);
      anchor = hasWideInput || index % 2 ? component.x + w + 10 + index * 2 : component.x - 10 - index * 2;
      const exit = component.y - 5 - index;
      segment(x, y, x, exit, size);
      segment(x, exit, anchor, exit, size);
      segment(anchor, exit, anchor, lane, size);
    } else {
      anchor = dir === "W" ? component.x - 16 : component.x + w + 10;
      segment(x, y, anchor, y, size);
      segment(anchor, y, anchor, lane, size);
    }
  }
  return anchor;
}
let wideLane = -40, narrowLane = 50;
for (const [net, terminals] of connections) {
  if (terminals.length < 2) throw new Error(`${net} has no destination`);
  const size = terminals[0].size;
  if (terminals.some((p) => p.size !== size)) throw new Error(`${net} has mixed widths`);
  const lane = size === 4 ? wideLane -= 4 : narrowLane += 4;
  const anchors = terminals.map((point) => {
    if (point.component === imm) {
      segment(point.px, point.py, 130, point.py, 4);
      segment(130, point.py, 130, lane, 4);
      return 130;
    }
    if (point.component === op) {
      segment(point.px, point.py, 150, point.py, 4);
      segment(150, point.py, 150, lane, 4);
      return 150;
    }
    return routePin(point, lane);
  });
  segment(Math.min(...anchors), lane, Math.max(...anchors), lane, size);
}
// The 8-bit instruction is split into a low immediate and high opcode nibble.
segment(2, 3, 2, 12, 8);
segment(2, 12, -10, 12, 8);
segment(-10, 12, -10, -16, 8);
segment(-10, -16, 61, -16, 8);
segment(61, -16, 61, 0, 8);
for (let bit = 0; bit < 4; bit++) {
  const stem = 80 + bit * 4;
  segment(62, 1 + bit, stem, 1 + bit, 1);
  segment(stem, 1 + bit, stem, -9 + bit, 1);
  segment(stem, -9 + bit, 120, -9 + bit, 1);
  segment(62, 5 + bit, 140, 5 + bit, 1);
}

const isa = ["LDI", "ADD", "SUB", "AND", "OR", "XOR", "NOT", "NAND", "NOR", "INC", "DEC", "CLR", "JMP", "JZ", "JNZ", "HALT"]
  .map((name, opcode) => [6, 9, 10, 11, 15].includes(opcode)
    ? `${name} | op 7-6-5-4-3-2-1-0=${opcode.toString(2).padStart(4, "0")}0000`
    : `${name} | op 7-6-5-4=${opcode.toString(2).padStart(4, "0")} | ${opcode >= 12 ? "address" : "immediate"} 3-2-1-0`)
  .join("\n");
const source = `; Countdown loop, then a taken zero branch and a jump.
LDI 0 ; initialize accumulator
LDI 5
ADD 3
SUB 1
JNZ 3
OR 2
XOR 3
NOT
NAND 3
NOR 1
INC
AND 0
JZ 14
LDI 15 ; skipped by JZ
JMP 15
HALT`;
rom.data = assemble(source, 4, 8, isa);
const fields = (component) => [component.t, component.x, component.y, component.r,
  ...documentFields(component.t).map((field) => field === "order" ? Number(component.order === "descendant")
    : field === "format" ? 0 : component[field])];
const document = {
  components: components.map(fields), wires: [...edges.values()], junctions: [],
  monitor: [
    [components.indexOf(named.get("PC")), "hex", true],
    [components.indexOf(named.get("ACC")), "hex", true],
  ],
  program: {
    rom: components.indexOf(rom), pc: components.indexOf(named.get("PC address")),
    run: components.indexOf(named.get("Run clock")), step: components.indexOf(named.get("Step clock")),
    resetPc: components.indexOf(named.get("Reset PC")), resetRegisters: components.indexOf(named.get("Reset registers")),
    registers: [components.indexOf(named.get("ACC"))], offset: 0, format: "hex",
    isa: [[components.indexOf(rom), isa]],
    sources: [[components.indexOf(rom), captureProgramSource(source, rom.data, 4, 8, isa)]],
  },
};
const project = { format: "computer-architecture-project", version: 1, document,
  drafts: { rom: [], isa: [], assembly: [], breakpoints: [] } };
const parsed = parseProject(JSON.stringify(project));
writeFileSync(new URL("../public/examples/branching-computer.json", import.meta.url), serializeProject(parsed.board));
console.log(`Wrote branching-computer.json (${components.length} components, ${edges.size} wire edges)`);
