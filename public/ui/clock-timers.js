import { DEFAULT_CLOCK_FREQUENCY } from "../core/components.js";
import { clocksInBoard } from "../core/model.js";
import { ctx } from "./context.js";

const timers = new Map();
let timerBoard = null;

/** Keeps one interval per enabled clock on the current board. */
export function syncClockTimers() {
  if (timerBoard !== ctx.board) {
    for (const { interval } of timers.values()) clearInterval(interval);
    timers.clear();
    timerBoard = ctx.board;
  }
  const clocks = new Map([...clocksInBoard(ctx.board)]
    .filter(([, component]) => component.enable !== false)
    .map(([id, component]) => [id, component.frequency ?? DEFAULT_CLOCK_FREQUENCY]));
  for (const [id, timer] of timers) {
    if (clocks.get(id) === timer.frequency) continue;
    clearInterval(timer.interval);
    timers.delete(id);
  }
  for (const [id, frequency] of clocks) {
    if (timers.has(id)) continue;
    const interval = setInterval(() => ctx.editor.tickClock(id), 500 / frequency);
    timers.set(id, { frequency, interval });
  }
}
