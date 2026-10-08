import { LocalizationKeys } from "../../../localization/LocalizationKeys.js";
import { Logger } from "../../../utils/Logger.js";
import { PipelineResult } from "../PipelineResult.js";
import { BuildingMode } from "../../../config/BuildModes.js";
import { currentTick } from "../../../utils/Tick.js";

/**
 * FinalSafetyCheckStage.js
 *
 * PURPOSE
 *   Sixth pipeline stage, new Project Prompt 10. Re-runs a full-path terrain
 *   scan immediately before construction begins, replacing
 *   `context.terrainReport` with a fresh result. This is the "Final Safety
 *   Check" box in Project Prompt 10's requested construction order,
 *   distinct from — and complementary to — two other checks:
 *
 *   1. TerrainScanningStage's scan (earlier in the pipeline) confirms the
 *      path *at the time the request was made*.
 *   2. This stage re-confirms the *whole path* is still clean *immediately
 *      before* placement starts — catching changes that happened during
 *      the (usually brief, but non-zero) time between the original scan
 *      and now: menu round trips already happened earlier, but inventory
 *      validation and any other synchronous work still take some time.
 *   3. StraightRailStrategy (during placement itself) re-checks *each
 *      individual position* as it's about to be placed — catching changes
 *      that happen *during* the multi-tick build, which this stage cannot,
 *      since it only runs once, before placement starts.
 *
 *   All three are real and necessary: (1) and (2) both run once,
 *   synchronously, and are cheap; (3) is what protects a build that might
 *   run for many ticks. None of them duplicate each other's job — each
 *   covers a different window of time.
 *
 * ROADMAP PHASE 16 ADDITION (Project Prompt 16): BRIDGE mode's own re-plan
 *   The NORMAL-mode branch immediately below (re-scan via `scanPath()`,
 *   check `buildReady`) is untouched from the previous session — see
 *   TerrainScanningStage.js's matching note for why. BRIDGE mode gets its
 *   own re-plan, calling `TerrainScanner.planBridge()` fresh and checking
 *   `.feasible` — the same "re-confirm the whole plan immediately before
 *   placement starts" role as the NORMAL branch, just against a BridgePlan
 *   instead of a TerrainScanResult. `context.bridgePlan` is replaced with
 *   the fresh result, exactly mirroring how the NORMAL branch replaces
 *   `context.terrainReport`. `Building supports/surface/rails from a plan
 *   that's already been superseded` is exactly the failure mode Project
 *   Prompt 16's own "final validation" construction-order step (step 1)
 *   exists to prevent — this is that step, for bridges.
 *
 * RESPONSIBILITIES
 *   - NORMAL: re-scan the full path via TerrainScanner (same call
 *     `TerrainScanningStage` already made — reused, not reimplemented). If
 *     no longer fully clean, stop here with a clear reason.
 *   - BRIDGE: re-plan the full bridge via `TerrainScanner.planBridge()`. If
 *     no longer feasible, stop here with a clear reason.
 *   - Never start placement on a path/plan that's changed since it was accepted.
 *
 * DEPENDENCIES
 *   - terrain/TerrainScanner.js
 *   - localization/LocalizationKeys.js
 *   - config/BuildModes.js (BuildingMode)
 *   - utils/Logger.js
 *   - ../PipelineResult.js
 *   - ui/MessageService.js (injected, Project Prompt 16 — the "Verifying..." actionbar ping)
 */

export class FinalSafetyCheckStage {
  /**
   * @param {import("../../../terrain/TerrainScanner.js").TerrainScanner} terrainScanner
   * @param {import("../../../ui/MessageService.js").MessageService} messageService Added Project Prompt 16.
   */
  constructor(terrainScanner, messageService) {
    this.name = "FinalSafetyCheckStage";
    /** @private */
    this._terrainScanner = terrainScanner;
    /** @private */
    this._messageService = messageService;
  }

  /**
   * @param {import("../PipelineContext.js").PipelineContext} context
   * @returns {PipelineResult}
   */
  execute(context) {
    const { dimension, buildVector, requestedLength, player, buildingMode, bridgeHeight, undergroundDepth } = context.request;

    // v2.0.0 SAME-TICK REUSE (optimization): this stage exists to catch world
    // changes between TerrainScanningStage's scan and now. Every stage in
    // between is synchronous, so normally both run in the very same game
    // tick — and the world cannot change mid-tick while this script is
    // running. In that case the earlier scan IS the fresh scan, and
    // re-scanning the whole route (hundreds of block reads) is pure cost.
    // If any tick has passed, or the tick can't be read, re-scan exactly
    // as before. Placement still re-checks every block as it builds.
    const tick = currentTick();
    if (tick !== undefined && context.terrainScannedAtTick === tick) {
      Logger.debug(`Final safety check for ${player.name}: same tick as the terrain scan (${tick}) — reusing it.`);
      return PipelineResult.success();
    }

    if (buildingMode === BuildingMode.BRIDGE) {
      this._messageService.sendActionBar(player, LocalizationKeys.ACTIONBAR_VERIFYING);
      const freshPlan = this._terrainScanner.planBridge(buildVector, requestedLength, dimension, bridgeHeight);
      context.bridgePlan = freshPlan;

      if (!freshPlan.feasible) {
        Logger.warn(`Final safety check failed for ${player.name}: bridge terrain changed since the original plan (${freshPlan.rejectionReason}).`);
        return PipelineResult.validationFailed(this.name, "BRIDGE_CHANGED_BEFORE_BUILD", LocalizationKeys.CONSTRUCTION_TERRAIN_CHANGED);
      }

      return PipelineResult.success();
    }

    if (buildingMode === BuildingMode.UNDERGROUND) {
      this._messageService.sendActionBar(player, LocalizationKeys.ACTIONBAR_VERIFYING);
      const freshPlan = this._terrainScanner.planUnderground(buildVector, requestedLength, dimension, undergroundDepth, {
        fillCaveGaps: context.request.fillCaveGaps,
      });
      context.undergroundPlan = freshPlan;

      if (!freshPlan.feasible) {
        Logger.warn(
          `Final safety check failed for ${player.name}: underground terrain changed since the original plan (${freshPlan.rejectionReason}).`
        );
        return PipelineResult.validationFailed(this.name, "UNDERGROUND_CHANGED_BEFORE_BUILD", LocalizationKeys.CONSTRUCTION_TERRAIN_CHANGED);
      }

      return PipelineResult.success();
    }

    const freshScan = this._terrainScanner.scanPath(buildVector, requestedLength, dimension);
    context.terrainReport = freshScan;

    if (!freshScan.buildReady) {
      Logger.warn(
        `Final safety check failed for ${player.name}: terrain changed since the original scan ` +
          `(${freshScan.unsafeCount}/${freshScan.totalScanned} positions no longer safe).`
      );
      return PipelineResult.validationFailed(this.name, "TERRAIN_CHANGED_BEFORE_BUILD", LocalizationKeys.CONSTRUCTION_TERRAIN_CHANGED);
    }

    return PipelineResult.success();
  }
}
