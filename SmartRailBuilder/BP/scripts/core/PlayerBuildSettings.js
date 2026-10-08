/**
 * PlayerBuildSettings.js
 *
 * PURPOSE (v2.0.0, Project Step 2 — Quick repeat)
 *   Remembers each player's last confirmed build settings — mode, length,
 *   bridge height / underground depth, bridge material — so the menu can
 *   offer "Repeat last build" and pre-fill its sliders.
 *
 * STORAGE
 *   Kept in memory and also written to a player dynamic property, so the
 *   settings survive leaving and rejoining the world. Dynamic property
 *   access is wrapped: if it's unavailable (or throws), the in-memory copy
 *   still works for the rest of the session.
 *
 * NEVER TRUST STORED VALUES
 *   Whatever comes back from storage is re-validated against
 *   config/BuildModes.js and LENGTH_PRESETS before use. Anything out of
 *   range or from an older/unknown format is ignored (treated as "no last
 *   build"), never clamped into something the player didn't choose.
 *   (Exception, v2.0.0 Step 3: the optional booster/light spacings fall
 *   back to their defaults when missing or unknown — an older save without
 *   them is still a valid "last build".)
 */

import { BUILD_MODE_REGISTRY, BuildingMode } from "../config/BuildModes.js";
import { LENGTH_PRESETS } from "../config/RailConfig.js";
import { EXTRAS_CONFIG, pickSpacing } from "../config/ExtrasConfig.js";
import { Logger } from "../utils/Logger.js";

export const LAST_BUILD_PROPERTY = "smart_rail_builder:last_build";

/**
 * @typedef {Object} LastBuildSettings
 * @property {string} mode One of BuildingMode's values.
 * @property {number} length
 * @property {number} [modeValue] Bridge height or underground depth.
 * @property {string} [materialId] Bridge material.
 * @property {number} [boosterSpacing] v2.0.0 Step 3 — 0 = off.
 * @property {number} [lightSpacing] v2.0.0 Step 3 — Underground only, 0 = off.
 * @property {boolean} [fillCaveGaps] v2.0.0 Step 4 — Underground only.
 * @property {boolean} [guardRails] v2.0.0 Step 4 — Bridge only.
 */

/**
 * @param {any} value
 * @returns {LastBuildSettings|null}
 */
export function sanitizeSettings(value) {
  if (!value || typeof value !== "object") return null;
  const modeDef = BUILD_MODE_REGISTRY[value.mode];
  if (!modeDef) return null;

  const { length } = value;
  if (!Number.isInteger(length) || length < LENGTH_PRESETS.MIN || length > LENGTH_PRESETS.MAX_SURVIVAL) return null;

  const settings = { mode: modeDef.id, length };
  if (modeDef.requiresConfig) {
    const { modeValue } = value;
    if (!Number.isInteger(modeValue) || modeValue < modeDef.min || modeValue > modeDef.max) return null;
    settings.modeValue = modeValue;
  }
  if (modeDef.id === BuildingMode.BRIDGE) {
    if (typeof value.materialId !== "string" || value.materialId.length === 0) return null;
    settings.materialId = value.materialId;
  }
  // Extras (Step 3) are optional: v2 Step 2 saves don't have them, and an
  // unknown value just falls back to the default instead of discarding
  // the whole saved build.
  settings.boosterSpacing = pickSpacing(value.boosterSpacing, EXTRAS_CONFIG.BOOSTER_SPACING_OPTIONS, EXTRAS_CONFIG.DEFAULT_BOOSTER_SPACING);
  if (modeDef.id === BuildingMode.UNDERGROUND) {
    settings.lightSpacing = pickSpacing(value.lightSpacing, EXTRAS_CONFIG.LIGHT_SPACING_OPTIONS, EXTRAS_CONFIG.DEFAULT_LIGHT_SPACING);
    settings.fillCaveGaps = value.fillCaveGaps === true;
  }
  if (modeDef.id === BuildingMode.BRIDGE) {
    settings.guardRails = value.guardRails === true;
  }
  return settings;
}

export class PlayerBuildSettings {
  constructor() {
    /** @private @type {Map<string, LastBuildSettings>} */
    this._byPlayerId = new Map();
  }

  /**
   * @param {import("@minecraft/server").Player} player
   * @returns {LastBuildSettings|null}
   */
  get(player) {
    const cached = this._byPlayerId.get(player.id);
    if (cached) return cached;

    let stored;
    try {
      const raw = player.getDynamicProperty?.(LAST_BUILD_PROPERTY);
      stored = typeof raw === "string" ? sanitizeSettings(JSON.parse(raw)) : null;
    } catch (error) {
      Logger.debug(`Could not read saved build settings for ${player.name}: ${error}`);
      stored = null;
    }
    if (stored) this._byPlayerId.set(player.id, stored);
    return stored;
  }

  /**
   * @param {import("@minecraft/server").Player} player
   * @param {LastBuildSettings} settings
   */
  save(player, settings) {
    const clean = sanitizeSettings(settings);
    if (!clean) return;
    this._byPlayerId.set(player.id, clean);
    try {
      player.setDynamicProperty?.(LAST_BUILD_PROPERTY, JSON.stringify(clean));
    } catch (error) {
      Logger.debug(`Could not persist build settings for ${player.name}: ${error}`);
    }
  }
}
