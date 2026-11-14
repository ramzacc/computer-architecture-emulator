// Characterizes public/core behaviour on the committed example projects.
// The snapshot is generated once from the pre-refactor implementation; keep
// it stable unless a behaviour change is intentional and documented.
// Regenerate with: UPDATE_SNAPSHOTS=1 npm test
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseProject } from "../public/core/project-file.js";
import {
  addComponent, addWireEdge, circuitIssue, clocksInBoard, createBoard, edgeKey, evaluateBoard,
  parseDocument, serialize,
} from "../public/core/model.js";
import { BoardEditor } from "../public/core/editor.js";

const ROOT = new URL("../", import.meta.url);
const SNAPSHOT_URL = new URL("./snapshots/characterization.json", import.meta.url);
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";
const TICKS = 40;

const PROJECT_FILES = [
  "public/demo-computer.json",
  "examples/8-bit-computer.json",
  "examples/branching-computer.json",
  "examples/odd-even-sorter.json",
];
const DOCUMENT_FILES = ["fixtures/portal-bus.json", "fixtures/register-wrappers.json"];

const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedMap = (map) => [...map].map(([key, value]) => [key, value]).sort(([a], [b]) => byKey(a, b));

function loadBoard(file, kind) {
  const text = readFileSync(new URL(file, ROOT), "utf8");
  return kind === "project" ? parseProject(text).board : parseDocument(text).board;
}

function compactState(state) {
  return { value: state.value, inputs: state.inputs, outputs: state.outputs, lit: state.lit };
}

function evaluationSummary(board) {
  const { nets, states, settled, portalWidthMismatch } = evaluateBoard(board);
  return {
    settled,
    portalWidthMismatch,
    nets: [...nets.values()]
      .map((net) => ({ id: net.id, size: net.size, value: net.value, edges: net.edges.length }))
      .sort((a, b) => byKey(a.id, b.id)),
    states: Object.fromEntries([...states].map(([id, state]) => [id, compactState(state)])),
  };
}

// Drive the circuit the way the UI does: enable every clock, pulse every
// top-level button, then alternate each clock 40 times round-robin.
function driveTrace(board) {
  const editor = new BoardEditor();
  editor.replaceBoard(board, { save: false });
  const clocks = [...clocksInBoard(editor.board)];
  const buttons = editor.board.components.filter((component) => component.t === "button");
  const sample = (action, ok) => ({
    action,
    ok,
    registers: sortedMap(editor.registerValues),
    rams: sortedMap(editor.ramValues).map(([id, words]) => [id, sortedMap(words)]),
    tags: Object.fromEntries([...editor.evaluation.states]
      .filter(([id]) => editor.component(id)?.t === "tag")
      .sort(([a], [b]) => byKey(a, b))
      .map(([id, state]) => [id, compactState(state)])),
  });
  const trace = [sample("load", true)];
  for (const [id, clock] of clocks) {
    if (clock.enable === false) trace.push(sample(`enable:${id}`, editor.setClockEnabled(id, true)));
  }
  for (const button of buttons) {
    trace.push(sample(`press:${button.id}`, editor.setButtonPressed(button.id, true)));
    trace.push(sample(`release:${button.id}`, editor.setButtonPressed(button.id, false)));
  }
  for (let index = 0; index < TICKS && clocks.length; index++) {
    const [id] = clocks[index % clocks.length];
    trace.push(sample(`tick:${index}:${id}`, editor.tickClock(id)));
  }
  return trace;
}

function issueSnapshot() {
  const highLow = createBoard();
  addComponent(highLow, { id: "low", t: "constant", x: -1, y: 1, value: 0, r: 2 });
  addComponent(highLow, { id: "high", t: "constant", x: 3, y: 1, value: 1, r: 2 });
  for (const edge of [
    { o: "V", x: 1, y: 2 }, { o: "V", x: 5, y: 2 },
    { o: "H", x: 1, y: 3 }, { o: "H", x: 2, y: 3 }, { o: "H", x: 3, y: 3 },
  ]) addWireEdge(highLow, edge);
  highLow.wires.set("H:4,3", { o: "H", x: 4, y: 3 });

  const loop = createBoard();
  addComponent(loop, { id: "inverter", t: "not", x: 0, y: 0 });
  for (const edge of [
    { o: "V", x: 1, y: -1 }, { o: "H", x: 1, y: -1 }, { o: "H", x: 2, y: -1 },
    { o: "V", x: 3, y: -1 }, { o: "V", x: 3, y: 0 }, { o: "V", x: 3, y: 1 },
    { o: "H", x: 2, y: 2 }, { o: "H", x: 1, y: 2 },
  ]) loop.wires.set(edgeKey(edge), edge);

  const mismatch = createBoard();
  addComponent(mismatch, { id: "a", t: "portal", x: 0, y: 0, size: 4, label: "BUS" });
  addComponent(mismatch, { id: "b", t: "portal", x: 8, y: 0, size: 8, label: "BUS" });
  mismatch.wires.set("H:-1,1", { o: "H", x: -1, y: 1, size: 4 });
  mismatch.wires.set("H:7,1", { o: "H", x: 7, y: 1, size: 8 });

  const pick = (issue) => issue && {
    message: issue.message, componentIds: issue.componentIds, wireKeys: issue.wireKeys,
  };
  return {
    highLow: pick(circuitIssue(highLow)),
    feedbackLoop: pick(circuitIssue(loop)),
    portalMismatch: pick(circuitIssue(mismatch)),
  };
}

let builtSnapshot;
function buildSnapshot() {
  if (builtSnapshot) return builtSnapshot;
  const snapshot = { documents: {}, evaluations: {}, traces: {}, issues: issueSnapshot() };
  for (const [files, kind] of [[PROJECT_FILES, "project"], [DOCUMENT_FILES, "document"]]) {
    for (const file of files) {
      const board = loadBoard(file, kind);
      snapshot.documents[file] = serialize(board);
      snapshot.evaluations[file] = evaluationSummary(board);
      // Driving the editor mutates the board, so do it after the snapshots above.
      snapshot.traces[file] = driveTrace(board);
    }
  }
  if (UPDATE) {
    mkdirSync(new URL("./snapshots/", import.meta.url), { recursive: true });
    writeFileSync(SNAPSHOT_URL, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  builtSnapshot = snapshot;
  return snapshot;
}

for (const section of ["documents", "evaluations", "traces", "issues"]) {
  test(`characterization: ${section} match the committed snapshot`, () => {
    const actual = buildSnapshot()[section];
    const expected = JSON.parse(readFileSync(SNAPSHOT_URL, "utf8"))[section];
    assert.deepEqual(actual, expected);
    if (section === "documents") {
      for (const file of Object.keys(expected)) {
        assert.equal(actual[file], expected[file], `${file} no longer serializes byte-for-byte`);
      }
    }
  });
}
