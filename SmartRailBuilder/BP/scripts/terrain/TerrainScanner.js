import { HAZARD_BLOCK_ID_SET } from "../config/HazardRegistry.js";
import { REPLACEABLE_BLOCK_ID_SET } from "../config/ReplaceableBlockRegistry.js";
import { UNBREAKABLE_BLOCK_ID_SET } from "../config/UnbreakableBlockRegistry.js";
import { VALUABLE_ORE_ID_SET, COMMON_ORE_ID_SET, isOre } from "../config/OreRegistry.js";
import { BRIDGE_CONFIG } from "../config/BridgeConfig.js";
import { UNDERGROUND_CONFIG } from "../config/UndergroundConfig.js";
import { computeBridgeRailY, BridgeRejectionReason } from "./BridgePlan.js";
import { computeUndergroundRailY, rampSlopeDirection, UndergroundRejectionReason } from "./UndergroundPlan.js";
import { readBlock } from "../utils/BlockReader.js";
import { DirectionUtils } from "../utils/DirectionUtils.js";
import { TunnelPlanner } from "./TunnelPlanner.js";
import { GapAnalyzer } from "./GapAnalyzer.js";
import { BridgeDetector } from "./BridgeDetector.js";
import { derivePathCategory } from "./PathCategory.js";
import { LENGTH_PRESETS, RAIL_ITEM_ID_SET } from "../config/RailConfig.js";
import { hasLiquidAbove, isSourceBlock, findLateralSealPositions } from "./WaterDetector.js";

/**
 * TerrainScanner.js
 *
 * PURPOSE
 *   The only module allowed to read blocks from the world during path
 *   planning. Does one pass along a candidate path and returns a neutral
 *   TerrainScanResult — it makes no accept/reject decisions itself. See
 *   ARCHITECTURE.md §5.2 for why this replaced the originally-separate
 *   hazard/chunk/shape scanners, and §21 for the original flat-only design.
 *
 * PROJECT PROMPT 18: UNDERWATER RAILWAY & WATER-SAFE CONSTRUCTION
 *   Water is no longer an automatic rejection everywhere. `_scanPosition()`
 *   now distinguishes three water shapes for NORMAL mode: ground itself
 *   being liquid (no floor at this Y — resolved through the exact same
 *   descend/ascend/tunnel/gap-analysis machinery an ordinary air gap already
 *   uses, so a deep lake correctly surfaces as GapAnalyzer's existing
 *   WATER_CROSSING gap type rather than a new, duplicated code path); a
 *   single shallow layer of water directly at the rail's own spot, over
 *   solid ground (safely buildable — FLAT_SAFE with `isUnderwater: true`,
 *   the rail simply displaces the water block, exactly like placing over
 *   any other replaceable decoration); and water stacked on top of THAT
 *   (too deep for Normal Mode to safely carry a player through — UNSUPPORTED,
 *   `unsupportedReason: "WATER_TOO_DEEP"`, directing the player to Bridge or
 *   Underground Mode via PathValidator). `planBridge()` and
 *   `planUnderground()` are extended the same session — see each method's
 *   own doc below for its water-specific design. See
 *   terrain/WaterDetector.js for the shared detection primitives all three
 *   modes' water handling is built from, and ARCHITECTURE.md's Project
 *   Prompt 18 entry for the full write-up.
 *
 * ROADMAP PHASE 12 (Project Prompt 12): TUNNELS THROUGH RISES > 1 BLOCK
 *   When the rail's own spot is blocked by more than 1 block (a hill/wall
 *   too tall for a simple ±1 ascend), this scanner now tries a tunnel
 *   before giving up — delegating to TunnelPlanner (which delegates to
 *   TunnelDetector) rather than reimplementing that search here. A
 *   successful plan can span MANY positions at once (the whole bore), so
 *   `scanPath()`'s main loop now advances by however many positions were
 *   just resolved, not always exactly 1 — see §37.1 for why this shape of
 *   change was needed and §36's slope design for the pattern it extends.
 *   Only rises are attempted this phase; a drop of more than 1 block is
 *   still UNSUPPORTED, unchanged — see TunnelDetector.js's own header for
 *   why that scope line was drawn there (bridges, not yet built).
 *
 * ROADMAP PHASE 11 (Project Prompt 11): SLOPE-AWARE SCANNING
 *   Through Project Prompt 11's PathValidator fix, this scanner only ever
 *   checked one fixed Y per position (the player's own standing height,
 *   unchanged for the whole path — BuildVector.positionAt() never varied
 *   Y). Any elevation change of any size rejected outright. This session
 *   extends scanning to a genuinely sequential process: each position's Y
 *   is resolved relative to the PREVIOUS position's resolved Y, allowing
 *   exactly ±1 steps (ASCENDING/DESCENDING) while still rejecting anything
 *   steeper (UNSUPPORTED) — see ARCHITECTURE.md §36 for the full design
 *   writeup, including the peak/valley limitation.
 *
 * RESPONSIBILITIES
 *   - Read every planned rail position along the path exactly once — always
 *     the FULL requested length, never stopping early at the first problem,
 *     since a complete picture is what PathValidator and Content Log
 *     diagnostics need (see ARCHITECTURE.md §21.2 for why full-scan was
 *     chosen over stop-early — unchanged this session).
 *   - Classify each position using only information available without
 *     making a judgment call: ground block, the block at the rail's own
 *     position, whether each is solid/replaceable/hazardous/loaded/in-bounds
 *     — now evaluated at up to three candidate Y values per position
 *     (flat, one down, one up), OR handed off to TunnelPlanner when a
 *     rise is too tall for a simple ascend.
 *   - Resolve, in a second pass over the already-scanned positions, which
 *     physical rail blocks need an ascending/descending shape rather than a
 *     flat one — see §36.2's "sloped block belongs to the higher position"
 *     derivation for why this needs a one-position lookahead. Tunnel
 *     positions are never sloped — a level bore has no shape to resolve.
 *   - Re-check a single position on demand (`scanSinglePosition`, Project
 *     Prompt 10) for callers that need a fresh read mid-build, without
 *     re-scanning the whole path. Unchanged this session — see WHY
 *     scanSinglePosition NEEDED NO SLOPE-AWARENESS below (equally true for
 *     tunnel positions, once excavated).
 *   - Convert `undefined` block reads and thrown location errors into a
 *     UNLOADED/OUT_OF_BOUNDS classification rather than letting them
 *     propagate — except for genuinely unexpected errors, which are
 *     re-thrown so BuildPipeline's existing error handling catches them.
 *   - Produce an aggregate summary (counts, overall readiness) alongside
 *     the per-position detail, in the same single pass.
 *
 * WHY scanSinglePosition NEEDED NO SLOPE-AWARENESS (and no tunnel-awareness)
 *   It's tempting to assume placement-time re-verification needs to relearn
 *   whether a position is flat/ascending/descending/tunnel. It doesn't: an
 *   ascending, descending, or (once excavated) tunnel position's OWN
 *   ground/above check, at its already-resolved Y, looks exactly like an
 *   ordinary flat check — "ground solid one below, clear at my own
 *   position." The *label* only ever described how the scanner GOT to that
 *   Y relative to its neighbor (or, for tunnels, that it needed excavating
 *   first), never a property of the position in isolation once it's
 *   actually ready. So `scanSinglePosition(path[i].position, dimension)` —
 *   called with the already-resolved position, unchanged from Project
 *   Prompt 10 — correctly re-confirms placement-time safety by simply
 *   checking it's still FLAT_SAFE at that specific Y, AFTER excavation has
 *   already happened for tunnel positions. See
 *   builder/strategies/StraightRailStrategy.js for exactly how the
 *   excavate-then-recheck order works.
 *
 * WHAT THIS CLASS DOES NOT DO (Project Prompt 7's explicit scope boundary,
 * still true this session)
 *   It never decides whether a path is buildable, never sends player
 *   messages, and never places or removes a block — including excavating a
 *   tunnel; TunnelDetector only READS blocks to check feasibility, the same
 *   "detection only" boundary this class has always had. "Detection only"
 *   — see ARCHITECTURE.md §21 for the full reasoning.
 *
 * FUTURE EXTENSIONS
 *   - Bridges (Roadmap Phase 13+) would extend the same "try a candidate Y
 *     or strategy, fall back if it doesn't work" pattern for the DROP case
 *     this phase deliberately left alone.
 *
 * DEPENDENCIES
 *   - config/HazardRegistry.js (HAZARD_BLOCK_ID_SET — pre-built, see that file's Project Prompt 13 comment)
 *   - utils/BlockReader.js (readBlock — extracted this session, see that file's header)
 *   - core/BuildVector.js (via its horizontalAt() method, passed in by the caller)
 *   - utils/DirectionUtils.js (opposite(), for descending rail shape)
 *   - ./TerrainClassification.js (re-exported below — see that file's own
 *     header for why the enum now lives there instead of here)
 *   - ./TunnelPlanner.js (Roadmap Phase 12)
 */

// Re-exported for full backward compatibility — every existing
// `import { TerrainClassification } from "./TerrainScanner.js"` (or
// "../terrain/TerrainScanner.js") elsewhere in the codebase continues to
// work unchanged. See ./TerrainClassification.js's header for why the
// enum itself moved to its own leaf file this session.
export { TerrainClassification } from "./TerrainClassification.js";
import { TerrainClassification } from "./TerrainClassification.js";

/** Classifications a build may safely proceed through. */
const BUILDABLE_CLASSIFICATIONS = Object.freeze([
  TerrainClassification.FLAT_SAFE,
  TerrainClassification.ASCENDING,
  TerrainClassification.DESCENDING,
  TerrainClassification.TUNNEL,
]);

/**
 * @typedef {Object} TerrainPositionFact
 * @property {{x: number, y: number, z: number}} position The rail's own placement position (resolved Y, may differ from a flat reference line — Roadmap Phase 11).
 * @property {string} [groundBlockId] typeId of the supporting block (position.y - 1). Undefined if unloaded/out-of-bounds.
 * @property {string} [aboveBlockId] typeId of the block at the rail's own position. Undefined if unloaded/out-of-bounds.
 * @property {boolean} isGroundSolid True if the ground block is neither air nor liquid.
 *   Deliberately not `Block.isSolid` — see ARCHITECTURE.md §34 for why (Project Prompt 11 follow-up fix).
 * @property {boolean} isAboveReplaceable `true` for air OR any block on
 *   config/ReplaceableBlockRegistry.js (short grass, flowers, dead bush,
 *   thin snow, saplings, etc. — see that file for the full, documented
 *   list and what's deliberately excluded). Was `block.isAir` only until
 *   a bugfix reported after Project Prompt 15's in-game test — see
 *   ARCHITECTURE.md §42 for the root-cause write-up. §21.4's original
 *   reasoning (conservative default given no live testing yet) is
 *   superseded, not deleted — read together they show why the initial
 *   choice was reasonable and why it needed revisiting once real
 *   terrain was actually tested.
 * @property {boolean} isExistingRail Added Project Prompt 19. `true` if the block at the
 *   rail's own position is already one of the 4 recognized rail types (config/RailConfig.js's
 *   RAIL_ITEM_ID_SET) — informational only; this field does not itself drive any
 *   accept/preserve decision (that logic already existed, see RAIL_ITEM_ID_SET's own doc).
 * @property {boolean} isLoaded
 * @property {boolean} isInBounds
 * @property {TerrainClassification} classification
 * @property {string} [hazardBlockId] Populated only when classification is HAZARD.
 * @property {string} [unsupportedReason] Added Roadmap Phase 12. Populated when
 *   classification is UNSUPPORTED and the cause is one of: a failed tunnel attempt (one
 *   of TunnelDetector's failure reasons — "UNBREAKABLE", "HAZARD", "TOO_LONG", "UNLOADED",
 *   "OUT_OF_BOUNDS", "FLOOR_GAP"); water too deep to safely ride through directly, Project
 *   Prompt 18 ("WATER_TOO_DEEP"); an unbreakable block sitting directly at the rail's own
 *   spot over otherwise-solid ground, Project Prompt 19 ("UNBREAKABLE" — the same string
 *   as the tunnel-failure case, since it maps to the same player-facing message); or
 *   insufficient headroom one block above an otherwise-buildable rail spot, Project
 *   Prompt 19 ("LOW_CLEARANCE" — see `_checkHeadroom()`). Undefined for a bigger drop or
 *   a peak/valley reversal (Roadmap Phase 11 UNSUPPORTED cases, which keep the generic
 *   "too steep" message).
 * @property {import("../utils/DirectionUtils.js").CardinalDirection|null} slopeDirection
 *   Added Roadmap Phase 11. Null for a flat or tunnel rail block. Otherwise, the compass
 *   direction this specific rail block should visually ascend toward — see
 *   ARCHITECTURE.md §36.2 for why this doesn't always match `classification`
 *   1:1 (a DESCENDING position's own block is usually flat; its PREVIOUS
 *   neighbor is the one that gets the sloped shape). Resolved in a second
 *   pass by `scanPath()`; always `null` from `scanSinglePosition()`, which
 *   doesn't need it — see WHY scanSinglePosition NEEDED NO SLOPE-AWARENESS above.
 * @property {{excavationPositions: ReadonlyArray<{x: number, y: number, z: number}>}} [futureMetadata]
 *   Added Roadmap Phase 12: populated only for TUNNEL positions, listing the exact
 *   block(s) TunnelExcavator must clear for this row (rail spot + headroom — see
 *   terrain/TunnelPlanner.js). Undefined for every other classification. The name
 *   ("future") predates this session but was kept rather than churned — see
 *   ARCHITECTURE.md §37.1 for why reusing the existing reserved field was preferred
 *   over adding a new one.
 * @property {import("./PathCategory.js").PathCategory} [pathCategory] Added Roadmap
 *   Phase 13. A simplified 6-category summary derived from `classification` (and, for
 *   a DEEP_DROP gap, also `gapAnalysis`/`bridgeFeasibility`) — see terrain/PathCategory.js
 *   for the full derivation and why this is informational only, never consulted by
 *   PathValidator. Undefined only from `scanSinglePosition()`, which has no use for it.
 * @property {import("./GapAnalyzer.js").GapAnalysis} [gapAnalysis] Added Roadmap Phase
 *   13. Present only when `unsupportedReason` is "DEEP_DROP" — see `_enrichGapPositions()`.
 * @property {import("./BridgeDetector.js").BridgeFeasibility} [bridgeFeasibility] Added
 *   Roadmap Phase 13. Present only when `unsupportedReason` is "DEEP_DROP". Never
 *   consulted for any accept/reject decision — see BridgeDetector.js's header.
 * @property {boolean} isUnderwater Added Project Prompt 18. True only for a FLAT_SAFE
 *   (or, via the ±1 step machinery, ASCENDING/DESCENDING) position whose rail spot is a
 *   single shallow layer of water over solid ground — purely informational (execution
 *   places a rail there exactly like any other clear position; the block naturally
 *   displaces the water). Always false for every other classification.
 * @property {{isSourceBlock: boolean}} [waterInfo] Added Project Prompt 18. Present only
 *   when `isUnderwater` is true — see terrain/WaterDetector.js's `isSourceBlock()`.
 */

/**
 * @typedef {Object} TerrainScanResult
 * @property {ReadonlyArray<TerrainPositionFact>} positions
 * @property {number} totalScanned
 * @property {number} safeCount Positions classified FLAT_SAFE, ASCENDING, DESCENDING, or TUNNEL.
 * @property {number} unsafeCount
 * @property {number} hazardCount Positions classified HAZARD or LIQUID.
 * @property {number} unsupportedCount Positions classified UNSUPPORTED (replaces Project Prompt 11's elevationChangeCount — see ARCHITECTURE.md §36.1).
 * @property {number} ascendingCount
 * @property {number} descendingCount
 * @property {number} tunnelCount Added Roadmap Phase 12.
 * @property {number} unloadedCount
 * @property {number} underwaterCount Added Project Prompt 18. Buildable positions (FLAT_SAFE/ASCENDING/DESCENDING) whose rail spot is a safe, shallow water layer — see `TerrainPositionFact.isUnderwater`.
 * @property {boolean} isFlat True only if ascendingCount, descendingCount, tunnelCount, and unsupportedCount are all 0.
 * @property {boolean} buildReady True only if every position is FLAT_SAFE, ASCENDING, DESCENDING, or TUNNEL.
 */

/**
 * v2.0.0 Step 4 (cave gap filling): from an empty floor position, walks down
 * looking for real support within UNDERGROUND_CONFIG.CAVE_FILL_MAX_DEPTH.
 * Returns the positions to fill, BOTTOM-UP (each block placed on the one
 * below it), or null when there's no safe support in range — open water,
 * lava, an unloaded/out-of-world block, or just too deep.
 *
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {{x:number,y:number,z:number}} floorPosition the empty block directly under the rail
 * @returns {Array<{x:number,y:number,z:number}>|null}
 */
function findCaveFillColumn(dimension, floorPosition) {
  const column = [];
  for (let d = 0; d < UNDERGROUND_CONFIG.CAVE_FILL_MAX_DEPTH; d++) {
    const position = { x: floorPosition.x, y: floorPosition.y - d, z: floorPosition.z };
    const read = readBlock(dimension, position);
    if (read.status !== "OK") return null;
    const block = read.block;
    if (block.isLiquid || HAZARD_BLOCK_ID_SET.has(block.typeId)) return null;
    if (block.isAir || REPLACEABLE_BLOCK_ID_SET.has(block.typeId)) {
      column.push(position);
      continue;
    }
    return column.reverse(); // solid support found
  }
  return null;
}

export class TerrainScanner {
  constructor() {
    /** @private */
    this._tunnelPlanner = new TunnelPlanner();
    /** @private */
    this._gapAnalyzer = new GapAnalyzer();
    /** @private */
    this._bridgeDetector = new BridgeDetector();
  }

  /**
   * @param {import("../core/BuildVector.js").BuildVector} buildVector
   * @param {number} length Requested number of positions to scan, starting at
   *   buildVector.origin. NOT a hard ceiling as of Project Prompt 14's second round —
   *   see EXTENDING PAST THE REQUESTED LENGTH below. The absolute ceiling is always
   *   `RailConfig.LENGTH_PRESETS.MAX_SURVIVAL`.
   * @param {import("@minecraft/server").Dimension} dimension
   * @returns {TerrainScanResult}
   */
  scanPath(buildVector, length, dimension) {
    const positions = [];
    let expectedY = buildVector.origin.y;
    /** @type {TerrainClassification|null} */
    let previousClassification = null;

    // EXTENDING PAST THE REQUESTED LENGTH (Project Prompt 14, second round)
    //   `scanLimit` starts equal to the requested `length`, exactly as before — but
    //   unlike `length` itself, it can grow when a tunnel needs more room than the
    //   original request left, up to the hard absolute ceiling
    //   (`LENGTH_PRESETS.MAX_SURVIVAL`). This was a real bug fix, not a new feature:
    //   in-game testing showed a tunnel's search room was previously computed as
    //   `length - i` — shrinking based on how much of the ORIGINALLY REQUESTED length
    //   had already been used by earlier terrain in the same build — so even a
    //   64-length build (the max) could still starve a tunnel of room if the
    //   obstruction started partway through. Confirmed with you directly: a tunnel
    //   should get its own fresh budget against the absolute ceiling, and the overall
    //   build may grow past what was originally requested to fit it. See
    //   config/TunnelConfig.js's NOTE ON MAX_SEARCH_LENGTH and ARCHITECTURE.md §40.
    let scanLimit = length;

    for (let i = 0; i < scanLimit; i++) {
      const { x, z } = buildVector.horizontalAt(i);

      if (i === 0) {
        const fact = this._scanPosition(dimension, { x, y: expectedY, z });
        positions.push(fact);
        expectedY = fact.position.y;
        previousClassification = fact.classification;
        continue;
      }

      const stepped = this._resolveSteppedPosition(dimension, x, z, expectedY, previousClassification);

      if (stepped !== null) {
        positions.push(stepped);
        expectedY = stepped.position.y;
        previousClassification = stepped.classification;
        continue;
      }

      // stepped === null: a rise too tall for a simple ±1 ascend — a
      // tunnel candidate (Roadmap Phase 12). Only this loop has the
      // buildVector/index/ceiling-distance TunnelPlanner needs, so the
      // attempt happens here rather than inside _resolveSteppedPosition().
      // positionsUntilAbsoluteCeiling is deliberately NOT `length - i` (see
      // EXTENDING PAST THE REQUESTED LENGTH above) — it's how far `i` can
      // go before hitting the hard ceiling, independent of what was
      // originally requested.
      const positionsUntilAbsoluteCeiling = LENGTH_PRESETS.MAX_SURVIVAL - i;
      const tunnelPlan = this._tunnelPlanner.plan(dimension, buildVector, i, expectedY, positionsUntilAbsoluteCeiling);

      if (tunnelPlan.possible) {
        if (tunnelPlan.length === 0) {
          // A zero-length tunnel means TunnelDetector found the exit
          // immediately — nothing actually needed excavating at this
          // position. This is the CORRECT, expected outcome for a true
          // 1-block-wide spike or valley floor (Roadmap Phase 14): there's
          // nothing to bore through, the terrain simply continues on the
          // other side of the reversal.
          //
          // CRITICAL: previousClassification MUST change before this exact
          // position is re-evaluated, or _resolveSteppedPosition() hits the
          // same ASCENDING/DESCENDING reversal guard again with unchanged
          // inputs and returns null a second time — confirmed by literally
          // crashing this method during Project Prompt 14 design work
          // (`Cannot read properties of null`) before this comment and the
          // `previousClassification = TUNNEL` line below were added. TUNNEL
          // is used as a deliberate "neither ASCENDING nor DESCENDING"
          // pass-through value — it doesn't claim this position tunneled
          // (it didn't; 0 TUNNEL-classified facts are pushed here), it only
          // needs to not match either reversal guard. `i` is decremented so
          // the loop's own `i++` re-lands on this exact same index next
          // iteration, this time resolving normally. See ARCHITECTURE.md
          // §39.2 for the full trace, including the crash that caught this.
          i -= 1;
          previousClassification = TerrainClassification.TUNNEL;
          continue;
        }
        for (const tunnelFact of tunnelPlan.positions) {
          positions.push(tunnelFact);
        }
        // If this tunnel pushes the final position past what was
        // originally requested, grow scanLimit to match — capped at the
        // absolute ceiling, never beyond it (guaranteed by
        // positionsUntilAbsoluteCeiling already having bounded the tunnel
        // search itself, so `i + tunnelPlan.length` here can never exceed
        // `LENGTH_PRESETS.MAX_SURVIVAL`). See EXTENDING PAST THE REQUESTED
        // LENGTH above.
        const endOfTunnel = i + tunnelPlan.length;
        if (endOfTunnel > scanLimit) {
          scanLimit = endOfTunnel;
        }
        // -1 because the for-loop's own i++ advances one more position on
        // top of this. expectedY is unchanged — a tunnel is always a level
        // bore, never a slope (see TunnelDetector.js's header).
        i += tunnelPlan.length - 1;
        previousClassification = TerrainClassification.TUNNEL;
        continue;
      }

      // Tunnel not possible either — genuinely unsupported. The specific
      // reason (unbreakable block, hazard, too long...) rides along on the
      // fact so PathValidator can give a more specific message than the
      // generic "too steep" — see _unsupportedFact() and PathValidator.js.
      const unsupportedFact = this._unsupportedFact({ x, y: expectedY, z }, tunnelPlan.failureReason);
      positions.push(unsupportedFact);
      previousClassification = TerrainClassification.UNSUPPORTED;
    }

    const enrichedPositions = this._enrichGapPositions(positions, dimension, buildVector);
    const shapedPositions = this._resolveRailShapes(enrichedPositions, buildVector.direction);

    return this._summarize(shapedPositions);
  }

  /**
   * Roadmap Phase 13 (Project Prompt 13): a third pass, after Y/classification
   * resolution and independent of rail-shape resolution, that attaches
   * purely informational gap/bridge data to any position tagged
   * `unsupportedReason: "DEEP_DROP"` by `_resolveSteppedPosition()` — a
   * drop of more than 1 block, which stays exactly as UNSUPPORTED
   * (unbuildable) as it was before this session. See GapAnalyzer.js and
   * BridgeDetector.js's headers, and ARCHITECTURE.md §38.1, for why this
   * enrichment never influences `classification` or `buildReady` — only
   * adds `gapAnalysis`/`bridgeFeasibility`/`pathCategory`, all purely
   * descriptive. Every other classification gets `pathCategory` derived
   * directly with no gap analysis needed (derivePathCategory() handles
   * both cases — see terrain/PathCategory.js).
   *
   * @param {ReadonlyArray<TerrainPositionFact>} positions
   * @param {import("@minecraft/server").Dimension} dimension
   * @param {import("../core/BuildVector.js").BuildVector} buildVector
   * @returns {ReadonlyArray<TerrainPositionFact>}
   * @private
   */
  _enrichGapPositions(positions, dimension, buildVector) {
    return positions.map((fact, i) => {
      if (fact.unsupportedReason !== "DEEP_DROP") {
        return { ...fact, pathCategory: derivePathCategory(fact.classification, undefined, undefined) };
      }

      const gapAnalysis = this._gapAnalyzer.analyze(dimension, fact.position);
      const bridgeFeasibility = this._bridgeDetector.detect(dimension, buildVector, i, fact.position.y, gapAnalysis);
      const pathCategory = derivePathCategory(fact.classification, gapAnalysis, bridgeFeasibility);

      return { ...fact, gapAnalysis, bridgeFeasibility, pathCategory };
    });
  }

  /**
   * Re-checks exactly one position, reusing the same base classification
   * logic as scanPath(). Added Project Prompt 10 for StraightRailStrategy's
   * per-block safety re-check during a multi-tick build — placement can
   * take many ticks for a long railway, during which the terrain at a
   * position scanned earlier (by scanPath(), possibly many ticks ago) can
   * change. This is the "revalidate immediately before mutating" principle,
   * applied to terrain the same way it's already applied to inventory (see
   * inventory/InventoryManager.js's deductRailItems doc). Deliberately does
   * NOT attempt ascend/descend fallback — see WHY scanSinglePosition NEEDED
   * NO SLOPE-AWARENESS in this file's header for why that's correct, not a
   * gap: callers always pass an already-resolved position (e.g.
   * `path[i].position` from the original scan), so a plain flat-safety
   * check at that exact Y is the right re-verification regardless of
   * whether that position was originally flat, ascending, or descending.
   *
   * @param {{x: number, y: number, z: number}} position The rail's own placement position.
   * @param {import("@minecraft/server").Dimension} dimension
   * @returns {TerrainPositionFact}
   */
  scanSinglePosition(position, dimension) {
    const groundPosition = { x: position.x, y: position.y - 1, z: position.z };
    return this._scanPosition(dimension, position, groundPosition);
  }

  /**
   * Rewritten in the bugfix pass before Project Prompt 18: plans an
   * entire Bridge Mode railway with a real ascending ramp, a flat crest
   * across the gap, and a real descending ramp back down — replacing the
   * Project Prompt 16 version's single fixed elevation for the whole
   * span, which is what produced both reported bugs at once: no gradual
   * climb (BUG 1) and, since every position needed an equally-tall full
   * support column under perfectly flat terrain, a continuous vertical
   * wall of blocks (BUG 2). See ARCHITECTURE.md §46.1-§46.2 for the full
   * diagnosis (including why the uploaded screenshots show what they
   * show) and the complete geometric derivation this method implements.
   *
   * ELEVATION PROFILE (one authoritative formula, `railYAt()` below)
   *   index 0 and index length-1 are always FLAT, at the railway's
   *   starting elevation (`buildVector.origin.y` — the same reference
   *   point Roadmap Phase 16/17 already established for both other
   *   modes). Indices [1, bridgeHeight] climb one block per index
   *   (ascending-shaped rail, ARCHITECTURE.md §46.2 derives exactly why
   *   this range, not [0, bridgeHeight-1], is the one that gets the
   *   sloped shape — it follows directly from this project's own
   *   established "the sloped block belongs to the higher of the two
   *   positions it connects" rule, unchanged from Roadmap Phase 11).
   *   Indices [length-1-bridgeHeight, length-2] mirror that descending
   *   back down at the far end. Whatever's left in between is flat, at
   *   the full bridgeHeight — this is the crest that actually crosses the
   *   gap, matching Project Prompt 16 (this pass)'s "after reaching the
   *   selected bridge height, the railway should continue horizontally."
   *
   * MINIMUM LENGTH: `length >= 2*bridgeHeight + 3`, NOT `+ 1`
   *   A real vanilla rail cannot represent a sharp peak — a single block
   *   cannot simultaneously be "the top of an up-ramp" and "the top of a
   *   down-ramp" with one `rail_direction` value (see
   *   RailPermutationBuilder.js: only one ascending direction can be
   *   encoded at a time). The crest therefore needs AT LEAST ONE genuine
   *   flat block connecting the last ascending block to the first
   *   descending block. Combined with the mandatory flat start and flat
   *   end, the true geometric minimum is `2*bridgeHeight + 3`
   *   (bridgeHeight ascending + 1 crest + bridgeHeight descending + flat
   *   start + flat end), derived and hand-verified against a worked
   *   example in ARCHITECTURE.md §46.2 — not the `2*bridgeHeight + 1`
   *   that a naive "just needs to get up and back down" count would
   *   suggest. Rejected, with the real minimum stated, exactly like
   *   Underground Mode's `LENGTH_TOO_SHORT_FOR_DEPTH` (Roadmap Phase 17)
   *   — the same pattern, applied to the mode it was always structurally
   *   analogous to.
   *
   * LIGHTWEIGHT PIER STRUCTURE, NOT A FULL COLUMN EVERY POSITION (BUG 2's fix)
   *   Every position that needs ANY fill still gets exactly one deck
   *   block (`surfacePositions`) directly beneath its rail — a rail must
   *   always have something to sit on. But a full support column reaching
   *   all the way down to real ground (`supportPositions`) is now built
   *   only at PIER positions: index 0, index length-1, and every index
   *   that's a multiple of `BRIDGE_CONFIG.PIER_SPACING` — see
   *   `isPierIndex()` below. Between piers, the deck simply floats (a
   *   valid, common, idiomatic Minecraft bridge pattern for non-gravity
   *   materials like the ones this addon offers) — no vertical fill, no
   *   downward ground-search, at all. This is both the "look like a real
   *   bridge" fix and, independently, a real performance win: far fewer
   *   blocks placed, and far fewer blocks READ (non-pier positions never
   *   scan downward for ground at all).
   *
   * EXISTING-RAIL CROSSING (bugfix pass before Project Prompt 18)
   *   Deck/headroom clearance now also accepts an existing rail
   *   (`RAIL_ITEM_ID_SET`) as clear, exactly matching the same fix applied
   *   to `_scanPosition()`/`planUnderground()` — see
   *   config/RailConfig.js's RAIL_ITEM_ID_SET doc.
   *
   * WHAT DIDN'T CHANGE
   *   Still a single pass, still rejects the WHOLE plan the instant any
   *   position fails (never a partial plan), still reuses this class's
   *   own `readBlock` and the hazard/unbreakable/replaceable registries
   *   rather than duplicating them. Still knows nothing about WHICH
   *   material will be used — that's an execution-time concern now that
   *   material is player-chosen (see core/BuildRequest.js's
   *   `bridgeMaterialId` and BridgeExecutionStrategy.js) rather than a
   *   fixed constant; planning only ever decides WHERE blocks go.
   *
   * @param {import("../core/BuildVector.js").BuildVector} buildVector
   * @param {number} length Requested number of rail positions.
   * @param {import("@minecraft/server").Dimension} dimension
   * @param {number} bridgeHeight Already validated 1-16 by ModeConfigValidator — this method re-derives nothing about that bound, it only consumes the value.
   * @returns {import("./BridgePlan.js").BridgePlan}
   */
  planBridge(buildVector, length, dimension, bridgeHeight) {
    const originY = buildVector.origin.y;
    const minimumLength = 2 * bridgeHeight + 3;

    if (length < minimumLength) {
      return {
        feasible: false,
        rejectionReason: BridgeRejectionReason.LENGTH_TOO_SHORT_FOR_HEIGHT,
        minimumRequiredLength: minimumLength,
      };
    }

    const deckPositions = [];
    const surfacePositions = [];
    const supportPositions = [];
    let columnsRequiringFill = 0;
    let deepestFillColumn = 0;

    const originGroundRead = readBlock(dimension, { x: buildVector.origin.x, y: originY - 1, z: buildVector.origin.z });
    const originGroundY = originGroundRead.status === "OK" ? originY - 1 : originY - 1;

    for (let i = 0; i < length; i++) {
      const { x, z } = buildVector.horizontalAt(i);
      const { y: railY, slopeDirection } = this._resolveBridgeElevation(i, length, bridgeHeight, originY, buildVector.direction);
      const deckPosition = { x, y: railY, z };
      const headroomCount = slopeDirection ? BRIDGE_CONFIG.RAMP_LEVEL_CLEARANCE - 1 : BRIDGE_CONFIG.FLAT_LEVEL_CLEARANCE - 1;

      const deckRead = readBlock(dimension, deckPosition);
      if (deckRead.status !== "OK") {
        return {
          feasible: false,
          rejectionReason: deckRead.status === "OUT_OF_BOUNDS" ? BridgeRejectionReason.OUT_OF_BOUNDS : BridgeRejectionReason.UNLOADED_CHUNK,
          rejectionPosition: deckPosition,
        };
      }
      const deckBlock = deckRead.block;
      const deckIsExistingRail = RAIL_ITEM_ID_SET.has(deckBlock.typeId);

      if (!deckIsExistingRail) {
        if (HAZARD_BLOCK_ID_SET.has(deckBlock.typeId)) {
          return { feasible: false, rejectionReason: BridgeRejectionReason.BLOCKED_BY_HAZARD, rejectionPosition: deckPosition };
        }
        // WATER DETECTION (Project Prompt 18): a liquid deck position no
        // longer rejects the bridge outright — the deck simply passes over
        // it, exactly like the pier-support search further below already
        // tolerates water rising through a support column (see that
        // search's own `isRealSolidGround` check, and BridgeSupportBuilder.js's
        // doc for why placement there deliberately never checks `isLiquid`).
        // BridgeRejectionReason.BLOCKED_BY_LIQUID is no longer produced by
        // this method as of this session — kept in the enum
        // (terrain/BridgePlan.js) as a documented, now-unreachable value
        // rather than deleted, matching this project's existing precedent
        // for a superseded-but-harmless constant (see config/RailConfig.js's
        // FALLBACK_MATERIAL_ID rename history). Lava remains rejected above
        // (a HAZARD_BLOCK_ID_SET member, checked first) — unaffected by
        // this change; see ARCHITECTURE.md's Project Prompt 18 entry.
        const deckClear = deckBlock.isAir || deckBlock.isLiquid || REPLACEABLE_BLOCK_ID_SET.has(deckBlock.typeId);
        if (!deckClear) {
          const blockedByUnbreakable = UNBREAKABLE_BLOCK_ID_SET.has(deckBlock.typeId);
          return {
            feasible: false,
            rejectionReason: blockedByUnbreakable ? BridgeRejectionReason.BLOCKED_BY_UNBREAKABLE : BridgeRejectionReason.BLOCKED_BY_TERRAIN,
            rejectionPosition: deckPosition,
          };
        }
      }

      for (let h = 1; h <= headroomCount; h++) {
        const headroomPosition = { x, y: railY + h, z };
        const headroomRead = readBlock(dimension, headroomPosition);
        if (headroomRead.status !== "OK") {
          return {
            feasible: false,
            rejectionReason: headroomRead.status === "OUT_OF_BOUNDS" ? BridgeRejectionReason.OUT_OF_BOUNDS : BridgeRejectionReason.UNLOADED_CHUNK,
            rejectionPosition: headroomPosition,
          };
        }
        const headroomBlock = headroomRead.block;
        if (RAIL_ITEM_ID_SET.has(headroomBlock.typeId)) continue;
        if (HAZARD_BLOCK_ID_SET.has(headroomBlock.typeId)) {
          return { feasible: false, rejectionReason: BridgeRejectionReason.BLOCKED_BY_HAZARD, rejectionPosition: headroomPosition };
        }
        // WATER DETECTION (Project Prompt 18): see the matching deck-level
        // comment above — water in the headroom column is likewise treated
        // as clear, not a rejection.
        const headroomClear = headroomBlock.isAir || headroomBlock.isLiquid || REPLACEABLE_BLOCK_ID_SET.has(headroomBlock.typeId);
        if (!headroomClear) {
          const blockedByUnbreakable = UNBREAKABLE_BLOCK_ID_SET.has(headroomBlock.typeId);
          return {
            feasible: false,
            rejectionReason: blockedByUnbreakable ? BridgeRejectionReason.BLOCKED_BY_UNBREAKABLE : BridgeRejectionReason.BLOCKED_BY_TERRAIN,
            rejectionPosition: headroomPosition,
          };
        }
      }

      deckPositions.push({ position: deckPosition, slopeDirection });

      if (deckIsExistingRail) {
        // Already a rail — never fill beneath an existing crossing rail's
        // own column; leave whatever's already supporting it untouched.
        continue;
      }

      const isPier = i === 0 || i === length - 1 || i % BRIDGE_CONFIG.PIER_SPACING === 0;
      const groundCheckPosition = { x, y: railY - 1, z };
      const groundRead = readBlock(dimension, groundCheckPosition);
      if (groundRead.status !== "OK") {
        return {
          feasible: false,
          rejectionReason: groundRead.status === "OUT_OF_BOUNDS" ? BridgeRejectionReason.OUT_OF_BOUNDS : BridgeRejectionReason.UNLOADED_CHUNK,
          rejectionPosition: groundCheckPosition,
        };
      }
      const groundAlreadySolid =
        !groundRead.block.isAir && !groundRead.block.isLiquid && !REPLACEABLE_BLOCK_ID_SET.has(groundRead.block.typeId);
      if (groundAlreadySolid) {
        continue; // terrain already reaches the deck — nothing to place, pier or not
      }

      if (!isPier) {
        // Non-pier column needing fill: place ONLY the single deck/surface
        // block. No downward search, no support column — the deck floats
        // between piers, exactly like a real pier bridge. See PIER
        // STRUCTURE above.
        surfacePositions.push(groundCheckPosition);
        columnsRequiringFill += 1;
        deepestFillColumn = Math.max(deepestFillColumn, 1);
        continue;
      }

      // Pier column: search down for real ground, exactly Project Prompt
      // 16's original per-position logic, just now applied selectively.
      const fillColumnTopDown = [];
      let foundGroundY = null;
      for (let depth = 0; depth <= BRIDGE_CONFIG.MAX_SUPPORT_SEARCH_DEPTH; depth++) {
        const checkY = railY - 1 - depth;
        const checkPosition = { x, y: checkY, z };
        const read = readBlock(dimension, checkPosition);
        if (read.status !== "OK") {
          return {
            feasible: false,
            rejectionReason: read.status === "OUT_OF_BOUNDS" ? BridgeRejectionReason.OUT_OF_BOUNDS : BridgeRejectionReason.UNLOADED_CHUNK,
            rejectionPosition: checkPosition,
          };
        }
        const groundBlock = read.block;
        if (HAZARD_BLOCK_ID_SET.has(groundBlock.typeId)) {
          return { feasible: false, rejectionReason: BridgeRejectionReason.SUPPORT_HAZARD, rejectionPosition: checkPosition };
        }
        const isRealSolidGround = !groundBlock.isAir && !groundBlock.isLiquid && !REPLACEABLE_BLOCK_ID_SET.has(groundBlock.typeId);
        if (isRealSolidGround) {
          foundGroundY = checkY;
          break;
        }
        fillColumnTopDown.push(checkPosition);
      }
      if (foundGroundY === null) {
        return { feasible: false, rejectionReason: BridgeRejectionReason.SUPPORT_UNAVAILABLE, rejectionPosition: groundCheckPosition };
      }
      if (fillColumnTopDown.length > 0) {
        columnsRequiringFill += 1;
        deepestFillColumn = Math.max(deepestFillColumn, fillColumnTopDown.length);
        const fillColumnBottomUp = fillColumnTopDown.slice().reverse();
        surfacePositions.push(fillColumnBottomUp[fillColumnBottomUp.length - 1]);
        for (let j = 0; j < fillColumnBottomUp.length - 1; j++) {
          supportPositions.push(fillColumnBottomUp[j]);
        }
      }
    }

    return {
      feasible: true,
      startPosition: deckPositions[0].position,
      endPosition: deckPositions[deckPositions.length - 1].position,
      direction: buildVector.direction,
      length,
      bridgeHeight,
      deckPositions,
      surfacePositions,
      supportPositions,
      requiredRailCount: deckPositions.length,
      requiredSupportBlockCount: supportPositions.length + surfacePositions.length,
      terrainSummary: { originGroundY, columnsRequiringFill, deepestFillColumn, pierSpacing: BRIDGE_CONFIG.PIER_SPACING },
    };
  }

  /**
   * The one authoritative elevation-profile formula for Bridge Mode — see
   * planBridge()'s ELEVATION PROFILE doc above for the full derivation.
   * Kept as a small private helper (not a free function in BridgePlan.js
   * like `computeBridgeRailY` — Roadmap Phase 16's original single-value
   * version — since this needs `DirectionUtils.opposite()`, and every
   * other per-index geometry helper in this file is already private to
   * this class) so `planBridge()`'s main loop stays readable.
   * @param {number} index
   * @param {number} length
   * @param {number} bridgeHeight
   * @param {number} originY
   * @param {import("../utils/DirectionUtils.js").CardinalDirection} travelDirection
   * @returns {{y: number, slopeDirection: import("../utils/DirectionUtils.js").CardinalDirection|null}}
   * @private
   */
  _resolveBridgeElevation(index, length, bridgeHeight, originY, travelDirection) {
    if (index === 0 || index === length - 1) {
      return { y: originY, slopeDirection: null };
    }
    if (index <= bridgeHeight) {
      return { y: originY + index, slopeDirection: travelDirection };
    }
    const distanceFromEnd = length - 1 - index;
    if (distanceFromEnd <= bridgeHeight) {
      return { y: originY + distanceFromEnd, slopeDirection: DirectionUtils.opposite(travelDirection) };
    }
    return { y: computeBridgeRailY(originY, bridgeHeight), slopeDirection: null };
  }

  /**
   * Added Roadmap Phase 17 (Project Prompt 17): plans an entire Underground
   * Mode railway — a continuous descending ramp from the surface down to
   * the requested depth, then a flat run at that depth, with the corridor
   * excavation for both computed up front.
   *
   * Structurally the mirror of `planBridge()` above (same single-pass,
   * reject-the-whole-plan-on-first-failure shape, same "never return a
   * partial plan" guarantee) and deliberately NOT built on top of
   * `scanPath()`'s ground-following machinery, for the same reason: the
   * elevation profile here is fully determined by `origin.y` and `depth`
   * before a single block is read, rather than discovered from terrain.
   *
   * Reuses this class's existing block-reading tools (`readBlock`, the
   * hazard/unbreakable/replaceable/ore registry Sets) rather than
   * duplicating them — "use the existing Terrain Scanner... do not
   * duplicate existing block-scanning logic" per Project Prompt 17.
   *
   * WATERPROOF TUNNEL (Project Prompt 18)
   *   Water intersecting the corridor (rail spot or headroom) no longer
   *   rejects the plan outright — it's excavated like any other clearable
   *   block, and every lateral face it could leak back in from (plus, only
   *   at the row's actual ceiling, one roof-cap check) gets a `sealPositions`
   *   entry for `UndergroundExecutionStrategy` to line with a solid block
   *   immediately after excavating that row. Water directly beneath the
   *   rail (the FLOOR, checked separately, earlier in this method) is
   *   unchanged — a floor made of open water is still rejected outright
   *   (`BLOCKED_BY_WATER`), since sealing doesn't fabricate a floor over
   *   nothing. See terrain/WaterDetector.js for the detection primitives
   *   and ARCHITECTURE.md's Project Prompt 18 entry for the full design.
   *
   * @param {import("../core/BuildVector.js").BuildVector} buildVector
   * @param {number} length Requested number of rail positions.
   * @param {import("@minecraft/server").Dimension} dimension
   * @param {number} depth Already validated 1-64 by ModeConfigValidator — this method consumes the value and never re-derives that bound.
   * @returns {import("./UndergroundPlan.js").UndergroundPlan}
   */
  planUnderground(buildVector, length, dimension, depth, { fillCaveGaps = false } = {}) {
    const originY = buildVector.origin.y;
    const railY = computeUndergroundRailY(originY, depth);

    // Geometric feasibility, checked before ANY block is read: reaching
    // depth D by rail costs exactly D positions of descending ramp, plus at
    // least one flat position to actually be an underground railway. See
    // terrain/UndergroundPlan.js's DESCENDING-RAMP ENTRY STRATEGY for why
    // this cannot be engineered around.
    if (length <= depth) {
      return {
        feasible: false,
        rejectionReason: UndergroundRejectionReason.LENGTH_TOO_SHORT_FOR_DEPTH,
        minimumRequiredLength: depth + 1,
      };
    }

    const slopeDir = rampSlopeDirection(buildVector.direction, DirectionUtils);
    const railSteps = [];
    let totalExcavationCount = 0;
    let alreadyClearCount = 0;
    let commonOresExcavated = 0;
    // WATERPROOF TUNNEL (Project Prompt 18) — see the corridor loop below.
    let totalSealCount = 0;
    let waterRowsSealed = 0;
    let caveFillCount = 0;

    for (let i = 0; i < length; i++) {
      const { x, z } = buildVector.horizontalAt(i);
      const isRamp = i < depth;
      const y = isRamp ? originY - i : railY;
      const clearance = isRamp ? UNDERGROUND_CONFIG.SLOPE_LEVEL_CLEARANCE : UNDERGROUND_CONFIG.RAIL_LEVEL_CLEARANCE;
      const railPosition = { x, y, z };

      // --- Floor: the rail needs something solid directly beneath it.
      // Never itself an excavation position (a ramp step's floor sits one
      // block below its own rail, in its own column, while the next step's
      // rail is one block FORWARD — different column, so the two can never
      // collide). An open cave/ravine here is rejected rather than
      // silently floored — see ARCHITECTURE.md §45.7.
      const floorPosition = { x, y: y - 1, z };
      const floorRead = readBlock(dimension, floorPosition);
      if (floorRead.status !== "OK") {
        return {
          feasible: false,
          rejectionReason: floorRead.status === "OUT_OF_BOUNDS" ? UndergroundRejectionReason.OUT_OF_BOUNDS : UndergroundRejectionReason.UNLOADED_CHUNK,
          rejectionPosition: floorPosition,
        };
      }
      const floorBlock = floorRead.block;

      // Lava/water beneath the rail is checked BEFORE the generic
      // solidity test below. Both would fail that test anyway (a liquid
      // isn't solid), but reporting them as "no solid floor / open cave"
      // would tell the player something actively misleading when the real
      // problem is a lava lake or an aquifer under the route. Caught by
      // this session's own test suite, which asserted the specific reason
      // and got UNSUPPORTED_FLOOR instead — see ARCHITECTURE.md §45.9.
      if (floorBlock.typeId === "minecraft:lava" || floorBlock.typeId === "minecraft:flowing_lava") {
        return { feasible: false, rejectionReason: UndergroundRejectionReason.BLOCKED_BY_LAVA, rejectionPosition: floorPosition };
      }
      if (floorBlock.isLiquid) {
        return { feasible: false, rejectionReason: UndergroundRejectionReason.BLOCKED_BY_WATER, rejectionPosition: floorPosition };
      }

      const floorIsSolid = !floorBlock.isAir && !REPLACEABLE_BLOCK_ID_SET.has(floorBlock.typeId);
      // v2.0.0 Step 4: an open cave under the rail can be bridged with a
      // short support column instead of rejecting the whole tunnel.
      let floorFillPositions = [];
      if (!floorIsSolid) {
        const fill = fillCaveGaps ? findCaveFillColumn(dimension, floorPosition) : null;
        if (!fill) {
          return {
            feasible: false,
            rejectionReason: UndergroundRejectionReason.UNSUPPORTED_FLOOR,
            rejectionPosition: floorPosition,
          };
        }
        floorFillPositions = fill;
        caveFillCount += fill.length;
      }

      // --- Corridor: the rail block plus its headroom, bottom-up.
      const excavationPositions = [];
      const waterPositionsThisRow = [];
      for (let h = 0; h < clearance; h++) {
        const checkPosition = { x, y: y + h, z };
        const read = readBlock(dimension, checkPosition);
        if (read.status !== "OK") {
          return {
            feasible: false,
            rejectionReason: read.status === "OUT_OF_BOUNDS" ? UndergroundRejectionReason.OUT_OF_BOUNDS : UndergroundRejectionReason.UNLOADED_CHUNK,
            rejectionPosition: checkPosition,
          };
        }
        const block = read.block;
        const typeId = block.typeId;

        if (UNBREAKABLE_BLOCK_ID_SET.has(typeId)) {
          return {
            feasible: false,
            rejectionReason: UndergroundRejectionReason.BLOCKED_BY_UNBREAKABLE,
            rejectionPosition: checkPosition,
            blockingBlockId: typeId,
          };
        }

        // Lava checked before the general hazard test purely so the player
        // gets the specific "lava" message rather than a generic hazard one
        // — lava is already a HAZARD_BLOCK_ID_SET member either way.
        if (typeId === "minecraft:lava" || typeId === "minecraft:flowing_lava") {
          return { feasible: false, rejectionReason: UndergroundRejectionReason.BLOCKED_BY_LAVA, rejectionPosition: checkPosition };
        }
        // WATERPROOF TUNNEL (Project Prompt 18): water inside the corridor
        // itself (as opposed to the FLOOR — see the separate, unchanged
        // floor check above, which still rejects outright: a floor made of
        // open water is "no floor," not something sealing fixes) no longer
        // rejects the whole plan. It's excavated exactly like any other
        // clearable block below, and its position is recorded here so the
        // seal pass right after this loop can wall off exactly the LATERAL
        // faces this water could keep leaking in from — never a full ring,
        // never the direction of travel itself. This is deliberately NOT
        // "remove one water block and let the tunnel flood" — see
        // terrain/WaterDetector.js's `findLateralSealPositions()` and
        // ARCHITECTURE.md's Project Prompt 18 entry for the full design.
        if (block.isLiquid) {
          waterPositionsThisRow.push(checkPosition);
        } else if (HAZARD_BLOCK_ID_SET.has(typeId)) {
          return { feasible: false, rejectionReason: UndergroundRejectionReason.BLOCKED_BY_HAZARD, rejectionPosition: checkPosition };
        }

        // --- Ore policy (config/UndergroundConfig.js's ORE_POLICY; see
        // config/OreRegistry.js for why the default is the middle tier).
        if (isOre(typeId)) {
          const policy = UNDERGROUND_CONFIG.ORE_POLICY;
          const blocksThisOre =
            policy === "PROTECT_ALL" ||
            (policy === "PROTECT_VALUABLE" && VALUABLE_ORE_ID_SET.has(typeId));
          if (blocksThisOre) {
            return {
              feasible: false,
              rejectionReason: UndergroundRejectionReason.PROTECTED_ORE,
              rejectionPosition: checkPosition,
              blockingBlockId: typeId,
            };
          }
          if (COMMON_ORE_ID_SET.has(typeId) || VALUABLE_ORE_ID_SET.has(typeId)) {
            commonOresExcavated += 1;
          }
        }

        // An existing rail here (an earlier crossing underground railway,
        // this addon's own or hand-placed) is left untouched entirely,
        // like an already-clear position — never added to
        // excavationPositions, so TunnelExcavator is never asked to break
        // it. Bugfix pass before Project Prompt 18 — see
        // config/RailConfig.js's RAIL_ITEM_ID_SET doc.
        if (RAIL_ITEM_ID_SET.has(typeId)) {
          alreadyClearCount += 1;
          continue;
        }

        if (block.isAir) {
          alreadyClearCount += 1;
        }
        excavationPositions.push(checkPosition);
        totalExcavationCount += 1;
      }

      // WATERPROOF TUNNEL, continued: only rows that actually intersected
      // water do any of this extra work — an ordinary dry row costs nothing
      // beyond the ore/hazard checks it already had. See PERFORMANCE in
      // ARCHITECTURE.md's Project Prompt 18 entry for why this matters.
      let sealPositions = [];
      if (waterPositionsThisRow.length > 0) {
        const sealPositionsByKey = new Map();
        for (const waterPosition of waterPositionsThisRow) {
          for (const lateral of findLateralSealPositions(dimension, waterPosition, buildVector.direction)) {
            sealPositionsByKey.set(`${lateral.x},${lateral.y},${lateral.z}`, lateral);
          }
        }
        // Roof cap: only relevant when water was found at this row's actual
        // ceiling (the topmost clearance level) — any lower water position's
        // "above" is just the next corridor block up, still interior, never
        // a leak point. Bounded to at most 1 extra read per row.
        const ceilingY = y + clearance - 1;
        const ceilingWaterPosition = waterPositionsThisRow.find((position) => position.y === ceilingY);
        if (ceilingWaterPosition && hasLiquidAbove(dimension, ceilingWaterPosition, 1)) {
          const roofPosition = { x: ceilingWaterPosition.x, y: ceilingWaterPosition.y + 1, z: ceilingWaterPosition.z };
          sealPositionsByKey.set(`${roofPosition.x},${roofPosition.y},${roofPosition.z}`, roofPosition);
        }
        sealPositions = Array.from(sealPositionsByKey.values());
        totalSealCount += sealPositions.length;
        waterRowsSealed += 1;
      }

      railSteps.push({
        position: railPosition,
        slopeDirection: isRamp ? slopeDir : null,
        excavationPositions,
        sealPositions,
        floorFillPositions,
      });
    }

    // TERMINAL LANDING BUFFER — bugfix pass before Project Prompt 18.
    // Reported as "the tunnel sometimes ends with only a one-block space...
    // making the player unable to travel through it": before this fix,
    // excavation stopped dead at the last requested rail position, so a
    // player riding to the end arrived at a flush wall of solid,
    // unexcavated terrain with nowhere to stand or turn around — exactly
    // "one block of space" (the last rail tile itself) and then an
    // obstruction. Excavates ONE extra full-clearance position immediately
    // past the last rail — same width/height as an ordinary flat position,
    // no rail placed in it — so there is always a proper landing pocket at
    // the terminus. Best-effort and never affects `feasible`: if this one
    // extra position can't be safely excavated (unloaded, unbreakable,
    // hazardous), it is simply omitted rather than failing an otherwise
    // complete, valid plan over a bonus safety margin. See
    // ARCHITECTURE.md §46.3 for the full diagnosis and reasoning.
    const landingExcavationPositions = [];
    const landingIndex = length;
    const { x: landX, z: landZ } = buildVector.horizontalAt(landingIndex);
    let landingSafe = true;
    for (let h = 0; h < UNDERGROUND_CONFIG.RAIL_LEVEL_CLEARANCE; h++) {
      const landingPosition = { x: landX, y: railY + h, z: landZ };
      const read = readBlock(dimension, landingPosition);
      if (read.status !== "OK") {
        landingSafe = false;
        break;
      }
      const block = read.block;
      if (UNBREAKABLE_BLOCK_ID_SET.has(block.typeId) || HAZARD_BLOCK_ID_SET.has(block.typeId) || block.isLiquid) {
        landingSafe = false;
        break;
      }
      landingExcavationPositions.push(landingPosition);
    }
    if (!landingSafe) {
      landingExcavationPositions.length = 0;
    }

    return {
      feasible: true,
      startPosition: railSteps[0].position,
      endPosition: railSteps[railSteps.length - 1].position,
      direction: buildVector.direction,
      length,
      depth,
      railY,
      tunnelWidth: UNDERGROUND_CONFIG.WIDTH,
      tunnelHeight: UNDERGROUND_CONFIG.RAIL_LEVEL_CLEARANCE,
      railSteps,
      landingExcavationPositions,
      requiredRailCount: railSteps.length,
      totalExcavationCount: totalExcavationCount + landingExcavationPositions.length,
      totalSealCount,
      terrainSummary: {
        surfaceReferenceY: originY,
        rampPositionCount: depth,
        flatPositionCount: length - depth,
        alreadyClearCount,
        commonOresExcavated,
        waterRowsSealed,
        caveFillCount,
      },
    };
  }

  /**
   * Resolves position i (i > 0) relative to `expectedY`, the previous
   * position's resolved Y. Tries flat first; if the ground isn't solid,
   * tries descending by 1; if the rail's own spot is blocked, tries
   * ascending by 1. If none of those resolve it, returns `null` rather
   * than giving up — `null` means "try a level tunnel at the current
   * height instead," which scanPath()'s loop hands to TunnelPlanner
   * (Roadmap Phase 12) before finally giving up. This covers two distinct
   * cases as of Roadmap Phase 14 (Project Prompt 14): a rise too tall for
   * a simple ascend, AND an immediate reversal right after the opposite
   * slope (a 1-block peak or valley — previously always rejected outright,
   * see §36.1/§39.1 for why a tunnel attempt is the correct fix rather
   * than a new kind of rejection). A genuinely bigger DROP (not a
   * reversal) still becomes UNSUPPORTED directly here, tagged "DEEP_DROP"
   * — tunnels are only attempted for the rail's own spot being blocked
   * (a rise, or a reversal), never for open air below, see TunnelDetector.js's
   * header for why. See ARCHITECTURE.md §36 (slopes), §37 (tunnels), and
   * §39 (reversal-as-tunnel) for the full derivation.
   *
   * @param {import("@minecraft/server").Dimension} dimension
   * @param {number} x
   * @param {number} z
   * @param {number} expectedY
   * @param {TerrainClassification|null} previousClassification
   * @returns {TerrainPositionFact|null} Null means "try a tunnel at expectedY" — see scanPath().
   * @private
   */
  _resolveSteppedPosition(dimension, x, z, expectedY, previousClassification) {
    const flatFact = this._scanPosition(dimension, { x, y: expectedY, z });

    if (
      flatFact.classification === TerrainClassification.FLAT_SAFE ||
      flatFact.classification === TerrainClassification.HAZARD ||
      flatFact.classification === TerrainClassification.LIQUID ||
      flatFact.classification === TerrainClassification.UNLOADED ||
      flatFact.classification === TerrainClassification.OUT_OF_BOUNDS ||
      flatFact.unsupportedReason === "WATER_TOO_DEEP"
    ) {
      // Hazard/unloaded/out-of-bounds never attempt a slope fallback —
      // there's nothing a different Y would fix about any of those. LIQUID
      // is kept in this list defensively (Project Prompt 18: `_scanPosition`
      // no longer produces it — a liquid ground already falls through to
      // UNSUPPORTED above, letting THIS method's own descend/ascend/tunnel
      // logic run over it normally, which is the whole point) rather than
      // removed, matching TerrainClassification.js's own "reserved, not
      // deleted" note for the same enum value. WATER_TOO_DEEP (Project
      // Prompt 18) is added as its own terminal case for the same reason:
      // without it, this position's own UNSUPPORTED verdict would instead
      // fall into the ascend/tunnel fallback below, which can only ever
      // produce a confusing "tunnel too long"/generic message for what's
      // actually a clean, specific "use Bridge or Underground Mode"
      // situation — found and fixed via this session's own test harness
      // (tests/water.test.mjs) before it could ship, exactly the kind of
      // bug the "state can change mid-build" re-check discipline elsewhere
      // in this project is built to catch early. See ARCHITECTURE.md's
      // Project Prompt 18 entry.
      return flatFact;
    }

    // Only two possibilities remain at this point: the old GAP case (ground
    // not solid — try descending) or the old OBSTRUCTED case (rail's own
    // spot blocked — try ascending). scanPosition() itself no longer
    // returns those two classifications (see §36.1) — this function is what
    // turns "not flat" into a specific attempt.
    const groundNotSolid = !flatFact.isGroundSolid;

    if (groundNotSolid) {
      if (previousClassification === TerrainClassification.ASCENDING) {
        // Immediate reversal right after climbing — a 1-block peak (or the
        // near edge of a narrow ridge/spike). A single sloped rail block
        // can't represent this (see §36.1/§39.1) — but rather than reject
        // outright, treat it exactly like a too-tall rise: signal `null`
        // so scanPath() attempts a level tunnel through the ridge at the
        // CURRENT (already-climbed) height, instead of trying to slope
        // back down immediately. For a true single-block spike this is a
        // very cheap tunnel (often length 1 — just the tip). Only if that
        // tunnel also fails does this genuinely become UNSUPPORTED, now
        // with whatever specific reason the tunnel attempt found. Added
        // Roadmap Phase 14 (Project Prompt 14) — see ARCHITECTURE.md §39.
        return null;
      }
      const descendFact = this._scanPosition(dimension, { x, y: expectedY - 1, z });
      if (descendFact.classification === TerrainClassification.FLAT_SAFE) {
        return { ...descendFact, classification: TerrainClassification.DESCENDING };
      }
      if (
        descendFact.classification === TerrainClassification.HAZARD ||
        descendFact.classification === TerrainClassification.LIQUID
      ) {
        // More specific and useful to the player than a generic "too
        // steep" — the real problem is what's down there, not the slope.
        return descendFact;
      }
      if (previousClassification === TerrainClassification.DESCENDING) {
        // A SECOND consecutive drop-attempt failure right after already
        // having dropped once — this is the actual shape a 1-block valley
        // floor takes: THIS position's ground check fails (not its
        // rail-spot check), so the ascending-branch's reversal guard below
        // never sees it. Confirmed by direct testing, not assumed — an
        // earlier version of this fix only had the guard in the ascending
        // branch and left this exact case broken. Try a level tunnel at
        // the CURRENT (already-dropped) height before giving up, mirroring
        // the peak fix. See ARCHITECTURE.md §39.2 for the full trace.
        return null;
      }
      // A genuine drop of more than 1 block (not a hazard down there, just
      // too far to descend safely, and not a valley-floor reversal
      // either). Tagged distinctly from the peak/valley reversal case so
      // scanPath()'s gap-analysis enrichment pass (Roadmap Phase 13) can
      // find exactly this case and attach informational gap/bridge data —
      // see that method.
      return this._unsupportedFact({ x, y: expectedY, z }, "DEEP_DROP");
    }

    // Rail's own spot is blocked — try ascending.
    const ascendFact = this._scanPosition(dimension, { x, y: expectedY + 1, z });
    if (ascendFact.classification === TerrainClassification.FLAT_SAFE) {
      return { ...ascendFact, classification: TerrainClassification.ASCENDING };
    }
    if (
      ascendFact.classification === TerrainClassification.HAZARD ||
      ascendFact.classification === TerrainClassification.LIQUID
    ) {
      return ascendFact;
    }
    if (previousClassification === TerrainClassification.DESCENDING) {
      // A true 1-block valley (down then straight back up) is fully
      // resolved by the ordinary ascend attempt above — this guard is
      // only reached when THAT also fails, meaning the ascend-by-1 alone
      // isn't enough (e.g. the far wall is itself more than 1 block tall).
      // Only in that case does a level tunnel at the CURRENT
      // (already-dropped) height make sense to attempt before giving up.
      // Reordering this after the plain ascend attempt — rather than
      // before it, an earlier version's mistake — was found by directly
      // tracing a real 1-block valley and confirming the plain ascend
      // should have succeeded immediately but never got the chance. See
      // ARCHITECTURE.md §39.2 for the full trace.
      return null;
    }
    // A simple +1 ascend didn't resolve it — this is a rise of more than 1
    // block. Not a verdict yet: let scanPath() try a tunnel before this
    // becomes UNSUPPORTED.
    return null;
  }

  /**
   * Second pass: decides which physical rail blocks get a sloped shape.
   * Must run after every position's Y/classification is fully resolved,
   * since a DESCENDING position's sloped block is its PREVIOUS neighbor,
   * not itself — see ARCHITECTURE.md §36.2 for the full derivation ("the
   * sloped block belongs to the higher of the two positions it connects").
   * A position gets a slope if EITHER it is itself ASCENDING (climbing
   * toward the direction of travel), OR its immediate next neighbor is
   * DESCENDING (meaning this position is the higher end of the next
   * step down, sloped toward the reverse of the direction of travel).
   * These two conditions can never both match the same position with
   * different directions — that would require an immediate peak/valley
   * reversal, which _resolveSteppedPosition() already prevents from ever
   * resolving as a pair of opposite slopes (§36.1).
   *
   * BUG FIX (Pre-Prompt 18 bug-fix pass): TUNNEL positions no longer
   * unconditionally skip the "next is DESCENDING" check
   *   The previous version short-circuited every TUNNEL-classified
   *   position with `return fact` before this check ever ran, on the
   *   stated reasoning that a tunnel is a level bore and should never get
   *   a sloped shape. That's correct for every INTERIOR tunnel position
   *   (whose own next neighbor is always another TUNNEL position at the
   *   same Y, so the check below is already a no-op for them) — but it
   *   also silently applied to the LAST tunnel position, whose next
   *   neighbor is genuinely outside the tunnel and CAN legitimately be
   *   DESCENDING (terrain resuming a natural 1-block drop right where the
   *   tunnel ends). That specific case produced two consecutive rails one
   *   block apart in Y with no sloped connector between them — reported
   *   as "the tunnel sometimes ends with only a one-block space/
   *   obstruction at the end, making the player unable to travel through
   *   it," reproduced directly (a wall requiring a tunnel, immediately
   *   followed by a natural 1-block descent) before this fix and
   *   confirmed resolved after it. See ARCHITECTURE.md §46.5 for the full
   *   trace. The special case is removed entirely: a TUNNEL position now
   *   goes through the exact same "is my next neighbor DESCENDING" check
   *   every other non-ASCENDING position already used, which is correct
   *   for both interior positions (next is TUNNEL, never DESCENDING, so
   *   nothing changes for them) and the last one (next can genuinely be
   *   DESCENDING, and now correctly gets the connecting slope).
   *
   * @param {ReadonlyArray<TerrainPositionFact>} positions
   * @param {import("../utils/DirectionUtils.js").CardinalDirection} direction Direction of travel for the whole path.
   * @returns {ReadonlyArray<TerrainPositionFact>}
   * @private
   */
  _resolveRailShapes(positions, direction) {
    return positions.map((fact, i) => {
      if (fact.classification === TerrainClassification.ASCENDING) {
        return { ...fact, slopeDirection: direction };
      }
      const next = positions[i + 1];
      if (next && next.classification === TerrainClassification.DESCENDING) {
        return { ...fact, slopeDirection: DirectionUtils.opposite(direction) };
      }
      return fact; // slopeDirection already null from _scanPosition/_unsupportedFact/_unreadableFact/TunnelPlanner
    });
  }

  /**
   * @param {ReadonlyArray<TerrainPositionFact>} positions
   * @returns {TerrainScanResult}
   * @private
   */
  _summarize(positions) {
    let safeCount = 0;
    let unsafeCount = 0;
    let hazardCount = 0;
    let unsupportedCount = 0;
    let ascendingCount = 0;
    let descendingCount = 0;
    let tunnelCount = 0;
    let unloadedCount = 0;
    let underwaterCount = 0;

    for (const fact of positions) {
      if (BUILDABLE_CLASSIFICATIONS.includes(fact.classification)) {
        safeCount += 1;
        if (fact.classification === TerrainClassification.ASCENDING) ascendingCount += 1;
        if (fact.classification === TerrainClassification.DESCENDING) descendingCount += 1;
        if (fact.classification === TerrainClassification.TUNNEL) tunnelCount += 1;
        if (fact.isUnderwater) underwaterCount += 1;
        continue;
      }

      unsafeCount += 1;
      if (fact.classification === TerrainClassification.HAZARD || fact.classification === TerrainClassification.LIQUID) {
        hazardCount += 1;
      } else if (fact.classification === TerrainClassification.UNSUPPORTED) {
        unsupportedCount += 1;
      } else if (fact.classification === TerrainClassification.UNLOADED) {
        unloadedCount += 1;
      }
    }

    return {
      positions,
      totalScanned: positions.length,
      safeCount,
      unsafeCount,
      hazardCount,
      unsupportedCount,
      ascendingCount,
      descendingCount,
      tunnelCount,
      unloadedCount,
      underwaterCount,
      isFlat: ascendingCount === 0 && descendingCount === 0 && tunnelCount === 0 && unsupportedCount === 0,
      buildReady: safeCount === positions.length,
    };
  }

  /**
   * @param {import("@minecraft/server").Dimension} dimension
   * @param {{x: number, y: number, z: number}} railPosition
   * @param {{x: number, y: number, z: number}} [groundPosition] Defaults to one below railPosition.
   * @returns {TerrainPositionFact}
   * @private
   */
  _scanPosition(dimension, railPosition, groundPosition = { x: railPosition.x, y: railPosition.y - 1, z: railPosition.z }) {
    const above = readBlock(dimension, railPosition);
    const ground = readBlock(dimension, groundPosition);

    // OUT_OF_BOUNDS takes precedence over UNLOADED when both positions
    // disagree (shouldn't normally happen for two vertically-adjacent
    // positions, but each read is independent, so handle it explicitly).
    if (above.status === "OUT_OF_BOUNDS" || ground.status === "OUT_OF_BOUNDS") {
      return this._unreadableFact(railPosition, TerrainClassification.OUT_OF_BOUNDS);
    }
    if (above.status === "UNLOADED" || ground.status === "UNLOADED") {
      return this._unreadableFact(railPosition, TerrainClassification.UNLOADED);
    }

    const aboveBlock = above.block;
    const groundBlock = ground.block;
    const groundBlockId = groundBlock.typeId;
    const aboveBlockId = aboveBlock.typeId;
    // isGroundSolid deliberately does NOT use `Block.isSolid`. Bedrock's own
    // documentation marks `isSolid` as pre-release/experimental (unlike
    // `isAir` and `isLiquid`, which are stable) — in practice this means it
    // does not reliably report `true` for ordinary terrain (confirmed via
    // Content Log against a fresh Flat world: every position on plain grass
    // came back non-solid) unless the world has an experimental toggle most
    // players will never enable. A published addon can't depend on that.
    // "Solid enough to build on" is instead defined using only stable
    // properties: not air, not liquid. See ARCHITECTURE.md §34 for the full
    // root-cause writeup (Project Prompt 11, follow-up fix).
    const isGroundSolid = !groundBlock.isAir && !groundBlock.isLiquid;
    // `|| RAIL_ITEM_ID_SET.has(aboveBlockId)` added in the bugfix pass
    // before Project Prompt 18: an existing rail (this addon's own, from
    // an earlier build, or hand-placed) is treated as already-clear for
    // pathing, the same as a replaceable decoration — the new path simply
    // crosses over it rather than the whole build being rejected here.
    // Placement-time protection against overwriting it lives in each
    // execution strategy — see config/RailConfig.js's RAIL_ITEM_ID_SET doc
    // for the full bugfix write-up and ARCHITECTURE.md §46.5.
    const isAboveReplaceable = aboveBlock.isAir || REPLACEABLE_BLOCK_ID_SET.has(aboveBlockId) || RAIL_ITEM_ID_SET.has(aboveBlockId);
    // Added Project Prompt 19 (SMART TERRAIN ANALYSIS): an explicit,
    // named field for "is the rail's own spot already an existing rail" —
    // this was already computed inline as part of `isAboveReplaceable`
    // above (bugfix pass before Project Prompt 18), but never exposed on
    // the fact itself. Purely informational/introspective — no decision in
    // this file changes based on it; see config/RailConfig.js's
    // RAIL_ITEM_ID_SET doc for where the actual accept/preserve behavior
    // lives.
    const isExistingRail = RAIL_ITEM_ID_SET.has(aboveBlockId);

    let hazardBlockId;
    if (HAZARD_BLOCK_ID_SET.has(groundBlockId)) hazardBlockId = groundBlockId;
    else if (HAZARD_BLOCK_ID_SET.has(aboveBlockId)) hazardBlockId = aboveBlockId;

    /** @type {TerrainClassification} */
    let classification;
    let unsupportedReason;
    let isUnderwater = false;
    let waterInfo;

    if (hazardBlockId) {
      classification = TerrainClassification.HAZARD;
    } else if (!isGroundSolid) {
      // Roadmap Phase 11: no longer terminal here — this is the raw "not
      // flat at this exact Y" signal. _resolveSteppedPosition() is what
      // decides whether that becomes DESCENDING or UNSUPPORTED; position 0
      // (which never calls _resolveSteppedPosition) has no previous
      // position to descend relative to, so a bare GAP there is reported
      // as UNSUPPORTED directly — a build can't start over a drop.
      //
      // WATER DETECTION (Project Prompt 18): this branch also covers the
      // ground block itself being a liquid (isGroundSolid is `!isAir &&
      // !isLiquid`, so a liquid ground already fails this check) — a body
      // of water with no floor at this exact Y is treated identically to an
      // ordinary open gap, reusing the SAME descend/ascend/tunnel/gap-
      // analysis machinery rather than a second, duplicated water-gap code
      // path. GapAnalyzer already tags a deep-enough one WATER_CROSSING
      // (see terrain/GapAnalyzer.js — unchanged this session), which
      // PathValidator now turns into a specific "use Bridge or Underground"
      // message — see PathValidator.js.
      classification = TerrainClassification.UNSUPPORTED;
    } else if (UNBREAKABLE_BLOCK_ID_SET.has(aboveBlockId)) {
      // Added Project Prompt 19 (SMART TERRAIN ANALYSIS / EXISTING BLOCKS):
      // previously an unbreakable block sitting directly at the rail's own
      // spot (bedrock, barrier, etc., with otherwise solid ground beneath —
      // a floating obstruction, not a gap) fell through to the generic
      // `!isAboveReplaceable` branch below and reported the same "too
      // steep" message every other flat obstruction gets. Distinguished
      // here the same way TunnelDetector already distinguishes it for a
      // failed tunnel attempt (`unsupportedReason: "UNBREAKABLE"` — the
      // exact same string, already wired through PathValidator's
      // UNSUPPORTED_REASON_TO_REASON to a specific message) — a player
      // told "too steep" about a single bedrock block has no idea what to
      // actually do about it; "unbreakable terrain" does.
      classification = TerrainClassification.UNSUPPORTED;
      unsupportedReason = "UNBREAKABLE";
    } else if (aboveBlock.isLiquid) {
      // WATER DETECTION (Project Prompt 18): the rail's own spot is a
      // liquid block, but the ground directly beneath it IS solid (already
      // confirmed — the branch above would have caught a liquid ground) —
      // a shallow puddle/stream/ford sitting on a real streambed, not an
      // open body with no floor. Safely buildable: placing the rail block
      // displaces this single water block exactly like placing over any
      // other replaceable decoration (see StraightRailStrategy.js — it has
      // no separate "is this clear" gate at all, just an unconditional
      // setPermutation() once the position is confirmed FLAT_SAFE). Rejected
      // only if a SECOND layer of water sits directly above this one
      // (hasLiquidAbove) — that would submerge the rail too deep for Normal
      // Mode to safely carry a player through, and the player is told to
      // use Bridge or Underground Mode instead (see PathValidator.js's
      // WATER_TOO_DEEP handling).
      if (hasLiquidAbove(dimension, railPosition, 1)) {
        classification = TerrainClassification.UNSUPPORTED;
        unsupportedReason = "WATER_TOO_DEEP";
      } else {
        classification = TerrainClassification.FLAT_SAFE;
        isUnderwater = true;
        waterInfo = { isSourceBlock: isSourceBlock(aboveBlock) };
      }
    } else if (!isAboveReplaceable) {
      // Same reasoning, mirrored: raw "blocked at this exact Y" signal.
      classification = TerrainClassification.UNSUPPORTED;
    } else {
      classification = TerrainClassification.FLAT_SAFE;
    }

    // AVAILABLE CLEARANCE (Project Prompt 19, SMART TERRAIN ANALYSIS): one
    // extra block read, ONLY when every check above already accepted this
    // position (dry flat OR safe shallow water) — an already-rejected
    // position never pays this cost, keeping this in line with the
    // project's standing "don't scan what you don't need" performance
    // discipline (see PERFORMANCE in ARCHITECTURE.md's Project Prompt 19
    // entry). Normal Mode previously only ever checked the rail's own
    // block, never the block directly above THAT — meaning a rail could be
    // planned directly beneath a 1-block-low ceiling (an overhang, the
    // underside of a floating structure) that a player riding through
    // would visibly clip into. `_checkHeadroom()` closes that gap the same
    // way Bridge/Underground Mode already reserve real headroom above
    // their own rail level.
    if (classification === TerrainClassification.FLAT_SAFE) {
      const headroom = this._checkHeadroom(dimension, railPosition);
      if (!headroom.clear) {
        if (headroom.reason === "HAZARD") {
          classification = TerrainClassification.HAZARD;
          hazardBlockId = headroom.blockingBlockId;
        } else {
          classification = TerrainClassification.UNSUPPORTED;
          unsupportedReason = headroom.reason ?? "LOW_CLEARANCE";
        }
        isUnderwater = false;
        waterInfo = undefined;
      }
    }

    return {
      position: railPosition,
      groundBlockId,
      aboveBlockId,
      isGroundSolid,
      isAboveReplaceable,
      isExistingRail,
      isLoaded: true,
      isInBounds: true,
      classification,
      hazardBlockId,
      slopeDirection: null,
      unsupportedReason,
      futureMetadata: undefined,
      isUnderwater,
      waterInfo,
    };
  }

  /**
   * AVAILABLE CLEARANCE (Project Prompt 19): reads exactly one block —
   * directly above the rail's own spot — and reports whether it's clear
   * enough for a player riding through to not visibly clip into it.
   * Deliberately narrow (one read, no recursion, no search) — this is not
   * a second tunnel/clearance system, just the one additional block Normal
   * Mode was previously never checking. Mirrors the same
   * hazard-then-unbreakable-then-generic ordering `_scanPosition()` itself
   * uses, so a dangerous or unbreakable ceiling gets its own specific
   * reason rather than a generic "not enough room" one.
   *
   * @param {import("@minecraft/server").Dimension} dimension
   * @param {{x: number, y: number, z: number}} railPosition
   * @returns {{clear: boolean, reason?: "HAZARD"|"UNBREAKABLE"|"LOW_CLEARANCE", blockingBlockId?: string}}
   * @private
   */
  _checkHeadroom(dimension, railPosition) {
    const headroomPosition = { x: railPosition.x, y: railPosition.y + 1, z: railPosition.z };
    const read = readBlock(dimension, headroomPosition);
    if (read.status !== "OK") {
      // Fails safe: an unreadable headroom position is treated as blocked
      // rather than assuming clearance exists — the same "don't guess
      // permissive" principle terrain/WaterDetector.js's hasLiquidAbove()
      // already established (Project Prompt 18).
      return { clear: false, reason: "LOW_CLEARANCE" };
    }
    const block = read.block;
    if (HAZARD_BLOCK_ID_SET.has(block.typeId)) {
      return { clear: false, reason: "HAZARD", blockingBlockId: block.typeId };
    }
    if (UNBREAKABLE_BLOCK_ID_SET.has(block.typeId)) {
      return { clear: false, reason: "UNBREAKABLE" };
    }
    // Liquid is treated as clear here, consistent with Bridge Mode's own
    // headroom tolerance (Project Prompt 18) — a rider's head briefly
    // brushing a water block one above an otherwise dry, safe rail is not
    // meaningfully different from Bridge Mode's already-accepted case.
    const clear = block.isAir || block.isLiquid || REPLACEABLE_BLOCK_ID_SET.has(block.typeId) || RAIL_ITEM_ID_SET.has(block.typeId);
    return clear ? { clear: true } : { clear: false, reason: "LOW_CLEARANCE" };
  }

  /**
   * @param {{x: number, y: number, z: number}} position
   * @param {string} [unsupportedReason] One of TunnelDetector's failure
   *   reasons ("UNBREAKABLE", "HAZARD", "TOO_LONG", "UNLOADED",
   *   "OUT_OF_BOUNDS", "FLOOR_GAP"), when this UNSUPPORTED resulted from a
   *   failed tunnel attempt — lets PathValidator give a more specific
   *   message than the generic "too steep" one. Undefined for every other
   *   UNSUPPORTED case (a bigger drop, a peak/valley reversal) — those
   *   keep the generic message, unchanged from Roadmap Phase 11.
   * @returns {TerrainPositionFact}
   * @private
   */
  _unsupportedFact(position, unsupportedReason = undefined) {
    return {
      position,
      groundBlockId: undefined,
      aboveBlockId: undefined,
      isGroundSolid: false,
      isAboveReplaceable: false,
      isExistingRail: false,
      isLoaded: true,
      isInBounds: true,
      classification: TerrainClassification.UNSUPPORTED,
      hazardBlockId: undefined,
      slopeDirection: null,
      unsupportedReason,
      futureMetadata: undefined,
      isUnderwater: false,
      waterInfo: undefined,
    };
  }

  /**
   * @param {{x: number, y: number, z: number}} position
   * @param {TerrainClassification} classification UNLOADED or OUT_OF_BOUNDS.
   * @returns {TerrainPositionFact}
   * @private
   */
  _unreadableFact(position, classification) {
    return {
      position,
      groundBlockId: undefined,
      aboveBlockId: undefined,
      isGroundSolid: false,
      isAboveReplaceable: false,
      isExistingRail: false,
      isLoaded: classification !== TerrainClassification.UNLOADED,
      isInBounds: classification !== TerrainClassification.OUT_OF_BOUNDS,
      classification,
      hazardBlockId: undefined,
      slopeDirection: null,
      unsupportedReason: undefined,
      futureMetadata: undefined,
      isUnderwater: false,
      waterInfo: undefined,
    };
  }
}
