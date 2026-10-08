# Changelog — Smart Rail Builder (formerly Ryzen Rail Builder — renamed Project Prompt 10)

## [Unreleased]

### Phase 1 — Foundation, Architecture & Planning — 2026-07-18
- Defined project architecture: module responsibilities, data flow, folder structure.
- Defined full milestone roadmap (Phases 1–10 detailed; 11+ reserved for future features).
- Grounded design in current Bedrock Script API (`@minecraft/server` 2.x stable,
  `@minecraft/server-ui` 2.1.0, `system.runJob` generator pattern).
- Identified risks, assumptions, and open design questions requiring your decision.
- No code, manifests, or JSON produced — planning only, per project rules.

### Project Prompt 2 — Finalize Architecture Decisions — 2026-07-18
- All 7 open questions from Prompt 1 answered and locked in as final decisions (ARCHITECTURE.md §2): 256-block default length with a designed-for preset system, flat/straight-only v1, facing-direction start, keep-placed/no-refund interruption policy, immediate stop + "Bridge required" message on gaps, Creative still requires holding the rail item, v1 scope is Singleplayer + LAN.
- Added permanent requirements: hazard-block safety stops, chunk/world-border safety, throttled progress feedback, full cancellation handling (leave/dimension-change/death/game mode change), a structured logging event vocabulary, and a strategy-swap replaceability guarantee.
- Architecture review found two real Phase 1 gaps and fixed them pre-code (no breaking change, since nothing was built yet):
  - `BuildRequest` (immutable) replaced by `BuildSession` (mutable) to support live cancellation tracking across a multi-tick build.
  - Hazard/chunk/border checks folded into a single-pass `TerrainScanner` + `TerrainReport`, avoiding redundant block reads across multiple scanner modules.
- Re-verified current Bedrock Script API surface for the new requirements: confirmed `playerGameModeChange`, `playerDimensionChange`, `playerLeave`, and `entityDie` (filtered to players) all exist on stable; confirmed there is no queryable `WorldBorder` API and designed around `LocationOutOfWorldBoundariesError` / `UnloadedChunksError` instead.
- Updated ROADMAP.md phases 5, 7, 8, 9, and 10 to reflect the finalized decisions; clarified that "Project Prompt N" and "Roadmap Phase N" are separate counters.

### Project Prompt 3 — Project Skeleton & Foundation — 2026-07-18
- Created the full BP/RP project skeleton: manifests, all 19 script module files,
  localization scaffold (`languages.json`, `en_US.lang` with pack listing strings), and a
  new `docs/UUID_REGISTRY.md`.
- Fully implemented all genuinely feature-free infrastructure: `Constants.js`,
  `RailConfig.js`, `HazardRegistry.js` (config/data), `Logger.js` (leveled, config-gated
  logging), `Vector3Utils.js` and `DirectionUtils.js` (pure math), `LocalizationKeys.js`
  (key registry), and `BuildSession.js` (mutable per-build state container).
- Added `builder/strategies/RailBuildStrategy.js` — a documented duck-typing contract
  making the "future replaceability" requirement concrete for JavaScript.
- Added `utils/NotImplemented.js` — a shared helper so every domain stub (BuildOrchestrator,
  CancellationWatcher, TerrainScanner, PathValidator, InventoryManager, RailBuilder,
  StraightRailStrategy, BuildMenu, ProgressReporter, MessageService) throws one consistent,
  informative error naming its owning Roadmap Phase, instead of each hand-rolling its own
  placeholder.
- `main.js` constructs the full dependency graph and logs a single startup message; no
  event subscriptions wired yet, per this phase's scope.
- Validated the entire skeleton outside Minecraft: the full import graph loads and runs
  cleanly under Node's ESM loader (zero runtime dependency on `@minecraft/server` — all
  engine types are JSDoc-only), a stub method was spot-checked to throw as designed, and
  all three JSON files were parsed successfully. Full detail in ARCHITECTURE.md §14.
- No manifests were guessed at: `format_version: 2` and the module/dependency shape were
  re-confirmed against current Microsoft documentation this session.

### Project Prompt 4 — Player Detection, Rail Detection & Smart Build Menu — 2026-07-18
- **First gameplay milestone.** Implemented real detection of all 4 vanilla rail items and
  a working ModalFormData length-selection menu. No terrain scanning or block placement.
- Selected and documented `world.beforeEvents.playerInteractWithBlock` as the event
  source, specifically because the older `ItemUseOnBeforeEvent`'s block-targeting
  properties are deprecated and scheduled for removal in 2.0.0+ (this project targets
  2.8.0). Full justification in ARCHITECTURE.md §15.1.
- Implemented two independent defenses against duplicate/double menus:
  `event.isFirstEvent` (ignores repeats from a held button) and a per-player active-request
  guard in `BuildOrchestrator` (stops overlapping first-presses; never blocks a different
  player). Both are unit-tested against mocks — see below.
- Added `core/BuildRequest.js` (new) and reconciled it with Project Prompt 2's
  `BuildSession` — they're complementary now (immutable snapshot vs. mutable live
  tracker), not conflicting designs. `BuildSession.js`'s header was corrected to describe
  this accurately. Full explanation: ARCHITECTURE.md §15.4.
- Added `core/BuildRequestValidator.js`, re-checking player existence, held item, length
  bounds, and a permanent (always-true today) permission hook, at submission time rather
  than menu-open time, since the menu round trip is async.
- Implemented `BuildMenu.promptForLength` for real: ModalFormData with a slider (not a
  text field — justified in ARCHITECTURE.md §15.3, since integer-only text input doesn't
  exist in the current API) and a relabeled "Build" submit button.
- Implemented `MessageService.sendChat` for real; `sendActionBar` remains a Phase 9 stub.
- **⚠️ Flagged, not silent:** `RailConfig.LENGTH_PRESETS.DEFAULT` changed from 256
  (Project Prompt 2's final decision) to 32 (Project Prompt 4's explicit menu spec). See
  ARCHITECTURE.md §15.6 — confirm or revert.
- Added real English text for the Phase 3 message keys to `RP/texts/en_US.lang`.
- Validated with 24 mocked logic tests across `BuildRequestValidator`, `BuildOrchestrator`
  (including the double-trigger guard and multiplayer isolation), cancellation/error
  paths, and `main.js`'s event filter — all 24 passed. Full breakdown: ARCHITECTURE.md §16.
- Added a full manual testing checklist to ROADMAP.md's Phase 3 entry covering
  Singleplayer, LAN multiplayer, both game modes, all 4 rail types, cancellation, invalid
  values, repeated/rapid use, and edge cases.

### Project Prompt 5 — Build Pipeline, Validation System & Foundation — 2026-07-18
- **Architectural refactor, no player-visible behavior change.** Restructured
  `BuildOrchestrator`'s inline menu → request → validate logic into a named, ordered
  `BuildPipeline` of 7 stages: `RailDetectionStage`, `BuildRequestCreationStage`,
  `ValidationStage`, `TerrainScanningStage`, `InventoryStage`, `PlacementStage`,
  `CompletionStage`. The last three are real, permanent, constructor-injected stages that
  currently report a new `FUTURE_EXPANSION` result status instead of calling into
  still-stubbed managers — this is *why* no rail can be placed this session by
  construction, not just by convention. Full rationale and alternatives considered:
  ARCHITECTURE.md §17.1.
- Added `core/pipeline/`: `PipelineStage.js` (documented contract), `PipelineContext.js`,
  `PipelineResult.js` (new `PipelineResultStatus` enum: SUCCESS, CANCELLED,
  VALIDATION_FAILED, UNEXPECTED_ERROR, FUTURE_EXPANSION), `BuildPipeline.js` (the runner).
- Replaced Project Prompt 4's monolithic `BuildRequestValidator` with `core/validation/`:
  a `Validator.js` contract, `ValidationManager.js` (stop-at-first-failure runner over an
  injected validator array), and 5 individual validators — `PlayerValidator`,
  `GameModeValidator` (**new** — Adventure/Spectator now explicitly rejected with their
  own message instead of failing confusingly later), `HeldItemValidator`,
  `LengthValidator`, `PermissionValidator`. Adding a validator is now one new file plus
  one array entry in `main.js`.
- Reviewed and expanded `BuildRequest`: added real `startPosition`
  (`Vector3Utils.floor(player.location)`) and `sessionId` (log-correlation only) fields.
  Considered and deliberately declined a "cancellation token" field, since that would
  duplicate or conflict with `BuildSession`'s existing job — reasoning kept in-code and in
  ARCHITECTURE.md §17.5.
- `BuildOrchestrator` is now a thin composition root: constructs a `PipelineContext`, runs
  the injected `BuildPipeline`, and maps the final `PipelineResult` to player feedback.
  The per-player double-menu guard and its try/finally safety are unchanged from Project
  Prompt 4, just relocated.
- `main.js` now composes the full dependency graph: 5 validators → `ValidationManager`,
  7 stages → `BuildPipeline`, both fed into `BuildOrchestrator`.
- **Self-review performed** (API compatibility, logic errors, performance, extensibility,
  race conditions, duplication, null safety, edge cases): found and fixed two stale
  comments in `BuildMenu.js`/`RailConfig.js` still referencing the deleted
  `BuildRequestValidator.js`; no logic errors, race conditions, or unguarded null-safety
  gaps found. Full write-up: ARCHITECTURE.md §18.1.
- Validated with 30 new mocked test cases (11 pipeline integration, 3 full-stack
  orchestrator, 9 re-run main.js event-filter, 7 individual-validator) on top of 40/40
  files passing `node --check` (up from 22) — all 30 passed. ARCHITECTURE.md §18.2.
- **⚠️ Flagged, not silently assumed:** this session's prompt header read "PROJECT PROMPT
  5/50" where every prior one read "N/15." Treated as a likely typo pending confirmation —
  see ARCHITECTURE.md's header note.

### Project Prompt 6 — Direction Detection & Railway Origin System — 2026-07-18
- Implemented real direction detection: `DirectionUtils.snapYawToCardinal(player.getRotation().y)`.
- **Self-review found and fixed a real bug before shipping:** the first implementation
  used `player.getViewDirection()`, reasoning that skipping its y-component guaranteed
  pitch-independence. Found that a 3D view vector's *horizontal* magnitude itself
  degrades toward zero at steep pitch, making direction numerically unstable exactly when
  a player looks steeply down to use a placement item. Switched to yaw
  (`player.getRotation().y`), which has no such degradation, and added a regression test
  reproducing the exact scenario. Full narrative: ARCHITECTURE.md §19.1/§20.1.
- Added `core/BuildVector.js`: the reusable model (direction, forward step, origin,
  `positionAt()`) every future placement stage will read instead of recomputing direction
  math itself. Origin is always exactly one block from the player
  (`playerBlock + stepVector`), structurally guaranteeing the player's own block is never
  selected.
- Added `core/validation/DirectionValidator.js` and `OriginValidator.js` to the validation
  framework (order: Player → GameMode → HeldItem → Direction → Origin → Length →
  Permission).
- **Deliberate scope boundary documented:** origin validity is checked structurally only
  (finite coordinates, valid dimension) — NOT for hazards, gaps, or obstructions, since
  that requires reading blocks, which is Roadmap Phase 5's `TerrainScanner`/`PathValidator`
  job specifically. Implementing a partial version now would duplicate logic about to be
  built properly next phase. Full reasoning: ARCHITECTURE.md §19.3.
- `BuildRequest` extended with a `buildVector` field; `facingDirection`/`startPosition`
  kept as backward-compatible aliases derived from it — no existing caller needed to change.
- `TerrainScanningStage` now sends a "Building {direction} for {length} blocks..."
  confirmation message before reporting `FUTURE_EXPANSION` — a narrow, honest responsibility
  addition (not scanning logic) that's also what makes this session's direction-detection
  checklist actually checkable in-game.
- Documented all requested edge cases (wall, water, slabs, stairs, both game modes, rapid
  repeated use, multiplayer, and the newly-discovered straight-up/down case) with expected
  behavior for each — ARCHITECTURE.md §19.5.
- Validated with 47 new mocked test cases (19 DirectionUtils, 12 BuildVector, 7
  DirectionValidator/OriginValidator, 9 full-pipeline integration) plus 12 regression tests
  re-confirmed against Prompt 4/5's suites, on top of 43/43 files passing `node --check`
  (up from 40). One regression-suite assertion needed updating to reflect this session's
  intentional new confirmation message — confirmed as working new behavior, not a bug.
  Full breakdown: ARCHITECTURE.md §20.2.

### Project Prompt 7 — Terrain Scanner (Flat Terrain Foundation) — 2026-07-18
- Implemented `terrain/TerrainScanner.js` for real: reads the ground block and the rail's
  own placement position for every one of the requested path positions, classifying each
  as `FLAT_SAFE`, `HAZARD`, `LIQUID`, `GAP`, `OBSTRUCTED`, `UNLOADED`, or `OUT_OF_BOUNDS`.
  Detection only — makes no accept/reject decisions; that stays `PathValidator`'s job
  (still a stub, next up). Full design: ARCHITECTURE.md §21.
- **Always scans the full requested length, never stops at the first problem** — a
  deliberate choice so the resulting `TerrainScanResult` can support future UI feedback
  showing everything found, not just the first issue. Confirmed by test with a path
  containing 3 different problems before its end.
- Water and lava are both liquids but classify differently: lava matches
  `HazardRegistry` and is `HAZARD`; water is `LIQUID` — kept distinct on purpose, since
  underwater support is a separate, not-yet-built future feature (Roadmap Phase 11+), not
  a "dangerous like lava" situation.
- `TerrainScanningStage` now calls the real scanner and attaches the result to the new
  `context.terrainReport`, plus logs a per-scan summary — but sends **no new player-facing
  message**, and still reports `FUTURE_EXPANSION` overall, preserving this session's
  explicit "detection only" scope boundary. Confirmed by test that exactly zero new
  messages were sent.
- Documented a deliberate simplification: `isAboveReplaceable` is conservatively
  `block.isAir` only (not tall grass/snow/etc.), since a reliable "is this replaceable"
  API couldn't be confirmed this session. Under-counts buildable positions rather than
  risk over-counting — flagged as a future refinement, not treated as a bug.
- **Self-review found and fixed a real performance issue:** the hazard-ID `Set` was being
  rebuilt from `HAZARD_BLOCK_IDS` on every single `scanPath()` call. Moved to a
  module-level constant, built exactly once. Fixed before the session was considered
  complete.
- Documented (not resolved, since it couldn't be fully confirmed either way) the exact
  `getBlock()` undefined-vs-throw split for unloaded chunks — handled defensively for
  both paths, and errors are distinguished by `error.name` string comparison rather than
  `instanceof` against a possibly-not-importable error class.
- Validated with 33 new mocked test cases (25 scanner classification/precedence/error-
  handling, 3 performance/allocation, 5 full-pipeline integration) plus a dedicated
  zero-length edge-case test (5 more), plus 12 regression tests re-confirmed after
  updating two stale Prompt 6 test fixtures (they needed a working `dimension.getBlock`
  and a real `TerrainScanner` instead of `null`, now that `TerrainScanningStage` actually
  uses it) — 104 tests passing across the full suite, on top of 43/43 syntax checks.

### Project Prompt 8 — Inventory Manager & Resource Validation System — 2026-07-18
- Implemented `inventory/InventoryManager.js` for real: `buildReport()` scans every
  inventory slot and returns a full `InventoryReport` (available/required/hasEnough/
  missingQuantity/slots). `countRailItems()` and `buildReport()` share one internal scan
  loop. `deductRailItems()` remains a stub (Roadmap Phase 8 in the original numbering,
  "Survival Resource Consumption") — no items removed this session.
- Added `inventory/ResourceValidator.js` (new): the third instance of this project's
  Scanner/Validator split (after the pipeline itself and terrain). Creative Mode bypasses
  quantity checking entirely; Survival requires an exact count. Unlike Prompt 7's
  `TerrainScanner`/`PathValidator` pair, **both halves are real this session** — a genuine
  accept/reject decision, not detection-only, per this session's explicit scope.
- **Architectural change beyond what was explicitly asked, fully justified:**
  `TerrainScanningStage` now advances the pipeline past itself when a scan is fully clean
  (`buildReady === true`), instead of always halting. This is NOT `PathValidator` (still
  not built — no per-hazard messages exist) — it only reads a field `TerrainScanner`
  already computed. Necessary because, without it, this session's entire deliverable
  would sit after a permanently-blocking stage and could never run in a real game, only
  in mocks — making the requested manual testing checklist impossible to actually
  perform. Any non-clean scan is completely unchanged from Prompt 7. Full reasoning:
  ARCHITECTURE.md §24. Confirmed by test that a hazardous-terrain fixture still halts
  regardless of available inventory.
- `PipelineResult.validationFailed()` gained an optional `substitutions` parameter (and
  `BuildOrchestrator` now passes it through to `MessageService.sendChat`) so the
  insufficient-rails message can carry the actual missing quantity — confirmed end-to-end
  by test, including the number being correctly stringified for the RawMessage payload.
- Documented, and confirmed by test, that Creative Mode still requires holding the rail
  item — enforced independently and earlier, by the existing `HeldItemValidator`, which
  `ResourceValidator` deliberately doesn't duplicate.
- Added the required **Known API Risks** section (ARCHITECTURE.md §25): inventory
  synchronization, player disconnect timing, inventory update timing, Script API
  transaction limitations, and future compatibility notes.
- Self-review confirmed zero inventory mutation this session (no `setItem`/`addItem`/
  `removeItem` calls anywhere in the new code) and recorded one resolved design question:
  `ResourceValidator` deliberately does not distinguish "empty inventory" from "inventory
  component missing" as separate rejection reasons, since both correctly reduce to the
  same accurate, actionable message.
- Validated with 30 new mocked test cases (16 InventoryManager, 6 ResourceValidator, 6
  InventoryStage, 2 substitution-delivery) plus 8 full-pipeline-integration and 2
  Creative-still-needs-item tests, plus 19 regression tests re-confirmed after updating 3
  stale test fixtures (`test_full_pipeline_p6/p7.mjs`, `test_orchestrator3.mjs` — expected
  consequences of the TerrainScanningStage change, not product regressions) — 144 tests
  passing across the full suite, on top of 44/44 syntax checks (up from 43).

### Project Prompt 9 — Creative Mode Support & Build Pipeline Integration — 2026-07-18
- **Integration review, not a rebuild.** Confirmed the pipeline order requested this
  session (Player Event → Rail Detection → Build Menu → Build Request Creation →
  Direction Detection → Terrain Scanner → Inventory Validation → Pipeline Result) was
  already fully built and wired across Prompts 4-8. Documented the mapping explicitly,
  including why menu-showing, request-creation, and direction-detection deliberately stay
  one stage (`BuildRequestCreationStage`) rather than three — not independently retryable,
  splitting them would add plumbing with no behavioral benefit. ARCHITECTURE.md §27.1.
- Added `core/pipeline/RequestLifecycleState.js` (new): a live, coarse-grained
  `CREATED → VALIDATING → READY/CANCELLED/FAILED` state, written only by `BuildPipeline`
  as a request progresses — centralizes lifecycle bookkeeping in one place instead of
  requiring every stage to remember it.
- Added `core/pipeline/PipelineOutcome.js` (new): a one-shot, fine-grained classification
  of a terminal `PipelineResult` — `BUILD_ACCEPTED`, `VALIDATION_FAILED`,
  `TERRAIN_FAILED`, `INVENTORY_FAILED`, `CANCELLED`, `UNEXPECTED_ERROR`, plus
  `PENDING_FUTURE_WORK` for the current typical result. Distinct from
  `RequestLifecycleState` — one tracks progress, the other classifies why a request
  ended where it did. `BuildOrchestrator` now classifies and logs this on every build.
- Implemented `MessageService.sendActionBar` for real
  (`player.onScreenDisplay.setActionBar()`), specifically to satisfy "avoid chat spam":
  4 new actionbar progress pings ("Preparing railway...", "Analyzing terrain...",
  "Checking inventory...", "Validation successful.") replace each other in the actionbar
  instead of accumulating in chat. `ValidationStage` and `InventoryStage` gained
  `messageService` as an additive constructor dependency to send them.
- Confirmed, by new end-to-end test rather than just documentation, that Creative Mode
  behaves exactly as specified: bypasses quantity, still requires holding the item, still
  goes through every currently-implemented check, reaching exactly as far as a
  fully-resourced Survival player would.
- Confirmed multiplayer safety by test: two players run through **one shared
  `BuildPipeline` instance** concurrently (matching `main.js`'s real wiring) with zero
  cross-contamination of lifecycle state, actionbar messages, or chat messages.
- Self-review found no new bugs requiring a fix (the integrated systems were each already
  reviewed in their own sessions) but corrected one documentation debt: Project Prompt
  5's `BuildPipeline.js` header claimed the class was "intentionally finished"; this
  session's changes to that same file needed that claim explicitly revised rather than
  silently contradicted.
- Validated with 33 new mocked test cases (7 outcome classification, 6 actionbar, 7
  lifecycle progression, 9 full-pipeline integration, 2 Creative-confirmed-end-to-end, 2
  orchestrator-outcome-delivery), plus 19 regression tests re-confirmed after updating 6
  test fixtures for the new `messageService` constructor parameter on `ValidationStage`/
  `InventoryStage` — 175 tests passing across the full suite, on top of 46/46 syntax
  checks (up from 44).

### Project Prompt 10 — First Working Railway Builder — 2026-07-18
- **This is the first session actual rails are placed in the world.** Flat terrain,
  straight line, one cardinal direction, both game modes — matching this session's
  explicit scope (no slopes/tunnels/bridges/underwater yet).
- **Product renamed** from "Ryzen Rail Builder" to "Smart Rail Builder," as explicitly
  requested. Updated: pack name/description (lang keys), `Constants.ADDON.DISPLAY_NAME`,
  manifest module descriptions, all 4 doc titles, and the delivered project folder/zip
  name. Deliberately NOT renamed: the internal `ryzenRailBuilder` localization-key
  namespace prefix used throughout the code — invisible to players, and changing it would
  mean touching every key across two files for zero player-facing benefit.
  **⚠️ Flagged for your attention:** this addon was previously part of a "Ryzen"-branded
  portfolio (alongside RyzenVeinMiner, RyzenBackpacks, RyzenMap+, and others per prior
  session context) — a full break from that naming convention wasn't something I could
  confirm was intentional versus e.g. "Ryzen Smart Rail Builder" being meant instead.
  Proceeded with exactly what was asked; flagging the portfolio-consistency question
  rather than silently assuming either interpretation.
- Implemented the full Rail Placement Engine: `builder/RailPermutationBuilder.js` (new)
  computes the exact `BlockPermutation` for a straight rail explicitly — `rail_direction`
  (0 = north-south, 1 = east-west) and, for the three powered variants, `rail_data_bit`
  (`false`) — rather than relying on unconfirmed auto-connection behavior from vanilla's
  neighbor-sensing placement logic. **The exact Bedrock state names were sourced from a
  community-maintained reference, not an official Microsoft document** — disclosed
  prominently as this session's highest-risk assumption; the manual testing checklist's
  first entries specifically ask for visual confirmation in-game.
- `builder/strategies/StraightRailStrategy.js` implemented for real: places one block per
  position, re-verifying cancellation, terrain (via `TerrainScanner`'s new
  `scanSinglePosition()`), and live resource availability before every single placement —
  not just once upfront — since a multi-tick build means real time passes during which
  the world or inventory can change. Game mode is read fresh every iteration, so a
  mid-build Survival↔Creative switch takes effect immediately.
- `builder/RailBuilder.js` implemented: bridges `system.runJob`'s tick-spread generator
  execution to a `Promise` via `yield*` delegation, so `PlacementStage` can simply `await`
  a placement that runs across many ticks under the hood.
- `inventory/InventoryManager.deductRailItems` implemented for real: removes exactly N
  items across as many slots as needed, always via the get-modify-writeback pattern,
  clearing a fully-consumed slot with `container.setItem(slot)` (undefined) rather than
  ever attempting `amount = 0` (which the real API rejects — valid range is 1-255).
  Confirmed anti-duplication-safe by 11 dedicated tests.
- `core/CancellationWatcher.js` implemented for real (reserved since Project Prompt 2):
  subscribes once to `playerLeave`, `playerDimensionChange`, `entityDie` (filtered to
  players — `event.deadEntity.id`, specifically re-confirmed against current official
  documentation this session), and `playerGameModeChange`.
- `core/BuildSession.js` now constructed directly from a `BuildRequest`, exactly as
  planned since Project Prompt 6 first described the relationship.
- Added `core/pipeline/stages/FinalSafetyCheckStage.js` (new pipeline stage, between
  `InventoryStage` and `PlacementStage`): a fresh full-path re-scan immediately before
  construction begins — distinct from, not redundant with, both the original scan and the
  per-block re-check during placement; each covers a different window of time.
- `core/pipeline/stages/PlacementStage.js` and `CompletionStage.js` implemented for real;
  `ui/ProgressReporter.js` implemented for real (throttled actionbar progress, reusing
  the config already set up back in Project Prompt 2).
- `PipelineOutcome` gained `PLACEMENT_INCOMPLETE` for a build that starts but stops
  partway. `BUILD_ACCEPTED` and `RequestLifecycleState.COMPLETED` are genuinely reachable
  for the first time — confirmed by test.
- `BuildOrchestrator` now distinguishes menu-close cancellation (no message needed) from
  mid-build cancellation (sends `CONSTRUCTION_CANCELLED` with the reason and blocks kept),
  since a mid-build cancellation leaves the player present and informed either way.
- Self-review confirmed no item-loss/duplication bugs, confirmed Creative Mode's
  inventory check is skipped via short-circuit evaluation (never scans inventory
  needlessly), and confirmed the placement engine's future-extensibility claims (a curved
  or sloped strategy would need zero changes to `RailBuilder`/`PlacementStage`) by design
  review rather than just assertion.
- Validated with 55 new mocked test cases (12 permutation building, 11 deduction safety,
  14 strategy behavior, 4 runJob-bridge, 6 cancellation watcher, 8 final-safety/placement)
  plus 41 regression tests re-confirmed and strengthened across 6 pipeline test files
  (each now confirms genuine end-to-end completion, including real deduction, rather than
  stopping at a stub) — 233 tests passing across the full suite, on top of 48/48 syntax
  checks (up from 46).

### Project Prompt 11 — Real PathValidator (Roadmap Phase 5, Part 2) — 2026-08-04
- **Session objective changed before any code was written.** This prompt originally
  requested Roadmap Phase 11 (automatic slope detection) directly. Flagged first: the
  project's own docs showed `PathValidator` (Phase 5 Part 2) was still an unbuilt stub,
  Phase 10 hadn't started, and ROADMAP.md's own Phase 11+ section calls for design
  discussion before that work begins — none of that had happened. You chose to finish
  PathValidator first, then move to slopes next session/turn. See TODO.md's new "Order
  Note" for the full record.
- `terrain/PathValidator.js` implemented for real, replacing the Roadmap Phase 5 stub:
  walks a `TerrainScanResult` in path order and returns the first rule violation, mapping
  each non-`FLAT_SAFE` classification to a specific `PathRejectionReason` and matching
  `localizationKey` via two small lookup tables (`HAZARD`/`LIQUID` → hazard message; `GAP`
  → distinct "bridge required" message; `OBSTRUCTED` → distinct "not flat" message;
  `UNLOADED`/`OUT_OF_BOUNDS` → their own messages). Deliberately does not re-inspect any
  block itself — reads only `classification` and `position` from facts `TerrainScanner`
  already computed, so it can never drift out of sync with the scanner.
- `core/pipeline/stages/TerrainScanningStage.js` updated: the interim `buildReady`
  shortcut from Project Prompt 8 is gone. The stage now calls `PathValidator.validate()`
  and returns `VALIDATION_FAILED` with the matching `localizationKey` on rejection — the
  same adapter shape `ValidationStage` already uses for `ValidationManager`. This makes
  `PipelineOutcome.TERRAIN_FAILED` reachable through the normal scan path for the first
  time, not only through `FinalSafetyCheckStage`.
- `core/pipeline/PipelineContext.js` gained `pathValidationResult`, matching the existing
  one-field-per-stage-output convention.
- 5 new lines added to `RP/texts/en_US.lang` (`path.rejected.notFlat`, `.hazard`,
  `.unloaded`, `.outOfBounds`, `path.bridgeRequired`) — these keys existed as forward
  declarations in `LocalizationKeys.js` since Roadmap Phase 5 was first planned but had no
  text until now.
- **Self-review found and corrected two pre-existing stale comments**, neither introduced
  this session: `PipelineOutcome.BUILD_ACCEPTED` said "not reachable yet," but it's been
  reachable since Project Prompt 10 made `PlacementStage` real (confirmed by that
  session's own changelog entry); `TERRAIN_FAILED`'s comment said `TerrainScanningStage`
  "isn't reachable yet," which this session's own change resolves. Both corrected rather
  than left to drift further alongside this session's edits.
- **Validation performed:** all 48 script files re-checked with `node --check` (0
  failures) and every call site of `PathValidator`/`TerrainScanningStage` manually
  reviewed for the new contract. **No automated mocked-test harness was present in the
  uploaded project archive this session** — prior sessions' entries above reference test
  suites (e.g. "233 tests passing") that weren't included in what was uploaded, so this
  entry does not claim a pass count for something that wasn't actually run. A manual
  in-game testing checklist was added to ROADMAP.md's Phase 5 Part 2 entry instead.
- No files removed or renamed. No behavior changed for a fully clean (all-`FLAT_SAFE`)
  path — it still proceeds to `InventoryStage` exactly as it did under the old shortcut.

### Project Prompt 11 (follow-up) — Real Bug Found & Fixed: `isGroundSolid` — 2026-08-04
- **Reported by you:** in-game testing of Phase 5 Part 2 found that genuinely flat terrain
  (confirmed standing on solid ground, no leftover holes from earlier tests) was rejected
  every time with `GAP_BRIDGE_REQUIRED`. Content Log showed `0/32 safe, 32 elevation
  change(s)` — a uniform failure across an entire flat plane, not a one-off bad block.
- **Root cause:** `TerrainScanner._scanPosition()`'s `isGroundSolid` was computed from
  `Block.isSolid`, which Bedrock's own Script API documentation marks as pre-release/
  experimental (unlike the stable `isAir`/`isLiquid`) and does not reliably report `true`
  for ordinary terrain without a specific experiment most players will never enable.
- **Fix:** `isGroundSolid` is now `!groundBlock.isAir && !groundBlock.isLiquid` — built
  entirely from properties this file already used elsewhere, no new dependency. This was
  the only call site of `.isSolid` in all 48 script files (confirmed by full-codebase
  grep), and because placement-time re-verification (`scanSinglePosition`) shares the same
  underlying method, this one change fixes both the initial scan and placement safety
  re-checks. See ARCHITECTURE.md §34 for the full diagnosis, including the specific
  Microsoft documentation that confirmed `isSolid`'s experimental status.
- **Disclosed trade-off:** the new check is very slightly less precise than a true
  solidity check would be (a fence or ladder as a *ground* block would now read as
  "solid enough") — an unlikely position for a support block to be in practice, and
  consistent with `isAboveReplaceable`'s existing, already-documented conservative
  approximation (§21.4).
- **Validation:** `node --check` clean across all 48 files. **Not yet confirmed in-game**
  — awaiting your retest.

### Project Prompt 12 (pre-work) — Length Range 1-64, Substitutions Bug, Uninstall Check — 2026-08-04
- **Length range changed:** `RailConfig.LENGTH_PRESETS` — `MIN` 32→1, `MAX_SURVIVAL`
  512→64, `STEP` 32→1 (must divide the new range evenly), `DEFAULT` unchanged at 32.
  One config file change, propagates everywhere via the existing single-source-of-truth
  design (`BuildMenu`, `LengthValidator`, `BuildRequestCreationStage` all read the
  constant, none hardcode the old bounds).
- **Real bug found and fixed while making that change:** `ValidationStage` silently
  dropped any `substitutions` a validator returned, unlike `InventoryStage`'s already-
  correct handling of the same pattern. `LengthValidator` now attaches `[MIN,
  MAX_SURVIVAL]` to its rejection message, and `ValidationStage` now passes
  `result.substitutions` through — without both fixes together, the new length-rejection
  message would have shown literal unfilled placeholder text to the player.
- **"Area not loaded" past 64 blocks:** explained, not separately coded around — render
  distance and simulation distance are different settings, and only the latter (often
  much smaller, regardless of client render distance) governs what a script can read.
  Capping length at 64 makes the reported failure mode unreachable; the general "very
  long builds can outrun simulation distance" risk stays open under Phase 10.
- **"Vanish completely if removed":** confirmed, not fixed — this addon has never used
  dynamic properties, scoreboards, or structure files (grep-confirmed across all 48
  files). Nothing persists beyond the rail blocks it places, which correctly remain in
  the world on uninstall exactly like any manually-placed block would.
- Manifest version bumped 0.1.1 → 0.1.2. `node --check` clean across all 48 files.
  **Not yet confirmed in-game.**

### Project Prompt 11 (continued) — Roadmap Phase 11: Smart Slope Detection — 2026-08-04
- **`TerrainScanner` now scans sequentially**, resolving each position's Y relative to the
  previous position's rather than always the origin's — trying flat first, then a ±1 step
  before giving up. New classifications `ASCENDING`/`DESCENDING` (buildable) replace `GAP`/
  `OBSTRUCTED` (which always meant reject); `UNSUPPORTED` now covers anything steeper than
  ±1 or an immediate reversal. `PathValidator` updated to treat all three of `FLAT_SAFE`/
  `ASCENDING`/`DESCENDING` as buildable. See ARCHITECTURE.md §36.1.
- **Rail shape resolution** (`TerrainScanner._resolveRailShapes()`, a second pass after Y
  resolution): works out which physical block gets the sloped `rail_direction` state —
  not always the position where a drop is detected; for a descending step it's the
  PREVIOUS (higher) position. Full derivation in ARCHITECTURE.md §36.2.
- **`RailPermutationBuilder` gained `buildAscendingRailPermutation()`** using
  `rail_direction` 2-5. Flagged as this session's highest-risk unconfirmed assumption —
  more uncertain than the existing 0/1 flat values, since no official or community source
  with an explicit numeric table could be found. Purely cosmetic if wrong (rails would tilt
  backwards, nothing crashes) — see ARCHITECTURE.md §36.3 and the file's own disclosure.
- **`StraightRailStrategy`** now reads `path[i].position` and `path[i].slopeDirection`
  (previously bare `{x,y,z}` — see the contract change in `RailBuildStrategy.js`), picking
  `buildStraightRailPermutation` or `buildAscendingRailPermutation` per block. Its per-block
  terrain re-check needed NO slope-awareness — re-verifying an already-resolved Y as
  `FLAT_SAFE` is correct whether that Y was originally reached via flat, ascending, or
  descending resolution. See TerrainScanner.js's header for the full reasoning.
- **Real bug found and fixed before ever shipping:** `PlacementStage` was independently
  rebuilding a flat-only path via `buildVector.positionAt()`, ignoring the actual validated
  terrain report. Harmless by coincidence while everything was flat; would have placed
  every rail past the first slope at the wrong height. Fixed: `path` is now
  `context.terrainReport.positions` directly. See ARCHITECTURE.md §36.4.
- **Known, disclosed limitation:** an immediate reversal (a 1-block peak or valley with no
  flat block at the extremum) is rejected as `UNSUPPORTED` rather than attempted — a single
  sloped rail block can't tilt two ways at once, and this phase doesn't yet insert a flat
  block at a summit automatically.
- **Validation:** the sequential-scan and rail-shape algorithm was actually EXECUTED against
  a mocked Node test harness (synthetic `dimension.getBlock()`, no live Minecraft needed) —
  9 scenarios, 25 assertions, all passing, including the two trickiest cases (descending
  shape landing on the correct earlier block; a continuous staircase correctly sloping every
  step). `node --check` clean across all 48 files. Full-codebase grep for every retired
  symbol confirmed no stale references remained — one real one
  (`TerrainScanningStage`'s Content Log line, referencing the renamed `elevationChangeCount`
  field) was found this way and fixed.
- **Not yet confirmed in-game.** The testing checklist in ROADMAP.md's Phase 11 entry opens
  with a single isolated ascending step, checked visually, specifically because of §36.3's
  disclosed uncertainty.

### Project Prompt 13 — Roadmap Phase 12 (Tunnels) & Phase 13 (Review + Bridge Foundation) — 2026-08-04
- **Scope note:** Project Prompt 13 (architecture review + bridge foundation) was
  originally requested directly, listing "Tunnel System" as an already-completed system
  to review. It wasn't — Phase 12 had never been built. Flagged before starting; you chose
  to build Phase 12 first, then Prompt 13. Both are covered in this single entry.
- **Roadmap Phase 12 (Tunnels):** `TunnelDetector` (feasibility search), `TunnelPlanner`
  (turns a detection into buildable `TUNNEL`-classified positions), `TunnelExcavator`
  (placement-time block-breaking, with its own narrow re-check). New
  `UnbreakableBlockRegistry.js` — a curated list, deliberately not a dynamic API query,
  per this project's `Block.isSolid` lesson (§34). Excavation gives no loot, consumes no
  tool durability (Project Prompt 12's explicit scope). `TerrainClassification` gained
  `TUNNEL`; `TerrainClassification` itself was extracted to its own file
  (`terrain/TerrainClassification.js`) to avoid a circular import between
  `TerrainScanner` and `TunnelPlanner` — `TerrainScanner.js` re-exports it, so nothing
  else needed to change. `PlacementStage`'s earlier fix (§36.4) meant `StraightRailStrategy`
  only needed to excavate-then-recheck per TUNNEL position, not restructure its loop.
- **Real bug found via the mocked test harness, not manual review:** `TunnelDetector`'s
  exit condition originally required solid ground at the exit position itself, which
  incorrectly rejected a wall immediately followed by a legitimate drop as an internal
  floor gap. Test 15 (a wall followed by a drop) caught it; fixed by separating "is this
  the exit" from "is there solid ground here" — see ARCHITECTURE.md §37.5.
- **Roadmap Phase 13 (Architecture Review + Bridge Foundation):** every completed system
  reviewed against real, checkable signals (file sizes, actual grep results for
  duplication, actual constructor coupling) — findings in ARCHITECTURE.md §38.5. Two
  concrete technical debt items found and resolved, confirmed to change zero observable
  behavior: block-read logic duplicated across `TerrainScanner`/`TunnelDetector`/
  `BridgeDetector`/`GapAnalyzer` extracted to `utils/BlockReader.js`; hazard/unbreakable
  ID Sets independently rebuilt in 3 files now built once in their registries and
  exported directly (`HAZARD_BLOCK_ID_SET`/`UNBREAKABLE_BLOCK_ID_SET`).
- **Bridge foundation:** `BridgePlan` (data shape + factory), `BridgeDetector`
  (structural feasibility only), `GapAnalyzer` (classifies a gap as AIR/SMALL_VALLEY/
  RAVINE/WATER_CROSSING), `BridgeValidation` (validates a BridgePlan in isolation), and
  an explicit `BridgeExecutionStrategy` placeholder using this project's established
  `NotImplemented.js` stub convention. **None of these are consulted by `PathValidator`**
  — a drop of more than 1 block is still, unconditionally, `UNSUPPORTED`, exactly as
  before this session. This is stated as plainly as possible because it's the entire
  point: verified concretely (not just by code inspection) in the mocked test harness —
  a position with `bridgeFeasibility.feasible: true` still produces `buildReady: false`.
- **Enhanced classification:** new `PathCategory` module (`terrain/PathCategory.js`) — a
  simplified 6-category summary (Flat/Slope/Tunnel/Bridge/WaterCrossing/Unsupported)
  layered on top of the existing detailed classification, attached to every position as
  `pathCategory`. Purely informational, same non-interference guarantee as the bridge
  foundation above.
- **Validation:** the mocked Node test harness grew from 25 assertions (Phase 11) to 41
  (+ Phase 12 tunnels) to 55 (+ Phase 13 gap/bridge/category) — every prior assertion
  still passing unchanged at each step, including immediately after the
  `BlockReader`/Set-sharing refactor (confirming the cleanup changed nothing observable).
  `node --check` clean across all 62 script files (up from 48 at the start of Project
  Prompt 11's session). Every deployed file reconfirmed byte-identical to what was
  actually tested, by diff.
- **Not yet confirmed in-game** — both the tunnel system and the bridge foundation's
  correct non-interference with existing behavior are genuinely awaiting your test pass.

### Project Prompt 14 — Peak/Valley Reversals Buildable via Tunnel Reuse — 2026-08-04
- **Reported by you:** in-game Content Log showed real mountains failing `TOO_STEEP`
  despite successfully ascending/descending/tunneling through most of the terrain first.
  Traced to the disclosed Roadmap Phase 11 limitation (immediate peak/valley reversals,
  always rejected) rather than a tunnel-length issue — confirmed by checking the log
  never showed the distinct `TOO_LONG` message a genuinely-too-long tunnel produces.
- **Fix:** a reversal now tries the ordinary ±1 resolution first (a true 1-block spike or
  dip needs no excavation — the rail just crests it); only if that fails does it fall
  back to a real tunnel attempt at the post-reversal height, reusing Roadmap Phase 12's
  tunnel system unchanged.
- **`TunnelConfig.MAX_SEARCH_LENGTH` raised 32 → 64**, matching the overall build-length
  cap, after your testing showed mountains needing 20+ tunneled blocks. You confirmed
  directly that the 64-block total build-length cap itself stays as-is — a mountain wider
  than that genuinely won't fully fit, a real accepted tradeoff, not something this
  raised limit works around.
- **Three real mistakes made and caught during this session, documented in full rather
  than only presenting the clean result** (see ARCHITECTURE.md §39.2 for the complete,
  procedural account): (1) an initial version's test failure was correctly the fix
  working, not a regression — verified by tracing output before updating the test; (2) a
  version that appeared to work relied on accidental loop-index side effects rather than
  intentional logic — a rewritten "explicit" version was checked by actually running it,
  which threw `Cannot read properties of null` immediately, caught before it could ship;
  (3) the valley-side fix was placed in the correct branch but the wrong order relative
  to the plain ascend attempt, found only by testing the valley case directly rather than
  assuming it mirrored the already-passing peak test — confirmed with direct block reads
  before touching code again.
- **Validation:** mocked test harness grew from 58 to 65 assertions — 3 new tests for
  this fix (valley crest, valley with a genuinely-unclimbable far wall still correctly
  failing, and a 3-reversal stress test confirming no index corruption), plus the
  existing peak test updated to reflect the corrected, intentional behavior. Every
  mistake above was caught by executing code and inspecting real output or a real crash,
  not by re-reading a diff. `node --check` clean. Deployed file reconfirmed
  byte-identical to what was tested, by diff.
- **Not yet confirmed in-game.**

### Project Prompt 14 (second round) — Tunnel Budget Decoupled From Requested Length — 2026-08-10
- **Reported by you, with fresh Content Log evidence:** the reversal fix above was
  confirmed working in-game (a flat build with 5 ascending/3 descending, and a separate
  build with 14 tunneled positions, both completed) — but a DIFFERENT failure,
  `TUNNEL_TOO_LONG`, showed up on real mountains, including at the full 64-block request
  length. Traced precisely: `TunnelDetector`'s search budget was `requestedLength - i`,
  not the absolute ceiling — one reported case had only 5 positions of room left for a
  tunnel attempt, on a 32-length request.
- **Two decisions confirmed with you directly, not assumed:** a tunnel gets its own
  fresh search budget against the absolute `LENGTH_PRESETS.MAX_SURVIVAL` ceiling (64),
  independent of how much of the original request earlier terrain had used; and the
  total build may extend past what was originally requested — up to that same ceiling,
  never beyond it — if a tunnel genuinely needs the room.
- **Fix:** `TunnelDetector`'s budget parameter renamed `remainingBudget` →
  `positionsUntilAbsoluteCeiling`, now computed from the absolute ceiling in
  `TerrainScanner.scanPath()`, not the original request. `scanPath()`'s loop bound
  changed from a fixed `length` to a mutable `scanLimit` that grows (capped at the
  ceiling) when a tunnel's end exceeds it.
- **Two more real bugs found and fixed as a direct consequence** — checked deliberately,
  not assumed away, once builds could legitimately grow past their original request:
  `InventoryStage` was checking resources against the stale original `requestedLength`
  (would have under-counted rails needed for Survival); `BuildSession.targetLength` —
  more serious — governed both the build loop's active condition and its own
  `completed` check, so a stale value would have made a fully successful, tunnel-grown
  build stop early or misreport itself as failed. Both fixed at the source:
  `InventoryStage` now uses `context.terrainReport.positions.length`; `BuildSession`'s
  constructor now takes the actual target length as an explicit parameter instead of
  reading a potentially-stale value out of the request internally.
- **A genuine leftover bug caught by grep, not missed:** after the first pass of fixes,
  `PlacementStage.js` still referenced the now-out-of-scope `requestedLength` variable in
  its interruption-message substitutions — would have thrown a `ReferenceError` on any
  interrupted build. Found by a full-codebase search for the old identifier, not assumed
  complete after the "obvious" fixes.
- **Validation:** the exact reported bug shape directly reproduced in the mocked test
  harness (a 32-length request, wall needing a 20-block tunnel) — confirmed the build now
  correctly extends to 48 total positions and succeeds. Separately confirmed the absolute
  ceiling is still genuinely enforced — a wall positioned so only the ceiling (not the
  original request) could stop it correctly fails at exactly 64 positions with a specific
  `TOO_LONG` reason, never silently overrunning. Both added as permanent regression tests.
  Full suite grew from 65 to 71 assertions, all passing. `node --check` clean across all
  62 files. Full-codebase grep confirmed zero stale references to the old parameter name
  or the removed `requestedLength` variable. Every deployed file reconfirmed
  byte-identical to what was tested, by diff.
- **Not yet confirmed in-game.**

### Project Prompt 15 — Three Building Modes & Unified Build Configuration UI — 2026-08-12
- **Scope note:** the handoff doc's "next up: bridge placement" and Project Prompt 15's
  actual text diverged — Prompt 15 introduces three PERMANENT modes (NORMAL/BRIDGE/
  UNDERGROUND), expands the roadmap from 25 to 30 total prompts, and explicitly scopes
  the real bridge/underground construction engines OUT to Prompts 16/17. Proceeded on
  the more detailed, current instructions; full reconciliation in ARCHITECTURE.md §41.1
  and TODO.md.
- **New:** `config/BuildModes.js` — single registry (`BuildingMode`, `BUILD_MODE_REGISTRY`)
  driving mode selection, validation, and pipeline gating, so a future 4th mode is one
  registry entry, not a rewrite across 4 files. See ARCHITECTURE.md §41.2.
- **Design decision — no new "BuildConfiguration" class:** extended `BuildRequest`
  (`buildingMode`, `bridgeHeight`, `undergroundDepth`, all optional/additive, defaulting
  to NORMAL/null/null) instead of introducing a second, parallel class — `BuildRequest`
  already was the prompt's requested "one authoritative build configuration" since
  Project Prompt 5. Full reasoning in ARCHITECTURE.md §41.3.
- **UI rewritten:** `BuildMenu.js`'s single length-slider menu replaced with a 3-screen
  flow — mode select (`ActionFormData`) → configuration + length combined
  (`ModalFormData`) → build summary (`MessageFormData`, distinct Build/Cancel buttons
  from the config screen's "Next"). Implements the prompt's 5 conceptual steps in 3 form
  round trips; rail type is shown as context text, not re-asked, since it's already
  determined by the held item. Full flow + rationale in ARCHITECTURE.md §41.4.
- **New pipeline stage:** `ModeAvailabilityStage`, between `ValidationStage` and
  `TerrainScanningStage` — stops a fully-valid Bridge/Underground request cleanly, with
  an honest player-facing message, before it reaches terrain-scanning code that only
  understands NORMAL-mode rules. Reuses `PipelineResultStatus.FUTURE_EXPANSION`,
  unreachable since Project Prompt 11. See ARCHITECTURE.md §41.6.
- **New validator:** `ModeConfigValidator` — generic, registry-driven bounds check for
  bridge height (1-16) / underground depth (1-64), added to `ValidationManager` after
  `LengthValidator`.
- **Extended, not broken:** `PipelineResult.futureExpansion()` gained two new optional
  trailing parameters (`localizationKey`, `substitutions`); `BuildOrchestrator`'s
  `PENDING_FUTURE_WORK` case now sends that message when present. Confirmed the original
  2-argument call shape still works unchanged.
- **Real, pre-existing bug found and fixed (unrelated to this session's main work):**
  `Constants.js`'s `ADDON.VERSION` had drifted to `"0.1.0"` while `BP/manifest.json` had
  independently advanced to 0.1.6, and `RP/manifest.json`'s own version had
  independently been stuck at `[0, 1, 0]` the entire time (with `BP/manifest.json`'s
  dependency entry on it also pinned to that stale value). All three now aligned at
  **0.1.7**. Full writeup in ARCHITECTURE.md §41.10.
- **Localization:** `MENU_BUILD_BUTTON` retired (the old single-slider menu's submit
  button no longer exists) and its lang line removed rather than left as unreferenced
  dead text. New keys added for mode selection, height/depth labels and validation
  messages, and the three mode-specific summary bodies. `MENU_LENGTH_LABEL`'s displayed
  text changed "Railway Length" → "Rail Length" per the prompt's explicit terminology
  requirement (key unchanged, so every existing reference picks it up automatically).
  `RailConfig.js`'s `RAIL_TYPES` gained a plain-string `displayName` per type, for the
  summary screen — deliberately not a translate key, mirroring the existing
  `DirectionUtils` display-name precedent (see ARCHITECTURE.md §41.2).
- **API usage flagged for visual confirmation:** `.body()` on `ActionFormData`/
  `MessageFormData` accepting `{translate, with}` with real substitutions, and literal
  `\n` in `.lang` values rendering as line breaks inside a form — both new usage this
  session, not previously exercised anywhere in this project. Full detail in
  ARCHITECTURE.md §41.8.
- **Validation:** new mocked test suite (pure-logic modules only, since `BuildMenu.js`
  and `BuildRequestCreationStage.js` need `@minecraft/server-ui`/`@minecraft/server`
  mocks this session's lightweight harness doesn't build) — 45 assertions, all passing,
  reproducing the prompt's own boundary-value testing checklist exactly (bridge height
  1/8/16 valid, 17/0/-1/NaN rejected; underground depth 1/32/64 valid, 65/0/-1
  rejected), plus `BuildRequest` field mutual-exclusivity and backward-compatibility
  checks, and the mode-availability gate's outcome classification. `node --check` clean
  across all touched/new files. Full detail, including what's explicitly NOT covered by
  this automated pass, in ARCHITECTURE.md §41.7.
- **Not yet confirmed in-game** — this is the first session's work that cannot be
  regression-tested against a prior in-game-confirmed baseline, since it's new UI
  surface, not a fix to existing behavior. See TODO.md's testing checklist.

### Bugfix Session (between Project Prompts 15 and 16) — 2026-08-12
Two bugs reported by you from testing Phase 15's delivered build. **Project Prompt 16
(Bridge Mode) was intentionally NOT started this session** — see TODO.md's Order Note:
Phase 15 hadn't been successfully tested in-game yet (blocked by the packaging bug
below), and starting a large new feature session before that milestone is confirmed
would break this project's own milestone-gating rule.
- **Fixed: ground decoration (short grass, flowers, dead bush, thin snow, saplings)
  blocking rail construction.** Root cause: `TerrainScanner._scanPosition()` only
  treated literal air as "clear" above the ground, so any non-air decoration —
  including the ordinary grass tufts in your screenshot — was misclassified
  `UNSUPPORTED`, the same as an actual wall. This was a previously-flagged, deferred
  TODO item, not a new discovery — testing made it un-deferrable. New
  `config/ReplaceableBlockRegistry.js` (matching `HazardRegistry.js`'s established
  pattern), one line changed in `TerrainScanner.js`. Crops and hazard blocks
  deliberately still stop the build — only naturally-spawning, non-solid decoration is
  now silently replaced. Full write-up: ARCHITECTURE.md §42.
- **Fixed: `.mcaddon` was not a valid Minecraft archive.** Root cause: the Project
  Prompt 15 delivery zipped raw `BP/`/`RP/`/`docs/` folders directly into the
  `.mcaddon`, instead of the confirmed-correct structure (two `.mcpack` files, each a
  zip with that pack's `manifest.json` at its own root, zipped together) — and
  included `docs/`, which isn't a valid pack at all. Found by directly inspecting the
  ORIGINAL `.mcaddon` you uploaded at project start. `.mcaddon` now contains only the
  two `.mcpack`s; the full project `.zip` (with `docs/`, for session continuity) is
  unchanged in purpose but rebuilt with the correct wrapper-folder structure. Full
  write-up: ARCHITECTURE.md §43.
- **Validation:** new standalone logic test for the replaceable-block fix (12
  assertions, all passing); full 45-assertion Phase 15 harness re-run against the
  updated `TerrainScanner.js` with zero regressions; `node --check` clean across all
  touched/new files; final package inspected directly (not assumed) to confirm both
  `.mcpack`s have their manifest at the archive root and the `.mcaddon` contains
  nothing else.
- **Not yet confirmed in-game** — both fixes need your retest, starting with whether
  the `.mcaddon` imports at all.

### Project Prompt 16 — Advanced Bridge Mode: Height 1–16 — 2026-08-13
- **Started per explicit "Start prompt 16" instruction**, ahead of an in-game
  confirmation of the immediately-preceding bugfix session (short grass / `.mcaddon`
  packaging). Flagged, not silently skipped — see TODO.md's Order Note and
  ARCHITECTURE.md §44's opening note.
- **Bridge Mode is now fully implemented.** A player can choose Bridge Mode, a height
  1–16, and a length, and get a real, physically supported elevated railway — not just
  the configuration screen from Project Prompt 15. `BUILD_MODE_REGISTRY.BRIDGE.implemented`
  is now `true`.
- **One authoritative bridge-height formula**, `terrain/BridgePlan.js`'s
  `computeBridgeRailY()`: `origin.y + bridgeHeight`. Every module that needs a bridge's
  elevation calls this one function. Full reasoning: ARCHITECTURE.md §44.2.
- **Design decision — one fixed-elevation bridge for the whole railway, not auto-bridging
  over detected gaps.** The Phase 13 foundation's original "detect and bridge one gap"
  model was replaced with a simpler, fully deterministic one: every position along the
  requested length sits at the same computed elevation, with a support column placed
  underneath only where terrain doesn't already reach that high. Full reasoning:
  ARCHITECTURE.md §44.3.
- **New:** `config/BridgeConfig.js` (material choice + support-search depth),
  `builder/BridgeSupportBuilder.js` (mirrors `TunnelExcavator.js`'s established shape —
  that file's own header predicted this exact class).
- **Redesigned (both were dead code with zero live callers, confirmed by direct search
  before touching either):** `terrain/BridgePlan.js` (the real plan shape Project Prompt
  16 asked for) and `terrain/BridgeValidation.js` (a real internal-consistency check,
  finally exercised). `terrain/BridgeDetector.js`/`terrain/GapAnalyzer.js` — which ARE
  live, for an unrelated NORMAL-mode diagnostic purpose — were deliberately left
  completely untouched. Full reasoning: ARCHITECTURE.md §44.1.
- **Implemented for real (replacing the Project Prompt 13 stub):**
  `builder/strategies/BridgeExecutionStrategy.js` — supports, then surface, then rails,
  each phase announced with one chat message, per-block resource re-verification and
  strictly-after-placement deduction identical to `StraightRailStrategy`'s
  already-proven discipline.
- **`builder/RailBuilder.js` changed:** `run()` now takes its strategy as a parameter
  instead of binding one at construction — needed now that a second real strategy
  exists. `core/pipeline/stages/PlacementStage.js` now picks between
  `StraightRailStrategy`/`BridgeExecutionStrategy` via a registry-style
  `strategiesByMode` map, keyed by `BuildingMode`, matching `config/BuildModes.js`'s own
  "one registry, no rewrites for a new entry" shape.
- **Four pipeline stages became mode-aware** — `TerrainScanningStage`, `InventoryStage`,
  `FinalSafetyCheckStage`, `PlacementStage` — each with its NORMAL-mode branch copied
  verbatim/unchanged and a new BRIDGE branch alongside it, per Project Prompt 16's "do
  NOT redesign Normal Mode."
- **Resource calculation:** one material (`minecraft:cobblestone`, chosen for being
  solid, non-flammable, and reliably Survival-obtainable) used for both support and
  surface blocks; rails and material checked as two separate `InventoryReport`s, rails
  first. `InventoryManager`'s rail-specific-sounding methods reused unchanged for the
  second item type — functionally correct, flagged as a naming-debt technical-debt item
  rather than renamed this session. Full reasoning: ARCHITECTURE.md §44.6.
- **Validation:** 39 new assertions exercising `planBridge()`'s real algorithm against a
  synthetic mocked terrain (flat ground, a hill reaching exactly to deck level, water
  crossings, lava-in-column rejection, terrain/unbreakable/liquid/hazard deck rejections,
  no-ground-found rejection, decorative-grass non-rejection, unloaded chunks) — all
  passing. A NEW, deeper 29-assertion end-to-end integration suite (a minimal test-only
  `@minecraft/server` stub + a mutable fake world + a real inventory container) threading
  a synthetic BuildRequest through the actual pipeline stage classes — confirming real
  block placement at real positions, exact inventory deduction to zero, Creative bypass,
  "place nothing" on insufficient resources, rails-checked-before-material ordering, a
  lava rejection stopping the pipeline before inventory is even checked, NORMAL mode
  fully unaffected, and a mid-build cancellation preserving every already-placed block
  with no automatic rollback — all passing. Full existing 45-assertion Phase 15 suite
  re-run: 40 pass unchanged, 5 are stale "Bridge not implemented" assertions now
  correctly failing (expected, not a regression). `node --check` clean across all 68
  script files. Full detail, including what a Node-only harness still cannot
  substitute for, in ARCHITECTURE.md §44.9.
- **Not yet confirmed in-game** — see TODO.md's full manual testing checklist,
  reproducing Project Prompt 16's own requested test matrix (heights 1 through 17,
  varied terrain, all four rail types, both game modes, cancellation/death/disconnect/
  dimension-change, multiplayer simultaneous builds).

### Project Prompt 17 — Advanced Underground Mode: Depth 1–64 — 2026-08-30
- **Milestone-gate note:** Phase 16 and the bugfix session before it are still
  unconfirmed in-game, making this the third consecutive session on an unverified base.
  Flagged, not silently absorbed — see ARCHITECTURE.md §45's opening note and TODO.md.
- **Underground Mode is now fully implemented.** All three permanent modes are live;
  `BUILD_MODE_REGISTRY.UNDERGROUND.implemented` is `true`, so `ModeAvailabilityStage`
  now gates nothing (kept in place, unchanged, for future modes).
- **One authoritative depth formula**, `terrain/UndergroundPlan.js`'s
  `computeUndergroundRailY()`: `origin.y - depth` — the exact mirror of Bridge Mode's
  height formula about the same reference point, asserted by test rather than just
  claimed. ARCHITECTURE.md §45.1.
- **Entry/transition strategy — the session's central design decision.** Rails descend
  exactly 1 block per block travelled, so reaching depth D costs D positions of ramp.
  Indices `0..D-1` are a continuous descending ramp from the surface; index `D` onward is
  the flat run. No shaft, no ladder, no discontinuity. **Consequence:** a build needs
  `length >= depth + 1`, so the deepest reachable depth in one build is 63; depth 64 is
  still selectable but is rejected with a message naming the length it would need, rather
  than being silently clamped. Alternatives considered and rejected: ARCHITECTURE.md §45.2.
- **Ramp reuses the existing Phase 11 slope architecture** — same `slopeDirection`
  convention, same `buildAscendingRailPermutation()` call shape `StraightRailStrategy`
  already uses. No new rail geometry was invented.
- **Excavation reuses `TunnelExcavator` completely unchanged** — no new excavation code
  was written. `main.js` now constructs one shared instance for both
  `StraightRailStrategy` and `UndergroundExecutionStrategy` (stateless, so safe).
  Corridor only: 2 blocks of clearance flat, 3 on ramp positions (documented reasoning,
  one-line change if testing shows 2 suffices). Floors are never excavated — proven, not
  just intended.
- **Ore policy** (`config/OreRegistry.js` + `UNDERGROUND_CONFIG.ORE_POLICY`): default
  `PROTECT_VALUABLE` — diamond/emerald/ancient debris reject the plan before anything is
  modified, naming the block and coordinate; common ores are excavated but **counted and
  reported** to the player, so nothing is destroyed silently under either tier. Two
  alternative policies fully implemented and one constant away. Full reasoning for
  rejecting both extremes: ARCHITECTURE.md §45.6.
- **New:** `config/OreRegistry.js`, `config/UndergroundConfig.js`,
  `terrain/UndergroundPlan.js`, `terrain/UndergroundValidation.js`,
  `builder/strategies/UndergroundExecutionStrategy.js`. **New method:**
  `TerrainScanner.planUnderground()`.
- **Modified:** `TerrainScanningStage`, `InventoryStage`, `FinalSafetyCheckStage`,
  `PlacementStage` (each gained an UNDERGROUND branch with existing branches untouched),
  `PipelineContext`, `BuildModes`, `main.js`, `LocalizationKeys`, `en_US.lang`, all
  manifests + `Constants.js` (0.1.8 → **0.1.9**, all five numbers aligned).
- **One real bug found and fixed by this session's own tests before shipping:** lava or
  water directly beneath a rail was reported as "opens into a cave with no solid floor"
  (a liquid correctly fails the solidity test) — a correct rejection with actively
  misleading wording. Now checked explicitly first, so both report their true cause.
- **Validation:** 71 assertions against the real `planUnderground()` algorithm + a
  48-assertion end-to-end integration suite (real pipeline classes, mutable fake world,
  real inventory container) — all passing. The integration suite includes **NORMAL and
  BRIDGE regression in the same wired graph**, mode isolation (a stray `bridgeHeight` on
  an underground request is ignored entirely and vice versa), two simultaneous
  multiplayer builds at different depths, all four rail types, mid-build cancellation
  preserving placed blocks, and confirmation that an insufficient-rails rejection leaves
  the world **completely unexcavated**. Performance measured directly: worst case
  (length 64, depth 63) is 255 block reads, 191 excavations, ~0.1 ms planning.
  `node --check` clean across all 73 files; all 73 localization keys verified 1:1 against
  `en_US.lang` with no duplicates or orphans.
- **Not yet confirmed in-game** — full manual checklist in ROADMAP.md's Phase 17 entry.

### Pre-Prompt-18 Bug-Fix Pass — 2026-08-30
Four bugs reported with screenshots after testing Phases 16/17. **Project Prompt 18 was
NOT started this session**, per your explicit instruction. This is the fourth
consecutive session on a base that has still never been confirmed in-game — see TODO.md.
- **Fixed: bridge did not climb gradually, and was built as a solid wall (two separate
  bugs, one root cause).** `planBridge()` computed a single fixed elevation for the
  entire span. Rewritten: a real ascending ramp, a flat crest, a real descending ramp —
  derived from and verified against this project's own established Roadmap Phase 11
  rail-shape rule. **Minimum length is `2×height + 3`, not `+1`**, because a single rail
  block cannot be the peak of both an up-ramp and a down-ramp at once — a genuine flat
  crest block is mandatory. Separately: full support columns are now built only at piers
  (index 0, the last index, every 4th index by default) instead of every position — a
  real, measured block-count and performance improvement, not just a visual one. Full
  derivation: ARCHITECTURE.md §46.2.
- **Fixed: bridge material is now player-chosen, not fixed.** New
  `InventoryManager.scanPlaceableMaterials()` (probes `BlockPermutation.resolve()` to
  determine placeability — confirmed, already-relied-upon API behavior, not a new
  assumption), new `BuildMenu.promptForBridgeMaterial()` screen, threaded through
  `BuildRequest.bridgeMaterialId` → `BuildSession` → `BridgeExecutionStrategy`/
  `InventoryStage`. Player never enters a quantity; the addon calculates it from the
  plan. Zero placeable materials stops the flow with a clear message before showing an
  empty form. ARCHITECTURE.md §46.6.
- **Fixed: Underground Mode's tunnel could end in a flush wall.** Root cause: excavation
  stopped dead at the last requested position with no verification of what came next.
  `planUnderground()` now reserves one extra full-clearance landing position past the
  last rail (best-effort, never fails the plan). NORMAL mode's separate hill-tunnel
  system was reviewed and found NOT to have this defect — it's architecturally
  guaranteed to always end at a position already confirmed open. ARCHITECTURE.md §46.3.
- **Fixed: new railways could silently destroy existing rails where they crossed.** Root
  cause: `RailPermutationBuilder.js` always force-computes a rail's shape from the new
  build's own direction alone, with no check for what already occupied that block. New
  `config/RailConfig.js` export `RAIL_ITEM_ID_SET`; a two-sided fix applied to all three
  modes — scanning/planning treats an existing rail as clear (not an obstruction), and
  every execution strategy (`StraightRailStrategy`/`BridgeExecutionStrategy`/
  `UndergroundExecutionStrategy`) leaves an existing rail completely untouched at
  placement time rather than overwriting it. ARCHITECTURE.md §46.5.
- **Changed: Underground Mode's maximum depth, 64 → 20.** One number, one place
  (`BUILD_MODE_REGISTRY.UNDERGROUND.max`) — every other bound already read from it. Also
  means the `length >= depth + 1` geometric constraint is rarely the binding one anymore
  at the new, shallower maximum. ARCHITECTURE.md §46.4.
- **A real bug found and fixed in the shipped code itself, by cross-checking rather than
  a test run:** after reshaping `deckPositions` for slope-aware rail placement, a grep
  for the old shape found one missed logging line in `TerrainScanningStage.js` that
  would have silently logged `undefined`. Fixed before any test touched it.
- **Files created:** none beyond what's already listed above (`RAIL_ITEM_ID_SET` lives
  in the existing `config/RailConfig.js`; material scanning lives in the existing
  `inventory/InventoryManager.js`).
- **Files substantially modified:** `terrain/TerrainScanner.js` (`planBridge()`
  rewritten, `planUnderground()`'s excavation loop and landing buffer, `_scanPosition()`'s
  rail-crossing check), `terrain/BridgePlan.js`/`terrain/BridgeValidation.js` (new plan
  shape, new elevation-profile validation), `builder/strategies/BridgeExecutionStrategy.js`
  (slope-aware placement, player material, crossing protection), `builder/strategies/
  StraightRailStrategy.js`/`UndergroundExecutionStrategy.js` (crossing protection),
  `config/BridgeConfig.js` (pier/clearance constants, material now a fallback only),
  `config/BuildModes.js` (underground max), `core/BuildRequest.js`/`core/BuildSession.js`
  (`bridgeMaterialId`), `ui/BuildMenu.js` (new material screen, updated summary),
  `core/pipeline/stages/BuildRequestCreationStage.js` (material screen orchestration),
  `core/pipeline/stages/InventoryStage.js`/`TerrainScanningStage.js` (player material,
  new rejection reason), `main.js` (wiring).
- **Validation:** 26 + 20 + 32 = 78 new assertions across three suites, all passing —
  full detail, including two real mistakes caught in the TESTS themselves (not the
  shipped code) and fixed before being trusted, in ARCHITECTURE.md §46.10. `node --check`
  clean across all 73 files. 77 localization keys verified 1:1 against `en_US.lang`, no
  duplicates or orphans.
- **Not yet confirmed in-game.**

### Project Prompt 18 — Underwater Railway & Water-Safe Construction
- **Added: new `terrain/WaterDetector.js`** — the shared water-detection primitives
  every mode's water handling is built from (`hasLiquidAbove`, `isSourceBlock`,
  `perpendicularOffsets`, `findLateralSealPositions`), mirroring `GapAnalyzer.js`'s/
  `BridgeDetector.js`'s established "detection only, reuse `readBlock`" pattern.
  ARCHITECTURE.md §47.2.
- **Normal Mode now safely builds through shallow water.** A single layer of water over
  solid ground (`FLAT_SAFE`, `isUnderwater: true`) is buildable — the rail simply
  displaces the water block, no execution-side change needed. Water stacked any deeper,
  or a drop into a body of water with no floor (reusing `GapAnalyzer`'s existing
  `WATER_CROSSING` gap type, wired to a message for the first time), rejects with a new,
  specific `WATER_CROSSING_UNSAFE` reason naming Bridge/Underground Mode as the
  alternative. ARCHITECTURE.md §47.3, §47.5.
- **Bridge Mode now passes over water instead of rejecting a wet deck/headroom.**
  `planBridge()`'s liquid checks now fold into "clear" rather than reject —
  `BridgeExecutionStrategy`'s own execution-time re-check was found and fixed to match
  (it would otherwise have halted a now-valid plan mid-build). Piers already correctly
  rose through water to real ground (Project Prompt 16); that part needed no change.
  `BridgeRejectionReason.BLOCKED_BY_LIQUID` is no longer produced, kept as a documented,
  unreachable value. ARCHITECTURE.md §47.4.
- **Underground Mode now waterproofs a tunnel instead of rejecting or flooding it.**
  Corridor water is excavated and its lateral/roof faces sealed with a thin,
  free-of-charge solid lining (new `TunnelExcavator.sealPositions()`,
  `UNDERGROUND_CONFIG.SEAL_BLOCK_ID`) — never a massive structure. A liquid FLOOR is
  still correctly rejected outright (sealing doesn't fabricate a floor over nothing).
  Fixed a real gap along the way: `TunnelExcavator.excavateRow()` unconditionally
  rejected any liquid — added an explicit, opt-in `allowLiquid` parameter (default off,
  so Normal Mode's unrelated hill-tunnels are completely unaffected) used only by
  Underground's own corridor excavation. Lava remains fully protected in every mode,
  unconditionally, regardless of these changes. ARCHITECTURE.md §47.6.
- **`TerrainClassification.LIQUID` is reserved, not deleted** — no longer produced
  directly, kept for defensive symmetry with `PathValidator`'s/`PathCategory`'s existing
  unrecognized-classification fallbacks. ARCHITECTURE.md §47.7.
- **Files created:** `terrain/WaterDetector.js`; `tests/mockWorld.mjs`,
  `tests/water.test.mjs`, `tests/README.md` (this project's first committed, executable
  test harness — see ARCHITECTURE.md §47.11 for why this closes a gap flagged across
  multiple prior sessions).
- **Files modified:** `terrain/TerrainScanner.js` (`_scanPosition()`'s water
  classification, `_resolveSteppedPosition()`'s new terminal case, `planBridge()`'s/
  `planUnderground()`'s water handling, new `underwaterCount`/`totalSealCount` summary
  fields), `terrain/TerrainClassification.js` (`LIQUID` doc), `terrain/PathValidator.js`
  (new `WATER_CROSSING_UNSAFE` reason), `terrain/UndergroundPlan.js`/
  `UndergroundValidation.js` (`sealPositions` field + check), `config/UndergroundConfig.js`
  (`SEAL_BLOCK_ID`), `builder/TunnelExcavator.js` (`sealPositions()` method, `allowLiquid`
  option), `builder/strategies/UndergroundExecutionStrategy.js` (seal placement, passes
  `allowLiquid: true`), `builder/strategies/BridgeExecutionStrategy.js` (water-tolerant
  re-check), `core/pipeline/stages/TerrainScanningStage.js` (log lines),
  `localization/LocalizationKeys.js` + `en_US.lang` (new key, two corrected messages
  whose old wording no longer matched reality), `config/Constants.js` + both manifests
  (version 0.1.10 → 0.1.11).
- **Validation:** new 55-assertion Node test suite (`tests/water.test.mjs`), all passing
  — full detail, including two real bugs this process caught and fixed before shipping
  (a missing terminal case in `_resolveSteppedPosition()`, and `TunnelExcavator`'s
  unconditional liquid rejection), in ARCHITECTURE.md §47.11. `node --check` clean
  across every script file.
- **Not yet confirmed in-game.**

### Project Prompt 19 — Smart Terrain Adaptation & Rail Connectivity
- **Reviewed, not rewritten:** one-block slopes, existing-rail preservation across all
  crossing geometries (parallel/perpendicular/T-junction/different types/two generated
  railways meeting), strict per-request mode isolation, and rail-placement-order
  independence were all confirmed already correct against the actual implementation —
  see ARCHITECTURE.md §48.1/§48.4/§48.5/§48.6 for the full trace, including why "never
  touch an existing rail's own shape" is the only generally-safe policy for every
  crossing geometry, not a simplification.
- **Added: Normal Mode gives a specific "unbreakable terrain" message** for an
  unbreakable block sitting directly at the rail's own spot over otherwise-solid
  ground — previously folded into the generic "too steep" message. Reuses the same
  `unsupportedReason: "UNBREAKABLE"` string TunnelDetector's own failure path already
  produced; no new `PathValidator` table entry needed. ARCHITECTURE.md §48.2.
- **Added: Available clearance (Section 1's "Smart Terrain Analysis").** Normal Mode
  now also checks the block directly above the rail's own spot (`_checkHeadroom()`),
  rejecting with a new, specific `"LOW_CLEARANCE"` reason if it's blocked — previously
  a rail could be planned directly beneath a 1-block-low overhang with no warning.
  Neither new check short-circuits the existing ascend/tunnel fallback (a real "climb
  over it" solution is tried first, same as a careful player would) — see
  ARCHITECTURE.md §48.2 for why, including the mistaken test expectation this session's
  own harness caught and corrected before it was trusted.
- **Added: `TerrainPositionFact.isExistingRail`** — an explicit, named field for a
  decision (`RAIL_ITEM_ID_SET.has(aboveBlockId)`) that already existed inline; purely
  informational, no behavior changed. ARCHITECTURE.md §48.3.
- **Added: a test-only `@minecraft/server` mock** (`node_modules/@minecraft/server/`)
  and `tests/mockPlayer.mjs` — unlocks testing every EXECUTION-side class for the first
  time (strategies, `TunnelExcavator`, `BridgeSupportBuilder`, `RailBuilder`,
  `CancellationWatcher`, `InventoryManager`, `ResourceValidator`), none of which had
  ever been run by an automated test before this session. Never bundled into the
  shipped `.mcaddon` — see `tests/README.md`.
- **Fixed a real bug in the test harness's own mock world**, found by the first
  execution-level tests: `tests/mockWorld.mjs`'s `Dimension.getBlock()` returned a
  brand-new object every call, so a `setPermutation()` mutation was silently discarded
  — harmless for Project Prompt 18's planning-only tests, but a false negative waiting
  to happen for anything that writes to the world. Fixed by making the mock's block
  store a persistent `Map`. ARCHITECTURE.md §48.7.
- **Files created:** `tests/terrain.test.mjs` (66 assertions), `tests/execution.test.mjs`
  (39 assertions), `tests/mockPlayer.mjs`, `node_modules/@minecraft/server/package.json`
  + `index.js`.
- **Files modified:** `terrain/TerrainScanner.js` (`_scanPosition()`'s two new checks,
  `_checkHeadroom()`), `terrain/PathValidator.js` (`LOW_CLEARANCE` reason),
  `localization/LocalizationKeys.js` + `en_US.lang` (new key, two corrected messages
  whose old wording no longer matched reality), `tests/mockWorld.mjs` (stateful block
  store, real `setPermutation()`), `config/Constants.js` + both manifests (version
  0.1.11 → 0.1.12).
- **Validation:** 160 assertions across 3 test files (55 unchanged from Project Prompt
  18, 66 + 39 new), all passing. `node --check` clean across every script file. Full
  detail, including the real bugs this process found and fixed (in both the shipped
  code and the test harness itself) before being trusted, in ARCHITECTURE.md §48.11.
- **Not yet confirmed in-game.**

### Project Prompt 20 — Pre-Prompt-21 Integration Test (Full Integration, Stability & Real-World Test Build)
- **Full architecture/integration review, no new features.** Read every remaining
  script file in the addon not already reviewed by Project Prompts 18-19 — `main.js`'s
  dependency graph, `BuildPipeline.js`, every pipeline stage, every validator,
  `ui/BuildMenu.js`, the tunnel-detection subsystem, and every small utility file.
  Confirmed the pipeline wiring (`RailDetectionStage` → ... → `CompletionStage`)
  matches the architecture exactly — no stage bypasses its role, no module boundary
  needed moving. ARCHITECTURE.md §49.1/§49.3.
- **Fixed: `TunnelPlanner.js`'s `TerrainPositionFact` was missing 3 fields**
  (`isExistingRail`/`isUnderwater`/`waterInfo`) added to the OTHER fact-producer
  (`TerrainScanner._scanPosition()`) across Project Prompts 18-19 — harmless in
  practice, but a real shape inconsistency between the codebase's two producers of
  this type. Fixed, with a new regression test. ARCHITECTURE.md §49.2.
- **Fixed: a stale doc comment** in `RequestLifecycleState.js` (`COMPLETED` marked "not
  reachable" for ten sessions after it became reachable in Project Prompt 10) and
  **removed `utils/NotImplemented.js`**, confirmed fully dead code (zero remaining call
  sites — every stub it was written for has been implemented since Project Prompt 3).
  ARCHITECTURE.md §49.2.
- **Added: `tests/integration.test.mjs`** — builds the exact same dependency graph
  `main.js` constructs and runs the real `BuildPipeline` end to end (NORMAL/BRIDGE/
  UNDERGROUND builds, 4 rejection paths, a 2-player multiplayer scenario), with only
  `ui/BuildMenu.js` substituted for a scripted stub. The first test in this project to
  verify the WIRING itself, not just individual pieces. Two real bugs in the test's own
  first draft (wrong assumed block coordinates; under-provisioned mock terrain/
  inventory) were found and fixed before being trusted. ARCHITECTURE.md §49.4.
- **UI and error-message review**: `ui/BuildMenu.js`'s full 4-screen flow and every
  player-facing rejection message re-read against `en_US.lang` — confirmed plain-
  language, no stray unfilled placeholders, 0 missing/orphaned localization keys.
  ARCHITECTURE.md §49.7.
- **Files created:** `tests/integration.test.mjs`.
- **Files modified:** `terrain/TunnelPlanner.js` (fact-shape fix),
  `core/pipeline/RequestLifecycleState.js` (stale comment fix), `tests/mockPlayer.mjs`
  (`isValid`/`dimension`/`sendMessage`/`onScreenDisplay` support for full-pipeline
  testing), `tests/terrain.test.mjs` (new regression assertions), `config/Constants.js`
  + both manifests (version 0.1.12 → 0.1.13).
- **Files removed:** `utils/NotImplemented.js` (dead code).
- **Packaged a new, testable `.mcaddon`** — version 0.1.13, structure verified
  (manifests valid, both `.mcpack` archives correctly rooted, `.mcaddon` contains
  exactly the 2 expected `.mcpack` files).
- **Validation:** 191 assertions across 4 test files (55 + 68 + 39 unchanged/incremented,
  29 new), all passing. `node --check` clean across every script file (73, one fewer
  than before this session). Full detail in ARCHITECTURE.md §49.9.
- **Not yet confirmed in-game** — this session's own instructions were explicit that
  claiming otherwise without an actual Minecraft launch would be dishonest; none of
  this project's 20 sessions has been play-tested by a human.

### Project Prompt 21 — Polished Mobile UI & Build Configuration — 2026-08-31

- **Fixed: three player-facing messages had gone factually stale.** `menu.modeBody` and
  `path.rejected.tooSteep` both still claimed Bridge/Underground construction was
  "coming in a future update" — false since Project Prompts 16-17. Rewritten to
  accurately describe all three modes as real, and to point players at Bridge/
  Underground as genuine alternatives when Normal Mode's terrain is too steep.
  `path.rejected.bridgeBlockedLiquid` (confirmed unreachable dead text) was also
  corrected. ARCHITECTURE.md §50.2.
- **Unified terminology**: "Rail Length"/"Bridge Height"/"Underground Depth" slider
  labels trimmed to the bare canonical terms ("Length"/"Height"/"Depth") the prompt's
  Accessibility requirement names explicitly — the mode is already shown one line above
  on every screen that matters, so the longer form was pure redundancy. The two
  validation messages keep the prompt's own literal fuller wording ("Bridge height must
  be between...") since a rejection popup is where naming the specific measurement is
  worth it. ARCHITECTURE.md §50.3.
- **Validation messages rewritten to "Required: X / Available: Y"** format (rails, and
  now the bridge material insufficiency message too, which also names the material):
  `Not enough rails.\nRequired: 20\nAvailable: 12` / `Not enough Stone Bricks.\nRequired:
  84\nAvailable: 60`. `inventory/ResourceValidator.js`'s substitutions changed from a
  single `[missingQuantity]` to `[requiredQuantity, totalAvailable]`.
  `InventoryStage._executeBridgeCheck()` now builds its own substitutions array
  prepending the material's display name. ARCHITECTURE.md §50.4.
- **Added: `utils/BlockDisplayName.js`** — a shared "minecraft:stone_bricks" → "Stone
  Bricks" formatter, extracted from a private duplicate inside `ui/BuildMenu.js`, now
  used by both that file's material screen/summary and the new bridge-material
  rejection message. ARCHITECTURE.md §50.5.
- **Build summary now shows "Required Rails"** pre-confirmation (all three modes, using
  the already-known requested length — no new world scan) and reveals the real Bridge
  Mode material quantity honestly in a new post-confirmation chat message, sent once
  `InventoryStage` confirms the player has enough (i.e., after the real terrain scan has
  already run) — rather than fabricating a number before it's genuinely known, which
  would have required scanning the whole route just to draw a form. ARCHITECTURE.md
  §50.6/§50.8.
- **Confirmed, not changed**: Bridge Height (1-16) and Underground Depth (1-20) were
  already structurally impossible to set out of range — the `ModalFormData` slider is
  built directly from `config/BuildModes.js`'s registry bounds, and a Bedrock slider
  cannot report a value outside its own declared range. ARCHITECTURE.md §50.7.
- **Added: `node_modules/@minecraft/server-ui` test mock** and **`tests/uiMenu.test.mjs`**
  (25 new assertions) — closes the one gap flagged in every session's tests/README.md
  since Project Prompt 18. Covers mode-screen button order/cancellation, the physical
  impossibility of an out-of-range Height/Depth value, NORMAL mode's single-field
  config screen, BRIDGE mode's two-field mapping, the material screen's selection
  mapping, the summary screen's three distinct outcomes (Build/Cancel/closed), and
  genuine concurrent multiplayer isolation. ARCHITECTURE.md §50.9.
- **Files created:** `BP/scripts/utils/BlockDisplayName.js`,
  `node_modules/@minecraft/server-ui/package.json`,
  `node_modules/@minecraft/server-ui/index.js`, `tests/uiMenu.test.mjs`.
- **Files modified:** `RP/texts/en_US.lang` (11 lines rewritten, 2 new lines added),
  `BP/scripts/localization/LocalizationKeys.js` (2 new keys),
  `BP/scripts/inventory/ResourceValidator.js` (richer substitutions),
  `BP/scripts/core/pipeline/stages/InventoryStage.js` (material-name-prefixed rejection
  message, new post-check chat summaries), `BP/scripts/ui/BuildMenu.js` (shared
  formatter import, private duplicate removed), `tests/README.md` (new mock/suite
  documented), `config/Constants.js` + both manifests (version 0.1.13 → 0.1.14).
- **Packaged a new, testable `.mcaddon`** — version 0.1.14, structure verified
  (manifests valid, all three version references agree, both `.mcpack` archives
  correctly rooted, `.mcaddon` contains exactly the 2 expected `.mcpack` files).
- **Validation:** 216 assertions across 5 test files (191 unchanged + 25 new), all
  passing. `node --check` clean across every modified script file. Full detail in
  ARCHITECTURE.md §50.12.
- **Not yet confirmed in-game** — this session's own instructions were explicit that
  claiming otherwise without an actual Minecraft launch would be dishonest; none of
  this project's 21 sessions has been play-tested by a human.

### Project Prompt 22 — Smart Build Preview, Validation & Safety — 2026-08-31

- **Added: `core/BuildPlan.js`** — the complete, consolidated build plan (rail type, mode,
  direction, length, start/end position, rail positions, terrain info, bridge/underground
  specifics, required rails/material, and a world modification boundary) Project Prompt 22
  asked for, assembled entirely from data the pipeline had already computed — no new terrain
  scan, no new planning call. ARCHITECTURE.md §51.3.
- **Added: `core/pipeline/stages/BuildPlanStage.js`** — new pipeline stage, running
  immediately after `FinalSafetyCheckStage` and before `PlacementStage`. Closes the one real
  remaining async-staleness gap: re-checks player validity, dimension, held item, and a fresh
  inventory read immediately before construction — everything else Project Prompt 22 §10
  asked to revalidate (length/mode/height/depth) needs no re-check, since `BuildRequest` is
  immutable once created. Any failure here means zero blocks placed. ARCHITECTURE.md §51.7.
- **Added: `core/ActiveBuildRegistry.js`** — a new multiplayer safety net. `PlacementStage`
  now claims a build's exact modification boundary before placing anything; a second
  player's overlapping build is rejected outright (`RAIL_CONFLICT`, zero blocks placed)
  rather than silently corrupting the first player's railway. Race-free by construction — the
  check-and-claim happens synchronously, before the one `await` in `PlacementStage.execute()`.
  ARCHITECTURE.md §51.6.
- **Added: `config/ValidationErrorCategory.js`** — maps every existing internal rejection
  reason (across every validator, `PathRejectionReason`, `BridgeRejectionReason`,
  `UndergroundRejectionReason`, `ResourceValidator`) onto the prompt's 13 named error
  categories, without renaming or replacing any existing player-facing message.
  ARCHITECTURE.md §51.11.
- **Added: a "STATUS: CANNOT BUILD" chat prefix** (`core/BuildOrchestrator.js`), sent once
  before the specific reason for every outcome that means zero world modification —
  deliberately not sent for a partial `PLACEMENT_INCOMPLETE` stop (some rails were kept) or a
  menu-close cancellation. ARCHITECTURE.md §51.11.
- **Fixed: `inventory/ResourceValidator.js` always reported `"INSUFFICIENT_RAILS"`** even
  when checking bridge material — a real, found inconsistency, harmless to players (the
  correct `.lang` message was still selected by the caller) but misleading to anything
  inspecting the reason string. Now takes an optional `resourceKind` ("RAILS"/"MATERIAL"),
  defaulting to the previous behavior for every pre-existing call site. ARCHITECTURE.md §51.2.
- **Confirmed, not changed**: terrain/mode-specific validation (§3/§4) and existing-rail
  protection (§6) were already fully implemented across `TerrainScanner`/`PathValidator`/
  `BridgeValidation`/`UndergroundValidation` and `RAIL_ITEM_ID_SET`'s preservation logic —
  re-verified, not re-implemented. ARCHITECTURE.md §51.5.
- **Added: `tests/buildPlanSafety.test.mjs`** (59 new assertions) — `BuildPlan` field
  assembly and boundary correctness (including a real overlap-deduplication proof for
  Underground Mode) for all three modes; `ActiveBuildRegistry` claim/conflict/release;
  `BuildPlanStage`'s four rejection paths; `PlacementStage`'s `RAIL_CONFLICT` rejection with a
  throwing stub proving placement is never attempted; `ValidationErrorCategory.categorize()`;
  and the new chat-message ordering. ARCHITECTURE.md §51.9.
- **Files created:** `BP/scripts/core/BuildPlan.js`, `BP/scripts/core/ActiveBuildRegistry.js`,
  `BP/scripts/core/pipeline/stages/BuildPlanStage.js`,
  `BP/scripts/config/ValidationErrorCategory.js`, `BP/scripts/utils/PositionKey.js`,
  `tests/buildPlanSafety.test.mjs`.
- **Files modified:** `BP/scripts/inventory/ResourceValidator.js`,
  `BP/scripts/core/pipeline/stages/InventoryStage.js` (resourceKind passed explicitly),
  `BP/scripts/core/pipeline/stages/PlacementStage.js` (claim/release, RAIL_CONFLICT),
  `BP/scripts/core/pipeline/PipelineContext.js` (new `buildPlan` field),
  `BP/scripts/core/pipeline/PipelineOutcome.js` (RAIL_CONFLICT/BuildPlanStage
  classification), `BP/scripts/core/BuildOrchestrator.js` (STATUS_CANNOT_BUILD prefix,
  one stale comment fixed), `BP/scripts/localization/LocalizationKeys.js` +
  `RP/texts/en_US.lang` (3 new keys), `BP/scripts/main.js` (pipeline wiring),
  `BP/scripts/core/pipeline/BuildPipeline.js` (lifecycle state entry),
  `tests/integration.test.mjs` + `tests/mockPlayer.mjs` + `tests/mockWorld.mjs` (mirrored
  wiring, new `setHeldItem()`/`setDimension()`/dimension `id`), `tests/README.md`,
  `config/Constants.js` + both manifests (version 0.1.14 → 0.1.15).
- **Packaged a new, testable `.mcaddon`** — version 0.1.15, structure verified (manifests
  valid, all three version references agree, both `.mcpack` archives correctly rooted,
  `.mcaddon` contains exactly the 2 expected `.mcpack` files).
- **Validation:** 275 assertions across 6 test files (216 unchanged + 59 new), all passing.
  `node --check` clean across all 79 script files. Full detail in ARCHITECTURE.md §51.14.
- **Not yet confirmed in-game** — this session's own instructions were explicit that
  claiming otherwise without an actual Minecraft launch would be dishonest; none of
  this project's 22 sessions has been play-tested by a human.

### Project Prompt 23 — Performance, Stability & Long-Build Optimization — 2026-08-31

- **Added: `InventoryManager.hasAtLeast(player, typeId, minimumAmount)`** — replaces four
  full-container inventory scans (one per per-block "do I still have enough" re-check across
  `StraightRailStrategy`, `BridgeExecutionStrategy` (rails and material), and
  `UndergroundExecutionStrategy`) with an early-exit threshold check. Same live, uncached read
  guarantee as before — never sacrifices transaction safety — just less iteration in the
  common case. ARCHITECTURE.md §52.2.
- **Added: practical performance metrics** to `CompletionStage`'s existing single completion
  log line — planning duration, construction duration, required rails/material, and positions
  modified, via one new `PipelineContext.createdAt` field. Still exactly one `INFO` line per
  completed build, silenced the same way any other log line already is. ARCHITECTURE.md §52.3.
- **Confirmed sound, not rewritten**: `system.runJob` generator pacing, terrain caching inside
  `BuildPlan` (already done, Project Prompt 22), block-write minimization (already correct by
  construction — excavation already skips already-clear blocks; bridge/underground fill
  positions are pre-filtered at planning time), `BuildPlan`'s memory footprint (measured at a
  maximum of 161 positions for the heaviest realistic build), and the project's API surface
  (no deprecated calls, no unhandled promises, no unbounded loops). ARCHITECTURE.md §52.4-§52.7.
- **Added: `tests/performanceStability.test.mjs`** (44 new assertions) — proves mid-construction
  cancellation actually stops a strategy's generator promptly with the correct partial state,
  for ALL THREE modes (previously only proven for `CancellationWatcher`'s own flag-setting);
  job lifecycle (a fresh build starts cleanly immediately after a previous one completes or is
  cancelled); the project's real 64-length ceiling succeeding for all three modes (respected,
  not raised, per this session's own instruction); and a 3-player simultaneous load test. A
  real bug in this test file's own first draft (a helper silently discarding `bridgeMaterialId`
  because it didn't forward `buildingMode`) was found and fixed before being trusted.
  ARCHITECTURE.md §52.8.
- **Performance measured directly** (Node-harness timing, explicitly not real Minecraft tick
  timing): every pipeline stage's cost stays flat as build size grows across the whole tested
  range (length up to 64, height up to 16, depth up to 20) — no algorithmic blowup found or
  introduced. ARCHITECTURE.md §52.9.
- **Files created:** `tests/performanceStability.test.mjs`.
- **Files modified:** `BP/scripts/inventory/InventoryManager.js` (new `hasAtLeast()`),
  `BP/scripts/builder/strategies/StraightRailStrategy.js` +
  `BP/scripts/builder/strategies/BridgeExecutionStrategy.js` +
  `BP/scripts/builder/strategies/UndergroundExecutionStrategy.js` (all 4 call sites switched
  to `hasAtLeast()`), `BP/scripts/core/pipeline/PipelineContext.js` (new `createdAt` field),
  `BP/scripts/core/pipeline/stages/CompletionStage.js` (metrics logging), `tests/README.md`,
  `config/Constants.js` + both manifests (version 0.1.15 → 0.1.16).
- **Packaged a new, testable `.mcaddon`** — version 0.1.16, structure verified (manifests
  valid, all three version references agree, both `.mcpack` archives correctly rooted,
  `.mcaddon` contains exactly the 2 expected `.mcpack` files).
- **Validation:** 319 assertions across 7 test files (275 unchanged + 44 new), all passing.
  `node --check` clean across all 79 script files. Full detail in ARCHITECTURE.md §52.11.
- **Not yet confirmed in-game** — this session's own instructions were explicit that
  claiming otherwise without an actual Minecraft launch would be dishonest; none of
  this project's 23 sessions has been play-tested by a human.

### Project Prompt 24 — Advanced Railway Routing & Terrain Intelligence — 2026-08-31

- **Added: player-structure protection.** `config/UnbreakableBlockRegistry.js` gained
  `PROTECTED_STRUCTURE_BLOCK_IDS` (chests, crafting/utility stations, doors/trapdoors, beds,
  signs, item frames, and similar deliberate-construction blocks), unioned into the same
  `UNBREAKABLE_BLOCK_ID_SET` every routing consumer already treats as "never plan to break
  this, reject the route instead" — every mode now protects a player's chest/furnace/door/bed
  exactly like bedrock, with zero changes to `TerrainScanner`/`TunnelDetector`/
  `TunnelExcavator`/`BridgeSupportBuilder`/`InventoryManager` themselves. ARCHITECTURE.md
  §53.2.
- **Fixed: three "unbreakable block" rejection messages** that previously said "bedrock or
  similar," which would have been actively misleading for a protected structure (a chest IS
  breakable in vanilla; this addon simply chooses never to break it) — reworded to be
  accurate for both cases.
- **Added: two real terrain-transition test gaps closed** — "Depression → Flat" and a
  descending staircase, both explicitly asked for by this session and empirically verified
  against the real, unmodified `TerrainScanner` rather than assumed symmetric with their
  already-tested ascending equivalents (`tests/terrain.test.mjs`, +10 assertions).
  ARCHITECTURE.md §53.3.
- **Added: `tests/structureProtection.test.mjs`** (14 new assertions) — proves the new
  protection across all three modes (a chest at the rail's own spot, in an excavation volume,
  and on a bridge deck position all reject the route with the block untouched) plus that a
  held chest is never offered as bridge material.
- **Confirmed sound, not rewritten** (reviewed against the full §1-§17 checklist, only real
  findings acted on): Normal Mode terrain following and transitions, steep-terrain rejection
  (structurally guaranteed by `buildingMode` being fixed on the immutable `BuildRequest`),
  Bridge/Underground routing and support intelligence, lava-first hazard ordering, existing-rail
  preservation (re-tested via the full regression suite), player intent (no pathfinding exists
  anywhere in the codebase), performance, and multiplayer isolation. ARCHITECTURE.md
  §53.4-§53.6.
- **Files created:** `tests/structureProtection.test.mjs`.
- **Files modified:** `BP/scripts/config/UnbreakableBlockRegistry.js` (new
  `PROTECTED_STRUCTURE_BLOCK_IDS`/`PROTECTED_STRUCTURE_BLOCK_ID_SET`, unioned into
  `UNBREAKABLE_BLOCK_ID_SET`), `RP/texts/en_US.lang` (3 messages reworded),
  `tests/terrain.test.mjs` (2 new test blocks), `config/Constants.js` + both manifests
  (version 0.1.16 → 0.1.17).
- **Packaged a new, testable `.mcaddon`** — version 0.1.17, structure verified (manifests
  valid, all three version references agree, both `.mcpack` archives correctly rooted,
  `.mcaddon` contains exactly the 2 expected `.mcpack` files).
- **Validation:** 343 assertions across 8 test files (319 unchanged + 10 new in
  `terrain.test.mjs` + 14 new in `structureProtection.test.mjs`), all passing. `node --check`
  clean across all 79 script files. Full detail in ARCHITECTURE.md §53.8.
- **Not yet confirmed in-game** — this session's own instructions were explicit that
  claiming otherwise without an actual Minecraft launch would be dishonest; none of
  this project's 24 sessions has been play-tested by a human.

### Project Prompt 25 — Professional Railway Construction & Feature Integration — 2026-08-31

- **No production code changed.** A construction-quality audit against the full §1-§22
  checklist found no new bugs — everything asked for was already correct, built across 24
  prior sessions. Five real test-coverage gaps were closed instead, each empirically proving
  a claim this project's own docs had only ever asserted, not verified by name.
- **Added: a direct regression proof for the Underground tunnel's terminal landing buffer**
  (the historically-reported "one-block space that cannot be passed through" bug) — an
  ordinary build now asserts `landingExcavationPositions` is genuinely non-empty and matches
  full tunnel clearance, not just documented as fixed. ARCHITECTURE.md §54.2.
- **Added: a direct regression proof that both bridge endpoints anchor to real ground** — a
  bridge whose deck sits well above natural terrain now asserts a real support column exists
  at both the starting and ending pier column, not just at "some point along the crossing."
  ARCHITECTURE.md §54.3.
- **Added: post-construction verification that the actual world matches `context.buildPlan`**
  for full BRIDGE and UNDERGROUND pipeline runs — every rail position holds a rail, every
  bridge support/surface position holds the chosen material, every excavated position was
  actually cleared. Scoped entirely to the plan's own position lists, no full-world scan.
  ARCHITECTURE.md §54.4.
- **Added: a full-pipeline rail-type-preservation proof** — a complete BRIDGE build holding a
  powered rail (`minecraft:golden_rail`) confirms every placed rail is genuinely the held
  type, never silently substituted with plain rail; every prior full-pipeline test had only
  ever used the default rail type. ARCHITECTURE.md §54.5.
- **Confirmed sound, not rewritten** (reviewed against the full checklist, only real findings
  acted on): construction quality/no duplicate rails, all terrain transitions, bridge material
  consistency, bridge supports over uneven terrain/water, lava safety, existing-rail
  preservation, resource transactions, partial-build policy, multiplayer isolation,
  performance, error handling, and UI. ARCHITECTURE.md §54.6.
- **Files modified:** `tests/terrain.test.mjs` (+5 assertions), `tests/integration.test.mjs`
  (+8 assertions), `tests/README.md`, `config/Constants.js` + both manifests (version
  0.1.17 → 0.1.18).
- **Packaged a new, testable `.mcaddon`** — version 0.1.18, structure verified (manifests
  valid, all three version references agree, both `.mcpack` archives correctly rooted,
  `.mcaddon` contains exactly the 2 expected `.mcpack` files).
- **Validation:** 356 assertions across 8 test files (343 unchanged + 13 new), all passing.
  `node --check` clean across all 79 script files (unchanged — no production code touched).
  Full detail in ARCHITECTURE.md §54.8.
- **Not yet confirmed in-game** — this session's own instructions were explicit that
  claiming otherwise without an actual Minecraft launch would be dishonest; none of
  this project's 25 sessions has been play-tested by a human.

### Project Prompt 26 — Final Feature Integration & Advanced Railway Behavior — 2026-08-31

- **Established the remaining project schedule**, per Project Prompt 26's own explicit
  reframing: Prompt 27 (bug-fixing/compatibility/multiplayer/optimization pass), Prompt 28
  (release candidate), Prompt 29 (branding), Prompt 30 (final polish/packaging).
- **Found and closed a real, significant test-coverage gap: direction coverage.** Auditing
  every existing test file found that, across over 300 assertions spanning every prior
  session, essentially every terrain/bridge/underground test travels EAST exclusively — NORTH
  appears once, SOUTH and WEST never appear outside a single bare permutation lookup. This
  mattered specifically because `RailPermutationBuilder.js`'s own header flags the ascending
  `rail_direction` mapping as "the session's highest-risk assumption" in the project, and
  three of its four values had never been exercised by any test. ARCHITECTURE.md §55.2.
- **Added: `tests/directionCoverage.test.mjs`** (64 new assertions) — the ascending
  `rail_direction` mapping, flat-terrain scanning, one-block rises, Bridge Mode, and
  Underground Mode all re-verified for NORTH/SOUTH/EAST/WEST, computing expected coordinates
  from `DirectionUtils` itself rather than hardcoded numbers. All 64 assertions passed against
  the real, unmodified production code — a coverage gap, not a functional bug.
- **Confirmed sound, not rewritten** (reviewed against the full checklist, only real findings
  acted on): railway continuity/rail type consistency, start/end position handling, slope
  quality, bridge/underground transitions and structure, underwater railway, rail
  intersections, existing structures, resource transactions, interruption handling,
  multiplayer, conflict protection, UI, configuration validation, performance, and error
  messages. ARCHITECTURE.md §55.3.
- **Files created:** `tests/directionCoverage.test.mjs`.
- **Files modified:** `tests/README.md`, `docs/TODO.md` (item #7 updated to reflect the new
  internal-consistency proof), `config/Constants.js` + both manifests (version
  0.1.18 → 0.1.19).
- **Packaged a new, testable `.mcaddon`** — version 0.1.19, structure verified (manifests
  valid, all three version references agree, both `.mcpack` archives correctly rooted,
  `.mcaddon` contains exactly the 2 expected `.mcpack` files).
- **Validation:** 420 assertions across 9 test files (356 unchanged + 64 new), all passing.
  `node --check` clean across all 79 script files (no production code changed this session).
  Full detail in ARCHITECTURE.md §55.5.
- **Not yet confirmed in-game** — this session's own instructions were explicit that
  claiming otherwise without an actual Minecraft launch would be dishonest; none of
  this project's 26 sessions has been play-tested by a human.

## [2.0.0] — in progress

### v2 Step 1 — Crouch-to-open & v1.0.0 source sync — 2026-10-08
- Repository source synced to the shipped v1.0.0 packs (Project Prompts 27–30: claim-before-message
  fix, branding strings, pack icons, 1.0.0 manifests). The repo had stopped at 0.1.19.
- **Crouch-to-open:** the build menu now opens only when the player is crouching (sneaking) and uses
  a rail on a block. Standing players place rails one at a time exactly like vanilla — the addon no
  longer cancels that placement. Works with the touch-control sneak toggle too.
- New `core/InteractionGate.js` holds the decision (IGNORE / VANILLA / OPEN_MENU); `main.js` only
  acts on it. `INTERACTION.REQUIRE_SNEAK_TO_OPEN_MENU` in `config/Constants.js` restores the v1
  always-open behavior if set to `false`.
- One-time actionbar hint (`ryzenRailBuilder.actionbar.crouchHint`) the first time per session a
  player places a rail standing up; mode menu body gained a matching tip line.
- Tests: new `tests/interactionGate.test.mjs` (decision table, real `main.js` wiring, and a check that
  every `LocalizationKeys` value exists in `en_US.lang`). The test-only `@minecraft/server` mock gained
  `system.run` (queued, flushed by tests) and `world.beforeEvents.playerInteractWithBlock`.
- New v2 logo: pixel-style "SMART RAIL BUILDER" title over a sunset railway with a gold gear badge.
  Full size at `docs/logo.png` (1024×1024); 256×256 copies replace both `pack_icon.png`s. Drawn by
  `tools/make_logo.py` (Pillow) so it can be regenerated or tweaked.

### v2 Step 2 — Repeat last build, remembered settings, Undo last build — 2026-10-08
- `core/BuildJournal.js`: every block write a build makes goes through `journal.write()` (or the
  `writeBlock()` helper), which records the previous permutation, the placed typeId and the item
  refunded for it. All six write sites (three strategies, `TunnelExcavator.excavateRow/sealPositions`,
  `BridgeSupportBuilder.placeBlock`) are journaled; `BuildSession.journal` holds it.
- `core/BuildHistory.js` keeps each player's last journal (in memory); `PlacementStage` records it in
  its `finally`, so partial/cancelled builds are undoable.
- `core/UndoService.js` replays a journal newest-first via `system.runJob` (32 restores/tick), restoring
  only positions that still hold what the build placed, refunding only restored writes, and reporting
  restored/skipped counts. New `InventoryManager.giveItems()` (stacks by max size, drops overflow).
- `core/PlayerBuildSettings.js` remembers mode/length/height-or-depth/material per player (memory +
  `smart_rail_builder:last_build` dynamic property), re-validated on every read.
- `BuildMenu.promptForMode(player, {lastSettings, canUndo})` adds the Repeat and Undo buttons and returns
  `{action: MODE|REPEAT|UNDO}`; `promptForConfiguration` accepts `defaultModeValue`. With no options the
  screen is identical to v1.
- `BuildRequestCreationStage` handles Undo (runs it, ends the pipeline as CANCELLED/UNDO_PERFORMED) and
  Repeat (skips material if still carried, skips configuration, keeps the summary), and saves settings on
  confirm.
- Optimizations: cached rail permutations (`RailPermutationBuilder`), cached air permutation
  (`TunnelExcavator`).
- Tests: `tests/undoRepeat.test.mjs` (54 assertions: undo of Normal/Underground/Bridge restores the exact
  world and inventory, skip-and-no-double-refund, repeat flow, settings validation/persistence, real menu
  button mapping, journal failure safety) and `tests/realGraphV2.mjs` helper. Mocks: restorable block
  permutation snapshots, `ItemStack`, real-shaped `Container.addItem(itemStack)`.

### v2 Step 3 — Powered boosters, tunnel lights, inventory optimizations — 2026-10-08
- `config/ExtrasConfig.js` (spacing choices, booster/power/light block ids, `pickSpacing`),
  `core/ExtrasPlan.js` (pure `planExtras()`: booster indices + power positions under the rail; Underground
  light positions in the left wall at rail y+1, offset half a spacing), `builder/ExtrasBuilder.js`
  (`createExtrasState`, `prepareRail`, `bridgeSurfaceBlockFor`, `placeLight`; never fails a build,
  journals every write for undo).
- `BuildRequest` gains `boosterSpacing`/`lightSpacing` (unknown -> 0; lights Underground-only);
  `BuildPlan.extras` and its positions join `modificationBoundary`.
- Strategies: booster indices place the redstone block then a powered rail (Normal/Underground/Bridge
  deck, the bridge loop is now indexed); Bridge `_placeMaterial` puts the redstone block in as the surface
  block under booster rails; Underground places a light after each planned rail.
- `PlacementStage` attaches `session.extras` and reports boosters/lights placed (and why any were skipped).
- `BuildMenu`: booster dropdown (all modes) and light dropdown (Underground) after the sliders; summary
  body gains an extras line (rawtext) only when relevant. Repeat and remembered settings carry both
  spacings (`PlayerBuildSettings` fills defaults for older saves).
- Optimizations: `InventoryManager` slot hints for `hasAtLeast`/`deductRailItems` (163 vs 4,608 slot reads
  over 64 placements), cached `_isPlaceableBlock`, cached extras permutations, `LOGGING.MIN_LEVEL` INFO.
- Tests: `tests/extras.test.mjs` (131 assertions). Mocks: `ModalFormData.dropdown` with all-field
  `formValues` indexing. Step 2 expectations updated for the new saved fields.
