import { EquipmentSlot } from "@minecraft/server";
import { LocalizationKeys } from "../../../localization/LocalizationKeys.js";
import { Logger } from "../../../utils/Logger.js";
import { PipelineResult } from "../PipelineResult.js";
import { BuildingMode } from "../../../config/BuildModes.js";
import { BuildPlan } from "../../BuildPlan.js";
import { formatBlockDisplayName } from "../../../utils/BlockDisplayName.js";
import { heldRailsRequired } from "../../ExtrasPlan.js";

/**
 * BuildPlanStage.js
 *
 * PURPOSE
 *   Added Project Prompt 22 ("Smart Build Preview, Validation & Safety").
 *   Eighth pipeline stage, running immediately after FinalSafetyCheckStage
 *   and immediately before PlacementStage — the very last checkpoint before
 *   any block is placed. Two responsibilities, both scoped tightly to
 *   "immediately before construction," per Project Prompt 22 §10:
 *
 *   1. RE-VALIDATE what could have changed since it was last checked, but
 *      that FinalSafetyCheckStage's terrain/plan re-scan does NOT cover:
 *      the player still being connected, still in the same dimension, still
 *      holding the same rail item, and the inventory still having enough
 *      rails (and, for BRIDGE, enough of the chosen material). Everything
 *      ELSE Project Prompt 22 §10 lists (Length/Mode/Height/Depth) cannot
 *      actually go stale — `BuildRequest` is immutable once created (see
 *      core/BuildRequest.js), so there is nothing there TO re-check beyond
 *      what FinalSafetyCheckStage already does by re-planning against those
 *      same fixed values. "Build area"/"Existing rails"/"Required chunks"
 *      are exactly what FinalSafetyCheckStage's fresh re-scan/re-plan
 *      already confirms, immediately before this stage runs — see that
 *      file's own header for why re-scanning right before placement isn't
 *      wasteful duplication (Project Prompt 22 §12) but a deliberate,
 *      one-time final safety gate, the exact same reasoning extended here
 *      to inventory.
 *   2. ASSEMBLE `context.buildPlan` (see ../../BuildPlan.js) from the now
 *      doubly-fresh data — the single, complete plan object Project Prompt
 *      22 §1 asked for, consumed by PlacementStage for its world
 *      modification boundary and multiplayer conflict check (§7/§11).
 *
 * WHY A FRESH INVENTORY READ HERE ISN'T "REPEATED SCANNING" (Project Prompt
 * 22 §12's Performance requirement)
 *   InventoryStage already checked resources once, earlier. Reading
 *   inventory again here is a second read of the SAME already-known
 *   required quantities (no new terrain scan, no new plan computation) —
 *   cheap, and done exactly once, right before the one truly irreversible
 *   step. This mirrors FinalSafetyCheckStage's own terrain re-scan
 *   precisely: neither is "duplicate work avoided by design," both are
 *   "the same cheap check run twice on purpose, at the two moments that
 *   actually matter" (once when the request is made, once immediately
 *   before it becomes irreversible).
 *
 * RESPONSIBILITIES
 *   - Re-check player validity, dimension, held item, and inventory.
 *   - On any failure: return VALIDATION_FAILED with zero world
 *     modifications made — this stage never places a block, never deducts
 *     an item.
 *   - On success: attach `context.buildPlan`.
 *
 * DEPENDENCIES
 *   - @minecraft/server (EquipmentSlot)
 *   - localization/LocalizationKeys.js
 *   - config/BuildModes.js (BuildingMode)
 *   - core/BuildPlan.js
 *   - utils/BlockDisplayName.js
 *   - utils/Logger.js
 *   - ../PipelineResult.js
 */

export class BuildPlanStage {
  /**
   * @param {import("../../../inventory/InventoryManager.js").InventoryManager} inventoryManager
   * @param {import("../../../inventory/ResourceValidator.js").ResourceValidator} resourceValidator
   */
  constructor(inventoryManager, resourceValidator) {
    this.name = "BuildPlanStage";
    /** @private */
    this._inventoryManager = inventoryManager;
    /** @private */
    this._resourceValidator = resourceValidator;
  }

  /**
   * @param {import("../PipelineContext.js").PipelineContext} context
   * @returns {PipelineResult}
   */
  execute(context) {
    const request = context.request;
    const player = request.player;

    if (!player || !player.isValid) {
      // No localizationKey — a player who has disconnected can't receive one
      // (same reasoning as core/validation/PlayerValidator.js).
      Logger.warn(`BuildPlanStage: player invalid immediately before construction (was ${request.player?.name ?? "unknown"}).`);
      return PipelineResult.validationFailed(this.name, "PLAYER_INVALID");
    }

    if ((player.dimension?.id ?? player.dimension) !== (request.dimension?.id ?? request.dimension)) {
      Logger.warn(`BuildPlanStage: ${player.name} changed dimension between planning and construction.`);
      return PipelineResult.validationFailed(this.name, "INVALID_DIMENSION", LocalizationKeys.VALIDATION_DIMENSION_CHANGED);
    }

    const equippable = player.getComponent("minecraft:equippable");
    const heldItem = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (!heldItem || heldItem.typeId !== request.railTypeId) {
      Logger.warn(`BuildPlanStage: ${player.name} is no longer holding ${request.railTypeId} immediately before construction.`);
      return PipelineResult.validationFailed(this.name, "ITEM_CHANGED", LocalizationKeys.VALIDATION_ITEM_CHANGED);
    }

    const gameMode = player.getGameMode();
    const requiredRailCount =
      request.buildingMode === BuildingMode.BRIDGE
        ? context.bridgePlan.requiredRailCount
        : request.buildingMode === BuildingMode.UNDERGROUND
          ? context.undergroundPlan.requiredRailCount
          : context.terrainReport.positions.length;

    const railReport = this._inventoryManager.buildReport(
      player,
      request.railTypeId,
      heldRailsRequired(this._inventoryManager, player, request, requiredRailCount) // v2.0.0 Step 4
    );
    const railValidation = this._resourceValidator.validate(railReport, gameMode, "RAILS");
    if (!railValidation.valid) {
      Logger.warn(
        `BuildPlanStage: ${player.name}'s rail count changed since InventoryStage checked it ` +
          `(have ${railReport.totalAvailable}, need ${railReport.requiredQuantity}).`
      );
      return PipelineResult.validationFailed(
        this.name,
        "INVENTORY_CHANGED_BEFORE_BUILD",
        LocalizationKeys.INVENTORY_INSUFFICIENT,
        railValidation.substitutions
      );
    }

    if (request.buildingMode === BuildingMode.BRIDGE) {
      const materialReport = this._inventoryManager.buildReport(
        player,
        request.bridgeMaterialId,
        context.bridgePlan.requiredSupportBlockCount
      );
      const materialValidation = this._resourceValidator.validate(materialReport, gameMode, "MATERIAL");
      if (!materialValidation.valid) {
        Logger.warn(
          `BuildPlanStage: ${player.name}'s bridge material count changed since InventoryStage checked it ` +
            `(have ${materialReport.totalAvailable}, need ${materialReport.requiredQuantity}).`
        );
        return PipelineResult.validationFailed(
          this.name,
          "MATERIAL_CHANGED_BEFORE_BUILD",
          LocalizationKeys.INVENTORY_INSUFFICIENT_BRIDGE_MATERIAL,
          [formatBlockDisplayName(request.bridgeMaterialId), ...materialValidation.substitutions]
        );
      }
    }

    context.buildPlan = BuildPlan.fromContext(context);
    return PipelineResult.success();
  }
}
