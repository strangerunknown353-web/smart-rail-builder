import { TerrainClassification } from "../../terrain/TerrainClassification.js";
import { buildStraightRailPermutation, buildAscendingRailPermutation } from "../RailPermutationBuilder.js";
import { RAIL_ITEM_ID_SET } from "../../config/RailConfig.js";
import { Logger } from "../../utils/Logger.js";
import { ExtrasBuilder } from "../ExtrasBuilder.js";

/**
 * StraightRailStrategy.js
 *
 * PURPOSE
 *   The first (and, for v1, only) implementation of the RailBuildStrategy
 *   contract (see ./RailBuildStrategy.js): places a straight line of rail
 *   blocks — flat, ascending, descending (Project Prompt 11), or through a
 *   tunnel (Project Prompt 12) — across pre-validated terrain. "Straight"
 *   describes the horizontal shape (no curves, still this addon's only
 *   supported layout) — it does not mean flat-only or open-air-only,
 *   neither of which has been true since Project Prompt 11.
 *
 * ROADMAP PHASE 12 CHANGE: EXCAVATE BEFORE RE-VERIFYING, FOR TUNNEL POSITIONS
 *   A TUNNEL position's rail spot is, by definition, still solid rock the
 *   moment placement begins — TerrainScanner only confirmed it WOULD be
 *   excavatable, not that it already had been (see terrain/TunnelPlanner.js).
 *   So the per-block loop below has one extra step specifically for TUNNEL
 *   positions, before the terrain re-check every position already gets:
 *   excavate first (via the injected TunnelExcavator, using
 *   `path[i].futureMetadata.excavationPositions`), THEN run the same
 *   `scanSinglePosition()` re-check every other position uses. This ordering
 *   is why the re-check still only ever needs to recognize FLAT_SAFE — see
 *   WHY THE RE-CHECK STILL ONLY ACCEPTS FLAT_SAFE below, extended this
 *   session to explain the tunnel case too.
 *
 * ROADMAP PHASE 11 CHANGE: path IS NOW TerrainPositionFact[], NOT {x,y,z}[]
 *   Through Project Prompt 11's PathValidator fix, `path` was a bare array
 *   of coordinates, independently rebuilt by PlacementStage from
 *   `buildVector.positionAt()` (always flat). Since a slope-aware path's Y
 *   varies per position — and TerrainScanner already resolved exactly that,
 *   correctly, during scanning — PlacementStage now passes
 *   `context.terrainReport.positions` directly instead of recomputing a
 *   flat one. See PlacementStage.js and RailBuildStrategy.js's contract
 *   doc for the same change reflected on the other side of this file.
 *   `path[i].position` is the placement coordinate; `path[i].slopeDirection`
 *   (null for flat and tunnel) says which permutation to use — see PICKING
 *   A PERMUTATION PER BLOCK below.
 *
 * PICKING A PERMUTATION PER BLOCK
 *   `path[i].slopeDirection` was already fully resolved by TerrainScanner's
 *   `_resolveRailShapes()` before validation ever ran — this strategy does
 *   not re-derive it, just reads it: null means `buildStraightRailPermutation`
 *   (used for both flat AND tunnel positions — a bored tunnel is level, so
 *   its rails are ordinary straight ones), any CardinalDirection means
 *   `buildAscendingRailPermutation` with that direction. See
 *   builder/RailPermutationBuilder.js for the disclosed uncertainty around
 *   the exact ascending `rail_direction` values.
 *
 * WHY EVERY BLOCK IS RE-VERIFIED, NOT JUST PLACED (Project Prompt 10)
 *   A long build is spread across many ticks via `system.runJob`. Between
 *   the original terrain scan (TerrainScanningStage) and the tick a given
 *   block actually gets placed, real time has passed — the same "state can
 *   change" principle already applied to inventory (see
 *   inventory/InventoryManager.js) applies here too. Before every single
 *   placement, this generator re-checks: cancellation
 *   (`session.isCancelled()`), terrain (excavating first for TUNNEL
 *   positions, then `terrainScanner.scanSinglePosition()` — cheap, a
 *   2-block read, not a full re-scan), and, in Survival, live resource
 *   availability. Any failure stops immediately, keeps everything already
 *   placed (Project Prompt 2's finalized interruption policy — no
 *   rollback, no refund), and reports why.
 *
 * WHY THE RE-CHECK STILL ONLY ACCEPTS FLAT_SAFE (Project Prompt 11, extended Project Prompt 12)
 *   `scanSinglePosition()` is called with `path[i].position` — the
 *   ALREADY-RESOLVED coordinate, e.g. y=11 for a position that was
 *   originally ASCENDING, or the bored-through coordinate for a TUNNEL
 *   position (checked AFTER excavation, see the Roadmap Phase 12 note
 *   above). Re-checked at that specific Y, a still-valid ascending,
 *   descending, or (post-excavation) tunnel position looks exactly like
 *   flat-safe terrain (solid ground one below, clear at the rail's own
 *   spot) — the ASCENDING/DESCENDING/TUNNEL label only ever described how
 *   the scanner GOT to that Y relative to its neighbor (or that it needed
 *   excavating first), not a property of the position in isolation once
 *   it's actually ready. So this check is deliberately unchanged from
 *   Project Prompt 10 — see terrain/TerrainScanner.js's "WHY
 *   scanSinglePosition NEEDED NO SLOPE-AWARENESS" for the full reasoning.
 *
 * WHY GAME MODE IS READ FRESH EVERY ITERATION, NOT ONCE AT THE START
 *   A player could switch Survival ↔ Creative mid-build. Reading
 *   `player.getGameMode()` fresh each iteration means a mid-build switch
 *   takes effect immediately and correctly for the next block, rather than
 *   using a stale mode captured when the build started.
 *
 * RESPONSIBILITIES
 *   - Implement buildPath(session, path) as a system.runJob-compatible
 *     generator that places one rail block per position, excavating first
 *     for TUNNEL positions, computing the correct BlockPermutation
 *     explicitly (see ../RailPermutationBuilder.js for why this doesn't
 *     rely on vanilla auto-connection).
 *   - In Survival, deduct exactly one item per block, strictly AFTER that
 *     block is confirmed placed — never before (Project Prompt 2).
 *     Excavated blocks (Project Prompt 12) never grant an item and never
 *     consume a tool — see builder/TunnelExcavator.js for that scope
 *     decision.
 *   - Report progress via the injected ProgressReporter.
 *
 * FUTURE EXTENSIONS
 *   - Roadmap Phase 13+: BridgeRailStrategy, CurvedRailStrategy will live
 *     alongside this file, each implementing the same contract.
 *
 * DEPENDENCIES
 *   - ./RailBuildStrategy.js (the contract this class implements)
 *   - ../RailPermutationBuilder.js
 *   - ../TunnelExcavator.js (Roadmap Phase 12, injected)
 *   - core/BuildSession.js (read/write during placement)
 *   - terrain/TerrainScanner.js (per-block re-check, injected)
 *   - terrain/TerrainClassification.js
 *   - inventory/InventoryManager.js (per-block re-check + deduction, injected)
 *   - ui/ProgressReporter.js (injected)
 *   - utils/Logger.js
 */

export class StraightRailStrategy {
  /**
   * @param {import("../../terrain/TerrainScanner.js").TerrainScanner} terrainScanner
   * @param {import("../../inventory/InventoryManager.js").InventoryManager} inventoryManager
   * @param {import("../../ui/ProgressReporter.js").ProgressReporter} progressReporter
   * @param {import("../TunnelExcavator.js").TunnelExcavator} tunnelExcavator
   */
  constructor(terrainScanner, inventoryManager, progressReporter, tunnelExcavator) {
    /** @private */
    this._terrainScanner = terrainScanner;
    /** @private */
    this._inventoryManager = inventoryManager;
    /** @private */
    this._progressReporter = progressReporter;
    /** @private */
    this._tunnelExcavator = tunnelExcavator;
    /** @private v2.0.0 Step 3 — boosters (no-op unless session.extras asks for them) */
    this._extras = new ExtrasBuilder(inventoryManager);
  }

  /**
   * @param {import("../../core/BuildSession.js").BuildSession} session
   * @param {ReadonlyArray<import("../../terrain/TerrainScanner.js").TerrainPositionFact>} path
   *   Pre-validated, pre-resolved positions — see ROADMAP PHASE 11 CHANGE above.
   * @returns {Generator<void, import("./RailBuildStrategy.js").BuildResult, void>}
   */
  *buildPath(session, path) {
    const { player, dimension, railTypeId, direction } = session;

    for (let i = session.blocksPlaced; i < path.length; i++) {
      if (session.isCancelled()) {
        return this._result(session, session.cancelReason);
      }

      const { position, slopeDirection, classification, futureMetadata } = path[i];

      if (classification === TerrainClassification.TUNNEL) {
        const excavation = this._tunnelExcavator.excavateRow(dimension, futureMetadata.excavationPositions, { journal: session.journal });
        if (!excavation.success) {
          Logger.warn(`Build stopped for ${player.name} at block ${i}: tunnel excavation failed (${excavation.reason}).`);
          return this._result(session, `TUNNEL_EXCAVATION_${excavation.reason}`);
        }
      }

      const fact = this._terrainScanner.scanSinglePosition(position, dimension);
      if (fact.classification !== TerrainClassification.FLAT_SAFE) {
        Logger.warn(`Build stopped for ${player.name} at block ${i}: terrain changed (${fact.classification}).`);
        return this._result(session, `TERRAIN_CHANGED_${fact.classification}`);
      }

      let block;
      try {
        block = dimension.getBlock(position);
      } catch (error) {
        Logger.warn(`Build stopped for ${player.name} at block ${i}: chunk unloaded mid-build.`);
        return this._result(session, "UNLOADED_DURING_BUILD");
      }
      if (!block) {
        Logger.warn(`Build stopped for ${player.name} at block ${i}: chunk unloaded mid-build.`);
        return this._result(session, "UNLOADED_DURING_BUILD");
      }

      // Bugfix pass before Project Prompt 18 — see config/RailConfig.js's
      // RAIL_ITEM_ID_SET doc for the full crossing/connection bug write-up.
      // A position that already holds ANY rail type is left completely
      // untouched: no overwrite, no forced direction, no deduction — this
      // is what stops a new railway from destroying an existing one where
      // the two cross. Still counts toward progress, since the route is
      // genuinely complete through this position either way.
      if (RAIL_ITEM_ID_SET.has(block.typeId)) {
        Logger.debug(`Existing rail preserved for ${player.name} at block ${i} (${block.typeId}) — not overwritten.`);
        session.incrementBlocksPlaced();
        this._progressReporter.reportIfDue(session);
        yield;
        continue;
      }

      const isSurvival = session.isSurvival;
      // v2.0.0: a booster index places its redstone block now and becomes a powered rail.
      const placeTypeId = this._extras.prepareRail(session, i, railTypeId);
      // Checked after prepareRail(): a booster spot needs a powered rail, not a held one.
      if (isSurvival && !this._inventoryManager.hasAtLeast(player, placeTypeId, 1)) {
        Logger.warn(`Build stopped for ${player.name} at block ${i}: ran out of ${placeTypeId}.`);
        return this._result(session, "OUT_OF_RESOURCES");
      }

      try {
        const permutation = slopeDirection
          ? buildAscendingRailPermutation(placeTypeId, slopeDirection)
          : buildStraightRailPermutation(placeTypeId, direction);
        session.journal.write(block, position, permutation, isSurvival ? placeTypeId : undefined);
      } catch (error) {
        Logger.error(`Build stopped for ${player.name} at block ${i}: placement failed.`, error);
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
