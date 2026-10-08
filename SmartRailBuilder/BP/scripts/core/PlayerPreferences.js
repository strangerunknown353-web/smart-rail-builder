/**
 * PlayerPreferences.js
 *
 * PURPOSE (v2.0.0, Project Step 4 — Settings screen)
 *   Each player's own defaults, edited from the crouch menu's "Settings"
 *   button (ui/BuildMenu.js promptForSettings):
 *     - defaultLength   length slider start when there's no last build
 *     - boosterSpacing  default "Powered boosters" choice
 *     - lightSpacing    default "Tunnel lights" choice (Underground)
 *     - fillCaveGaps    default "Fill cave gaps" toggle (Underground)
 *     - guardRails      default "Guard rails" toggle (Bridge)
 *     - quickRepeat     "Repeat last build" skips the confirm screen
 *     - showTips        the one-time "crouch to open" tip
 *
 *   How defaults combine with "last build" (core/PlayerBuildSettings.js):
 *   the length and height/depth sliders start at the last build's values
 *   (falling back to defaultLength here); the extras dropdowns/toggles
 *   always start at these preferences, so changing a setting takes effect
 *   on the very next build. "Repeat last build" uses the last build as-is.
 *
 * STORAGE / VALIDATION
 *   Same approach as PlayerBuildSettings: memory + a player dynamic
 *   property, every access wrapped. Unlike a saved build, preferences are
 *   forgiving: each field is checked on its own and an invalid or missing
 *   one falls back to its default, so one bad value never resets the rest.
 */

import { EXTRAS_CONFIG, pickSpacing } from "../config/ExtrasConfig.js";
import { LENGTH_PRESETS } from "../config/RailConfig.js";
import { Logger } from "../utils/Logger.js";

export const PREFERENCES_PROPERTY = "smart_rail_builder:prefs";

/**
 * @typedef {Object} Preferences
 * @property {number} defaultLength
 * @property {number} boosterSpacing
 * @property {number} lightSpacing
 * @property {boolean} fillCaveGaps
 * @property {boolean} guardRails
 * @property {boolean} quickRepeat
 * @property {boolean} showTips
 */

/** @type {Readonly<Preferences>} */
export const DEFAULT_PREFERENCES = Object.freeze({
  defaultLength: LENGTH_PRESETS.DEFAULT,
  boosterSpacing: EXTRAS_CONFIG.DEFAULT_BOOSTER_SPACING,
  lightSpacing: EXTRAS_CONFIG.DEFAULT_LIGHT_SPACING,
  fillCaveGaps: true,
  guardRails: false,
  quickRepeat: false,
  showTips: true,
});

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * @param {any} value
 * @returns {Preferences} always a complete, valid object
 */
export function sanitizePreferences(value) {
  const v = value && typeof value === "object" ? value : {};
  const d = DEFAULT_PREFERENCES;
  const lengthOk = Number.isInteger(v.defaultLength) && v.defaultLength >= LENGTH_PRESETS.MIN && v.defaultLength <= LENGTH_PRESETS.MAX_SURVIVAL;
  return {
    defaultLength: lengthOk ? v.defaultLength : d.defaultLength,
    boosterSpacing: pickSpacing(v.boosterSpacing, EXTRAS_CONFIG.BOOSTER_SPACING_OPTIONS, d.boosterSpacing),
    lightSpacing: pickSpacing(v.lightSpacing, EXTRAS_CONFIG.LIGHT_SPACING_OPTIONS, d.lightSpacing),
    fillCaveGaps: bool(v.fillCaveGaps, d.fillCaveGaps),
    guardRails: bool(v.guardRails, d.guardRails),
    quickRepeat: bool(v.quickRepeat, d.quickRepeat),
    showTips: bool(v.showTips, d.showTips),
  };
}

export class PlayerPreferences {
  constructor() {
    /** @private @type {Map<string, Preferences>} */
    this._byPlayerId = new Map();
  }

  /**
   * @param {import("@minecraft/server").Player} player
   * @returns {Preferences}
   */
  get(player) {
    const cached = this._byPlayerId.get(player.id);
    if (cached) return cached;

    let stored = null;
    try {
      const raw = player.getDynamicProperty?.(PREFERENCES_PROPERTY);
      if (typeof raw === "string") stored = JSON.parse(raw);
    } catch (error) {
      Logger.debug(`Could not read preferences for ${player.name}: ${error}`);
    }
    const preferences = sanitizePreferences(stored);
    this._byPlayerId.set(player.id, preferences);
    return preferences;
  }

  /**
   * @param {import("@minecraft/server").Player} player
   * @param {Partial<Preferences>} preferences
   * @returns {Preferences} what was actually saved
   */
  save(player, preferences) {
    const clean = sanitizePreferences(preferences);
    this._byPlayerId.set(player.id, clean);
    try {
      player.setDynamicProperty?.(PREFERENCES_PROPERTY, JSON.stringify(clean));
    } catch (error) {
      Logger.debug(`Could not persist preferences for ${player.name}: ${error}`);
    }
    return clean;
  }
}
