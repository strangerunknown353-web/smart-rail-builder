import { GameMode } from "@minecraft/server";
import { buildStraightRailPermutation, buildAscendingRailPermutation } from "../RailPermutationBuilder.js";
import { RAIL_ITEM_ID_SET } from "../../config/RailConfig.js";
import { UNDERGROUND_CONFIG } from "../../config/UndergroundConfig.js";
import { readBlock } from "../../utils/BlockReader.js";
import { Logger } from "../../utils/Logger.js";
import { LocalizationKeys } from "../../localization/LocalizationKeys.js";
import { ExtrasBuilder } from "../ExtrasBuilder.js";

/**
 * UndergroundExecutionStrategy.js
 *
 * PURPOSE
 *   Roadmap Phase 17 (Project Prompt 17) — the third real implementer of
 *   the RailBuildStrategy contract (see ./RailBuildStrategy.js), alongside
 *   StraightRailStrategy (NORMAL) and BridgeExecutionStrategy (BRIDGE).
 *   Excavates the planned corridor and places the railway inside it.
 *
 * `path` IS AN UndergroundPlan HERE
 *   Same arrangement Bridge Mode established in Project Prompt 16:
 *   RailBuildStrategy's contract deliberately leaves `path`'s shape to each
 *   strategy, and `RailBuilder` never inspects it — it only forwards
 *   whatever PlacementStage passed alongside whichever strategy
 *   PlacementStage also chose.
 *
 * CONSTRUCTION ORDER: PER-STEP EXCAVATE-THEN-PLACE, NOT EXCAVATE-ALL-THEN-PLACE-ALL
 *   Project Prompt 17's conceptual order lists excavation (step 6), then
 *   clearance verification (7), then rail placement (8) — which reads as
 *   three whole-route passes. This class instead interleaves them per rail
 *   position: excavate THIS step's corridor, re-verify THIS step's rail
 *   spot is now clear, place THIS step's rail, then move on. That is the
 *   same order at the granularity that actually matters ("never place rails
 *   in a location that has not been safely prepared" holds absolutely —
 *   a rail is only ever placed into a corridor cleared moments earlier in
 *   the same iteration), and it is strictly safer on interruption, which
 *   the prompt cares about separately: an interrupted whole-route pass
 *   would leave a fully hollowed tunnel with no track in it, whereas an
 *   interrupted interleaved build leaves a shorter but *complete and
 *   usable* railway. Since partial builds are explicitly kept and never
 *   rolled back, "what does the half-finished state look like" is a real
 *   design consideration, not a hypothetical. Adapting the order this way
 *   is what the prompt's own "adapt this order if the actual Bedrock API
 *   requires a safer strategy" allowance is for.
 *
 * TRANSACTION SAFETY
 *   Identical, deliberately unchanged discipline to the two existing
 *   strategies: a rail item is deducted exactly once, strictly AFTER that
 *   specific rail is confirmed placed — never before, never in bulk. A live
 *   Survival resource re-check happens immediately before every single
 *   placement, not just once at InventoryStage. Excavation consumes no
 *   items and grants none (the established Project Prompt 12 decision — see
 *   builder/TunnelExcavator.js), so there is no second resource ledger to
 *   keep consistent here, unlike Bridge Mode's material.
 *
 * PARTIAL FAILURE / RECOVERY INFORMATION (Project Prompt 17)
 *   On any stop, the returned BuildResult carries `blocksPlaced` (rails
 *   actually placed) and a specific `stopReason`, and `session` retains the
 *   same. Combined with the plan's own deterministic
 *   `railSteps` array — the same plan is reproducible from
 *   (origin, direction, length, depth) alone — that is enough for a future
 *   undo/recovery feature to reconstruct exactly what was modified, without
 *   this session having to build undo itself (explicitly out of scope).
 *   Logged at WARN with position and reason for the Content Log.
 *
 * DEPENDENCIES
 *   - ./RailBuildStrategy.js (the contract this class implements)
 *   - ../RailPermutationBuilder.js (both straight AND ascending — the ramp reuses
 *     the existing Phase 11 slope shapes rather than any new geometry)
 *   - ../TunnelExcavator.js (injected — reused unchanged, see EXCAVATION REUSE below)
 *   - inventory/InventoryManager.js (injected)
 *   - ui/ProgressReporter.js (injected)
 *   - ui/MessageService.js (injected — phase-transition chat messages)
 *   - utils/BlockReader.js, utils/Logger.js, localization/LocalizationKeys.js
 *
 * EXCAVATION REUSE
 *   `TunnelExcavator.excavateRow()` already does exactly what this mode
 *   needs, per position: re-verify each block is still breakable and
 *   non-hazardous immediately before breaking it (the "state can change
 *   mid-build" principle), then set it to air, reporting
 *   UNBREAKABLE/HAZARD/UNLOADED on failure. It is used here completely
 *   unchanged — no new excavation code was written this session, and
 *   `UndergroundPlan`'s per-step `excavationPositions` field is shaped
 *   exactly like the `futureMetadata.excavationPositions` TunnelPlanner
 *   already produces, specifically so this reuse needed no adapter.
 */

export class UndergroundExecutionStrategy {
  /**
   * @param {import("../TunnelExcavator.js").TunnelExcavator} tunnelExcavator
   * @param {import("../../inventory/InventoryManager.js").InventoryManager} inventoryManager
   * @param {import("../../ui/ProgressReporter.js").ProgressReporter} progressReporter
   * @param {import("../../ui/MessageService.js").MessageService} messageService
   */
  constructor(tunnelExcavator, inventoryManager, progressReporter, messageService) {
    /** @private */
    this._tunnelExcavator = tunnelExcavator;
    /** @private */
    this._inventoryManager = inventoryManager;
    /** @private */
    this._progressReporter = progressReporter;
    /** @private */
    this._messageService = messageService;
    /** @private v2.0.0 Step 3 — boosters + tunnel lights (no-op unless session.extras asks for them) */
    this._extras = new ExtrasBuilder(inventoryManager);
  }

  /**
   * @param {import("../../core/BuildSession.js").BuildSession} session
   * @param {import("../../terrain/UndergroundPlan.js").UndergroundPlan} plan Feasible plan — TerrainScanningStage/FinalSafetyCheckStage already rejected any infeasible one before this is ever called.
   * @returns {Generator<void, import("./RailBuildStrategy.js").BuildResult, void>}
   */
  *buildPath(session, plan) {
    const { player, dimension, railTypeId, direction } = session;

    this._messageService.sendChat(player, LocalizationKeys.UNDERGROUND_EXCAVATING);
    let announcedRailPhase = false;

    for (let i = session.blocksPlaced; i < plan.railSteps.length; i++) {
      if (session.isCancelled()) {
        return this._result(session, session.cancelReason);
      }

      const step = plan.railSteps[i];

      // Announce the transition from ramp to flat run once, so a player
      // watching a deep build gets a meaningful progress beat rather than
      // silence between "Excavating..." and completion. Never per-block.
      if (!announcedRailPhase && step.slopeDirection === null) {
        this._messageService.sendChat(player, LocalizationKeys.UNDERGROUND_PLACING_RAILS);
        announcedRailPhase = true;
      }

      // WATERPROOF TUNNEL (Project Prompt 18): allowLiquid: true — this
      // row's excavationPositions may legitimately include water
      // planUnderground() already planned around (see terrain/TerrainScanner.js);
      // TunnelExcavator's default (used by every OTHER caller, e.g. Normal
      // Mode's hill-tunnels) still aborts on unexpected water. Lava is
      // still never excavated regardless — see TunnelExcavator.excavateRow()'s
      // own doc.
      const excavation = this._tunnelExcavator.excavateRow(dimension, step.excavationPositions, {
        allowLiquid: true,
        journal: session.journal,
      });
      if (!excavation.success) {
        Logger.warn(
          `Underground build stopped for ${player.name} at step ${i} ` +
            `(${step.position.x}, ${step.position.y}, ${step.position.z}): excavation failed (${excavation.reason}).`
        );
        return this._result(session, `UNDERGROUND_EXCAVATION_${excavation.reason}`);
      }

      // WATERPROOF TUNNEL (Project Prompt 18): seal the lateral/roof faces
      // this row's water leaked in from, immediately after excavating it —
      // before the rail-spot clearance check below, so the interior is
      // walled off before anything else happens this iteration. Best-effort
      // (see TunnelExcavator.sealPositions()'s own doc) and a no-op for the
      // overwhelming majority of rows, which never intersected water at all
      // (`step.sealPositions` is empty for those — see terrain/UndergroundPlan.js).
      if (step.sealPositions.length > 0) {
        this._tunnelExcavator.sealPositions(dimension, step.sealPositions, UNDERGROUND_CONFIG.SEAL_BLOCK_ID, session.journal);
      }

      // Clearance verification, per Project Prompt 17's step 7: confirm the
      // rail's own spot is genuinely clear now that excavation has run,
      // rather than assuming excavateRow's success implies it. Deliberately
      // narrow (this one block), not a re-run of planUnderground's whole
      // per-position analysis — the route was already committed to.
      const read = readBlock(dimension, step.position);
      if (read.status !== "OK") {
        Logger.warn(`Underground build stopped for ${player.name} at step ${i}: chunk unloaded mid-build.`);
        return this._result(session, "UNLOADED_DURING_BUILD");
      }

      // Bugfix pass before Project Prompt 18 — see config/RailConfig.js's
      // RAIL_ITEM_ID_SET doc. `planUnderground()` deliberately never adds
      // an existing rail's position to `excavationPositions` (see
      // TerrainScanner.js), so this spot is correctly NOT air — it still
      // holds that rail, exactly as intended. Recognize that here rather
      // than treating "not air" as an obstruction: preserve it untouched
      // (no overwrite, no deduction), same as StraightRailStrategy does.
      if (RAIL_ITEM_ID_SET.has(read.block.typeId)) {
        Logger.debug(`Existing rail preserved for ${player.name} at step ${i} (${read.block.typeId}) — not overwritten.`);
        session.incrementBlocksPlaced();
        this._progressReporter.reportIfDue(session);
        yield;
        continue;
      }

      if (!read.block.isAir) {
        Logger.warn(
          `Underground build stopped for ${player.name} at step ${i}: rail position still obstructed ` +
            `by ${read.block.typeId} after excavation.`
        );
        return this._result(session, "UNDERGROUND_CLEARANCE_FAILED");
      }

      const isSurvival = player.getGameMode() !== GameMode.Creative;
      if (isSurvival && !this._inventoryManager.hasAtLeast(player, railTypeId, 1)) {
        Logger.warn(`Underground build stopped for ${player.name} at step ${i}: ran out of ${railTypeId}.`);
        return this._result(session, "OUT_OF_RESOURCES");
      }
      // v2.0.0: a booster index places its redstone block now and becomes a powered rail.
      const placeTypeId = this._extras.prepareRail(session, i, railTypeId);

      try {
        // Exactly the same call shape StraightRailStrategy uses for slopes —
        // the ramp reuses the existing Phase 11 rail geometry rather than
        // introducing any new one. See UndergroundPlan.js's rampSlopeDirection.
        const permutation = step.slopeDirection
          ? buildAscendingRailPermutation(placeTypeId, step.slopeDirection)
          : buildStraightRailPermutation(placeTypeId, direction);
        session.journal.write(read.block, step.position, permutation, isSurvival ? placeTypeId : undefined);
      } catch (error) {
        Logger.error(`Underground build stopped for ${player.name} at step ${i}: rail placement failed.`, error);
        return this._result(session, "PLACEMENT_ERROR");
      }

      session.incrementBlocksPlaced();
      if (isSurvival) {
        this._inventoryManager.deductRailItems(player, placeTypeId, 1);
      }
      // v2.0.0: tunnel light in the wall beside this rail, if one is planned here.
      this._extras.placeLight(session, i);
      this._progressReporter.reportIfDue(session);
      yield;
    }

    // Terminal landing buffer (bugfix pass before Project Prompt 18) — see
    // terrain/UndergroundPlan.js's `landingExcavationPositions` doc and
    // ARCHITECTURE.md §46.3. Reuses the same `TunnelExcavator` the main
    // corridor loop uses above, rather than duplicating placement logic.
    // Best-effort: the array is simply empty if planning couldn't safely
    // reserve it, and a failure to excavate it now is logged but never
    // stops or fails the build — the actual railway is already complete.
    if (plan.landingExcavationPositions.length > 0) {
      const landing = this._tunnelExcavator.excavateRow(dimension, plan.landingExcavationPositions, { journal: session.journal });
      if (!landing.success) {
        Logger.debug(`Landing buffer excavation skipped for ${player.name}: ${landing.reason}.`);
      }
    }

    return this._result(session, undefined);
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
