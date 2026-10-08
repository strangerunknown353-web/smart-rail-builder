import { BlockPermutation, ItemStack } from "@minecraft/server";
import { RAIL_ITEM_ID_SET } from "../config/RailConfig.js";
import { HAZARD_BLOCK_ID_SET } from "../config/HazardRegistry.js";
import { UNBREAKABLE_BLOCK_ID_SET } from "../config/UnbreakableBlockRegistry.js";
import { Logger } from "../utils/Logger.js";

/**
 * InventoryManager.js
 *
 * PURPOSE
 *   Reads a player's inventory and reports what it finds — counts, slots,
 *   whether that's enough for a given requirement. Mirrors
 *   terrain/TerrainScanner.js's role exactly: this class only reads and
 *   reports facts, it never decides whether a build should proceed (that's
 *   inventory/ResourceValidator.js's job, mirroring PathValidator).
 *   `deductRailItems` (implemented Project Prompt 10) is the one exception
 *   to "never modifies inventory" — see its own doc below for the safety
 *   contract it follows.
 *
 * RESPONSIBILITIES
 *   - Count how many of a given rail item a player currently holds, across
 *     every inventory slot (`countRailItems`).
 *   - Produce a complete InventoryReport for a required quantity
 *     (`buildReport`) — the primary interface future stages/tests use.
 *   - Answer "does this player have at least N of this item" without
 *     necessarily scanning every slot (`hasAtLeast`, Project Prompt 23) —
 *     the cheap, still-live check every per-block placement loop's
 *     "do I still have enough for THIS block" re-check actually needs.
 *   - Remove exactly N matching items from inventory, only when explicitly
 *     asked (`deductRailItems`) — never as a side effect of reading.
 *   - List the player's currently-held placeable blocks (`scanPlaceableMaterials`,
 *     added in the bugfix pass before Project Prompt 18) — for Bridge
 *     Mode's material-selection UI. See that method's own doc for the
 *     "is this a placeable block" determination.
 *
 * WHY READS ARE NEVER CACHED (Project Prompt 8's SECURITY requirement)
 *   Every call to `buildReport`/`countRailItems`/`hasAtLeast` re-reads the
 *   live container. Nothing is cached across calls, because inventory can
 *   change at any time — while a menu is open, between pipeline stages, or
 *   between ticks during a multi-tick build. See ARCHITECTURE.md §23.5/§29
 *   ("Known API Risks") for the full reasoning. `hasAtLeast` (Project Prompt
 *   23) still reads live every call — it only changes HOW MUCH of the
 *   container it reads (early exit once the threshold is certain), never
 *   WHETHER it reads live, so this guarantee is unchanged, not weakened.
 *
 * DEPENDENCIES
 *   - utils/Logger.js
 *   - None beyond the live `player` object passed in by the caller.
 */

/**
 * @typedef {Object} InventorySlotInfo
 * @property {number} slot Zero-based slot index within the player's inventory container.
 * @property {number} amount
 */

/**
 * @typedef {Object} InventoryReport
 * @property {string} railTypeId
 * @property {number} totalAvailable Summed across every matching slot.
 * @property {number} requiredQuantity
 * @property {boolean} hasEnough
 * @property {number} missingQuantity max(0, requiredQuantity - totalAvailable).
 * @property {ReadonlyArray<InventorySlotInfo>} slots Every slot containing a matching item.
 * @property {unknown} [futureMetadata] Reserved — e.g. future support-block/fuel-item counts
 *   would extend this report rather than requiring a second report type.
 */

/**
 * @typedef {Object} PlaceableMaterialOption
 *   One distinct block type currently in the player's inventory, offered
 *   as a Bridge Mode material choice — see `scanPlaceableMaterials()`.
 * @property {string} typeId Vanilla item/block type ID.
 * @property {number} totalAvailable Summed across every matching slot — informational only; the player never enters a quantity, see ui/BuildMenu.js's `promptForBridgeMaterial()`.
 */

// v2.0.0 optimizations. Every Container.getItem() call crosses into the
// engine and copies an ItemStack, and a build used to scan the whole
// inventory (up to 36 slots) twice per placed block — once to check, once
// to deduct. Two module-level caches (InventoryManager instances are
// stateless and several exist, so the caches are shared):
//   - _slotHints: per player + item, the slot that last held that item.
//     hasAtLeast()/deductRailItems() look there first; it's only ever a
//     starting point (re-checked every time), so a stale hint just falls
//     back to the normal full scan.
//   - _placeableCache: whether BlockPermutation.resolve() accepts a typeId.
//     The answer never changes during a world session, and resolve() THROWS
//     for non-blocks, so caching avoids repeated exceptions every time the
//     bridge material screen opens.
const _slotHints = new Map();
const _placeableCache = new Map();

function hintKey(player, typeId) {
  return `${player.id}|${typeId}`;
}

export class InventoryManager {
  /**
   * @param {import("@minecraft/server").Player} player
   * @param {string} railTypeId Vanilla item type ID, see config/RailConfig.js.
   * @returns {number} Total matching items across all inventory slots.
   */
  countRailItems(player, railTypeId) {
    return this._scanSlots(player, railTypeId).totalAvailable;
  }

  /**
   * Added Project Prompt 23 (performance pass). Every per-block placement
   * loop (StraightRailStrategy, BridgeExecutionStrategy,
   * UndergroundExecutionStrategy) re-checks "do I still have at least one
   * of this item" before every single block — a genuine, necessary live
   * safety re-check (see those files' own "WHY EVERY BLOCK IS RE-VERIFIED"
   * docs), not something to cache or skip. But every one of those call sites
   * only ever needed a yes/no threshold answer, not the exact total — and
   * `countRailItems()` (via `_scanSlots()`) always sums across EVERY slot in
   * the container regardless, even after the answer is already certain.
   * This method answers the exact same live question with an early exit the
   * moment the threshold is met, typically well before the container's last
   * slot — same live-read guarantee (never cached, never stale), less
   * iteration in the common case. `countRailItems()`/`buildReport()` are
   * unchanged and still the right calls wherever the exact total is actually
   * needed (InventoryStage, BuildPlanStage, deduction accounting).
   * @param {import("@minecraft/server").Player} player
   * @param {string} typeId
   * @param {number} minimumAmount
   * @returns {boolean}
   */
  hasAtLeast(player, typeId, minimumAmount) {
    const inventory = player.getComponent("minecraft:inventory");
    const container = inventory?.container;
    if (!container) return false;

    const key = hintKey(player, typeId);
    const hint = _slotHints.get(key);
    if (hint !== undefined && hint < container.size) {
      const hinted = container.getItem(hint);
      if (hinted && hinted.typeId === typeId && hinted.amount >= minimumAmount) return true;
    }

    let total = 0;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item && item.typeId === typeId) {
        _slotHints.set(key, slot);
        total += item.amount;
        if (total >= minimumAmount) return true;
      }
    }
    return false;
  }

  /**
   * Lists every DISTINCT placeable-block item currently in the player's
   * inventory — added in the bugfix pass before Project Prompt 18 for
   * Bridge Mode's material-selection UI ("the player must be able to
   * choose the block used... show the player's currently available
   * placeable blocks").
   *
   * "IS THIS A PLACEABLE BLOCK" DETERMINATION
   *   No `ItemStack`/`ItemType` property in the targeted stable
   *   `@minecraft/server` API directly answers "is this item a block."
   *   Rather than hand-maintain a list of every placeable vanilla item
   *   (unmaintainable, and would drift from whatever version of Minecraft
   *   this addon actually runs against), this method PROBES the real API
   *   it already depends on everywhere else: `BlockPermutation.resolve(typeId)`
   *   throws for a type ID that isn't a valid block, and succeeds
   *   otherwise — the exact same call every execution strategy already
   *   uses to place a block. A candidate item is treated as placeable if
   *   and only if that call succeeds. This is a confirmed, already-relied-
   *   upon API behavior, not a new assumption — see ARCHITECTURE.md §46.9
   *   for the one genuinely open question it leaves (icon texture paths).
   *
   * EXCLUDED EVEN IF THE PROBE ABOVE SUCCEEDS
   *   - Any of the 4 rail types (`RAIL_ITEM_ID_SET`) — building a bridge
   *     deck out of rails makes no sense and would conflict with this
   *     addon's own rail-placement/crossing logic.
   *   - Anything on `HAZARD_BLOCK_ID_SET`/`UNBREAKABLE_BLOCK_ID_SET` — a
   *     bridge built from fire or bedrock isn't a real, usable choice.
   *
   * Deduplicates by type ID (a player might have the same block across
   * many stacks/slots) and sums the total across all of them, purely for
   * display — the player never enters a quantity; the addon calculates
   * exactly how many are needed once a material is chosen.
   *
   * @param {import("@minecraft/server").Player} player
   * @returns {ReadonlyArray<PlaceableMaterialOption>} Ordered by descending totalAvailable — the player's most-plentiful materials first.
   */
  scanPlaceableMaterials(player) {
    const inventory = player.getComponent("minecraft:inventory");
    const container = inventory?.container;
    if (!container) return [];

    const totals = new Map();

    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (!item) continue;
      const typeId = item.typeId;

      if (RAIL_ITEM_ID_SET.has(typeId) || HAZARD_BLOCK_ID_SET.has(typeId) || UNBREAKABLE_BLOCK_ID_SET.has(typeId)) {
        continue;
      }
      if (!totals.has(typeId)) {
        if (!this._isPlaceableBlock(typeId)) continue;
        totals.set(typeId, 0);
      }
      totals.set(typeId, totals.get(typeId) + item.amount);
    }

    return Array.from(totals.entries())
      .map(([typeId, totalAvailable]) => ({ typeId, totalAvailable }))
      .sort((a, b) => b.totalAvailable - a.totalAvailable);
  }

  /**
   * @param {string} typeId
   * @returns {boolean}
   * @private
   */
  _isPlaceableBlock(typeId) {
    const cached = _placeableCache.get(typeId);
    if (cached !== undefined) return cached;
    let placeable;
    try {
      BlockPermutation.resolve(typeId);
      placeable = true;
    } catch (error) {
      placeable = false;
    }
    _placeableCache.set(typeId, placeable);
    return placeable;
  }

  /**
   * @param {import("@minecraft/server").Player} player
   * @param {string} railTypeId
   * @param {number} requiredQuantity
   * @returns {InventoryReport}
   */
  buildReport(player, railTypeId, requiredQuantity) {
    const { totalAvailable, slots } = this._scanSlots(player, railTypeId);
    const missingQuantity = Math.max(0, requiredQuantity - totalAvailable);

    return {
      railTypeId,
      totalAvailable,
      requiredQuantity,
      hasEnough: totalAvailable >= requiredQuantity,
      missingQuantity,
      slots,
      futureMetadata: undefined,
    };
  }

  /**
   * Removes exactly `amount` of the given rail item from the player's
   * inventory, across as many slots as needed. No-op is the CALLER's
   * responsibility to enforce for Creative Mode — this method always
   * removes if asked, matching Container's own behavior; StraightRailStrategy
   * is what decides not to call this in Creative Mode.
   *
   * SAFETY CONTRACT: must only be called for blocks that have already been
   * confirmed placed (see PlacementStage / StraightRailStrategy — deduction
   * always happens strictly after a successful `block.setPermutation()`
   * call, never before). Removes from the first matching slot(s) found;
   * fully empties a slot via `container.setItem(slot)` (undefined clears a
   * slot — confirmed via Container.setItem's documented optional
   * `itemStack` parameter) rather than attempting to set `amount = 0`,
   * which the API rejects (valid range is 1-255).
   *
   * If fewer than `amount` matching items are found across the whole
   * container (should not happen if the caller re-verified availability
   * immediately beforehand, per this class's "never cache" principle), logs
   * an error rather than throwing or silently under-reporting — this is a
   * genuine anomaly, not an expected condition.
   *
   * @param {import("@minecraft/server").Player} player
   * @param {string} railTypeId
   * @param {number} amount
   * @returns {void}
   */
  deductRailItems(player, railTypeId, amount) {
    const inventory = player.getComponent("minecraft:inventory");
    const container = inventory?.container;
    if (!container) {
      Logger.error(`deductRailItems: no inventory container for ${player.name} — could not remove ${amount} of ${railTypeId}.`);
      return;
    }

    let remaining = amount;
    const key = hintKey(player, railTypeId);
    const hint = _slotHints.get(key);
    const takeFrom = (slot) => {
      const item = container.getItem(slot);
      if (!item || item.typeId !== railTypeId) return;

      const takeFromThisSlot = Math.min(item.amount, remaining);
      if (takeFromThisSlot >= item.amount) {
        container.setItem(slot); // fully consumes this stack - clears the slot
        if (_slotHints.get(key) === slot) _slotHints.delete(key);
      } else {
        item.amount -= takeFromThisSlot;
        container.setItem(slot, item); // write the modified copy back
        _slotHints.set(key, slot);
      }
      remaining -= takeFromThisSlot;
    };
    // v2.0.0: the hinted slot first (usually the only one touched), then the rest in order.
    if (hint !== undefined && hint < container.size) takeFrom(hint);
    for (let slot = 0; slot < container.size && remaining > 0; slot++) {
      if (slot !== hint) takeFrom(slot);
    }

    if (remaining > 0) {
      Logger.error(
        `deductRailItems: expected to remove ${amount} of ${railTypeId} from ${player.name} but was ` +
          `${remaining} short — inventory changed unexpectedly between verification and deduction.`
      );
    }
  }

  /**
   * v2.0.0 (Undo refunds): gives `amount` of `typeId` back to the player,
   * split into stacks of the item's max stack size. Anything that doesn't
   * fit in the inventory is dropped at the player's feet so nothing is lost.
   *
   * @param {import("@minecraft/server").Player} player
   * @param {string} typeId
   * @param {number} amount
   * @returns {number} How many items were given (inventory + dropped).
   */
  giveItems(player, typeId, amount) {
    const container = player.getComponent("minecraft:inventory")?.container;
    let given = 0;
    try {
      const maxStack = new ItemStack(typeId, 1).maxAmount || 64;
      let remaining = amount;
      while (remaining > 0) {
        const count = Math.min(remaining, maxStack);
        const stack = new ItemStack(typeId, count);
        const leftover = container ? container.addItem(stack) : stack;
        if (leftover) {
          player.dimension.spawnItem(leftover, player.location);
        }
        remaining -= count;
        given += count;
      }
    } catch (error) {
      Logger.error(`giveItems: failed to return ${amount} of ${typeId} to ${player.name} (${given} given).`, error);
    }
    return given;
  }

  /**
   * The single place that actually iterates the inventory container.
   * `countRailItems` and `buildReport` both call this rather than
   * duplicating the scan loop.
   *
   * Deliberately does NOT catch errors from `container.getItem()` (which
   * the API documents as throwing if the container becomes invalid, e.g. a
   * player disconnecting mid-read) — an unrecognized failure here is a
   * genuinely unexpected condition, not a normal "empty inventory" case,
   * and should propagate to BuildPipeline's existing error handling
   * (converted to UNEXPECTED_ERROR) rather than this method silently
   * reporting "0 available," which would incorrectly present as "not
   * enough rails" instead of the real cause. See ARCHITECTURE.md §23.5.
   *
   * @param {import("@minecraft/server").Player} player
   * @param {string} railTypeId
   * @returns {{totalAvailable: number, slots: InventorySlotInfo[]}}
   * @private
   */
  _scanSlots(player, railTypeId) {
    const inventory = player.getComponent("minecraft:inventory");
    const container = inventory?.container;

    const slots = [];
    let totalAvailable = 0;

    if (container) {
      for (let slot = 0; slot < container.size; slot++) {
        const item = container.getItem(slot);
        if (item && item.typeId === railTypeId) {
          slots.push({ slot, amount: item.amount });
          totalAvailable += item.amount;
        }
      }
    }

    return { totalAvailable, slots };
  }
}
