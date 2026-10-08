import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { BUILD_MODE_REGISTRY, BUILD_MODE_ORDER, BuildingMode } from "../config/BuildModes.js";
import { RAIL_TYPES } from "../config/RailConfig.js";
import { LocalizationKeys } from "../localization/LocalizationKeys.js";
import { DirectionUtils } from "../utils/DirectionUtils.js";
import { formatBlockDisplayName } from "../utils/BlockDisplayName.js";
import { Logger } from "../utils/Logger.js";

/**
 * BuildMenu.js
 *
 * PURPOSE
 *   Shows every ModalFormData/ActionFormData/MessageFormData screen that
 *   asks a player how Smart Rail Builder should construct their railway,
 *   and returns their answers (or the fact that they cancelled at any
 *   point). Never touches blocks or inventory.
 *
 * PROJECT PROMPT 15 — THREE-SCREEN FLOW, NOT FIVE FORMS
 *   The prompt's recommended flow describes 5 conceptual steps (rail type,
 *   mode, mode config, length, summary). This class implements all 5 as
 *   exactly 3 form round trips, per the prompt's own "adapt the flow if the
 *   current UI architecture has a better design... do not create
 *   unnecessary forms" allowance:
  *     1. Rail type — NOT a new form. This addon has always determined rail
 *        type from the item the player is holding at the moment they
 *        trigger the menu (RailDetectionStage, unchanged since Roadmap
 *        Phase 3) — asking again in a form would let a player pick a
 *        different rail than what's in their hand, which HeldItemValidator
 *        would then immediately reject. The held rail is shown as context
 *        text on screens 2 and 3 instead.
 *     2. `promptForMode()` — ActionFormData, one button per
 *        config/BuildModes.js registry entry (NORMAL/BRIDGE/UNDERGROUND
 *        today; future modes need no change here, see that file).
 *     2.5. `promptForBridgeMaterial()` — BRIDGE mode only, added in the
 *        bugfix pass before Project Prompt 18. ActionFormData, one button
 *        per distinct placeable block currently in the player's inventory
 *        (see inventory/InventoryManager.js's `scanPlaceableMaterials()`).
 *        Skipped entirely for NORMAL/UNDERGROUND — this is the one place
 *        the "3 screens for every mode" count from Project Prompt 15 grew
 *        to 4, specifically for BRIDGE, since material selection has no
 *        equivalent in the other two modes.
 *     3. `promptForConfiguration()` — ONE ModalFormData combining the
 *        prompt's steps 3 (mode config) and 4 (length): a height/depth
 *        slider is added only for modes with `requiresConfig: true`, then
 *        the length slider always follows. Two round trips saved versus
 *        showing them separately.
 *     4. `promptForSummary()` — MessageFormData, the prompt's step 5,
 *        showing every chosen value (including the material, for BRIDGE)
 *        with dedicated Build/Cancel buttons distinct from step 3's
 *        "Next" button, so a player can never confuse "confirm this
 *        screen" with "start construction" (Project Prompt 15's "no
 *        accidental construction" requirement).
 *   BuildRequestCreationStage (../core/pipeline/stages/BuildRequestCreationStage.js)
 *   is what actually chains these three calls together and reacts to a
 *   cancellation at any of them — this class only knows how to show one
 *   screen at a time and report what happened.
 *
 * WHY ActionFormData / ModalFormData / MessageFormData, NOT CustomForm
 *   Unchanged reasoning from Project Prompt 4 (see this file's prior
 *   header): this is a short, linear, one-directional flow with no live
 *   two-way binding needed between screens — each screen's inputs are
 *   fully known before it's shown. CustomForm ("Data-Driven UI") remains
 *   reserved for a genuinely reactive screen (e.g. a live settings panel)
 *   this project doesn't have yet. Re-evaluated for this session
 *   specifically because mode-dependent screen 3 could in principle be one
 *   reactive form instead of two sequential ones — deliberately not taken,
 *   since it would trade a well-established, thoroughly-tested API for a
 *   newer one on the single most player-facing surface in the addon, for a
 *   savings of one form. Documented per Project Prompt 15's "verify all
 *   UI/API usage... document the decision" instruction.
 *
 * ASSUMPTION FLAGGED FOR VISUAL CONFIRMATION (Project Prompt 15)
 *   `.body()` on ActionFormData/MessageFormData accepting a `{translate,
 *   with}` RawMessage — not just a plain string or a `{translate}` with no
 *   substitutions — is new usage this session (BuildMenu's title has used
 *   plain `{translate}` since Project Prompt 4, but never `with`, and never
 *   on `.body()`). `player.sendMessage`/`setActionBar` already confirmed
 *   this shape works for chat/actionbar (MessageService.js). Forms are a
 *   different code path in the client. If the summary screen's body shows
 *   raw `%1$s`-style placeholders instead of real values in-game, this is
 *   the first place to look — see TODO.md.
 *
 * MATERIAL BUTTON ICONS FLAGGED FOR VISUAL CONFIRMATION (bugfix pass before
 * Project Prompt 18)
 *   `promptForBridgeMaterial()`'s buttons pass a best-effort
 *   `textures/items/<shortName>` icon path — confirmed as a real, working
 *   "vanilla texture" convention for at least some items (community
 *   scripting references show `textures/items/compass`,
 *   `textures/items/diamond_shovel`, etc. resolving correctly), but NOT
 *   confirmed to resolve for every possible block a player might be
 *   holding — some blocks' inventory icons may live under a different
 *   path, and this wasn't resolvable without a live client to test
 *   against. Non-blocking either way: a wrong/missing icon path is
 *   expected to just show a blank icon slot, never break the button's
 *   text or its selection behavior. Deliberately NOT using
 *   `{translate, with}` for the button's own label text (unlike the
 *   summary screen's body above) — no evidence turned up that `.button()`
 *   supports substitutions the way `.body()` might, so the label is
 *   assembled as a plain JS string instead, sidestepping the question
 *   entirely. See ARCHITECTURE.md §46.9.
 *
 * RESPONSIBILITIES
 *   - Present each screen, bounded/populated by config/BuildModes.js and
 *     config/RailConfig.js.
 *   - Report back plain result objects — no validation beyond what each
 *     slider's own min/max/step already guarantees; ValidationStage +
 *     ModeAvailabilityStage do the authoritative re-check, exactly as
 *     Project Prompt 5 established for the original single-slider menu.
 *   - Never throw: a failed `.show()` at any screen (player disconnected,
 *     another form was already open, etc.) is caught and reported as a
 *     cancellation at that step — the caller stops the whole flow, it never
 *     retries or skips ahead.
 *
 * FUTURE EXTENSIONS
 *   - A distinct Creative "Unlimited" length option still needs a different
 *     control (unchanged limitation from Project Prompt 4 — see TODO.md).
 *   - A 4th+ mode: add one entry to config/BuildModes.js's
 *     BUILD_MODE_REGISTRY. Nothing in this file changes.
 *
 * DEPENDENCIES
 *   - @minecraft/server-ui (ActionFormData, ModalFormData, MessageFormData)
 *   - config/BuildModes.js
 *   - config/RailConfig.js
 *   - inventory/InventoryManager.js (PlaceableMaterialOption typedef only — the actual scan happens in BuildRequestCreationStage, this file only displays results)
 *   - localization/LocalizationKeys.js
 *   - utils/DirectionUtils.js
 *   - utils/Logger.js
 */

/**
 * What the player picked on the mode screen (v2.0.0). MODE is one of the
 * building modes; REPEAT and UNDO are the optional shortcut buttons.
 * @enum {string}
 */
export const MenuAction = Object.freeze({
  MODE: "MODE",
  REPEAT: "REPEAT",
  UNDO: "UNDO",
});

/** Repeat-button label key per mode — each shows that mode's own settings. */
const REPEAT_LABEL_KEYS = Object.freeze({
  [BuildingMode.NORMAL]: LocalizationKeys.MENU_REPEAT_NORMAL,
  [BuildingMode.BRIDGE]: LocalizationKeys.MENU_REPEAT_BRIDGE,
  [BuildingMode.UNDERGROUND]: LocalizationKeys.MENU_REPEAT_UNDERGROUND,
});

/**
 * @typedef {Object} ModeMenuResult
 * @property {boolean} cancelled
 * @property {string} [action] One of MenuAction's values. Present only when cancelled is false.
 * @property {import("../config/BuildModes.js").BuildingMode} [mode] Present when action is MODE.
 */

/**
 * @typedef {Object} ConfigMenuResult
 * @property {boolean} cancelled
 * @property {number} [modeValue] Present only when the chosen mode has requiresConfig and cancelled is false.
 * @property {number} [length] Present only when cancelled is false.
 */

export class BuildMenu {
  /**
   * STEP: Select Building Mode.
   *
   * v2.0.0: when `lastSettings` is given, a "Repeat last build" button is
   * shown first; when `canUndo` is true, an "Undo last build" button is
   * shown last. With neither, the screen is exactly the v1 mode list.
   *
   * @param {import("@minecraft/server").Player} player
   * @param {{lastSettings?: import("../core/PlayerBuildSettings.js").LastBuildSettings|null, canUndo?: boolean}} [options]
   * @returns {Promise<ModeMenuResult>}
   */
  async promptForMode(player, { lastSettings = null, canUndo = false } = {}) {
    const form = new ActionFormData()
      .title({ translate: LocalizationKeys.MENU_MODE_TITLE })
      .body({ translate: LocalizationKeys.MENU_MODE_BODY });

    /** @type {Array<{action: string, mode?: string}>} button index -> meaning */
    const buttons = [];
    if (lastSettings && REPEAT_LABEL_KEYS[lastSettings.mode]) {
      const repeatWith = [lastSettings.length];
      if (lastSettings.modeValue !== undefined) repeatWith.push(lastSettings.modeValue);
      form.button({ translate: REPEAT_LABEL_KEYS[lastSettings.mode], with: repeatWith.map(String) });
      buttons.push({ action: MenuAction.REPEAT });
    }
    for (const modeId of BUILD_MODE_ORDER) {
      form.button({ translate: BUILD_MODE_REGISTRY[modeId].buttonLabelKey });
      buttons.push({ action: MenuAction.MODE, mode: modeId });
    }
    if (canUndo) {
      form.button({ translate: LocalizationKeys.MENU_UNDO_BUTTON });
      buttons.push({ action: MenuAction.UNDO });
    }

    let response;
    try {
      response = await form.show(player);
    } catch (error) {
      Logger.warn(`BuildMenu failed to show the mode screen for ${player?.name ?? "unknown player"}`, error);
      return { cancelled: true };
    }

    if (response.canceled || response.selection === undefined) {
      Logger.debug(
        `${player.name} closed the mode selection screen` +
          (response.cancelationReason ? ` (${response.cancelationReason})` : "")
      );
      return { cancelled: true };
    }

    const picked = buttons[response.selection];
    if (!picked) return { cancelled: true };
    return { cancelled: false, ...picked };
  }

  /**
   * STEP: Select Bridge Material (BRIDGE mode only) — see this file's
   * header for why this is a 4th screen just for BRIDGE. One button per
   * candidate, already deduplicated and counted by
   * inventory/InventoryManager.js's `scanPlaceableMaterials()` — this
   * method only displays what it's given, never reads inventory itself
   * (matching every other screen's "present, don't decide" role).
   *
   * @param {import("@minecraft/server").Player} player
   * @param {ReadonlyArray<import("../inventory/InventoryManager.js").PlaceableMaterialOption>} materials
   *   Must be non-empty — the caller (BuildRequestCreationStage) is
   *   responsible for checking `scanPlaceableMaterials()`'s result before
   *   ever calling this method, and handling the empty case with its own
   *   clear message rather than this method showing a button-less form.
   * @returns {Promise<{cancelled: boolean, materialId?: string}>}
   */
  async promptForBridgeMaterial(player, materials) {
    const form = new ActionFormData()
      .title({ translate: LocalizationKeys.MENU_MATERIAL_TITLE })
      .body({ translate: LocalizationKeys.MENU_MATERIAL_BODY });

    for (const material of materials) {
      const shortName = material.typeId.replace(/^minecraft:/, "");
      const label = `${formatBlockDisplayName(material.typeId)} (x${material.totalAvailable})`;
      // See this file's header, MATERIAL BUTTON ICONS FLAGGED FOR VISUAL
      // CONFIRMATION — best-effort, non-blocking if this exact path is wrong.
      form.button(label, `textures/items/${shortName}`);
    }

    let response;
    try {
      response = await form.show(player);
    } catch (error) {
      Logger.warn(`BuildMenu failed to show the material screen for ${player?.name ?? "unknown player"}`, error);
      return { cancelled: true };
    }

    if (response.canceled || response.selection === undefined) {
      Logger.debug(
        `${player.name} closed the material selection screen` +
          (response.cancelationReason ? ` (${response.cancelationReason})` : "")
      );
      return { cancelled: true };
    }

    return { cancelled: false, materialId: materials[response.selection].typeId };
  }

  /**
   * STEP: Configure Mode (if applicable) + Choose Railway Length, combined
   * into one form — see this file's header for why.
   * @param {import("@minecraft/server").Player} player
   * @param {import("../config/BuildModes.js").BuildingMode} mode
   * @param {Object} bounds
   * @param {number} bounds.minLength
   * @param {number} bounds.maxLength
   * @param {number} bounds.step
   * @param {number} bounds.defaultLength
   * @param {number} [bounds.defaultModeValue] v2.0.0 — pre-fills the height/depth slider (e.g. from the player's last build); falls back to the mode's registry default when missing or out of range.
   * @returns {Promise<ConfigMenuResult>}
   */
  async promptForConfiguration(player, mode, { minLength, maxLength, step, defaultLength, defaultModeValue }) {
    const modeDef = BUILD_MODE_REGISTRY[mode];
    const form = new ModalFormData().title({ translate: LocalizationKeys.MENU_TITLE });

    // Tracks which form field index maps to which value, since the
    // mode-value slider is only present for modes with requiresConfig —
    // NORMAL's form has 1 field (length only); BRIDGE/UNDERGROUND have 2
    // (modeValue, then length). Built up in the exact order fields are
    // added to `form`, so this never has to be kept in sync by hand.
    const fieldOrder = [];

    if (modeDef?.requiresConfig) {
      form.slider({ translate: modeDef.configLabelKey }, modeDef.min, modeDef.max, {
        valueStep: 1,
        defaultValue:
          Number.isInteger(defaultModeValue) && defaultModeValue >= modeDef.min && defaultModeValue <= modeDef.max
            ? defaultModeValue
            : modeDef.default,
      });
      fieldOrder.push("modeValue");
    }

    form.slider({ translate: LocalizationKeys.MENU_LENGTH_LABEL }, minLength, maxLength, {
      valueStep: step,
      defaultValue: defaultLength,
    });
    fieldOrder.push("length");

    form.submitButton({ translate: LocalizationKeys.MENU_NEXT_BUTTON });

    let response;
    try {
      response = await form.show(player);
    } catch (error) {
      Logger.warn(`BuildMenu failed to show the configuration screen for ${player?.name ?? "unknown player"}`, error);
      return { cancelled: true };
    }

    if (response.canceled) {
      Logger.debug(
        `${player.name} closed the configuration screen` +
          (response.cancelationReason ? ` (${response.cancelationReason})` : "")
      );
      return { cancelled: true };
    }

    const result = { cancelled: false };
    fieldOrder.forEach((field, index) => {
      result[field] = response.formValues[index];
    });
    return result;
  }

  /**
   * STEP: Final Build Summary. Shows every chosen value and asks for an
   * explicit Build/Cancel decision — distinct buttons from the previous
   * screen's "Next," per this file's header.
   * @param {import("@minecraft/server").Player} player
   * @param {Object} summary
   * @param {string} summary.railTypeId Vanilla item type ID, see config/RailConfig.js.
   * @param {import("../config/BuildModes.js").BuildingMode} summary.mode
   * @param {number} [summary.modeValue] Bridge height or underground depth, if applicable.
   * @param {string} [summary.materialId] The chosen bridge material's type ID — BRIDGE mode only, added in the bugfix pass before Project Prompt 18.
   * @param {number} summary.length
   * @param {import("../utils/DirectionUtils.js").CardinalDirection} summary.direction
   * @returns {Promise<{cancelled: boolean, confirmed: boolean}>} `confirmed`
   *   is only meaningful when `cancelled` is false — MessageFormData always
   *   reports exactly one of its two buttons as pressed, never both.
   */
  async promptForSummary(player, { railTypeId, mode, modeValue, materialId, length, direction }) {
    const modeDef = BUILD_MODE_REGISTRY[mode];
    const railDisplayName = RAIL_TYPES[railTypeId]?.displayName ?? railTypeId;
    const modeDisplayName = modeDef?.displayName ?? mode;
    const directionDisplayName = DirectionUtils.toDisplayName(direction);

    let bodyKey;
    let substitutions;
    if (mode === BuildingMode.BRIDGE) {
      const materialDisplayName = materialId ? formatBlockDisplayName(materialId) : "";
      bodyKey = LocalizationKeys.MENU_SUMMARY_BODY_BRIDGE;
      substitutions = [railDisplayName, modeDisplayName, materialDisplayName, modeValue, length, directionDisplayName];
    } else if (mode === BuildingMode.UNDERGROUND) {
      bodyKey = LocalizationKeys.MENU_SUMMARY_BODY_UNDERGROUND;
      substitutions = [railDisplayName, modeDisplayName, modeValue, length, directionDisplayName];
    } else {
      bodyKey = LocalizationKeys.MENU_SUMMARY_BODY_NORMAL;
      substitutions = [railDisplayName, modeDisplayName, length, directionDisplayName];
    }

    const form = new MessageFormData()
      .title({ translate: LocalizationKeys.MENU_SUMMARY_TITLE })
      .body({ translate: bodyKey, with: substitutions.map(String) })
      .button1({ translate: LocalizationKeys.MENU_SUMMARY_BUILD_BUTTON })
      .button2({ translate: LocalizationKeys.MENU_SUMMARY_CANCEL_BUTTON });

    let response;
    try {
      response = await form.show(player);
    } catch (error) {
      Logger.warn(`BuildMenu failed to show the summary screen for ${player?.name ?? "unknown player"}`, error);
      return { cancelled: true, confirmed: false };
    }

    if (response.canceled) {
      Logger.debug(
        `${player.name} closed the summary screen` +
          (response.cancelationReason ? ` (${response.cancelationReason})` : "")
      );
      return { cancelled: true, confirmed: false };
    }

    // MessageFormData: selection 0 === button1 (Build), 1 === button2 (Cancel).
    const confirmed = response.selection === 0;
    return { cancelled: false, confirmed };
  }
}
