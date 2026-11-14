// Public board model API. The implementation lives in focused modules; this
// barrel keeps the original "./model.js" import path stable for the UI and
// tests.
export {
  addComponent, createBoard, edgeKey, edgePoints, isValidComponent, labelAvailable, nextLabel, wireSize,
} from "./board.js";
export {
  addWireEdge, crossingAt, edgePlacementError, pruneJunctions, sanitizeWires, wireLayoutError, wireRoute,
} from "./wiring.js";
export {
  buttonsInBoard, clocksInBoard, evaluateBoard, netContaining, resizeNet, storedInBoard,
} from "./simulate.js";
export { circuitIssue, shortCircuitError } from "./issues.js";
export { parseDocument, serialize } from "./document.js";
