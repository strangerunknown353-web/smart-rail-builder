/**
 * BuildRequest.js
 *
 * PURPOSE
 *   Immutable snapshot of exactly what a player asked for, captured the
 *   moment BuildMenu resolves. This is a different, complementary concept to
 *   core/BuildSession.js (Project Prompt 2): BuildRequest is "what was
 *   asked for" (menu output, never mutated), while BuildSession is "what is
 *   currently happening" (live, mutable, constructed FROM a BuildRequest once
 *   the actual build pipeline starts in Roadmap Phase 7). Neither replaces
 *   the other — BuildSession's constructor will accept a BuildRequest.
 *
 * RESPONSIBILITIES
 *   - Hold player, dimension, rail type, requested length, a BuildVector
 *     (direction + origin + step), timestamp, and session ID as a single,
 *     easy-to-pass-around value object.
 *   - Nothing else — no validation, no mutation, no behavior.
 *
 * FIELD REVIEW (Project Prompt 5, extended Project Prompt 6)
 *   - `buildVector` (new, Project Prompt 6) — the authoritative
 *     direction/origin model from core/BuildVector.js, computed once via
 *     `BuildVector.fromPlayer(player)` in BuildRequestCreationStage. Every
 *     future placement system reads this instead of recomputing direction.
 *   - `facingDirection` / `startPosition` (from Project Prompt 4/5) are kept
 *     as read-only convenience aliases derived from `buildVector`, so
 *     nothing that already reads those two field names breaks — an
 *     additive, non-breaking change, consistent with every field added
 *     since Project Prompt 4.
 *   - `sessionId`: a log-correlation identifier, unique enough to tell two
 *     requests apart in the Content Log — not a security or uniqueness
 *     guarantee. Distinct from BuildSession, which is the actual
 *     live-tracking object.
 *   - A "cancellation token" was considered and deliberately NOT added here.
 *     BuildRequest's whole contract is "immutable snapshot, never mutated" —
 *     a cancellation flag is inherently live, mutable state, which is
 *     exactly what BuildSession (Project Prompt 2) already exists to own.
 *
 * FUTURE EXTENSIONS
 *   - Build-style options (curve radius, slope angle, bridge style —
 *     Roadmap Phase 11+) would be added as additional optional constructor
 *     fields here, not as a second request type. Every field added since
 *     Project Prompt 4 has been an additional optional destructured
 *     constructor parameter, which never breaks an existing caller — this
 *     pattern is expected to hold indefinitely.
 *   - Project Prompt 15 is the first session to actually exercise that
 *     promise: `buildingMode`, `bridgeHeight`, and `undergroundDepth` were
 *     added exactly this way — three more optional constructor fields, no
 *     existing field touched or renamed. See BUILD CONFIGURATION MODEL
 *     below for why this class, not a new parallel class, is Project
 *     Prompt 15's "centralized BuildConfiguration."
 *   - The bugfix pass before Project Prompt 18 added a fourth field the
 *     same way: `bridgeMaterialId` — the player's chosen bridge material
 *     (see ui/BuildMenu.js's `promptForBridgeMaterial()`), replacing what
 *     had been a fixed constant in config/BridgeConfig.js. Same rule as
 *     `bridgeHeight`: only meaningful when `buildingMode` is BRIDGE, null
 *     otherwise.
 *
 * BUILD CONFIGURATION MODEL (Project Prompt 15)
 *   Project Prompt 15 asked for "a centralized BuildConfiguration or
 *   equivalent... one authoritative build configuration" holding rail type,
 *   mode, length, direction, origin, bridge height, underground depth, and
 *   player/session info — specifically to prevent different UI components
 *   from creating conflicting versions of these values. That description is
 *   this class, field for field, and has been since Project Prompt 5: an
 *   immutable snapshot built in exactly one place
 *   (BuildRequestCreationStage), read everywhere else. Introducing a
 *   second, parallel "BuildConfiguration" class would itself recreate the
 *   exact hazard the prompt warns against — two objects that could drift
 *   out of sync. So this session extends BuildRequest with the three new
 *   mode-related fields instead of adding a competing type. `buildingMode`
 *   plus its one relevant config value (`bridgeHeight` for BRIDGE,
 *   `undergroundDepth` for UNDERGROUND, neither for NORMAL) round out the
 *   "mode" half of the configuration; direction/origin/length/rail
 *   type/player/session were already here.
 *
 * DEPENDENCIES
 *   - config/BuildModes.js (Project Prompt 15 — DEFAULT_BUILDING_MODE only,
 *     so this class never hardcodes a duplicate "NORMAL" string literal
 *     that could drift from the registry's own value).
 */

import { DEFAULT_BUILDING_MODE } from "../config/BuildModes.js";
import { EXTRAS_CONFIG, pickSpacing } from "../config/ExtrasConfig.js";

export class BuildRequest {
  /**
   * @param {Object} params
   * @param {import("@minecraft/server").Player} params.player
   * @param {import("@minecraft/server").Dimension} params.dimension
   * @param {string} params.railTypeId Vanilla item type ID, see config/RailConfig.js.
   * @param {number} params.requestedLength Value read from the build menu's slider.
   * @param {import("./BuildVector.js").BuildVector} params.buildVector
   *   Computed direction + origin, see core/BuildVector.js.
   * @param {string} params.sessionId Log-correlation identifier for this request.
   * @param {number} [params.timestamp] Defaults to Date.now().
   * @param {import("../config/BuildModes.js").BuildingMode} [params.buildingMode]
   *   One of config/BuildModes.js's BuildingMode values. Defaults to NORMAL
   *   (config/BuildModes.js's DEFAULT_BUILDING_MODE) so any caller written
   *   before Project Prompt 15 — including every mocked test harness
   *   assertion from prior sessions — keeps constructing an ordinary,
   *   valid, NORMAL-mode request without changes.
   * @param {number|null} [params.bridgeHeight] Only meaningful when
   *   buildingMode is BRIDGE. Null for every other mode — never a stale
   *   leftover value from a menu the player didn't actually see.
   * @param {string|null} [params.bridgeMaterialId] The player's chosen
   *   bridge material's vanilla block/item type ID. Only meaningful when
   *   buildingMode is BRIDGE, same as bridgeHeight — added in the bugfix
   *   pass before Project Prompt 18.
   * @param {number|null} [params.undergroundDepth] Only meaningful when
   *   buildingMode is UNDERGROUND. Null for every other mode, same reasoning.
   */
  constructor({
    player,
    dimension,
    railTypeId,
    requestedLength,
    buildVector,
    sessionId,
    timestamp,
    buildingMode,
    bridgeHeight,
    bridgeMaterialId,
    undergroundDepth,
    boosterSpacing,
    lightSpacing,
    fillCaveGaps,
    guardRails,
  }) {
    /** @readonly */
    this.player = player;
    /** @readonly */
    this.dimension = dimension;
    /** @readonly */
    this.railTypeId = railTypeId;
    /** @readonly */
    this.requestedLength = requestedLength;
    /** @readonly */
    this.buildVector = buildVector;
    /** @readonly Convenience alias for buildVector.direction — kept for backward compatibility. */
    this.facingDirection = buildVector?.direction ?? null;
    /** @readonly Convenience alias for buildVector.origin — kept for backward compatibility. */
    this.startPosition = buildVector?.origin ?? null;
    /** @readonly */
    this.sessionId = sessionId;
    /** @readonly */
    this.timestamp = timestamp ?? Date.now();
    /** @readonly See BUILD CONFIGURATION MODEL above. Defaults to NORMAL. */
    this.buildingMode = buildingMode ?? DEFAULT_BUILDING_MODE;
    /** @readonly Only non-null when buildingMode === "BRIDGE". */
    this.bridgeHeight = this.buildingMode === "BRIDGE" ? bridgeHeight ?? null : null;
    /** @readonly Only non-null when buildingMode === "BRIDGE". Added in the bugfix pass before Project Prompt 18. */
    this.bridgeMaterialId = this.buildingMode === "BRIDGE" ? bridgeMaterialId ?? null : null;
    /** @readonly Only non-null when buildingMode === "UNDERGROUND". */
    this.undergroundDepth = this.buildingMode === "UNDERGROUND" ? undergroundDepth ?? null : null;
    // v2.0.0 Step 3 — extras (config/ExtrasConfig.js). Anything that isn't
    // one of the offered choices becomes "off"; lights are Underground-only.
    this.boosterSpacing = pickSpacing(boosterSpacing, EXTRAS_CONFIG.BOOSTER_SPACING_OPTIONS, 0);
    this.lightSpacing =
      this.buildingMode === "UNDERGROUND" ? pickSpacing(lightSpacing, EXTRAS_CONFIG.LIGHT_SPACING_OPTIONS, 0) : 0;
    // v2.0.0 Step 4 — strictly booleans, and only for the mode they belong to.
    this.fillCaveGaps = this.buildingMode === "UNDERGROUND" && fillCaveGaps === true;
    this.guardRails = this.buildingMode === "BRIDGE" && guardRails === true;
  }
}
