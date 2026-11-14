import { DEFAULT_CLOCK_FREQUENCY } from "../core/components.js";
import { clocksInBoard } from "../core/model.js";

/** Keeps one interval per enabled clock on the current board. */
export function createClockTimers({ getEditor, getState }) {
  const timers = new Map();
  let timerBoard = null;

  return {
    sync() {
      const state = getState();
      if (timerBoard !== state) {
        for (const { interval } of timers.values()) clearInterval(interval);
        timers.clear();
        timerBoard = state;
      }
      const clocks = new Map([...clocksInBoard(state)]
        .filter(([, component]) => component.enable !== false)
        .map(([id, component]) => [id, component.frequency ?? DEFAULT_CLOCK_FREQUENCY]));
      for (const [id, timer] of timers) {
        if (clocks.get(id) === timer.frequency) continue;
        clearInterval(timer.interval);
        timers.delete(id);
      }
      for (const [id, frequency] of clocks) {
        if (timers.has(id)) continue;
        const interval = setInterval(() => getEditor().tickClock(id), 500 / frequency);
        timers.set(id, { frequency, interval });
      }
    },
  };
}
