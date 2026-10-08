/**
 * BuildJournal.js
 *
 * PURPOSE (v2.0.0, Project Step 2 — Undo)
 *   Records every block a single build changes, in order, so the build can
 *   be undone later (see core/UndoService.js). One journal per BuildSession
 *   (`session.journal`); once placement ends PlacementStage hands it to
 *   core/BuildHistory.js as that player's "last build".
 *
 * WHAT AN ENTRY HOLDS
 *   - `position`            where the change happened
 *   - `previousPermutation` the block's permutation BEFORE the write — the
 *                           exact object undo passes back to setPermutation()
 *   - `placedTypeId`        the block's typeId AFTER the write; undo only
 *                           restores a position that still holds this, so a
 *                           block the player has since broken or replaced is
 *                           never overwritten
 *   - `refundItemId`        the item deducted for this write (Survival rails
 *                           and bridge material), or undefined if nothing was
 *                           paid (Creative, excavation, waterproof seals)
 *
 * WHY `write()` PERFORMS THE WRITE ITSELF
 *   Capturing "before" and "after" around the one setPermutation() call in
 *   one place means a failed write (it throws) never leaves a journal entry
 *   behind, and no call site can forget either half. Call sites use the
 *   `writeBlock()` helper, which falls back to a plain setPermutation() when
 *   no journal is passed (every pre-v2 caller/test that doesn't pass one).
 */

export class BuildJournal {
  /**
   * @param {import("@minecraft/server").Dimension} dimension The dimension every entry belongs to.
   */
  constructor(dimension) {
    this.dimension = dimension;
    /** @private @type {Array<{position: {x:number,y:number,z:number}, previousPermutation: any, placedTypeId: string, refundItemId?: string}>} */
    this._entries = [];
  }

  /** @returns {number} */
  get size() {
    return this._entries.length;
  }

  /**
   * @param {import("@minecraft/server").Block} block
   * @param {{x:number,y:number,z:number}} position
   * @param {import("@minecraft/server").BlockPermutation} permutation
   * @param {string} [refundItemId]
   */
  write(block, position, permutation, refundItemId) {
    const previousPermutation = block.permutation;
    block.setPermutation(permutation); // throws -> no entry recorded
    this._entries.push({
      position: { x: position.x, y: position.y, z: position.z },
      previousPermutation,
      placedTypeId: block.typeId,
      refundItemId,
    });
  }

  /** @returns {ReadonlyArray<{position: {x:number,y:number,z:number}, previousPermutation: any, placedTypeId: string, refundItemId?: string}>} newest first — the order undo must replay in. */
  entriesNewestFirst() {
    return this._entries.slice().reverse();
  }
}

/**
 * Writes `permutation` into `block`, journaling it when a journal is given.
 *
 * @param {import("@minecraft/server").Block} block
 * @param {{x:number,y:number,z:number}} position
 * @param {import("@minecraft/server").BlockPermutation} permutation
 * @param {BuildJournal|undefined} journal
 * @param {string} [refundItemId]
 */
export function writeBlock(block, position, permutation, journal, refundItemId) {
  if (journal) {
    journal.write(block, position, permutation, refundItemId);
  } else {
    block.setPermutation(permutation);
  }
}
