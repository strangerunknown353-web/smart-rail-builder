import { BUILD_MODE_REGISTRY } from "../../config/BuildModes.js";
import { LocalizationKeys } from "../../localization/LocalizationKeys.js";

/**
 * ModeConfigValidator.js
 *
 * PURPOSE (Project Prompt 15)
 *   Authoritative, mode-aware re-check of the value BuildMenu's
 *   configuration screen collected for the request's `buildingMode` —
 *   `bridgeHeight` for BRIDGE (1-16), `undergroundDepth` for UNDERGROUND
 *   (1-20 — see config/BuildModes.js's BUILD_MODE_REGISTRY, the actual
 *   source of truth this validator reads its bounds from; this docstring
 *   previously said "1-64" — a stale mismatch against the real enforced
 *   bound, fixed Project Prompt 27 — see ARCHITECTURE.md's Project Prompt 27
 *   entry), nothing for NORMAL. "Never trust UI values alone": a
 *   ModalFormData slider already constrains what a player CAN submit, but
 *   this validator is what the pipeline actually relies on, exactly the
 *   same relationship LengthValidator already has with the length slider.
 *
 * WHY ONE GENERIC VALIDATOR, NOT BridgeHeightValidator +
 * UndergroundDepthValidator
 *   Both would be near-identical files differing only in which
 *   BuildRequest field and which bounds/message key they read — reading
 *   those directly from config/BuildModes.js's BUILD_MODE_REGISTRY instead
 *   means a future mode needing its own bounded numeric value (see that
 *   file's registry shape) is validated correctly the moment it's added to
 *   the registry, with zero new validator code. This mirrors the same
 *   "one registry drives N consumers" pattern BUILD_MODE_REGISTRY already
 *   uses for BuildMenu's mode screen.
 *
 * RESPONSIBILITIES
 *   - Look up the request's buildingMode in BUILD_MODE_REGISTRY.
 *   - If that mode doesn't require a config value (NORMAL today), pass.
 *   - Otherwise, confirm the request's configField value is a finite
 *     number within [min, max]; reject with the mode's own
 *     invalidConfigKey and [min, max] substitutions otherwise — the same
 *     shape LengthValidator already produces for MENU_INVALID_LENGTH.
 *   - An unrecognized buildingMode (should be unreachable — BuildMenu only
 *     ever returns a BUILD_MODE_ORDER value) is treated as a hard
 *     rejection, not a silent pass-through, per this project's "never
 *     trust unlabelled/unexpected input" posture elsewhere (e.g.
 *     RailDetectionStage's own defensive re-check of an already-filtered
 *     value).
 *
 * DEPENDENCIES
 *   - config/BuildModes.js (BUILD_MODE_REGISTRY)
 *   - localization/LocalizationKeys.js
 */

export class ModeConfigValidator {
  constructor() {
    this.name = "ModeConfigValidator";
  }

  /**
   * @param {import("../BuildRequest.js").BuildRequest} request
   * @returns {import("./ValidationManager.js").ValidationResult}
   */
  validate(request) {
    const modeDef = BUILD_MODE_REGISTRY[request.buildingMode];

    if (!modeDef) {
      return {
        valid: false,
        reason: "UNKNOWN_BUILD_MODE",
        localizationKey: LocalizationKeys.VALIDATION_INVALID_MODE,
      };
    }

    if (!modeDef.requiresConfig) {
      return { valid: true };
    }

    const value = request[modeDef.configField];
    if (!Number.isFinite(value) || value < modeDef.min || value > modeDef.max) {
      return {
        valid: false,
        reason: `${modeDef.configField.toUpperCase()}_OUT_OF_RANGE`,
        localizationKey: modeDef.invalidConfigKey,
        substitutions: [modeDef.min, modeDef.max],
      };
    }

    return { valid: true };
  }
}
