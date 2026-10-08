import { BlockPermutation } from "@minecraft/server";
import { UNBREAKABLE_BLOCK_ID_SET } from "../config/UnbreakableBlockRegistry.js";
import { HAZARD_BLOCK_ID_SET } from "../config/HazardRegistry.js";
import { readBlock } from "../utils/BlockReader.js";
import { writeBlock } from "../core/BuildJournal.js";

/**
 * BridgeSupportBuilder.js
 *
 * PURPOSE
 *   "Bridge support/surface execution," Roadmap Phase 16 (Project Prompt
 *   16) — the only class that actually places a support or surface block
 *   for a bridge. Mirrors builder/TunnelExcavator.js's shape deliberately:
 *   that file's own header predicted exactly this ("Bridge support...
 *   will need its own placement-time helper alongside this one, following
 *   the same small, focused, called per-block by the existing strategy
 *   shape rather than a new parallel strategy class"). Used by
 *   BridgeExecutionStrategy (not RailBuilder directly), the same
 *   relationship TunnelExcavator has with StraightRailStrategy.
 *
 * WHY THIS RE-CHECKS SAFETY ITSELF, NOT JUST TRUSTING THE PLAN
 *   `TerrainScanner.planBridge()` already confirmed every fill position
 *   was air/liquid/replaceable (never unbreakable or hazardous) — but
 *   potentially many ticks before this method actually runs, since
 *   placement is spread across ticks. Same "state can change mid-build"
 *   principle already applied to terrain (TunnelExcavator), inventory, and
 *   rails (StraightRailStrategy) — deliberately narrow, not a full re-plan.
 *
 * DEPENDENCIES
 *   - config/UnbreakableBlockRegistry.js
 *   - config/HazardRegistry.js
 *   - utils/BlockReader.js
 *   - @minecraft/server (BlockPermutation)
 */

/**
 * @typedef {Object} SupportPlacementResult
 * @property {boolean} success
 * @property {string} [reason] One of "UNBREAKABLE", "HAZARD", "UNLOADED". Present only if !success.
 */

export class BridgeSupportBuilder {
  /**
   * @param {import("@minecraft/server").Dimension} dimension
   * @param {{x: number, y: number, z: number}} position
   * @param {{journal?: import("../core/BuildJournal.js").BuildJournal, refundItemId?: string}} [options] v2.0.0 — undo journaling; refundItemId is the item deducted for this block (Survival only).
   * @param {string} materialId Vanilla block type ID — the player's chosen bridge material, see core/BuildSession.js's `bridgeMaterialId`.
   * @returns {SupportPlacementResult}
   */
  placeBlock(dimension, position, materialId, { journal, refundItemId } = {}) {
    const read = readBlock(dimension, position);
    if (read.status !== "OK") {
      return { success: false, reason: "UNLOADED" };
    }
    const block = read.block;

    if (UNBREAKABLE_BLOCK_ID_SET.has(block.typeId)) {
      return { success: false, reason: "UNBREAKABLE" };
    }
    // Deliberately checks the hazard registry only, NOT `block.isLiquid` —
    // water must be allowed through here (a support pillar rising through
    // a river/lake, exactly as planned by planBridge()'s support search);
    // lava is already a HAZARD_BLOCK_ID_SET member, so it's still caught.
    if (HAZARD_BLOCK_ID_SET.has(block.typeId)) {
      return { success: false, reason: "HAZARD" };
    }

    // Same proven mechanism TunnelExcavator/RailPermutationBuilder already
    // use — BlockPermutation.resolve() + setPermutation() — reusing a
    // confirmed-working call rather than a hypothetical shortcut.
    writeBlock(block, position, BlockPermutation.resolve(materialId), journal, refundItemId);
    return { success: true };
  }
}
