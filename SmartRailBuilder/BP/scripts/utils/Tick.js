/**
 * Tick.js
 *
 * v2.0.0: the current game tick, or undefined when it can't be read (e.g.
 * the test mock of @minecraft/server, or an engine that doesn't expose it).
 * Callers must treat undefined as "unknown" and take their safe path.
 */

import { system } from "@minecraft/server";

/** @returns {number|undefined} */
export function currentTick() {
  try {
    const tick = system.currentTick;
    return typeof tick === "number" ? tick : undefined;
  } catch {
    return undefined;
  }
}
