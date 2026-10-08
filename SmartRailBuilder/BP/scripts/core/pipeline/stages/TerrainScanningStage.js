import { DirectionUtils } from "../../../utils/DirectionUtils.js";
import { LocalizationKeys } from "../../../localization/LocalizationKeys.js";
import { Logger } from "../../../utils/Logger.js";
import { PipelineResult } from "../PipelineResult.js";
import { BuildingMode } from "../../../config/BuildModes.js";
import { BridgeRejectionReason } from "../../../terrain/BridgePlan.js";
import { UndergroundRejectionReason } from "../../../terrain/UndergroundPlan.js";
import { currentTick } from "../../../utils/Tick.js";

/**
 * TerrainScanningStage.js
 *
 * PURPOSE
 *   Fourth pipeline stage. For NORMAL mode: calls `TerrainScanner.scanPath()`,
 *   attaches the resulting `TerrainScanResult` to `context.terrainReport`,
 *   then hands that report to `PathValidator` for the accept/reject
 *   decision. For BRIDGE mode (Project Prompt 16): calls
 *   `TerrainScanner.planBridge()` instead, attaches the resulting
 *   `BridgePlan` to `context.bridgePlan`, and uses `BridgeValidation` for
 *   its own accept/reject decision — a structurally parallel but distinct
 *   path, since a BridgePlan's shape has nothing in common with a
 *   TerrainScanResult's (see terrain/BridgePlan.js's header for why).
 *
 * ROADMAP PHASE 16 CHANGE: MODE-AWARE BRANCH (Project Prompt 16)
 *   The NORMAL-mode branch below is copied verbatim from the previous
 *   session — not one line changed — per Project Prompt 16's explicit "do
 *   NOT redesign Normal Mode." The BRIDGE branch is entirely new and does
 *   not touch `context.terrainReport`/`context.pathValidationResult` at
 *   all, so a bug in bridge planning can never leak a stale or
 *   wrong-shaped value into those fields for a NORMAL build (mode is fixed
 *   for the lifetime of one BuildRequest, so this distinction is safe by
 *   construction, not just by convention).
 *
 * HISTORY: THE `buildReady` SHORTCUT THIS REPLACES (introduced Project
 * Prompt 8, removed Project Prompt 11)
 *   From Project Prompt 8 through Project Prompt 10, this stage read
 *   `scanResult.buildReady` directly (true only if every position was
 *   FLAT_SAFE) instead of calling PathValidator, because PathValidator was
 *   still a stub and the pipeline needed *some* way to let a fully clean
 *   path continue to InventoryStage/PlacementStage for real end-to-end
 *   testing. That was explicitly documented as an interim measure, never a
 *   substitute for PathValidator — see TODO.md's Project Prompt 8 entry.
 *   That shortcut is gone now: this stage no longer reads `buildReady` at
 *   all. (`TerrainScanner` still computes `buildReady` — FinalSafetyCheckStage
 *   still uses it for its own, simpler "did anything change" re-check; see
 *   that file. This stage's own decision now comes entirely from PathValidator.)
 *
 * DEPENDENCIES
 *   - ../PipelineResult.js
 *   - terrain/TerrainScanner.js (scanPath, and planBridge as of Project Prompt 16)
 *   - terrain/PathValidator.js — NORMAL mode's accept/reject decision
 *   - terrain/BridgeValidation.js — BRIDGE mode's accept/reject decision (Project Prompt 16, injected)
 *   - terrain/BridgePlan.js (BridgeRejectionReason, for the message lookup)
 *   - config/BuildModes.js (BuildingMode)
 *   - utils/DirectionUtils.js (toDisplayName, for the confirmation message)
 *   - localization/LocalizationKeys.js
 *   - utils/Logger.js
 *   - ui/MessageService.js (injected, for the direction confirmation and the
 *     "Analyzing terrain..."/"Planning Bridge..." actionbar ping)
 */

/**
 * Maps a BridgePlan's rejectionReason to a player-facing message. Kept as
 * one table right here, mirroring PathValidator.js's own
 * REASON_TO_LOCALIZATION_KEY convention — a new bridge rejection reason
 * and its message are always added together.
 * @type {Readonly<Record<string, string>>}
 */
const BRIDGE_REJECTION_TO_LOCALIZATION_KEY = Object.freeze({
  [BridgeRejectionReason.LENGTH_TOO_SHORT_FOR_HEIGHT]: LocalizationKeys.PATH_REJECTED_BRIDGE_LENGTH_TOO_SHORT,
  [BridgeRejectionReason.BLOCKED_BY_TERRAIN]: LocalizationKeys.PATH_REJECTED_BRIDGE_BLOCKED_TERRAIN,
  [BridgeRejectionReason.BLOCKED_BY_UNBREAKABLE]: LocalizationKeys.PATH_REJECTED_BRIDGE_BLOCKED_UNBREAKABLE,
  [BridgeRejectionReason.BLOCKED_BY_HAZARD]: LocalizationKeys.PATH_REJECTED_BRIDGE_BLOCKED_HAZARD,
  [BridgeRejectionReason.BLOCKED_BY_LIQUID]: LocalizationKeys.PATH_REJECTED_BRIDGE_BLOCKED_LIQUID,
  [BridgeRejectionReason.SUPPORT_HAZARD]: LocalizationKeys.PATH_REJECTED_BRIDGE_SUPPORT_HAZARD,
  [BridgeRejectionReason.SUPPORT_UNAVAILABLE]: LocalizationKeys.PATH_REJECTED_BRIDGE_SUPPORT_UNAVAILABLE,
  [BridgeRejectionReason.UNLOADED_CHUNK]: LocalizationKeys.PATH_REJECTED_UNLOADED,
  [BridgeRejectionReason.OUT_OF_BOUNDS]: LocalizationKeys.PATH_REJECTED_OUT_OF_BOUNDS,
});

/**
 * Underground Mode's equivalent of the bridge table above (Project Prompt
 * 17). Kept as its own table rather than merged into one shared map: the
 * two modes fail for genuinely different reasons and deserve genuinely
 * different wording, and a merged table would need every entry keyed by
 * mode anyway.
 * @type {Readonly<Record<string, string>>}
 */
const UNDERGROUND_REJECTION_TO_LOCALIZATION_KEY = Object.freeze({
  [UndergroundRejectionReason.LENGTH_TOO_SHORT_FOR_DEPTH]: LocalizationKeys.PATH_REJECTED_UNDERGROUND_LENGTH_TOO_SHORT,
  [UndergroundRejectionReason.BLOCKED_BY_UNBREAKABLE]: LocalizationKeys.PATH_REJECTED_UNDERGROUND_UNBREAKABLE,
  [UndergroundRejectionReason.BLOCKED_BY_HAZARD]: LocalizationKeys.PATH_REJECTED_UNDERGROUND_HAZARD,
  [UndergroundRejectionReason.BLOCKED_BY_LAVA]: LocalizationKeys.PATH_REJECTED_UNDERGROUND_LAVA,
  [UndergroundRejectionReason.BLOCKED_BY_WATER]: LocalizationKeys.PATH_REJECTED_UNDERGROUND_WATER,
  [UndergroundRejectionReason.PROTECTED_ORE]: LocalizationKeys.PATH_REJECTED_UNDERGROUND_PROTECTED_ORE,
  [UndergroundRejectionReason.UNSUPPORTED_FLOOR]: LocalizationKeys.PATH_REJECTED_UNDERGROUND_UNSUPPORTED_FLOOR,
  [UndergroundRejectionReason.UNLOADED_CHUNK]: LocalizationKeys.PATH_REJECTED_UNLOADED,
  [UndergroundRejectionReason.OUT_OF_BOUNDS]: LocalizationKeys.PATH_REJECTED_OUT_OF_BOUNDS,
});

export class TerrainScanningStage {
  /**
   * @param {import("../../../terrain/TerrainScanner.js").TerrainScanner} terrainScanner
   * @param {import("../../../terrain/PathValidator.js").PathValidator} pathValidator
   * @param {import("../../../ui/MessageService.js").MessageService} messageService
   * @param {import("../../../terrain/BridgeValidation.js").BridgeValidation} bridgeValidation Added Project Prompt 16.
   */
  constructor(terrainScanner, pathValidator, messageService, bridgeValidation, undergroundValidation) {
    this.name = "TerrainScanningStage";
    /** @private */
    this._terrainScanner = terrainScanner;
    /** @private */
    this._pathValidator = pathValidator;
    /** @private */
    this._messageService = messageService;
    /** @private */
    this._bridgeValidation = bridgeValidation;
    /** @private */
    this._undergroundValidation = undergroundValidation;
  }

  /**
   * @param {import("../PipelineContext.js").PipelineContext} context
   * @returns {PipelineResult}
   */
  execute(context) {
    const { player, dimension, buildVector, requestedLength, buildingMode, bridgeHeight, undergroundDepth } = context.request;

    // v2.0.0 optimization — see FinalSafetyCheckStage's SAME-TICK REUSE note.
    context.terrainScannedAtTick = currentTick();

    this._messageService.sendChat(player, LocalizationKeys.DIRECTION_CONFIRMED, [
      DirectionUtils.toDisplayName(buildVector.direction),
      requestedLength,
    ]);

    if (buildingMode === BuildingMode.BRIDGE) {
      return this._executeBridgePlanning(context, player, dimension, buildVector, requestedLength, bridgeHeight);
    }
    if (buildingMode === BuildingMode.UNDERGROUND) {
      return this._executeUndergroundPlanning(context, player, dimension, buildVector, requestedLength, undergroundDepth);
    }

    this._messageService.sendActionBar(player, LocalizationKeys.ACTIONBAR_ANALYZING_TERRAIN);

    const scanResult = this._terrainScanner.scanPath(buildVector, requestedLength, dimension);
    context.terrainReport = scanResult;

    Logger.info(
      `Terrain scan for ${player.name}: ${scanResult.safeCount}/${scanResult.totalScanned} safe ` +
        `(${scanResult.ascendingCount} ascending, ${scanResult.descendingCount} descending, ` +
        `${scanResult.tunnelCount} tunneled, ${scanResult.underwaterCount} underwater), ${scanResult.hazardCount} hazard(s), ` +
        `${scanResult.unsupportedCount} unsupported, ${scanResult.unloadedCount} unloaded.`
    );

    const validation = this._pathValidator.validate(scanResult);
    context.pathValidationResult = validation;

    if (!validation.valid) {
      const pos = validation.position;
      Logger.info(
        `Path rejected for ${player.name}: ${validation.reason}` +
          (pos ? ` at (${pos.x}, ${pos.y}, ${pos.z}).` : ".")
      );
      return PipelineResult.validationFailed(this.name, validation.reason, validation.localizationKey);
    }

    return PipelineResult.success();
  }

  /**
   * Added Project Prompt 16 — BRIDGE mode's equivalent of the NORMAL-mode
   * block above, kept as its own method rather than inlined so `execute()`'s
   * mode branch stays easy to read at a glance.
   * @private
   */
  _executeBridgePlanning(context, player, dimension, buildVector, requestedLength, bridgeHeight) {
    this._messageService.sendActionBar(player, LocalizationKeys.ACTIONBAR_PLANNING_BRIDGE);

    const plan = this._terrainScanner.planBridge(buildVector, requestedLength, dimension, bridgeHeight);

    if (plan.feasible) {
      const consistency = this._bridgeValidation.validate(plan);
      if (!consistency.valid) {
        // Should be unreachable if planBridge() is correct — a defensive
        // catch, same posture as PathValidator's own "fail safe on an
        // unrecognized classification" fallback. Logged loudly since this
        // would indicate a real bug in planBridge()'s own arithmetic, not
        // an ordinary terrain rejection.
        Logger.error(`Bridge plan failed its own internal consistency check for ${player.name}: ${consistency.reason}. Rejecting rather than trusting an inconsistent plan.`);
        context.bridgePlan = { feasible: false, rejectionReason: consistency.reason };
        return PipelineResult.validationFailed(this.name, consistency.reason, LocalizationKeys.GENERIC_ERROR);
      }
    }

    context.bridgePlan = plan;

    if (!plan.feasible) {
      Logger.info(
        `Bridge plan rejected for ${player.name}: ${plan.rejectionReason}` +
          (plan.rejectionPosition ? ` at (${plan.rejectionPosition.x}, ${plan.rejectionPosition.y}, ${plan.rejectionPosition.z}).` : ".")
      );
      const localizationKey = BRIDGE_REJECTION_TO_LOCALIZATION_KEY[plan.rejectionReason] ?? LocalizationKeys.PATH_REJECTED_TOO_STEEP;

      // Mirrors TerrainScanningStage's own UNDERGROUND handling directly
      // below — LENGTH_TOO_SHORT_FOR_HEIGHT is Bridge Mode's exact
      // structural counterpart of Underground's LENGTH_TOO_SHORT_FOR_DEPTH,
      // added in the bugfix pass before Project Prompt 18 alongside the
      // real ramp geometry that made the constraint possible in the first
      // place — see terrain/BridgePlan.js's MINIMUM LENGTH doc.
      const substitutions =
        plan.rejectionReason === BridgeRejectionReason.LENGTH_TOO_SHORT_FOR_HEIGHT
          ? [bridgeHeight, plan.minimumRequiredLength]
          : undefined;

      return PipelineResult.validationFailed(this.name, plan.rejectionReason, localizationKey, substitutions);
    }

    Logger.info(
      `Bridge plan for ${player.name}: ${plan.requiredRailCount} rail position(s), ` +
        `${plan.requiredSupportBlockCount} support/surface block(s) across ${plan.terrainSummary.columnsRequiringFill} column(s) ` +
        `(pier spacing ${plan.terrainSummary.pierSpacing}), start Y=${plan.deckPositions[0].position.y}, ` +
        `crest Y=${plan.deckPositions[0].position.y + plan.bridgeHeight} (height ${plan.bridgeHeight}).`
    );

    return PipelineResult.success();
  }

  /**
   * Added Project Prompt 17 — UNDERGROUND mode's equivalent of
   * `_executeBridgePlanning` above, structured identically on purpose.
   * @private
   */
  _executeUndergroundPlanning(context, player, dimension, buildVector, requestedLength, undergroundDepth) {
    this._messageService.sendActionBar(player, LocalizationKeys.ACTIONBAR_PLANNING_UNDERGROUND);

    const plan = this._terrainScanner.planUnderground(buildVector, requestedLength, dimension, undergroundDepth, {
      fillCaveGaps: context.request.fillCaveGaps,
    });

    if (plan.feasible) {
      const consistency = this._undergroundValidation.validate(plan);
      if (!consistency.valid) {
        // Should be unreachable if planUnderground() is correct — a
        // defensive catch, same posture as the bridge equivalent above.
        // Logged loudly since this would indicate a real bug in the ramp
        // arithmetic, not an ordinary terrain rejection.
        Logger.error(
          `Underground plan failed its own internal consistency check for ${player.name}: ${consistency.reason}. ` +
            "Rejecting rather than trusting an inconsistent plan."
        );
        context.undergroundPlan = { feasible: false, rejectionReason: consistency.reason };
        return PipelineResult.validationFailed(this.name, consistency.reason, LocalizationKeys.GENERIC_ERROR);
      }
    }

    context.undergroundPlan = plan;

    if (!plan.feasible) {
      Logger.info(
        `Underground plan rejected for ${player.name}: ${plan.rejectionReason}` +
          (plan.rejectionPosition ? ` at (${plan.rejectionPosition.x}, ${plan.rejectionPosition.y}, ${plan.rejectionPosition.z}).` : ".")
      );
      const localizationKey = UNDERGROUND_REJECTION_TO_LOCALIZATION_KEY[plan.rejectionReason] ?? LocalizationKeys.GENERIC_ERROR;

      // Two rejection messages carry substitutions the player needs in
      // order to act on them; everything else takes none. Kept as an
      // explicit small mapping rather than attaching substitutions to every
      // rejection generically, so an unrelated future reason can't silently
      // inherit the wrong ones.
      let substitutions;
      if (plan.rejectionReason === UndergroundRejectionReason.LENGTH_TOO_SHORT_FOR_DEPTH) {
        substitutions = [undergroundDepth, plan.minimumRequiredLength];
      } else if (plan.blockingBlockId) {
        substitutions = [plan.blockingBlockId];
      }

      return PipelineResult.validationFailed(this.name, plan.rejectionReason, localizationKey, substitutions);
    }

    Logger.info(
      `Underground plan for ${player.name}: ${plan.requiredRailCount} rail position(s) ` +
        `(${plan.terrainSummary.rampPositionCount} ramp + ${plan.terrainSummary.flatPositionCount} flat), ` +
        `${plan.totalExcavationCount} excavation position(s) of which ${plan.terrainSummary.alreadyClearCount} already clear, ` +
        `${plan.terrainSummary.commonOresExcavated} ore(s) in path, ${plan.terrainSummary.waterRowsSealed} row(s) waterproofed ` +
        `(${plan.totalSealCount} seal block(s)), railY=${plan.railY} (depth ${plan.depth}).`
    );

    return PipelineResult.success();
  }
}
