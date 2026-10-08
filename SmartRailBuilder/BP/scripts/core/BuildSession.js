/**
 * BuildSession.js
 *
 * PURPOSE
 *   Mutable state for a single in-progress build, constructed FROM a
 *   BuildRequest (see core/BuildRequest.js) exactly as planned since
 *   Project Prompt 6's header first described the relationship — this
 *   session (Project Prompt 10) is where that finally happens for real,
 *   in PlacementStage. BuildRequest is "what was asked for" (immutable
 *   snapshot); BuildSession is "what is currently happening" (live,
 *   mutable, read and written by RailBuilder's generator and by
 *   CancellationWatcher's event listeners).
 *
 * RESPONSIBILITIES
 *   - Hold the immutable inputs of a build (player, dimension, rail type,
 *     direction, target length) alongside its mutable progress (blocks
 *     placed so far, cancellation flag + reason).
 *   - Provide small, intention-revealing mutators instead of letting callers
 *     poke at raw fields — see ARCHITECTURE.md §6.
 *
 * BUG FIX (Project Prompt 14, second round): targetLength is passed in
 * explicitly, not read from buildRequest.requestedLength
 *   A tunnel encountered during scanning can now extend a build past what
 *   was originally requested (up to the hard `LENGTH_PRESETS.MAX_SURVIVAL`
 *   ceiling — see terrain/TerrainScanner.js's `scanPath()`). The
 *   constructor previously read `buildRequest.requestedLength` directly —
 *   the ORIGINAL, possibly-stale request value. Since `targetLength` is
 *   used by both `isActive()` (governs whether the session's build loop
 *   should keep going) and `StraightRailStrategy._result()`'s `completed`
 *   check (`blocksPlaced === targetLength`), a stale too-small value would
 *   have made a fully successful, tunnel-extended build stop early and/or
 *   incorrectly report itself as incomplete — found while designing the
 *   tunnel-budget fix, before it could ship. `PlacementStage` now passes
 *   `path.length` (the actual, already-resolved position count) in
 *   directly, instead of this class silently trusting the request.
 *
 * BRIDGE MATERIAL (bugfix pass before Project Prompt 18)
 *   `bridgeMaterialId` is carried alongside `railTypeId`/`direction` —
 *   the player's own chosen bridge material (see
 *   ui/BuildMenu.js's `promptForBridgeMaterial()`), read by
 *   BridgeExecutionStrategy exactly the way `railTypeId` already is.
 *   `undefined` for NORMAL/UNDERGROUND builds, where it's simply unused —
 *   same "this field only means something for one mode" pattern already
 *   established for `BuildRequest.bridgeHeight`/`undergroundDepth`.
 *
 * FUTURE EXTENSIONS
 *   - Roadmap Phase 10 (Singleplayer + LAN Safety Pass): a session registry
 *     keyed by player ID will use this class for its build lock — today,
 *     BuildOrchestrator's own `_activePlayerIds` Set already serves that
 *     purpose at the whole-pipeline level, so this remains a placeholder
 *     for a more granular, mid-build lock if one is ever needed.
 *
 * DEPENDENCIES
 *   None beyond the BuildRequest passed into the constructor. Deliberately
 *   holds no reference to game API objects beyond the opaque `player`/
 *   `dimension` it's given, so it stays easy to reason about and to unit test.
 */

import { BuildJournal } from "./BuildJournal.js";

export class BuildSession {
  /**
   * @param {import("./BuildRequest.js").BuildRequest} buildRequest
   * @param {number} targetLength The ACTUAL number of positions to build —
   *   see BUG FIX above. Callers must pass the real, final scanned length
   *   (e.g. `context.terrainReport.positions.length`), not
   *   `buildRequest.requestedLength` directly.
   */
  constructor(buildRequest, targetLength) {
    /** @readonly */
    this.player = buildRequest.player;
    /** @readonly */
    this.dimension = buildRequest.dimension;
    /** @readonly */
    this.railTypeId = buildRequest.railTypeId;
    /** @readonly */
    this.direction = buildRequest.buildVector.direction;
    /** @readonly See BRIDGE MATERIAL above. Undefined for NORMAL/UNDERGROUND builds. */
    this.bridgeMaterialId = buildRequest.bridgeMaterialId;
    /** @readonly */
    this.targetLength = targetLength;
    /** @readonly */
    this.sessionId = buildRequest.sessionId;
    /** @readonly */
    this.startedAt = Date.now();

    /** v2.0.0 — every block this build changes, for undo. See core/BuildJournal.js. */
    this.journal = new BuildJournal(this.dimension);

    this.blocksPlaced = 0;
    this.cancelled = false;
    /** @type {string|undefined} */
    this.cancelReason = undefined;
  }

  /** Call once per block confirmed placed. */
  incrementBlocksPlaced() {
    this.blocksPlaced += 1;
  }

  /**
   * Marks this session as cancelled. Idempotent — the first reason wins.
   * @param {string} reason e.g. "playerLeave", "playerDimensionChange", "playerDeath", "playerGameModeChange"
   */
  markCancelled(reason) {
    if (this.cancelled) return;
    this.cancelled = true;
    this.cancelReason = reason;
  }

  /** @returns {boolean} */
  isCancelled() {
    return this.cancelled;
  }

  /** @returns {boolean} True while blocksPlaced is below targetLength and not cancelled. */
  isActive() {
    return !this.cancelled && this.blocksPlaced < this.targetLength;
  }
}
