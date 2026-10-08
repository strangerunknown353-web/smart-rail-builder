/**
 * LocalizationKeys.js
 *
 * PURPOSE
 *   Central registry of every translate key MessageService (and, later,
 *   BuildMenu) is allowed to send to a player. No module should ever embed
 *   a player-facing string literal — it imports a key from here and passes
 *   it as `{ translate: key }` in a RawMessage, resolved against
 *   RP/texts/en_US.lang.
 *
 * RESPONSIBILITIES
 *   - Declare the full set of message keys the addon will use, grouped by
 *     the Roadmap phase that will implement the feature that sends them.
 *
 * FUTURE EXTENSIONS
 *   - Each key below gets its matching line added to RP/texts/en_US.lang at
 *     the Roadmap phase noted in the comment, when the module that sends it
 *     is implemented. Keys are declared ahead of time so every future module
 *     can import a stable identifier today. Roadmap Phase 3 keys now have
 *     real English text (Project Prompt 4) — later groups remain forward
 *     declarations until their phase is implemented.
 *   - Additional languages are added by creating new .lang files under
 *     RP/texts/ that define the same keys — no script changes required.
 *
 * DEPENDENCIES
 *   None. Pure data.
 */

export const LocalizationKeys = Object.freeze({
  // --- Roadmap Phase 3: Item Detection & Menu Trigger ---
  MENU_TITLE: "ryzenRailBuilder.menu.title",
  MENU_LENGTH_LABEL: "ryzenRailBuilder.menu.lengthLabel",
  MENU_INVALID_LENGTH: "ryzenRailBuilder.menu.invalidLength",
  VALIDATION_ITEM_CHANGED: "ryzenRailBuilder.validation.itemChanged",
  VALIDATION_ALREADY_BUILDING: "ryzenRailBuilder.validation.alreadyBuilding",
  VALIDATION_NOT_ALLOWED: "ryzenRailBuilder.validation.notAllowed",
  VALIDATION_UNSUPPORTED_GAME_MODE: "ryzenRailBuilder.validation.unsupportedGameMode",

  // --- Roadmap Phase 15: Three Building Modes & Unified Build Configuration UI (Project Prompt 15) ---
  // MENU_BUILD_BUTTON ("ryzenRailBuilder.menu.buildButton") retired this
  // session, same pattern as the PATH_REJECTED_NOT_FLAT/PATH_REJECTED_BRIDGE_REQUIRED
  // retirement noted above: it labeled the single-slider menu's submit
  // button, which BuildMenu.js no longer has (replaced by the 3-screen
  // mode -> configuration -> summary flow below). Its lang line is removed
  // from en_US.lang too — not left as harmless dead text, since an unused
  // key with a live-looking lang entry could confuse a future session into
  // thinking a "Build" button still exists on the old menu. The
  // configuration screen's submit is now MENU_NEXT_BUTTON ("Next" — it
  // isn't the final confirmation); the actual build action lives on the
  // summary screen as MENU_SUMMARY_BUILD_BUTTON, deliberately a distinct
  // key so the two can never be confused, per Project Prompt 15's
  // "no accidental construction" requirement.
  MENU_NEXT_BUTTON: "ryzenRailBuilder.menu.nextButton",
  MENU_MODE_TITLE: "ryzenRailBuilder.menu.modeTitle",
  MENU_MODE_BODY: "ryzenRailBuilder.menu.modeBody",
  MODE_NORMAL_LABEL: "ryzenRailBuilder.mode.normal.label",
  MODE_BRIDGE_LABEL: "ryzenRailBuilder.mode.bridge.label",
  MODE_UNDERGROUND_LABEL: "ryzenRailBuilder.mode.underground.label",
  MENU_BRIDGE_HEIGHT_LABEL: "ryzenRailBuilder.menu.bridgeHeightLabel",
  MENU_UNDERGROUND_DEPTH_LABEL: "ryzenRailBuilder.menu.undergroundDepthLabel",
  MENU_INVALID_HEIGHT: "ryzenRailBuilder.menu.invalidHeight",
  MENU_INVALID_DEPTH: "ryzenRailBuilder.menu.invalidDepth",
  VALIDATION_INVALID_MODE: "ryzenRailBuilder.validation.invalidMode",
  MENU_SUMMARY_TITLE: "ryzenRailBuilder.menu.summaryTitle",
  MENU_SUMMARY_BODY_NORMAL: "ryzenRailBuilder.menu.summaryBody.normal",
  MENU_SUMMARY_BODY_BRIDGE: "ryzenRailBuilder.menu.summaryBody.bridge",
  MENU_SUMMARY_BODY_UNDERGROUND: "ryzenRailBuilder.menu.summaryBody.underground",
  MENU_SUMMARY_BUILD_BUTTON: "ryzenRailBuilder.menu.summaryBuildButton",
  MENU_SUMMARY_CANCEL_BUTTON: "ryzenRailBuilder.menu.summaryCancelButton",
  MODE_NOT_YET_AVAILABLE: "ryzenRailBuilder.mode.notYetAvailable",

  // --- Roadmap Phase 16: Advanced Bridge Mode (Project Prompt 16) ---
  ACTIONBAR_PLANNING_BRIDGE: "ryzenRailBuilder.actionbar.planningBridge",
  ACTIONBAR_VERIFYING: "ryzenRailBuilder.actionbar.verifying",
  BRIDGE_CONSTRUCTION_STARTED: "ryzenRailBuilder.bridge.constructionStarted",
  BRIDGE_CONSTRUCTION_COMPLETE: "ryzenRailBuilder.bridge.constructionComplete",
  BRIDGE_BUILDING_SUPPORTS: "ryzenRailBuilder.bridge.buildingSupports",
  BRIDGE_BUILDING_SURFACE: "ryzenRailBuilder.bridge.buildingSurface",
  BRIDGE_PLACING_RAILS: "ryzenRailBuilder.bridge.placingRails",
  PATH_REJECTED_BRIDGE_BLOCKED_TERRAIN: "ryzenRailBuilder.path.rejected.bridgeBlockedTerrain",
  PATH_REJECTED_BRIDGE_BLOCKED_UNBREAKABLE: "ryzenRailBuilder.path.rejected.bridgeBlockedUnbreakable",
  PATH_REJECTED_BRIDGE_BLOCKED_HAZARD: "ryzenRailBuilder.path.rejected.bridgeBlockedHazard",
  PATH_REJECTED_BRIDGE_BLOCKED_LIQUID: "ryzenRailBuilder.path.rejected.bridgeBlockedLiquid",
  PATH_REJECTED_BRIDGE_SUPPORT_HAZARD: "ryzenRailBuilder.path.rejected.bridgeSupportHazard",
  PATH_REJECTED_BRIDGE_SUPPORT_UNAVAILABLE: "ryzenRailBuilder.path.rejected.bridgeSupportUnavailable",
  INVENTORY_INSUFFICIENT_BRIDGE_MATERIAL: "ryzenRailBuilder.inventory.insufficientBridgeMaterial",
  // Added Project Prompt 21 — post-confirmation "actual required quantity"
  // reveal. See InventoryStage.js's REVISION HISTORY: the Build Summary
  // screen (ui/BuildMenu.js's promptForSummary()) shows Bridge Mode's
  // material line as "(calculated automatically)" rather than a real
  // number, because the real number only exists after TerrainScanningStage
  // has actually run (planBridge() walks the whole route) — which the
  // Performance requirement forbids doing just to show a form. Once
  // InventoryStage confirms the player has enough, the real count is finally
  // known and honestly reportable, so it's sent here instead.
  INVENTORY_REQUIRED_RAILS_SUMMARY: "ryzenRailBuilder.inventory.requiredRailsSummary",
  INVENTORY_REQUIRED_BRIDGE_SUMMARY: "ryzenRailBuilder.inventory.requiredBridgeSummary",

  // --- Roadmap Phase 17: Advanced Underground Mode (Project Prompt 17) ---
  ACTIONBAR_PLANNING_UNDERGROUND: "ryzenRailBuilder.actionbar.planningUnderground",
  UNDERGROUND_CONSTRUCTION_STARTED: "ryzenRailBuilder.underground.constructionStarted",
  UNDERGROUND_CONSTRUCTION_COMPLETE: "ryzenRailBuilder.underground.constructionComplete",
  UNDERGROUND_EXCAVATING: "ryzenRailBuilder.underground.excavating",
  UNDERGROUND_PLACING_RAILS: "ryzenRailBuilder.underground.placingRails",
  UNDERGROUND_ORES_EXCAVATED: "ryzenRailBuilder.underground.oresExcavated",
  PATH_REJECTED_UNDERGROUND_LENGTH_TOO_SHORT: "ryzenRailBuilder.path.rejected.undergroundLengthTooShort",
  PATH_REJECTED_UNDERGROUND_UNBREAKABLE: "ryzenRailBuilder.path.rejected.undergroundUnbreakable",
  PATH_REJECTED_UNDERGROUND_HAZARD: "ryzenRailBuilder.path.rejected.undergroundHazard",
  PATH_REJECTED_UNDERGROUND_LAVA: "ryzenRailBuilder.path.rejected.undergroundLava",
  PATH_REJECTED_UNDERGROUND_WATER: "ryzenRailBuilder.path.rejected.undergroundWater",
  PATH_REJECTED_UNDERGROUND_PROTECTED_ORE: "ryzenRailBuilder.path.rejected.undergroundProtectedOre",
  PATH_REJECTED_UNDERGROUND_UNSUPPORTED_FLOOR: "ryzenRailBuilder.path.rejected.undergroundUnsupportedFloor",

  // --- Bugfix pass before Project Prompt 18: bridge ramp/piers, material selection, tunnel clearance, rail crossing ---
  MENU_MATERIAL_TITLE: "ryzenRailBuilder.menu.materialTitle",
  MENU_MATERIAL_BODY: "ryzenRailBuilder.menu.materialBody",
  MENU_NO_MATERIALS_AVAILABLE: "ryzenRailBuilder.menu.noMaterialsAvailable",
  PATH_REJECTED_BRIDGE_LENGTH_TOO_SHORT: "ryzenRailBuilder.path.rejected.bridgeLengthTooShort",

  // --- Roadmap Phase 4: Direction & Facing Detection ---
  DIRECTION_CONFIRMED: "ryzenRailBuilder.direction.confirmed",
  VALIDATION_INVALID_DIRECTION: "ryzenRailBuilder.validation.invalidDirection",
  VALIDATION_INVALID_ORIGIN: "ryzenRailBuilder.validation.invalidOrigin",

  // --- Roadmap Phase 5: Terrain Scanner & Safety Validation ---
  // PATH_REJECTED_NOT_FLAT and PATH_BRIDGE_REQUIRED (Project Prompt 11)
  // retired this same session (Roadmap Phase 11): TerrainScanner no longer
  // produces the GAP/OBSTRUCTED classifications they were written for, and
  // "Slopes aren't supported yet" became false the moment slopes shipped.
  // Replaced by one unified key below.
  PATH_REJECTED_TOO_STEEP: "ryzenRailBuilder.path.rejected.tooSteep",
  PATH_REJECTED_HAZARD: "ryzenRailBuilder.path.rejected.hazard",
  PATH_REJECTED_UNLOADED: "ryzenRailBuilder.path.rejected.unloaded",
  PATH_REJECTED_OUT_OF_BOUNDS: "ryzenRailBuilder.path.rejected.outOfBounds",
  // --- Roadmap Phase 12: Tunnel Detection & Excavation ---
  PATH_REJECTED_UNBREAKABLE: "ryzenRailBuilder.path.rejected.unbreakable",
  PATH_REJECTED_TUNNEL_TOO_LONG: "ryzenRailBuilder.path.rejected.tunnelTooLong",

  // --- Project Prompt 18: Underwater Railway & Water-Safe Construction ---
  PATH_REJECTED_WATER_CROSSING: "ryzenRailBuilder.path.rejected.waterCrossingUnsafe",

  // --- Project Prompt 19: Smart Terrain Adaptation & Rail Connectivity ---
  PATH_REJECTED_LOW_CLEARANCE: "ryzenRailBuilder.path.rejected.lowClearance",

  // --- Roadmap Phase 6: Inventory Verification ---
  INVENTORY_INSUFFICIENT: "ryzenRailBuilder.inventory.insufficient",

  // --- Project Prompt 9: Pipeline Integration & Player Feedback ---
  ACTIONBAR_PREPARING: "ryzenRailBuilder.actionbar.preparing",
  // v2.0.0 Step 2 — Repeat / Undo
  MENU_REPEAT_NORMAL: "ryzenRailBuilder.menu.repeatNormal",
  MENU_REPEAT_BRIDGE: "ryzenRailBuilder.menu.repeatBridge",
  MENU_REPEAT_UNDERGROUND: "ryzenRailBuilder.menu.repeatUnderground",
  MENU_UNDO_BUTTON: "ryzenRailBuilder.menu.undoButton",
  UNDO_COMPLETE: "ryzenRailBuilder.undo.complete",
  UNDO_SKIPPED: "ryzenRailBuilder.undo.skipped",
  UNDO_NOTHING: "ryzenRailBuilder.undo.nothing",
  ACTIONBAR_CROUCH_HINT: "ryzenRailBuilder.actionbar.crouchHint", // v2.0.0 — one-time hint after a standing (vanilla) rail placement
  ACTIONBAR_ANALYZING_TERRAIN: "ryzenRailBuilder.actionbar.analyzingTerrain",
  ACTIONBAR_CHECKING_INVENTORY: "ryzenRailBuilder.actionbar.checkingInventory",
  ACTIONBAR_VALIDATION_SUCCESSFUL: "ryzenRailBuilder.actionbar.validationSuccessful",

  // --- Roadmap Phase 7: Core Straight Rail Placement (Project Prompt 10) ---
  CONSTRUCTION_STARTED: "ryzenRailBuilder.construction.started",
  CONSTRUCTION_CANCELLED: "ryzenRailBuilder.construction.cancelled",
  CONSTRUCTION_STOPPED: "ryzenRailBuilder.construction.stopped",
  CONSTRUCTION_TERRAIN_CHANGED: "ryzenRailBuilder.construction.terrainChanged",

  // --- Roadmap Phase 9: Feedback, Progress & Logging Polish ---
  CONSTRUCTION_PROGRESS: "ryzenRailBuilder.construction.progress",
  CONSTRUCTION_COMPLETE: "ryzenRailBuilder.construction.complete",
  GENERIC_ERROR: "ryzenRailBuilder.error.generic",

  // --- Project Prompt 22: Smart Build Preview, Validation & Safety ---
  // Sent once, right before the specific rejection reason, for every
  // outcome that means zero world modification — see BuildOrchestrator.js's
  // _reportResult().
  STATUS_CANNOT_BUILD: "ryzenRailBuilder.status.cannotBuild",
  // BuildPlanStage's own immediately-before-construction revalidation
  // (§10) — dimension is the one re-check with no existing message to
  // reuse (item/inventory staleness reuse VALIDATION_ITEM_CHANGED /
  // INVENTORY_INSUFFICIENT* unchanged).
  VALIDATION_DIMENSION_CHANGED: "ryzenRailBuilder.validation.dimensionChanged",
  // PlacementStage's multiplayer conflict rejection (§7/§11) — see
  // core/ActiveBuildRegistry.js.
  VALIDATION_RAIL_CONFLICT: "ryzenRailBuilder.validation.railConflict",
});
