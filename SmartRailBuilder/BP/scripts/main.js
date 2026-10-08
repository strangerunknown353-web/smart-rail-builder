/**
 * main.js
 *
 * PURPOSE
 *   Script module entry point (see BP/manifest.json's "entry" field).
 *   Constructs the dependency graph once at pack load, then registers the
 *   one top-level event subscription that drives the whole addon.
 *
 * ROADMAP PHASE 3-7 SCOPE (Project Prompts 5-10)
 *   The dependency graph composes the full BuildPipeline — `FinalSafetyCheckStage`
 *   was inserted between `InventoryStage` and `PlacementStage` in Project
 *   Prompt 10 — and wires real implementations for every remaining stubbed
 *   dependency: `StraightRailStrategy`, `RailBuilder`, `ProgressReporter`,
 *   and `CancellationWatcher`, which is now actually initialized (see
 *   below). Project Prompt 10 was the first session actual rails were
 *   placed. See ARCHITECTURE.md §29 for the full review.
 *
 * ROADMAP PHASE 15 SCOPE (Project Prompt 15)
 *   Two new dependency-graph entries: `ModeConfigValidator` (into
 *   `validationManager`, after `LengthValidator`) and `ModeAvailabilityStage`
 *   (into `pipeline`, between `ValidationStage` and `TerrainScanningStage`)
 *   — see config/BuildModes.js, core/validation/ModeConfigValidator.js, and
 *   core/pipeline/stages/ModeAvailabilityStage.js. Both are additive: every
 *   existing stage/validator is unchanged, per this file's own "new
 *   behavior is a new constructor call and array entry" claim below, now
 *   exercised for the first time since it was written.
 *
 * ROADMAP PHASE 16 SCOPE (Project Prompt 16, this session)
 *   Bridge Mode's real construction engine: `BridgeExecutionStrategy` +
 *   `BridgeSupportBuilder` (new, mirroring `StraightRailStrategy`/
 *   `TunnelExcavator`'s existing relationship), `BridgeValidation` (now
 *   real — injected into `TerrainScanningStage`), and a `strategiesByMode`
 *   map replacing `RailBuilder`'s old single fixed strategy (see
 *   builder/RailBuilder.js and core/pipeline/stages/PlacementStage.js for
 *   why). `FinalSafetyCheckStage` also gained a `messageService` dependency
 *   (the "Verifying..." actionbar ping, BRIDGE mode only).
 *   `BuildModes.js`'s `BRIDGE.implemented` flag is now `true`.
 *
 * ROADMAP PHASE 17 SCOPE (Project Prompt 17, this session)
 *   Underground Mode's real excavation engine: `UndergroundExecutionStrategy`
 *   (a third `strategiesByMode` entry — no other wiring shape changed, which
 *   is the registry pattern working as intended) and `UndergroundValidation`
 *   (injected into `TerrainScanningStage` alongside `BridgeValidation`).
 *   `TunnelExcavator` is now constructed once and SHARED by
 *   `StraightRailStrategy` and `UndergroundExecutionStrategy` — it is
 *   stateless, and Underground Mode deliberately reuses it rather than
 *   duplicating excavation logic. `BuildModes.js`'s
 *   `UNDERGROUND.implemented` flag is now `true`, which means all three
 *   permanent modes are live and `ModeAvailabilityStage` no longer gates
 *   anything (kept in place, unchanged, for future modes).
 *
 * FUTURE EXTENSIONS
 *   - A new pipeline stage or validator is added here as one new
 *     constructor call and one array entry — no other file changes.
 */

import { system, world } from "@minecraft/server";

import { ADDON, INTERACTION } from "./config/Constants.js";
import { RAIL_ITEM_IDS } from "./config/RailConfig.js";
import { Logger } from "./utils/Logger.js";

import { BuildOrchestrator } from "./core/BuildOrchestrator.js";
import { CancellationWatcher } from "./core/CancellationWatcher.js";
import { InteractionGate, InteractionDecision } from "./core/InteractionGate.js";
import { LocalizationKeys } from "./localization/LocalizationKeys.js";

import { BuildPipeline } from "./core/pipeline/BuildPipeline.js";
import { RailDetectionStage } from "./core/pipeline/stages/RailDetectionStage.js";
import { BuildRequestCreationStage } from "./core/pipeline/stages/BuildRequestCreationStage.js";
import { ValidationStage } from "./core/pipeline/stages/ValidationStage.js";
import { ModeAvailabilityStage } from "./core/pipeline/stages/ModeAvailabilityStage.js";
import { TerrainScanningStage } from "./core/pipeline/stages/TerrainScanningStage.js";
import { InventoryStage } from "./core/pipeline/stages/InventoryStage.js";
import { FinalSafetyCheckStage } from "./core/pipeline/stages/FinalSafetyCheckStage.js";
import { BuildPlanStage } from "./core/pipeline/stages/BuildPlanStage.js";
import { PlacementStage } from "./core/pipeline/stages/PlacementStage.js";
import { CompletionStage } from "./core/pipeline/stages/CompletionStage.js";
import { ActiveBuildRegistry } from "./core/ActiveBuildRegistry.js";
import { BuildHistory } from "./core/BuildHistory.js";
import { UndoService } from "./core/UndoService.js";
import { PlayerBuildSettings } from "./core/PlayerBuildSettings.js";

import { ValidationManager } from "./core/validation/ValidationManager.js";
import { PlayerValidator } from "./core/validation/PlayerValidator.js";
import { GameModeValidator } from "./core/validation/GameModeValidator.js";
import { HeldItemValidator } from "./core/validation/HeldItemValidator.js";
import { DirectionValidator } from "./core/validation/DirectionValidator.js";
import { OriginValidator } from "./core/validation/OriginValidator.js";
import { LengthValidator } from "./core/validation/LengthValidator.js";
import { ModeConfigValidator } from "./core/validation/ModeConfigValidator.js";
import { PermissionValidator } from "./core/validation/PermissionValidator.js";
import { TerrainScanner } from "./terrain/TerrainScanner.js";
import { PathValidator } from "./terrain/PathValidator.js";

import { InventoryManager } from "./inventory/InventoryManager.js";
import { ResourceValidator } from "./inventory/ResourceValidator.js";

import { RailBuilder } from "./builder/RailBuilder.js";
import { StraightRailStrategy } from "./builder/strategies/StraightRailStrategy.js";
import { TunnelExcavator } from "./builder/TunnelExcavator.js";
import { BridgeExecutionStrategy } from "./builder/strategies/BridgeExecutionStrategy.js";
import { BridgeSupportBuilder } from "./builder/BridgeSupportBuilder.js";
import { BridgeValidation } from "./terrain/BridgeValidation.js";
import { UndergroundExecutionStrategy } from "./builder/strategies/UndergroundExecutionStrategy.js";
import { UndergroundValidation } from "./terrain/UndergroundValidation.js";
import { BuildingMode } from "./config/BuildModes.js";

import { BuildMenu } from "./ui/BuildMenu.js";
import { ProgressReporter } from "./ui/ProgressReporter.js";
import { MessageService } from "./ui/MessageService.js";

/**
 * Constructs the full object graph. Constructors only assign fields — no
 * stubbed classes remain as of Project Prompt 11 (PathValidator was the
 * last one), so this remains safe to run unconditionally at pack load.
 */
function buildDependencyGraph() {
  // --- Leaf services ---
  const terrainScanner = new TerrainScanner();
  const pathValidator = new PathValidator(); // real as of Project Prompt 11 - see terrain/PathValidator.js
  const inventoryManager = new InventoryManager();
  const resourceValidator = new ResourceValidator();
  const buildMenu = new BuildMenu();
  const messageService = new MessageService();
  const progressReporter = new ProgressReporter(messageService);
  const cancellationWatcher = new CancellationWatcher();

  // --- Placement engine (Project Prompt 10; Bridge Mode added Project Prompt 16) ---
  // Roadmap Phase 12 — stateless, so one shared instance is safe and is now
  // genuinely shared by two strategies (Project Prompt 17: Underground Mode
  // reuses TunnelExcavator unchanged rather than duplicating excavation).
  const tunnelExcavator = new TunnelExcavator();
  const straightRailStrategy = new StraightRailStrategy(
    terrainScanner,
    inventoryManager,
    progressReporter,
    tunnelExcavator
  );
  const bridgeExecutionStrategy = new BridgeExecutionStrategy(
    new BridgeSupportBuilder(), // Roadmap Phase 16 — stateless, same reasoning as TunnelExcavator above
    inventoryManager,
    progressReporter,
    messageService
  );
  // Registry-driven, keyed by config/BuildModes.js's BuildingMode values —
  // a future mode's strategy is one new entry here, matching that file's
  // own "one registry, no rewrites elsewhere" shape. See PlacementStage.js's
  // ROADMAP PHASE 16 CHANGE note.
  const undergroundExecutionStrategy = new UndergroundExecutionStrategy(
    tunnelExcavator,
    inventoryManager,
    progressReporter,
    messageService
  );
  const strategiesByMode = Object.freeze({
    [BuildingMode.NORMAL]: straightRailStrategy,
    [BuildingMode.BRIDGE]: bridgeExecutionStrategy,
    [BuildingMode.UNDERGROUND]: undergroundExecutionStrategy,
  });
  const railBuilder = new RailBuilder(); // Project Prompt 16 — no longer bound to one strategy at construction, see builder/RailBuilder.js
  const bridgeValidation = new BridgeValidation(); // Project Prompt 16
  const undergroundValidation = new UndergroundValidation(); // Project Prompt 17
  const activeBuildRegistry = new ActiveBuildRegistry(); // Project Prompt 22 — multiplayer position-conflict claims, see core/ActiveBuildRegistry.js
  // v2.0.0 Step 2 — "Repeat last build" + "Undo last build"
  const buildHistory = new BuildHistory();
  const undoService = new UndoService(buildHistory, inventoryManager, messageService);
  const buildSettings = new PlayerBuildSettings();

  // --- Validation framework: one validator per concern, order matters
  // (cheapest/most-fundamental checks first). ---
  const validationManager = new ValidationManager([
    new PlayerValidator(),
    new GameModeValidator(),
    new HeldItemValidator(),
    new DirectionValidator(),
    new OriginValidator(),
    new LengthValidator(),
    new ModeConfigValidator(), // Project Prompt 15 — bridge height / underground depth bounds
    new PermissionValidator(),
  ]);

  // --- Build pipeline: one stage per box in ARCHITECTURE.md's data-flow
  // diagram. Every stage's decision-making is real as of Project Prompt 11 —
  // TerrainScanningStage was the last one gated behind a stub (PathValidator,
  // see §24 for the buildReady-shortcut history and §32 for the real fix). ---
  const pipeline = new BuildPipeline([
    new RailDetectionStage(),
    new BuildRequestCreationStage(buildMenu, inventoryManager, buildSettings, undoService), // inventoryManager added in the bugfix pass before Project Prompt 18 — bridge material scanning
    new ValidationStage(validationManager, messageService),
    new ModeAvailabilityStage(), // Project Prompt 15 — kept in place for future modes; as of Project Prompt 17 all three permanent modes are implemented, so this gates nothing today
    new TerrainScanningStage(terrainScanner, pathValidator, messageService, bridgeValidation, undergroundValidation),
    new InventoryStage(inventoryManager, resourceValidator, messageService),
    new FinalSafetyCheckStage(terrainScanner, messageService),
    new BuildPlanStage(inventoryManager, resourceValidator), // Project Prompt 22 — final revalidation + context.buildPlan
    new PlacementStage(railBuilder, cancellationWatcher, messageService, strategiesByMode, activeBuildRegistry, buildHistory),
    new CompletionStage(messageService),
  ]);

  const orchestrator = new BuildOrchestrator({ pipeline, messageService });

  return { orchestrator, cancellationWatcher, messageService };
}

const { orchestrator, cancellationWatcher, messageService } = buildDependencyGraph();
const interactionGate = new InteractionGate(RAIL_ITEM_IDS, {
  requireSneak: INTERACTION.REQUIRE_SNEAK_TO_OPEN_MENU,
});

// A build can now run for many ticks (system.runJob), so live cancellation
// detection matters for the first time this session — initialized exactly
// once here, at startup, not per-build. See CancellationWatcher.js.
cancellationWatcher.initialize();

/**
 * Filters and dispatches a single rail-item interaction. Deliberately thin:
 * all decision-making (guards, pipeline, validation) lives in
 * BuildOrchestrator and the pipeline it runs.
 *
 * WHY `world.beforeEvents.playerInteractWithBlock` — see ARCHITECTURE.md
 * §15.1 for the full justification (unchanged since Project Prompt 4):
 * rails are block-placement items, so the relevant modern event is the
 * block-targeted one; the older event's block-targeting properties are
 * deprecated as of the current stable API, and this is their documented
 * replacement. `isFirstEvent` guards against held-button repeats;
 * BuildOrchestrator's per-player Set guards against overlapping first-presses.
 *
 * CROUCH-TO-OPEN (v2.0.0): only a crouching player opens the build menu. A
 * standing player's interaction is left completely untouched so the game
 * places one rail normally — see core/InteractionGate.js.
 *
 * @param {import("@minecraft/server").PlayerInteractWithBlockBeforeEvent} event
 */
function handleRailItemInteraction(event) {
  const decision = interactionGate.decide(event);
  if (decision === InteractionDecision.IGNORE) return;

  // event.player and itemStack.typeId are captured into locals now, since
  // beforeEvent data is only valid for the duration of this synchronous
  // callback — system.run() below runs on a later tick.
  const player = event.player;
  const railTypeId = event.itemStack.typeId;

  if (decision === InteractionDecision.VANILLA) {
    // Leave event.cancel alone: the game places a single rail. The first
    // time per session, tell the player how to reach the build menu now
    // that a plain tap no longer opens it. Deferred because actionbar
    // writes aren't allowed in restricted-execution mode.
    if (interactionGate.takeHint(player.id)) {
      system.run(() => messageService.sendActionBar(player, LocalizationKeys.ACTIONBAR_CROUCH_HINT));
    }
    return;
  }

  // OPEN_MENU: cancel the vanilla rail placement — the player should never
  // see a vanilla-placed rail underneath our own UI, even for an
  // interaction BuildOrchestrator goes on to reject (e.g. a duplicate
  // trigger).
  event.cancel = true;

  // ModalFormData.show() can't be called in restricted-execution mode
  // (the mode beforeEvents run in), so the actual pipeline run is deferred
  // to the next normal-execution tick.
  system.run(() => {
    orchestrator.startBuild(player, railTypeId).catch((error) => {
      Logger.error(`Unhandled error handling a rail item interaction for ${player?.name}`, error);
    });
  });
}

world.beforeEvents.playerInteractWithBlock.subscribe(handleRailItemInteraction);

Logger.info(`${ADDON.DISPLAY_NAME} v${ADDON.VERSION} loaded — rail placement engine online.`);
