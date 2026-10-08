import { LocalizationKeys } from "../../../localization/LocalizationKeys.js";
import { Logger } from "../../../utils/Logger.js";
import { PipelineResult } from "../PipelineResult.js";
import { BuildingMode } from "../../../config/BuildModes.js";
import { formatBlockDisplayName } from "../../../utils/BlockDisplayName.js";
import { heldRailsRequired } from "../../ExtrasPlan.js";

/**
 * InventoryStage.js
 *
 * PURPOSE
 *   Fifth pipeline stage. For NORMAL mode: builds an InventoryReport (see
 *   inventory/InventoryManager.js) for the request's rail type and
 *   requested length, then asks ResourceValidator (see
 *   inventory/ResourceValidator.js) whether that's sufficient. For BRIDGE
 *   mode (Project Prompt 16): builds and validates TWO reports — rails
 *   (`context.bridgePlan.requiredRailCount`) and bridge material
 *   (`context.bridgePlan.requiredSupportBlockCount`) — checking rails
 *   first, then material, stopping at whichever fails first (same
 *   stop-at-first-failure convention every other validator in this project
 *   already follows). Creative Mode bypasses BOTH quantity checks;
 *   Survival requires an exact count for BOTH.
 *
 *   Both/all reports are read fresh every time this stage runs — nothing
 *   is cached from earlier in the pipeline — because inventory and game
 *   mode can both change while the menu was open or while earlier stages
 *   ran. See ARCHITECTURE.md §23 for the full security reasoning.
 *
 * ROADMAP PHASE 16 REUSE NOTE (Project Prompt 16): InventoryManager's
 * rail-specific-sounding method names, reused unchanged for a second item
 *   `InventoryManager.buildReport`/`countRailItems`/`deductRailItems` all
 *   take a plain `railTypeId` string parameter and never actually assume
 *   it's a rail — the implementation only ever does `item.typeId ===
 *   railTypeId`. Calling them with the player's chosen bridge material ID
 *   (`request.bridgeMaterialId` — a fixed `"minecraft:cobblestone"`
 *   through Project Prompt 16, now player-selected as of the bugfix pass
 *   before Project Prompt 18 — see core/BuildRequest.js) works correctly,
 *   unchanged, today. The method/parameter NAMES are now misleading for
 *   this second call site — flagged as technical debt (a future rename to
 *   `countItems`/`deductItems`/`itemTypeId`) rather than renamed this
 *   session, to avoid touching a stable, already-tested file without a
 *   functional reason. See ARCHITECTURE.md §44.7 and TODO.md.
 *
 * BUG FIX (Project Prompt 14, second round): checks the ACTUAL scanned
 * length, not the originally requested one (NORMAL mode only)
 *   This stage previously built its InventoryReport from
 *   `context.request.requestedLength` — but a tunnel encountered during
 *   scanning can extend the build past what was originally requested (up
 *   to the hard `RailConfig.LENGTH_PRESETS.MAX_SURVIVAL` ceiling — see
 *   terrain/TerrainScanner.js's `scanPath()`). Checking inventory against
 *   the smaller, stale `requestedLength` would have under-counted how many
 *   rails a Survival player actually needs. `context.terrainReport.positions.length`
 *   (the real, final count) is used instead for NORMAL mode.
 *   BRIDGE mode has no equivalent extension concept — `planBridge()`
 *   always plans exactly `requestedLength` positions or rejects outright
 *   (see terrain/BridgePlan.js) — so `context.bridgePlan.requiredRailCount`
 *   is already the correct, final count with no analogous staleness risk.
 *
 * RESPONSIBILITIES
 *   - Build fresh InventoryReport(s) and attach to `context.inventoryCheck`
 *     (rails, both modes) and, for BRIDGE mode, `context.bridgeInventoryCheck`
 *     (bridge material).
 *   - Read the player's current game mode fresh (not cached) and ask
 *     ResourceValidator for a decision, once per report.
 *   - Send a brief "Checking inventory..." actionbar ping on entry, and —
 *     only on success — a "Validation successful." actionbar.
 *   - On rejection, return VALIDATION_FAILED with the exact message key and
 *     substitutions (e.g. the missing quantity).
 *   - Never place blocks, never deduct items.
 *
 * PROJECT PROMPT 21 — HONEST "REQUIRED RAILS/MATERIAL" REVEAL
 *   ui/BuildMenu.js's Build Summary screen shows "Required Rails" using the
 *   requested length (cheap, known before any scan) and, for Bridge Mode,
 *   a material line reading "(calculated automatically)" instead of a real
 *   quantity — showing a real number there would mean running planBridge()'s
 *   full route scan just to render a form, which the UI polish pass's
 *   Performance requirement forbids. The real numbers ARE known by the time
 *   this stage's checks pass (TerrainScanningStage has already run), so this
 *   stage sends one extra chat line on success revealing the actual
 *   required Rails count (all modes) and, for Bridge, the actual required
 *   material count too — the honest fulfillment of "Required Material: XX"
 *   at the first point it's truthfully known.
 *
 * PROJECT PROMPT 21 — MATERIAL NAME IN THE BRIDGE MATERIAL REJECTION MESSAGE
 *   ResourceValidator's substitutions are generic ([requiredQuantity,
 *   totalAvailable]) since it never sees a material's display name. The
 *   Bridge material rejection message ("Not enough Stone Bricks.\nRequired:
 *   84\nAvailable: 60") needs the name prepended, so `_executeBridgeCheck()`
 *   builds its own substitutions array here rather than forwarding
 *   ResourceValidator's directly, using the same formatBlockDisplayName()
 *   utility ui/BuildMenu.js uses for its material button labels (see that
 *   utility's own header for why this was extracted rather than duplicated
 *   a second time).
 *
 * DEPENDENCIES
 *   - inventory/InventoryManager.js
 *   - inventory/ResourceValidator.js
 *   - ui/MessageService.js (injected)
 *   - localization/LocalizationKeys.js
 *   - config/BuildModes.js (BuildingMode)
 *   - config/BridgeConfig.js (Project Prompt 16)
 *   - utils/BlockDisplayName.js (Project Prompt 21)
 *   - ../PipelineResult.js
 *   - utils/Logger.js
 */

export class InventoryStage {
  /**
   * @param {import("../../../inventory/InventoryManager.js").InventoryManager} inventoryManager
   * @param {import("../../../inventory/ResourceValidator.js").ResourceValidator} resourceValidator
   * @param {import("../../../ui/MessageService.js").MessageService} messageService
   */
  constructor(inventoryManager, resourceValidator, messageService) {
    this.name = "InventoryStage";
    /** @private */
    this._inventoryManager = inventoryManager;
    /** @private */
    this._resourceValidator = resourceValidator;
    /** @private */
    this._messageService = messageService;
  }

  /**
   * @param {import("../PipelineContext.js").PipelineContext} context
   * @returns {PipelineResult}
   */
  execute(context) {
    const { player, railTypeId, buildingMode, bridgeMaterialId } = context.request;

    this._messageService.sendActionBar(player, LocalizationKeys.ACTIONBAR_CHECKING_INVENTORY);
    // Read fresh, not cached from GameModeValidator's earlier check — more
    // time has passed, and this decision (Creative bypass vs. Survival
    // exact-count) specifically depends on the current mode.
    const gameMode = player.getGameMode();

    if (buildingMode === BuildingMode.BRIDGE) {
      return this._executeBridgeCheck(context, player, railTypeId, bridgeMaterialId, gameMode);
    }

    // UNDERGROUND (Project Prompt 17): rails only — excavation consumes no
    // items and grants none (the established Project Prompt 12 decision,
    // see builder/TunnelExcavator.js), so unlike BRIDGE there is no second
    // material to account for. `plan.requiredRailCount` is already the
    // exact, final count (planUnderground() plans exactly `requestedLength`
    // positions or rejects outright — no tunnel-style extension concept
    // applies), so there is no staleness risk of the kind the NORMAL branch
    // below had to be fixed for.
    const requiredLength =
      buildingMode === BuildingMode.UNDERGROUND
        ? context.undergroundPlan.requiredRailCount
        : // context.terrainReport.positions.length is the ACTUAL final count —
          // may exceed context.request.requestedLength if a tunnel extended the
          // build (Project Prompt 14, second round). See this file's header.
          context.terrainReport.positions.length;

    // v2.0.0 Step 4: affordable boosters replace held rails — see core/ExtrasPlan.js.
    const report = this._inventoryManager.buildReport(
      player,
      railTypeId,
      heldRailsRequired(this._inventoryManager, player, context.request, requiredLength)
    );
    context.inventoryCheck = report;

    const validation = this._resourceValidator.validate(report, gameMode, "RAILS");

    if (!validation.valid) {
      Logger.debug(
        `Inventory check failed for ${player.name}: ${validation.reason} ` +
          `(have ${report.totalAvailable}, need ${report.requiredQuantity}, missing ${report.missingQuantity})`
      );
      return PipelineResult.validationFailed(this.name, validation.reason, validation.localizationKey, validation.substitutions);
    }

    Logger.info(
      `Inventory check passed for ${player.name}: ${report.totalAvailable}/${report.requiredQuantity} ` +
        `${report.railTypeId} (${validation.reason === "CREATIVE_BYPASS" ? "Creative bypass" : "Survival verified"}).`
    );
    this._messageService.sendActionBar(player, LocalizationKeys.ACTIONBAR_VALIDATION_SUCCESSFUL);
    this._messageService.sendChat(player, LocalizationKeys.INVENTORY_REQUIRED_RAILS_SUMMARY, [report.requiredQuantity]);
    return PipelineResult.success();
  }

  /**
   * Added Project Prompt 16 — BRIDGE mode's two-report check. Kept as its
   * own method so `execute()`'s mode branch stays easy to read.
   * @param {import("../PipelineContext.js").PipelineContext} context
   * @param {import("@minecraft/server").Player} player
   * @param {string} railTypeId
   * @param {import("@minecraft/server").GameMode} gameMode
   * @returns {PipelineResult}
   * @private
   */
  _executeBridgeCheck(context, player, railTypeId, bridgeMaterialId, gameMode) {
    const plan = context.bridgePlan;

    const railReport = this._inventoryManager.buildReport(
      player,
      railTypeId,
      heldRailsRequired(this._inventoryManager, player, context.request, plan.requiredRailCount)
    );
    context.inventoryCheck = railReport;
    const railValidation = this._resourceValidator.validate(railReport, gameMode, "RAILS");
    if (!railValidation.valid) {
      Logger.debug(
        `Bridge inventory check failed for ${player.name} (rails): ${railValidation.reason} ` +
          `(have ${railReport.totalAvailable}, need ${railReport.requiredQuantity}, missing ${railReport.missingQuantity})`
      );
      return PipelineResult.validationFailed(this.name, railValidation.reason, railValidation.localizationKey, railValidation.substitutions);
    }

    // As of the bugfix pass before Project Prompt 18, `bridgeMaterialId`
    // is the player's OWN choice (see ui/BuildMenu.js's
    // `promptForBridgeMaterial()`), not a fixed constant — this stage
    // still reuses `buildReport()`'s generic `railTypeId`-named parameter
    // for it (see ROADMAP PHASE 16 REUSE NOTE above), just with a real
    // per-player value now instead of always the same one.
    const materialReport = this._inventoryManager.buildReport(player, bridgeMaterialId, plan.requiredSupportBlockCount);
    context.bridgeInventoryCheck = materialReport;
    const materialValidation = this._resourceValidator.validate(materialReport, gameMode, "MATERIAL");
    const materialDisplayName = formatBlockDisplayName(bridgeMaterialId);
    if (!materialValidation.valid) {
      Logger.debug(
        `Bridge inventory check failed for ${player.name} (material): ${materialValidation.reason} ` +
          `(have ${materialReport.totalAvailable}, need ${materialReport.requiredQuantity}, missing ${materialReport.missingQuantity})`
      );
      // Prepend the material's display name — ResourceValidator's own
      // substitutions are generic ([requiredQuantity, totalAvailable]), it
      // never sees a display name. See this file's header.
      return PipelineResult.validationFailed(
        this.name,
        materialValidation.reason,
        LocalizationKeys.INVENTORY_INSUFFICIENT_BRIDGE_MATERIAL,
        [materialDisplayName, ...materialValidation.substitutions]
      );
    }

    Logger.info(
      `Bridge inventory check passed for ${player.name}: ${railReport.totalAvailable}/${railReport.requiredQuantity} rails, ` +
        `${materialReport.totalAvailable}/${materialReport.requiredQuantity} material ` +
        `(${railValidation.reason === "CREATIVE_BYPASS" ? "Creative bypass" : "Survival verified"}).`
    );
    this._messageService.sendActionBar(player, LocalizationKeys.ACTIONBAR_VALIDATION_SUCCESSFUL);
    this._messageService.sendChat(player, LocalizationKeys.INVENTORY_REQUIRED_BRIDGE_SUMMARY, [
      railReport.requiredQuantity,
      materialDisplayName,
      materialReport.requiredQuantity,
    ]);
    return PipelineResult.success();
  }
}
