import { BuildSession } from "../../BuildSession.js";
import { DirectionUtils } from "../../../utils/DirectionUtils.js";
import { LocalizationKeys } from "../../../localization/LocalizationKeys.js";
import { Logger } from "../../../utils/Logger.js";
import { PipelineResult } from "../PipelineResult.js";
import { BuildingMode } from "../../../config/BuildModes.js";

/**
 * PlacementStage.js
 *
 * PURPOSE
 *   Seventh pipeline stage. Constructs a BuildSession from the validated
 *   BuildRequest, registers it with CancellationWatcher, picks the right
 *   RailBuildStrategy + path for the request's mode, runs RailBuilder
 *   (which spreads placement across ticks via `system.runJob`), and
 *   translates the resulting BuildResult into a PipelineResult.
 *
 * ROADMAP PHASE 16 CHANGE: mode-aware strategy selection (Project Prompt 16)
 *   Through Project Prompt 15, exactly one strategy existed, so this stage
 *   held a single injected `RailBuilder` already bound to
 *   StraightRailStrategy at construction. Now that BridgeExecutionStrategy
 *   is real too, this stage is given a small `strategiesByMode` map
 *   (`{ NORMAL: straightRailStrategy, BRIDGE: bridgeExecutionStrategy }`,
 *   keyed by config/BuildModes.js's BuildingMode values) instead, and picks
 *   the right one by `context.request.buildingMode` — the same "one
 *   registry, no new file needed for a future mode" shape already used for
 *   the mode UI itself. `railBuilder.run()` was updated alongside this (see
 *   builder/RailBuilder.js) to accept the chosen strategy per call rather
 *   than fixing one at construction. A future mode (Roadmap Phase 17+)
 *   needs one new map entry here, nothing else in this file.
 *
 * BUG FIX (Roadmap Phase 11, Project Prompt 11): path now comes from the
 * terrain report, not a fresh recomputation (NORMAL mode only)
 *   Through Project Prompt 11's PathValidator fix, this stage independently
 *   rebuilt `path` from `buildVector.positionAt(i)` — completely ignoring
 *   `context.terrainReport`, the ALREADY-SCANNED, ALREADY-VALIDATED result
 *   TerrainScanningStage produced earlier in this same pipeline run. This
 *   happened to not matter while every path was flat (both computations
 *   agreed by coincidence), but would have been actively wrong the moment
 *   slopes shipped: `positionAt()` always returns the origin's Y, so a
 *   validated ascending/descending path would have been rebuilt here as a
 *   flat one, placing every rail at the wrong height. Found and fixed
 *   during this same session, before it could ship broken — see
 *   ARCHITECTURE.md §36.4. `path` is now `context.terrainReport.positions`
 *   directly: exactly what PathValidator approved, nothing recomputed.
 *   BRIDGE mode has the exact same discipline applied from day one: `path`
 *   is `context.bridgePlan` directly — exactly what BridgeValidation
 *   approved, nothing recomputed here.
 *
 * PROJECT PROMPT 22 ADDITION: MULTIPLAYER CONFLICT CLAIM (§7/§11)
 *   Before anything else in this stage — including the mode-specific
 *   "construction started" chat message — this stage claims
 *   `context.buildPlan.modificationBoundary` (see core/BuildPlan.js) from
 *   `core/ActiveBuildRegistry.js`. If any position is already claimed by a
 *   DIFFERENT player's active build, this stage rejects with `RAIL_CONFLICT`
 *   and NEVER calls `railBuilder.run()` — zero blocks placed, exactly like
 *   every other pre-placement rejection. The claim is released in the same
 *   `finally` block that already unregisters the session from
 *   CancellationWatcher, so it's always freed whether the build finishes, is
 *   cancelled, or throws. See ActiveBuildRegistry.js's own header for why
 *   doing the check-and-claim together, synchronously, right here (rather
 *   than in an earlier, separate stage) is what makes this race-free.
 *
 * BUG FIX (Project Prompt 27): claim BEFORE the "started" message, not after
 *   The claim used to run after the mode-specific "construction started"
 *   chat message was already sent, right before the one `await` in this
 *   method. That ordering meant a player whose build lost a conflicting
 *   claim (RAIL_CONFLICT) still received "Building N rails going ..." and
 *   THEN, immediately after, "Another build is already using part of this
 *   area" — confusing and factually wrong, since no construction had
 *   started. The claim itself was already correctly race-free (synchronous,
 *   before the one `await`) — this fix only reorders which synchronous
 *   statement runs first, moving the claim to the very top of `execute()`,
 *   before any player-facing message is sent. Zero effect on the race-free
 *   property or on release timing (still the same `finally`).
 *
 * RESPONSIBILITIES
 *   - Send one chat message right before construction starts — the
 *     player's cue that a potentially multi-tick operation is beginning
 *     (mode-specific wording: BRIDGE_CONSTRUCTION_STARTED mentions the
 *     bridge height; CONSTRUCTION_STARTED does not, unchanged from before).
 *   - Use the already-resolved, already-validated path/plan from
 *     `context.terrainReport.positions` (NORMAL) or `context.bridgePlan`
 *     (BRIDGE) — see the bug fix notes above for why this stage must not
 *     recompute either.
 *   - Claim `context.buildPlan.modificationBoundary` before placing anything;
 *     reject with RAIL_CONFLICT (no blocks placed) if another active build
 *     already holds any of those positions (Project Prompt 22).
 *   - Construct and register a BuildSession for the duration of the build,
 *     always unregistering it afterward (try/finally) even if placement throws.
 *   - Never place a block itself, never touch UI beyond the one message
 *     above — all block mutation is RailBuilder/the chosen strategy's job;
 *     this stage only sequences and translates results, matching every
 *     other stage's role in this pipeline.
 *
 * DEPENDENCIES
 *   - builder/RailBuilder.js
 *   - core/BuildSession.js
 *   - core/CancellationWatcher.js
 *   - core/ActiveBuildRegistry.js (Project Prompt 22)
 *   - ui/MessageService.js (injected)
 *   - utils/DirectionUtils.js
 *   - localization/LocalizationKeys.js
 *   - config/BuildModes.js (BuildingMode)
 *   - utils/Logger.js
 *   - ../PipelineResult.js
 */

export class PlacementStage {
  /**
   * @param {import("../../../builder/RailBuilder.js").RailBuilder} railBuilder
   * @param {import("../../CancellationWatcher.js").CancellationWatcher} cancellationWatcher
   * @param {import("../../../ui/MessageService.js").MessageService} messageService
   * @param {Readonly<Record<string, import("../../../builder/strategies/RailBuildStrategy.js")>>} strategiesByMode
   *   Added Project Prompt 16 — see ROADMAP PHASE 16 CHANGE above.
   * @param {import("../../ActiveBuildRegistry.js").ActiveBuildRegistry} activeBuildRegistry
   *   Added Project Prompt 22 — see MULTIPLAYER CONFLICT CLAIM above.
   */
  constructor(railBuilder, cancellationWatcher, messageService, strategiesByMode, activeBuildRegistry) {
    this.name = "PlacementStage";
    /** @private */
    this._railBuilder = railBuilder;
    /** @private */
    this._cancellationWatcher = cancellationWatcher;
    /** @private */
    this._messageService = messageService;
    /** @private */
    this._strategiesByMode = strategiesByMode;
    /** @private */
    this._activeBuildRegistry = activeBuildRegistry;
  }

  /**
   * @param {import("../PipelineContext.js").PipelineContext} context
   * @returns {Promise<PipelineResult>}
   */
  async execute(context) {
    const request = context.request;
    const { player, buildVector, buildingMode, bridgeHeight, undergroundDepth } = request;

    const strategy = this._strategiesByMode[buildingMode];
    const isBridge = buildingMode === BuildingMode.BRIDGE;
    const isUnderground = buildingMode === BuildingMode.UNDERGROUND;

    // Project Prompt 22 §7/§11, reordered Project Prompt 27: claim every
    // position this build will touch before doing anything else — in
    // particular, before the "construction started" chat message below, so
    // a rejected claim never follows a message claiming construction began.
    // Still synchronous and still before the one `await` further down, so
    // this remains race-free — see MULTIPLAYER CONFLICT CLAIM above.
    const claimResult = this._activeBuildRegistry.claim(player.id, context.buildPlan.modificationBoundary);
    if (!claimResult.claimed) {
      Logger.warn(
        `Placement rejected for ${player.name}: ${claimResult.conflictingKeys.length} position(s) already claimed by another active build.`
      );
      return PipelineResult.validationFailed(this.name, "RAIL_CONFLICT", LocalizationKeys.VALIDATION_RAIL_CONFLICT);
    }

    let path;
    let actualLength;
    if (isBridge) {
      path = context.bridgePlan;
      actualLength = path.requiredRailCount + path.requiredSupportBlockCount;
      this._messageService.sendChat(player, LocalizationKeys.BRIDGE_CONSTRUCTION_STARTED, [
        path.requiredRailCount,
        bridgeHeight,
        DirectionUtils.toDisplayName(buildVector.direction),
      ]);
    } else if (isUnderground) {
      path = context.undergroundPlan;
      // Unlike BRIDGE, `targetLength` counts ONLY rails: excavation is not
      // a placement and never increments `session.blocksPlaced` (see
      // UndergroundExecutionStrategy — it delegates excavation to
      // TunnelExcavator and increments only after a rail is placed). Using
      // rail count alone here is what keeps `completed` correct.
      actualLength = path.requiredRailCount;
      this._messageService.sendChat(player, LocalizationKeys.UNDERGROUND_CONSTRUCTION_STARTED, [
        path.requiredRailCount,
        undergroundDepth,
        DirectionUtils.toDisplayName(buildVector.direction),
      ]);
    } else {
      path = context.terrainReport.positions;
      // path.length may exceed request.requestedLength if a tunnel extended
      // the build (Project Prompt 14, second round) — the player is told the
      // real, final number they're about to see built, not the stale
      // original request. See BuildSession.js's header for the same fix
      // applied to the build-loop logic itself.
      actualLength = path.length;
      this._messageService.sendChat(player, LocalizationKeys.CONSTRUCTION_STARTED, [
        actualLength,
        DirectionUtils.toDisplayName(buildVector.direction),
      ]);
    }

    const session = new BuildSession(request, actualLength);
    context.buildSession = session;
    this._cancellationWatcher.registerSession(player.id, session);

    try {
      const buildResult = await this._railBuilder.run(session, path, strategy);
      context.placementResult = buildResult;

      Logger.info(
        `Placement finished for ${player.name}: ${buildResult.blocksPlaced}/${actualLength} placed, ` +
          `completed=${buildResult.completed}${buildResult.stopReason ? `, stopReason=${buildResult.stopReason}` : ""}.`
      );

      if (buildResult.completed) {
        if (isBridge) {
          this._messageService.sendChat(player, LocalizationKeys.BRIDGE_CONSTRUCTION_COMPLETE, [
            path.requiredRailCount,
            bridgeHeight,
            DirectionUtils.toDisplayName(buildVector.direction),
          ]);
        } else if (isUnderground) {
          this._messageService.sendChat(player, LocalizationKeys.UNDERGROUND_CONSTRUCTION_COMPLETE, [
            path.requiredRailCount,
            undergroundDepth,
            DirectionUtils.toDisplayName(buildVector.direction),
          ]);
          // Ore accounting, per Project Prompt 17's "do NOT silently
          // destroy ores." Sent only when there were any, so an ordinary
          // dirt-and-stone tunnel doesn't get a pointless "0 ores" line.
          if (path.terrainSummary.commonOresExcavated > 0) {
            this._messageService.sendChat(player, LocalizationKeys.UNDERGROUND_ORES_EXCAVATED, [
              path.terrainSummary.commonOresExcavated,
            ]);
          }
        }
        return PipelineResult.success();
      }
      if (session.isCancelled()) {
        return PipelineResult.cancelled(this.name, session.cancelReason);
      }
      // Stopped partway through for a real reason (terrain changed, ran out
      // of resources, chunk unloaded, a placement error) — keep what was
      // placed (Project Prompt 2's finalized interruption policy), report why.
      return PipelineResult.validationFailed(
        this.name,
        buildResult.stopReason ?? "PLACEMENT_STOPPED",
        LocalizationKeys.CONSTRUCTION_STOPPED,
        [buildResult.blocksPlaced, actualLength]
      );
    } finally {
      this._cancellationWatcher.unregisterSession(player.id);
      this._activeBuildRegistry.release(player.id);
    }
  }
}
