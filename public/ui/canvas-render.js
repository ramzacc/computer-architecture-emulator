import { byId } from "./dom.js";
import { ctx } from "./context.js";
import { createRenderer } from "./renderer.js";

/** The one renderer instance; other modules import these functions directly. */
const renderer = createRenderer(
  byId("grid"),
  () => ctx.board,
  () => ctx.editor.evaluation,
  () => ctx.selectedIds,
  () => ctx.selectedWires,
  () => ctx.activeIssue,
);

export const { componentArt, renderComponents, renderPins, renderWires, edgeBox, applyBox } = renderer;
