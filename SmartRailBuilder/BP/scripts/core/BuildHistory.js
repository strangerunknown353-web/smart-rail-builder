/**
 * BuildHistory.js
 *
 * PURPOSE (v2.0.0, Project Step 2 — Undo)
 *   Remembers each player's most recent build journal (core/BuildJournal.js)
 *   so core/UndoService.js can roll it back. One level deep by design: a new
 *   build replaces the previous one, and undoing consumes it.
 *
 *   In memory only — block permutations can't be serialized into a dynamic
 *   property, so the undo slot is cleared when the world is closed or
 *   reloaded. Partial builds (cancelled, ran out of rails, terrain changed)
 *   are recorded too: whatever was actually placed can be undone.
 */

export class BuildHistory {
  constructor() {
    /** @private @type {Map<string, import("./BuildJournal.js").BuildJournal>} */
    this._lastByPlayerId = new Map();
  }

  /**
   * @param {string} playerId
   * @param {import("./BuildJournal.js").BuildJournal|undefined} journal Ignored when empty — a build that changed nothing leaves the previous undo slot alone.
   */
  record(playerId, journal) {
    if (!journal || journal.size === 0) return;
    this._lastByPlayerId.set(playerId, journal);
  }

  /** @param {string} playerId */
  has(playerId) {
    return this._lastByPlayerId.has(playerId);
  }

  /**
   * Removes and returns the player's last journal.
   * @param {string} playerId
   * @returns {import("./BuildJournal.js").BuildJournal|undefined}
   */
  take(playerId) {
    const journal = this._lastByPlayerId.get(playerId);
    this._lastByPlayerId.delete(playerId);
    return journal;
  }
}
