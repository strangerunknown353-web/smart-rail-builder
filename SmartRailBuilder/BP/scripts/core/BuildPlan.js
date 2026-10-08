import { BuildingMode } from "../config/BuildModes.js";
import { TerrainClassification } from "../terrain/TerrainClassification.js";
import { positionKey } from "../utils/PositionKey.js";
import { NO_EXTRAS, planExtras } from "./ExtrasPlan.js";

/**
 * BuildPlan.js
 *
 * PURPOSE
 *   Added Project Prompt 22 ("Smart Build Preview, Validation & Safety").
 *   The single, complete, read-only description of one build BEFORE any
 *   block is placed — everything Project Prompt 22 asked a "Build Plan" to
 *   contain (rail type, mode, direction, length, start/end position, rail
 *   positions, terrain info, bridge/underground specifics, required
 *   resources, and a world-modification boundary), assembled from data the
 *   pipeline has ALREADY computed.
 *
 * NOT A NEW SCAN — A CONSOLIDATION (Project Prompt 22's Performance
 * requirement: "avoid duplicate terrain scans... recalculating the same
 * positions")
 *   Every field below is read directly from `context.terrainReport` /
 *   `context.bridgePlan` / `context.undergroundPlan` (TerrainScanningStage,
 *   re-confirmed fresh by FinalSafetyCheckStage) and `context.request` — all
 *   already computed by the time `BuildPlanStage` (the new pipeline stage
 *   that constructs a BuildPlan, see that file) runs. `fromContext()` is
 *   pure reshaping: it does not call TerrainScanner, InventoryManager, or
 *   any other scanning class itself.
 *
 * ONE BuildPlan PER BUILD, NOT PER MODE (mirrors BuildRequest's own "one
 * class, optional fields" shape — see core/BuildRequest.js's BUILD
 * CONFIGURATION MODEL note)
 *   Exactly one of `bridgeHeight`/`undergroundDepth` is non-null for any
 *   given plan, decided by `buildingMode` — same convention BuildRequest
 *   already established for its own mode-specific fields, continued here
 *   rather than three separate BuildPlan subclasses.
 *
 * THE WORLD MODIFICATION BOUNDARY (Project Prompt 22 §7)
 *   `modificationBoundary` is the exact, closed set of block positions this
 *   build is allowed to touch — every rail position, every bridge
 *   support/surface position, every tunnel excavation/seal position,
 *   nothing else. It is not a new runtime gate placed in front of the
 *   execution strategies: every strategy (StraightRailStrategy,
 *   BridgeExecutionStrategy, UndergroundExecutionStrategy) already derives
 *   every position it touches directly from the same plan/path object this
 *   boundary is built from — see ARCHITECTURE.md §51.4 for the confirmation
 *   that no strategy computes a position independently. The boundary's real
 *   job is to make that existing guarantee an inspectable, testable value
 *   instead of an implicit property of the code, and to give
 *   `core/ActiveBuildRegistry.js` something concrete to claim for
 *   multiplayer conflict detection (§7/§11).
 *
 * "DO NOT COUNT THE SAME BLOCK TWICE" (Project Prompt 22 §5)
 *   `modificationBoundary` is a Set, so a position appearing in more than
 *   one source list (e.g. an Underground rail position, which is always
 *   also the first entry of that same step's own `excavationPositions`)
 *   collapses to one entry — the boundary's *size* is never inflated by
 *   overlap. Resource COUNTS (`requiredRailCount`/`requiredMaterialCount`)
 *   are untouched by this — they still come straight from
 *   BridgePlan/UndergroundPlan's own already-deduplicated counts (see those
 *   files' own docs for why `surfacePositions`/`supportPositions` never
 *   overlap), so nothing here changes what a player is charged.
 *
 * DEPENDENCIES
 *   - config/BuildModes.js (BuildingMode)
 *   - terrain/TerrainClassification.js
 *   - utils/PositionKey.js
 */

/** v2.0.0 Step 3: extras for this request's rail positions (empty when none were asked for). */
function extrasFor(request, railPositions) {
  return planExtras({
    buildingMode: request.buildingMode,
    direction: request.buildVector.direction,
    railPositions,
    boosterSpacing: request.boosterSpacing,
    lightSpacing: request.lightSpacing,
  });
}

export class BuildPlan {
  /**
   * @param {Object} params
   * @param {string} params.railTypeId
   * @param {import("../config/BuildModes.js").BuildingMode} params.buildingMode
   * @param {import("../utils/DirectionUtils.js").CardinalDirection} params.direction
   * @param {number} params.requestedLength What the player asked for.
   * @param {number} params.actualLength The real, final rail count — may exceed `requestedLength` (NORMAL mode, tunnel extension only, see BuildSession.js's history).
   * @param {{x: number, y: number, z: number}} params.startPosition
   * @param {{x: number, y: number, z: number}} params.endPosition
   * @param {ReadonlyArray<{x: number, y: number, z: number}>} params.railPositions Every position a rail block will be placed at, in build order.
   * @param {Object} params.terrainInfo Mode-specific terrain summary — NORMAL: a trimmed TerrainScanResult (no `positions`, already carried above); BRIDGE/UNDERGROUND: that plan's own `terrainSummary`.
   * @param {number|null} params.bridgeHeight BRIDGE only.
   * @param {string|null} params.bridgeMaterialId BRIDGE only.
   * @param {ReadonlyArray<{x: number, y: number, z: number}>|null} params.bridgeSupportPositions BRIDGE only — surface + support positions combined.
   * @param {number|null} params.undergroundDepth UNDERGROUND only.
   * @param {ReadonlyArray<{x: number, y: number, z: number}>|null} params.tunnelPositions NORMAL (hill-tunnel excavation) or UNDERGROUND (full corridor excavation + seal + landing buffer) only. Null for BRIDGE.
   * @param {number} params.requiredRailCount Exact number of rails that will actually be placed.
   * @param {string|null} params.requiredMaterialId BRIDGE only.
   * @param {number|null} params.requiredMaterialCount BRIDGE only — exact number of structural blocks that will actually be placed.
   * @param {ReadonlyArray<string>} params.validationResults Short machine-readable labels for what had already been confirmed by the time this plan was assembled (e.g. "TERRAIN_VALIDATED") — informational, not a second gate; the pipeline stopping early on any real failure is the actual gate.
   */
  constructor({
    railTypeId,
    buildingMode,
    direction,
    requestedLength,
    actualLength,
    startPosition,
    endPosition,
    railPositions,
    terrainInfo,
    bridgeHeight,
    bridgeMaterialId,
    bridgeSupportPositions,
    undergroundDepth,
    tunnelPositions,
    requiredRailCount,
    requiredMaterialId,
    requiredMaterialCount,
    validationResults,
    extras,
  }) {
    /** @readonly */
    this.railTypeId = railTypeId;
    /** @readonly */
    this.buildingMode = buildingMode;
    /** @readonly */
    this.direction = direction;
    /** @readonly */
    this.requestedLength = requestedLength;
    /** @readonly */
    this.actualLength = actualLength;
    /** @readonly */
    this.startPosition = startPosition;
    /** @readonly */
    this.endPosition = endPosition;
    /** @readonly */
    this.railPositions = railPositions;
    /** @readonly */
    this.terrainInfo = terrainInfo;
    /** @readonly */
    this.bridgeHeight = bridgeHeight ?? null;
    /** @readonly */
    this.bridgeMaterialId = bridgeMaterialId ?? null;
    /** @readonly */
    this.bridgeSupportPositions = bridgeSupportPositions ?? null;
    /** @readonly */
    this.undergroundDepth = undergroundDepth ?? null;
    /** @readonly */
    this.tunnelPositions = tunnelPositions ?? null;
    /** @readonly */
    this.requiredRailCount = requiredRailCount;
    /** @readonly */
    this.requiredMaterialId = requiredMaterialId ?? null;
    /** @readonly */
    this.requiredMaterialCount = requiredMaterialCount ?? null;
    /** @readonly */
    this.validationResults = validationResults;
    /** v2.0.0 Step 3 — boosters + tunnel lights, see core/ExtrasPlan.js. */
    this.extras = extras ?? NO_EXTRAS;

    /**
     * @readonly
     * @type {ReadonlySet<string>} Every position this build may write to — see the WORLD MODIFICATION BOUNDARY doc above.
     */
    this.modificationBoundary = new Set([
      ...railPositions.map(positionKey),
      ...(bridgeSupportPositions ?? []).map(positionKey),
      ...(tunnelPositions ?? []).map(positionKey),
      ...this.extras.boosters.map((b) => positionKey(b.powerPosition)),
      ...this.extras.lights.map((l) => positionKey(l.position)),
    ]);
  }

  /**
   * @param {{x: number, y: number, z: number}} position
   * @returns {boolean} True if this build plan is allowed to modify this exact block.
   */
  containsPosition(position) {
    return this.modificationBoundary.has(positionKey(position));
  }

  /**
   * Assembles a BuildPlan from an in-progress PipelineContext — see this
   * file's header for why this is pure reshaping, not a new scan. Must be
   * called only after TerrainScanningStage/InventoryStage/
   * FinalSafetyCheckStage have all already run and succeeded (BuildPlanStage
   * is the one caller, immediately after FinalSafetyCheckStage).
   * @param {import("./pipeline/PipelineContext.js").PipelineContext} context
   * @returns {BuildPlan}
   */
  static fromContext(context) {
    const request = context.request;
    const { railTypeId, buildingMode, requestedLength, bridgeHeight, bridgeMaterialId, undergroundDepth } = request;
    const direction = request.buildVector.direction;

    if (buildingMode === BuildingMode.BRIDGE) {
      const plan = context.bridgePlan;
      const railPositions = plan.deckPositions.map((d) => d.position);
      const bridgeSupportPositions = [...plan.surfacePositions, ...plan.supportPositions];
      return new BuildPlan({
        railTypeId,
        buildingMode,
        direction,
        requestedLength,
        actualLength: plan.requiredRailCount,
        startPosition: plan.startPosition,
        endPosition: plan.endPosition,
        railPositions,
        terrainInfo: plan.terrainSummary,
        bridgeHeight,
        bridgeMaterialId,
        bridgeSupportPositions,
        undergroundDepth: null,
        tunnelPositions: null,
        requiredRailCount: plan.requiredRailCount,
        requiredMaterialId: bridgeMaterialId,
        requiredMaterialCount: plan.requiredSupportBlockCount,
        validationResults: ["TERRAIN_VALIDATED", "INVENTORY_VALIDATED", "MATERIAL_VALIDATED"],
        extras: extrasFor(request, railPositions),
      });
    }

    if (buildingMode === BuildingMode.UNDERGROUND) {
      const plan = context.undergroundPlan;
      const railPositions = plan.railSteps.map((s) => s.position);
      const tunnelPositions = [
        ...plan.railSteps.flatMap((s) => s.excavationPositions),
        ...plan.railSteps.flatMap((s) => s.sealPositions),
        ...(plan.landingExcavationPositions ?? []),
      ];
      return new BuildPlan({
        railTypeId,
        buildingMode,
        direction,
        requestedLength,
        actualLength: plan.requiredRailCount,
        startPosition: plan.startPosition,
        endPosition: plan.endPosition,
        railPositions,
        terrainInfo: plan.terrainSummary,
        bridgeHeight: null,
        bridgeMaterialId: null,
        bridgeSupportPositions: null,
        undergroundDepth,
        tunnelPositions,
        requiredRailCount: plan.requiredRailCount,
        requiredMaterialId: null,
        requiredMaterialCount: null,
        validationResults: ["TERRAIN_VALIDATED", "INVENTORY_VALIDATED"],
        extras: extrasFor(request, railPositions),
      });
    }

    // NORMAL
    const report = context.terrainReport;
    const railPositions = report.positions.map((p) => p.position);
    const tunnelPositions = report.positions
      .filter((p) => p.classification === TerrainClassification.TUNNEL)
      .flatMap((p) => p.futureMetadata?.excavationPositions ?? []);
    // eslint-disable-next-line no-unused-vars -- `positions` is deliberately excluded from terrainInfo; see the field's own doc above.
    const { positions, ...terrainInfo } = report;
    return new BuildPlan({
      railTypeId,
      buildingMode,
      direction,
      requestedLength,
      // The ACTUAL final count, not requestedLength — may be larger if a
      // tunnel extended the build (Project Prompt 14, second round). Same
      // resolution InventoryStage.js already uses for this exact reason.
      actualLength: report.positions.length,
      startPosition: report.positions[0].position,
      endPosition: report.positions[report.positions.length - 1].position,
      railPositions,
      terrainInfo,
      bridgeHeight: null,
      bridgeMaterialId: null,
      bridgeSupportPositions: null,
      undergroundDepth: null,
      tunnelPositions,
      requiredRailCount: report.positions.length,
      requiredMaterialId: null,
      requiredMaterialCount: null,
      validationResults: ["TERRAIN_VALIDATED", "INVENTORY_VALIDATED"],
      extras: extrasFor(request, railPositions),
    });
  }
}
