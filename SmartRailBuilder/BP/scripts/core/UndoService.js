/**
 * UndoService.js
 *
 * PURPOSE (v2.0.0, Project Step 2 — Undo last build)
 *   Rolls back a player's most recent build (core/BuildHistory.js) by
 *   replaying its journal (core/BuildJournal.js) newest-first, putting each
 *   block's previous permutation back.
 *
 * SAFETY RULES
 *   - A position is restored only if it still holds exactly the block type
 *     the build placed there. Anything the player (or anyone else) changed
 *     since — a rail they broke, a block they put in a dug-out tunnel — is
 *     left alone and counted as "skipped".
 *   - Items are refunded only for positions actually restored, and only for
 *     writes that cost an item in the first place (Survival rails / bridge
 *     material). Breaking a rail by hand already gave that rail back, so a
 *     skipped position is never refunded twice.
 *   - Unloaded/out-of-world positions are skipped, never thrown on.
 *   - Spread across ticks with system.runJob, like placement itself.
 *   - One level, consumed on use: undoing twice in a row does nothing the
 *     second time.
 */

import { system } from "@minecraft/server";
import { LocalizationKeys } from "../localization/LocalizationKeys.js";
import { readBlock } from "../utils/BlockReader.js";
import { Logger } from "../utils/Logger.js";

/** Restores per tick before yielding (each restore is one block write). */
const RESTORES_PER_TICK = 32;

export class UndoService {
  /**
   * @param {import("./BuildHistory.js").BuildHistory} buildHistory
   * @param {import("../inventory/InventoryManager.js").InventoryManager} inventoryManager
   * @param {import("../ui/MessageService.js").MessageService} messageService
   */
  constructor(buildHistory, inventoryManager, messageService) {
    this._buildHistory = buildHistory;
    this._inventoryManager = inventoryManager;
    this._messageService = messageService;
  }

  /** @param {import("@minecraft/server").Player} player */
  canUndo(player) {
    return this._buildHistory.has(player.id);
  }

  /**
   * @param {import("@minecraft/server").Player} player
   * @returns {Promise<{undone: boolean, restored: number, skipped: number, refunded: number}>}
   */
  async undoLast(player) {
    const journal = this._buildHistory.take(player.id);
    if (!journal) {
      this._messageService.sendChat(player, LocalizationKeys.UNDO_NOTHING);
      return { undone: false, restored: 0, skipped: 0, refunded: 0 };
    }

    const { restored, skipped, refunds } = await this._replay(journal);

    let refunded = 0;
    for (const [itemId, count] of refunds) {
      refunded += this._inventoryManager.giveItems(player, itemId, count);
    }

    Logger.info(`Undo for ${player.name}: restored=${restored}, skipped=${skipped}, refunded=${refunded}.`);
    this._messageService.sendChat(player, LocalizationKeys.UNDO_COMPLETE, [restored, refunded]);
    if (skipped > 0) {
      this._messageService.sendChat(player, LocalizationKeys.UNDO_SKIPPED, [skipped]);
    }
    return { undone: true, restored, skipped, refunded };
  }

  /**
   * @param {import("./BuildJournal.js").BuildJournal} journal
   * @returns {Promise<{restored: number, skipped: number, refunds: Map<string, number>}>}
   * @private
   */
  _replay(journal) {
    const totals = { restored: 0, skipped: 0, refunds: new Map() };
    const entries = journal.entriesNewestFirst();

    function* restoreAll() {
      let sinceYield = 0;
      for (const entry of entries) {
        let read;
        try {
          read = readBlock(journal.dimension, entry.position);
        } catch (error) {
          read = { status: "ERROR" };
        }
        if (read.status !== "OK" || read.block.typeId !== entry.placedTypeId) {
          totals.skipped += 1;
        } else {
          try {
            read.block.setPermutation(entry.previousPermutation);
            totals.restored += 1;
            if (entry.refundItemId) {
              totals.refunds.set(entry.refundItemId, (totals.refunds.get(entry.refundItemId) ?? 0) + 1);
            }
          } catch (error) {
            Logger.warn(`Undo: could not restore ${entry.position.x},${entry.position.y},${entry.position.z}`, error);
            totals.skipped += 1;
          }
        }
        if (++sinceYield >= RESTORES_PER_TICK) {
          sinceYield = 0;
          yield;
        }
      }
    }

    return new Promise((resolve, reject) => {
      function* driver() {
        try {
          yield* restoreAll();
          resolve(totals);
        } catch (error) {
          reject(error);
        }
      }
      system.runJob(driver());
    });
  }
}
