import { GameMode } from "@minecraft/server";
import { buildStraightRailPermutation, buildAscendingRailPermutation } from "../RailPermutationBuilder.js";
import { REPLACEABLE_BLOCK_ID_SET } from "../../config/ReplaceableBlockRegistry.js";
import { RAIL_ITEM_ID_SET } from "../../config/RailConfig.js";
import { BRIDGE_CONFIG } from "../../config/BridgeConfig.js";
import { readBlock } from "../../utils/BlockReader.js";
import { Logger } from "../../utils/Logger.js";
import { LocalizationKeys } from "../../localization/LocalizationKeys.js";
import { ExtrasBuilder } from "../ExtrasBuilder.js";

/**
 * BridgeExecutionStrategy.js
 *
 * PURPOSE
 *   Implemented Roadmap Phase 16 (Project Prompt 16), substantially
 *   rewritten in the bugfix pass before Project Prompt 18 — see REVISION
 *   HISTORY below. Third implementer of the RailBuildStrategy contract
 *   (see ./RailBuildStrategy.js) alongside StraightRailStrategy (NORMAL)
 *   and UndergroundExecutionStrategy (UNDERGROUND).
 *
 * REVISION HISTORY (bugfix pass before Project Prompt 18)
 *   Three changes, matching terrain/BridgePlan.js's own revision:
 *   1. Rail placement is now slope-aware. `plan.deckPositions` entries are
 *      now `{position, slopeDirection}` (mirroring
 *      `UndergroundExecutionStrategy`'s `railSteps`), and this class picks
 *      `buildAscendingRailPermutation()` vs `buildStraightRailPermutation()`
 *      exactly the way that class already does — the ramp/crest/descent
 *      profile `planBridge()` now computes needs real sloped rail blocks,
 *      not a straight rail forced at a diagonal-looking elevation.
 *   2. Material is read from `session.bridgeMaterialId` (the player's own
 *      choice — see ui/BuildMenu.js's `promptForBridgeMaterial()` and
 *      core/BuildSession.js) instead of a fixed
 *      `BRIDGE_CONFIG.MATERIAL_ITEM_ID` constant, which no longer exists
 *      (see that file's REVISION HISTORY). `BRIDGE_CONFIG.FALLBACK_MATERIAL_ID`
 *      is used only as a defensive fallback if that field is somehow
 *      missing — expected to be unreachable, since BuildMenu always
 *      collects a material before a bridge build can be confirmed.
 *   3. An existing rail at any position (deck or the ramp's own spot) is
 *      preserved rather than overwritten — see config/RailConfig.js's
 *      RAIL_ITEM_ID_SET doc for the crossing/connection bugfix this is
 *      part of, applied here identically to how StraightRailStrategy and
 *      UndergroundExecutionStrategy already apply it.
 *
 * PROJECT PROMPT 18 ADDENDUM: WATER-TOLERANT DECK RE-CHECK
 *   `planBridge()` now accepts a liquid deck/headroom position (the bridge
 *   passes over water rather than rejecting outright — see
 *   terrain/TerrainScanner.js). This class's own per-block re-check
 *   (`stillClear` in the rail-placement loop below) is updated to match:
 *   a deck position that's still water when its turn comes is exactly as
 *   placeable as one that's still air, not a "became obstructed" stop.
 *
 * `path` IS A BridgePlan HERE, NOT A TerrainPositionFact[]
 *   RailBuildStrategy.js's contract deliberately leaves `path`'s exact
 *   shape to each strategy — see that file's contract doc.
 *
 * CONSTRUCTION ORDER (Project Prompt 16's explicit order, steps 3-5 — steps
 * 1/2/7/8 are earlier/later pipeline stages, not this class's job)
 *   1. Build supports (`plan.supportPositions` — pier columns only, see
 *      terrain/BridgePlan.js's REVISION HISTORY; bottom of each column
 *      first, already bottom-up ordered by `planBridge()`).
 *   2. Build bridge surface (`plan.surfacePositions` — the block every
 *      rail that needed fill sits on, pier or not).
 *   3. Place rails (`plan.deckPositions`), now with the correct slope
 *      shape per position.
 *   Never places a rail before its column's surface/support exist — deck
 *   positions are only ever reached after every fill position across the
 *   whole bridge has already been placed, by construction (three separate,
 *   strictly sequential loops, not interleaved).
 *
 * TRANSACTION SAFETY (Project Prompt 16's explicit requirement, unchanged)
 *   Identical discipline to StraightRailStrategy's already-proven pattern,
 *   applied to bridge material too: deduct exactly one item strictly AFTER
 *   that specific block is confirmed placed, never before, never in bulk
 *   up front. A resource re-check happens immediately before EVERY
 *   placement (support, surface, AND rail) — not just once at
 *   InventoryStage. An interruption at any point keeps every block already
 *   placed and reports the interruption; this class never rolls back or
 *   auto-refunds. A position that already holds an existing rail is
 *   neither placed into nor deducted for — see point 3 above.
 *
 * WHY SUPPORT/SURFACE SHARE ONE HELPER LOOP, RAILS DO NOT
 *   Support and surface placement are IDENTICAL logic — same material,
 *   same safety re-check (`BridgeSupportBuilder`), same deduction — only
 *   the position list and the phase-transition message differ, so both
 *   call the shared, private `_placeMaterial()`. Rail placement needs
 *   different logic entirely (a different re-check shape, a slope-aware
 *   permutation call, a different item type, the crossing check) and
 *   stays its own explicit loop, deliberately mirroring
 *   UndergroundExecutionStrategy's proven rail-loop shape closely.
 *
 * DEPENDENCIES
 *   - ./RailBuildStrategy.js (the contract this class implements)
 *   - ../RailPermutationBuilder.js (buildStraightRailPermutation AND buildAscendingRailPermutation, as of this revision)
 *   - ../BridgeSupportBuilder.js (injected)
 *   - config/ReplaceableBlockRegistry.js
 *   - config/RailConfig.js (RAIL_ITEM_ID_SET, as of this revision)
 *   - config/BridgeConfig.js
 *   - utils/BlockReader.js
 *   - core/BuildSession.js (read/write during placement; bridgeMaterialId as of this revision)
 *   - inventory/InventoryManager.js (per-block re-check + deduction, injected)
 *   - ui/ProgressReporter.js (injected)
 *   - ui/MessageService.js (injected — phase-transition chat messages)
 *   - localization/LocalizationKeys.js
 *   - utils/Logger.js
 */

export class BridgeExecutionStrategy {
  /**
   * @param {import("../BridgeSupportBuilder.js").BridgeSupportBuilder} bridgeSupportBuilder
   * @param {import("../../inventory/InventoryManager.js").InventoryManager} inventoryManager
   * @param {import("../../ui/ProgressReporter.js").ProgressReporter} progressReporter
   * @param {import("../../ui/MessageService.js").MessageService} messageService
   */
  constructor(bridgeSupportBuilder, inventoryManager, progressReporter, messageService) {
    /** @private */
    this._bridgeSupportBuilder = bridgeSupportBuilder;
    /** @private */
    this._inventoryManager = inventoryManager;
    /** @private */
    this._progressReporter = progressReporter;
    /** @private */
    this._messageService = messageService;
    /** @private v2.0.0 Step 3 — boosters (no-op unless session.extras asks for them) */
    this._extras = new ExtrasBuilder(inventoryManager);
  }

  /**
   * @param {import("../../core/BuildSession.js").BuildSession} session
   * @param {import("../../terrain/BridgePlan.js").BridgePlan} plan Feasible plan — TerrainScanningStage/FinalSafetyCheckStage already rejected any infeasible one before this is ever called.
   * @returns {Generator<void, import("./RailBuildStrategy.js").BuildResult, void>}
   */
  *buildPath(session, plan) {
    const { player } = session;
    const materialId = session.bridgeMaterialId ?? BRIDGE_CONFIG.FALLBACK_MATERIAL_ID;

    if (plan.supportPositions.length > 0) {
      this._messageService.sendChat(player, LocalizationKeys.BRIDGE_BUILDING_SUPPORTS);
    }
    for (const position of plan.supportPositions) {
      const stopReason = yield* this._placeMaterial(session, position, materialId, "BRIDGE_SUPPORT");
      if (stopReason !== null) return this._result(session, stopReason);
    }

    if (plan.surfacePositions.length > 0) {
      this._messageService.sendChat(player, LocalizationKeys.BRIDGE_BUILDING_SURFACE);
    }
    for (const position of plan.surfacePositions) {
      const stopReason = yield* this._placeMaterial(session, position, materialId, "BRIDGE_SURFACE");
      if (stopReason !== null) return this._result(session, stopReason);
    }

    this._messageService.sendChat(player, LocalizationKeys.BRIDGE_PLACING_RAILS);
    for (let deckIndex = 0; deckIndex < plan.deckPositions.length; deckIndex++) {
      const step = plan.deckPositions[deckIndex];
      if (session.isCancelled()) {
        return this._result(session, session.cancelReason);
      }

      // State can change mid-build (same principle as the other two
      // strategies' per-block re-check) — re-confirm this exact deck spot
      // immediately before placing a rail on it. Deliberately a narrow
      // re-check (clear, or already a rail, or not), not a full re-run of
      // planBridge()'s per-position logic — the overall plan was already
      // committed to.
      const read = readBlock(session.dimension, step.position);
      if (read.status !== "OK") {
        Logger.warn(`Bridge build stopped for ${player.name}: chunk unloaded mid-build at a rail position.`);
        return this._result(session, "UNLOADED_DURING_BUILD");
      }
      const block = read.block;

      // Existing-rail crossing protection — see config/RailConfig.js's
      // RAIL_ITEM_ID_SET doc. A bridge's ramp/deck can cross another
      // railway at ground level near either end; preserve it untouched.
      if (RAIL_ITEM_ID_SET.has(block.typeId)) {
        Logger.debug(`Existing rail preserved for ${player.name} on the bridge deck (${block.typeId}) — not overwritten.`);
        session.incrementBlocksPlaced();
        this._progressReporter.reportIfDue(session);
        yield;
        continue;
      }

      // WATER DETECTION (Project Prompt 18): a deck position may legitimately
      // be water — planBridge() now accepts that (see terrain/TerrainScanner.js) —
      // so the re-check here must accept it too, or a plan that passed
      // planning would incorrectly halt at execution time.
      const stillClear = block.isAir || block.isLiquid || REPLACEABLE_BLOCK_ID_SET.has(block.typeId);
      if (!stillClear) {
        Logger.warn(`Bridge build stopped for ${player.name}: a rail position became obstructed mid-build.`);
        return this._result(session, "BRIDGE_DECK_OBSTRUCTED_DURING_BUILD");
      }

      const isSurvival = player.getGameMode() !== GameMode.Creative;
      if (isSurvival && !this._inventoryManager.hasAtLeast(player, session.railTypeId, 1)) {
        Logger.warn(`Bridge build stopped for ${player.name}: ran out of ${session.railTypeId}.`);
        return this._result(session, "OUT_OF_RESOURCES");
      }
      // v2.0.0: a booster index becomes a powered rail (its redstone block is
      // usually already in place as the deck surface — see _placeMaterial).
      const placeTypeId = this._extras.prepareRail(session, deckIndex, session.railTypeId);

      try {
        // Slope-aware as of this revision — mirrors exactly how
        // UndergroundExecutionStrategy/StraightRailStrategy already pick
        // between the two permutation builders.
        const permutation = step.slopeDirection
          ? buildAscendingRailPermutation(placeTypeId, step.slopeDirection)
          : buildStraightRailPermutation(placeTypeId, session.direction);
        session.journal.write(block, step.position, permutation, isSurvival ? placeTypeId : undefined);
      } catch (error) {
        Logger.error(`Bridge build stopped for ${player.name}: rail placement failed.`, error);
        return this._result(session, "PLACEMENT_ERROR");
      }

      session.incrementBlocksPlaced();
      if (isSurvival) {
        this._inventoryManager.deductRailItems(player, placeTypeId, 1);
      }
      this._progressReporter.reportIfDue(session);
      yield;
    }

    return this._result(session, undefined);
  }

  /**
   * Shared support/surface placement: cancellation check, live Survival
   * resource re-check, delegate the actual safety-re-check-and-place to
   * BridgeSupportBuilder, deduct strictly after success, report progress,
   * yield. A generator (not a plain method) so it can `yield` itself,
   * mid-shared-logic — `yield*` in buildPath() above transparently
   * forwards those yields AND captures this method's `return` value as
   * the delegated expression's result.
   *
   * @param {import("../../core/BuildSession.js").BuildSession} session
   * @param {{x: number, y: number, z: number}} position
   * @param {string} chosenMaterialId The player's chosen bridge material — see REVISION HISTORY above. (v2.0.0: swapped for the redstone block under a booster rail.)
   * @param {string} phaseLabel "BRIDGE_SUPPORT" or "BRIDGE_SURFACE" — prefixes the stop reason so a failure's phase is visible in logs/Content Log without a separate field.
   * @returns {Generator<void, string|null, void>} The stop reason if placement should halt, or null to continue.
   * @private
   */
  *_placeMaterial(session, position, chosenMaterialId, phaseLabel) {
    const { player, dimension } = session;
    // v2.0.0: under a booster rail the "surface" block is the redstone block.
    const materialId = this._extras.bridgeSurfaceBlockFor(session, position, chosenMaterialId);

    if (session.isCancelled()) {
      return session.cancelReason;
    }

    const isSurvival = player.getGameMode() !== GameMode.Creative;
    if (isSurvival && !this._inventoryManager.hasAtLeast(player, materialId, 1)) {
      Logger.warn(`Bridge build stopped for ${player.name}: ran out of ${materialId}.`);
      return "OUT_OF_BRIDGE_MATERIAL";
    }

    const placement = this._bridgeSupportBuilder.placeBlock(dimension, position, materialId, {
      journal: session.journal,
      refundItemId: isSurvival ? materialId : undefined,
    });
    if (!placement.success) {
      Logger.warn(`Bridge build stopped for ${player.name}: ${phaseLabel} placement failed (${placement.reason}).`);
      return `${phaseLabel}_${placement.reason}`;
    }

    session.incrementBlocksPlaced();
    if (isSurvival) {
      this._inventoryManager.deductRailItems(player, materialId, 1);
    }
    this._progressReporter.reportIfDue(session);
    yield;
    return null;
  }

  /**
   * @param {import("../../core/BuildSession.js").BuildSession} session
   * @param {string|undefined} stopReason
   * @returns {import("./RailBuildStrategy.js").BuildResult}
   * @private
   */
  _result(session, stopReason) {
    return {
      blocksPlaced: session.blocksPlaced,
      completed: session.blocksPlaced === session.targetLength,
      stopReason,
    };
  }
}
