import { LENGTH_PRESETS } from "../../../config/RailConfig.js";
import { BUILD_MODE_REGISTRY, BuildingMode } from "../../../config/BuildModes.js";
import { LocalizationKeys } from "../../../localization/LocalizationKeys.js";
import { BuildRequest } from "../../BuildRequest.js";
import { BuildVector } from "../../BuildVector.js";
import { PipelineResult } from "../PipelineResult.js";
import { MenuAction } from "../../../ui/BuildMenu.js";

/**
 * BuildRequestCreationStage.js
 *
 * PURPOSE
 *   Second pipeline stage. Runs the full build-configuration UI flow
 *   (BuildMenu's mode screen -> [BRIDGE only: material screen] ->
 *   configuration screen -> summary screen) and, only if the player
 *   confirms every screen, constructs the immutable BuildRequest every
 *   later stage reads. Reports PipelineResultStatus.CANCELLED (not an
 *   error) if the player closes any screen or presses Cancel on the
 *   summary.
 *
 * RESPONSIBILITIES (Project Prompt 15 — expanded from a single length menu;
 * material screen added in the bugfix pass before Project Prompt 18)
 *   - Call BuildMenu.promptForMode, then — for BRIDGE specifically —
 *     scan the player's inventory (InventoryManager.scanPlaceableMaterials)
 *     and call BuildMenu.promptForBridgeMaterial, then
 *     BuildMenu.promptForConfiguration, then BuildMenu.promptForSummary —
 *     stopping and returning CANCELLED the moment any one of them reports
 *     cancellation. Each call is awaited in sequence; nothing here shows
 *     two screens at once or races them.
 *   - If the player has NO placeable materials at all, stop with a clear
 *     VALIDATION_FAILED (not a silent CANCELLED — see the inline comment
 *     at that check for why the distinction matters) rather than showing
 *     BuildMenu an empty, button-less form.
 *   - Compute a BuildVector (direction + origin) via `BuildVector.fromPlayer`
 *     TWICE, deliberately: once right before the summary screen (so it can
 *     show a real direction, not a placeholder), and again right after the
 *     player confirms Build — the same "state can change during an async
 *     round trip, re-verify closest to point of use" principle this
 *     project has applied since Project Prompt 6 (menu round trip) and
 *     Project Prompt 10 (per-block placement re-check). A player can turn
 *     to face a different direction during the summary screen exactly as
 *     easily as during the old single-slider menu.
 *   - Generate a `sessionId` for log correlation across this request's
 *     lifetime.
 *   - Attach the constructed BuildRequest — now also carrying
 *     `buildingMode`/`bridgeHeight`/`bridgeMaterialId`/`undergroundDepth`,
 *     see core/BuildRequest.js's BUILD CONFIGURATION MODEL note — to
 *     `context.request`.
 *
 * WHY BOUNDS COME FROM config/BuildModes.js, NOT HARDCODED HERE
 *   `BUILD_MODE_REGISTRY[mode].min/max/default` are read directly rather
 *   than this stage knowing "bridge is 1-16, underground is 1-20" itself —
 *   the same "one registry, no duplicated numbers" principle already used
 *   for LENGTH_PRESETS. A future mode's bounds need no change here.
 *
 * FUTURE EXTENSIONS
 *   - Direction/origin logic lives entirely in core/BuildVector.js, so a
 *     future change to how the origin is computed only touches that file.
 *   - A future mode needing its own extra screen (like BRIDGE's material
 *     screen) would follow the same shape: one conditional block, gated on
 *     `modeResult.mode`, between mode selection and configuration.
 *
 * DEPENDENCIES
 *   - ui/BuildMenu.js (injected)
 *   - inventory/InventoryManager.js (injected, bugfix pass before Project Prompt 18 — scanPlaceableMaterials only)
 *   - config/RailConfig.js (LENGTH_PRESETS)
 *   - config/BuildModes.js (BUILD_MODE_REGISTRY, BuildingMode)
 *   - localization/LocalizationKeys.js
 *   - core/BuildVector.js
 *   - core/BuildRequest.js
 *   - ../PipelineResult.js
 */

let _sessionCounter = 0;

/**
 * Generates a log-correlation ID. Not cryptographically unique — just
 * unique enough to tell two build requests apart in the Content Log.
 * @param {string} playerId
 * @returns {string}
 */
function generateSessionId(playerId) {
  _sessionCounter += 1;
  return `${playerId}_${Date.now()}_${_sessionCounter}`;
}

export class BuildRequestCreationStage {
  /**
   * @param {import("../../../ui/BuildMenu.js").BuildMenu} buildMenu
   * @param {import("../../../inventory/InventoryManager.js").InventoryManager} inventoryManager Added in the bugfix pass before Project Prompt 18.
   * @param {import("../../PlayerBuildSettings.js").PlayerBuildSettings} [buildSettings] v2.0.0 — enables "Repeat last build" and remembered slider values.
   * @param {import("../../UndoService.js").UndoService} [undoService] v2.0.0 — enables "Undo last build".
   */
  constructor(buildMenu, inventoryManager, buildSettings, undoService) {
    this.name = "BuildRequestCreationStage";
    /** @private */
    this._buildMenu = buildMenu;
    /** @private */
    this._inventoryManager = inventoryManager;
    /** @private */
    this._buildSettings = buildSettings;
    /** @private */
    this._undoService = undoService;
  }

  /**
   * @param {import("../PipelineContext.js").PipelineContext} context
   * @returns {Promise<PipelineResult>}
   */
  async execute(context) {
    // --- Screen 1: Building Mode (+ v2.0.0 Repeat / Undo shortcuts) ---
    const lastSettings = this._buildSettings?.get(context.player) ?? null;
    const modeResult = await this._buildMenu.promptForMode(context.player, {
      lastSettings,
      canUndo: this._undoService?.canUndo(context.player) ?? false,
    });
    if (modeResult.cancelled) {
      return PipelineResult.cancelled(this.name, "MODE_MENU_CLOSED");
    }

    // v2.0.0: Undo runs here and ends the pipeline — nothing is built.
    // CANCELLED keeps BuildOrchestrator silent; UndoService sends its own
    // result message.
    if (modeResult.action === MenuAction.UNDO) {
      await this._undoService.undoLast(context.player);
      return PipelineResult.cancelled(this.name, "UNDO_PERFORMED");
    }

    // v2.0.0: Repeat reuses the last confirmed settings and skips the
    // material and configuration screens. The summary screen still shows,
    // because direction always comes from where the player faces NOW.
    const repeating = modeResult.action === MenuAction.REPEAT && lastSettings !== null;
    const mode = repeating ? lastSettings.mode : modeResult.mode;

    // --- Screen 1.5 (BRIDGE only): Bridge Material ---
    let materialId;
    if (mode === BuildingMode.BRIDGE) {
      const materials = this._inventoryManager.scanPlaceableMaterials(context.player);

      // Not a menu-close cancellation — the player did nothing wrong, they
      // simply have nothing usable to build with. VALIDATION_FAILED (which
      // BuildOrchestrator always messages) is the right outcome here, not
      // CANCELLED (which BuildOrchestrator deliberately leaves silent for
      // this stage — see that file's own comment — since an ordinary
      // "closed the form" needs no explanation, but this does).
      if (materials.length === 0) {
        return PipelineResult.validationFailed(this.name, "NO_BRIDGE_MATERIALS", LocalizationKeys.MENU_NO_MATERIALS_AVAILABLE);
      }

      // Repeat keeps the last material only while the player still carries
      // it; otherwise they pick again rather than failing later.
      if (repeating && materials.some((material) => material.typeId === lastSettings.materialId)) {
        materialId = lastSettings.materialId;
      } else {
        const materialResult = await this._buildMenu.promptForBridgeMaterial(context.player, materials);
        if (materialResult.cancelled) {
          return PipelineResult.cancelled(this.name, "MATERIAL_MENU_CLOSED");
        }
        materialId = materialResult.materialId;
      }
    }

    // --- Screen 2: Mode Configuration (if applicable) + Railway Length ---
    // Skipped on Repeat; otherwise pre-filled from the last build (v2.0.0).
    let configResult;
    if (repeating) {
      configResult = { cancelled: false, length: lastSettings.length, modeValue: lastSettings.modeValue };
    } else {
      configResult = await this._buildMenu.promptForConfiguration(context.player, mode, {
        minLength: LENGTH_PRESETS.MIN,
        maxLength: LENGTH_PRESETS.MAX_SURVIVAL,
        step: LENGTH_PRESETS.STEP,
        defaultLength: lastSettings?.length ?? LENGTH_PRESETS.DEFAULT,
        defaultModeValue: lastSettings?.mode === mode ? lastSettings.modeValue : undefined,
      });
      if (configResult.cancelled) {
        return PipelineResult.cancelled(this.name, "CONFIG_MENU_CLOSED");
      }
    }

    // Computed here (not earlier) so the summary screen shows a real
    // direction — the menu round trips so far are async and the player
    // could have turned since triggering the build. See this file's header.
    let buildVector = BuildVector.fromPlayer(context.player);

    // --- Screen 3: Final Build Summary ---
    const summaryResult = await this._buildMenu.promptForSummary(context.player, {
      railTypeId: context.railTypeId,
      mode,
      modeValue: configResult.modeValue,
      materialId,
      length: configResult.length,
      direction: buildVector.direction,
    });
    if (summaryResult.cancelled || !summaryResult.confirmed) {
      return PipelineResult.cancelled(this.name, summaryResult.cancelled ? "SUMMARY_MENU_CLOSED" : "SUMMARY_CANCELLED");
    }

    // v2.0.0: remembered as soon as the player confirms, so "Repeat" offers
    // these settings next time even if this build later fails validation.
    this._buildSettings?.save(context.player, {
      mode,
      length: configResult.length,
      modeValue: configResult.modeValue,
      materialId,
    });

    // Re-computed fresh here, right before actually constructing the
    // request — the summary screen was itself another async round trip.
    // See this file's header for why this isn't considered redundant.
    buildVector = BuildVector.fromPlayer(context.player);

    const modeDef = BUILD_MODE_REGISTRY[mode];
    context.request = new BuildRequest({
      player: context.player,
      dimension: context.player.dimension,
      railTypeId: context.railTypeId,
      requestedLength: configResult.length,
      buildVector,
      sessionId: generateSessionId(context.player.id),
      buildingMode: mode,
      bridgeHeight: modeDef?.configField === "bridgeHeight" ? configResult.modeValue : undefined,
      bridgeMaterialId: materialId,
      undergroundDepth: modeDef?.configField === "undergroundDepth" ? configResult.modeValue : undefined,
    });

    return PipelineResult.success();
  }
}
