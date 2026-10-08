/**
 * realGraphV2.mjs — v2.0.0 test helper.
 *
 * The same object graph as BP/scripts/main.js's buildDependencyGraph(),
 * including the v2 pieces (BuildHistory, UndoService, PlayerBuildSettings),
 * with BuildMenu supplied by the caller. integration.test.mjs keeps its own
 * v1-shaped copy on purpose — it proves the new constructor arguments are
 * optional.
 */

import { TerrainScanner } from "../BP/scripts/terrain/TerrainScanner.js";
import { PathValidator } from "../BP/scripts/terrain/PathValidator.js";
import { BridgeValidation } from "../BP/scripts/terrain/BridgeValidation.js";
import { UndergroundValidation } from "../BP/scripts/terrain/UndergroundValidation.js";
import { InventoryManager } from "../BP/scripts/inventory/InventoryManager.js";
import { ResourceValidator } from "../BP/scripts/inventory/ResourceValidator.js";
import { MessageService } from "../BP/scripts/ui/MessageService.js";
import { ProgressReporter } from "../BP/scripts/ui/ProgressReporter.js";
import { CancellationWatcher } from "../BP/scripts/core/CancellationWatcher.js";
import { TunnelExcavator } from "../BP/scripts/builder/TunnelExcavator.js";
import { StraightRailStrategy } from "../BP/scripts/builder/strategies/StraightRailStrategy.js";
import { BridgeExecutionStrategy } from "../BP/scripts/builder/strategies/BridgeExecutionStrategy.js";
import { BridgeSupportBuilder } from "../BP/scripts/builder/BridgeSupportBuilder.js";
import { UndergroundExecutionStrategy } from "../BP/scripts/builder/strategies/UndergroundExecutionStrategy.js";
import { RailBuilder } from "../BP/scripts/builder/RailBuilder.js";
import { BuildingMode } from "../BP/scripts/config/BuildModes.js";

import { ValidationManager } from "../BP/scripts/core/validation/ValidationManager.js";
import { PlayerValidator } from "../BP/scripts/core/validation/PlayerValidator.js";
import { GameModeValidator } from "../BP/scripts/core/validation/GameModeValidator.js";
import { HeldItemValidator } from "../BP/scripts/core/validation/HeldItemValidator.js";
import { DirectionValidator } from "../BP/scripts/core/validation/DirectionValidator.js";
import { OriginValidator } from "../BP/scripts/core/validation/OriginValidator.js";
import { LengthValidator } from "../BP/scripts/core/validation/LengthValidator.js";
import { ModeConfigValidator } from "../BP/scripts/core/validation/ModeConfigValidator.js";
import { PermissionValidator } from "../BP/scripts/core/validation/PermissionValidator.js";

import { BuildPipeline } from "../BP/scripts/core/pipeline/BuildPipeline.js";
import { RailDetectionStage } from "../BP/scripts/core/pipeline/stages/RailDetectionStage.js";
import { BuildRequestCreationStage } from "../BP/scripts/core/pipeline/stages/BuildRequestCreationStage.js";
import { ValidationStage } from "../BP/scripts/core/pipeline/stages/ValidationStage.js";
import { ModeAvailabilityStage } from "../BP/scripts/core/pipeline/stages/ModeAvailabilityStage.js";
import { TerrainScanningStage } from "../BP/scripts/core/pipeline/stages/TerrainScanningStage.js";
import { InventoryStage } from "../BP/scripts/core/pipeline/stages/InventoryStage.js";
import { FinalSafetyCheckStage } from "../BP/scripts/core/pipeline/stages/FinalSafetyCheckStage.js";
import { BuildPlanStage } from "../BP/scripts/core/pipeline/stages/BuildPlanStage.js";
import { PlacementStage } from "../BP/scripts/core/pipeline/stages/PlacementStage.js";
import { CompletionStage } from "../BP/scripts/core/pipeline/stages/CompletionStage.js";
import { ActiveBuildRegistry } from "../BP/scripts/core/ActiveBuildRegistry.js";
import { BuildOrchestrator } from "../BP/scripts/core/BuildOrchestrator.js";
import { BuildHistory } from "../BP/scripts/core/BuildHistory.js";
import { UndoService } from "../BP/scripts/core/UndoService.js";
import { PlayerBuildSettings } from "../BP/scripts/core/PlayerBuildSettings.js";

export function buildV2DependencyGraph(buildMenu) {
  const terrainScanner = new TerrainScanner();
  const pathValidator = new PathValidator();
  const inventoryManager = new InventoryManager();
  const resourceValidator = new ResourceValidator();
  const messageService = new MessageService();
  const progressReporter = new ProgressReporter(messageService);
  const cancellationWatcher = new CancellationWatcher();

  const tunnelExcavator = new TunnelExcavator();
  const straightRailStrategy = new StraightRailStrategy(terrainScanner, inventoryManager, progressReporter, tunnelExcavator);
  const bridgeExecutionStrategy = new BridgeExecutionStrategy(new BridgeSupportBuilder(), inventoryManager, progressReporter, messageService);
  const undergroundExecutionStrategy = new UndergroundExecutionStrategy(tunnelExcavator, inventoryManager, progressReporter, messageService);
  const strategiesByMode = Object.freeze({
    [BuildingMode.NORMAL]: straightRailStrategy,
    [BuildingMode.BRIDGE]: bridgeExecutionStrategy,
    [BuildingMode.UNDERGROUND]: undergroundExecutionStrategy,
  });
  const railBuilder = new RailBuilder();
  const bridgeValidation = new BridgeValidation();
  const undergroundValidation = new UndergroundValidation();
  const activeBuildRegistry = new ActiveBuildRegistry();
  const buildHistory = new BuildHistory();
  const undoService = new UndoService(buildHistory, inventoryManager, messageService);
  const buildSettings = new PlayerBuildSettings();

  const validationManager = new ValidationManager([
    new PlayerValidator(),
    new GameModeValidator(),
    new HeldItemValidator(),
    new DirectionValidator(),
    new OriginValidator(),
    new LengthValidator(),
    new ModeConfigValidator(),
    new PermissionValidator(),
  ]);

  const pipeline = new BuildPipeline([
    new RailDetectionStage(),
    new BuildRequestCreationStage(buildMenu, inventoryManager, buildSettings, undoService),
    new ValidationStage(validationManager, messageService),
    new ModeAvailabilityStage(),
    new TerrainScanningStage(terrainScanner, pathValidator, messageService, bridgeValidation, undergroundValidation),
    new InventoryStage(inventoryManager, resourceValidator, messageService),
    new FinalSafetyCheckStage(terrainScanner, messageService),
    new BuildPlanStage(inventoryManager, resourceValidator),
    new PlacementStage(railBuilder, cancellationWatcher, messageService, strategiesByMode, activeBuildRegistry, buildHistory),
    new CompletionStage(messageService),
  ]);

  const orchestrator = new BuildOrchestrator({ pipeline, messageService });
  return { orchestrator, pipeline, cancellationWatcher, inventoryManager, activeBuildRegistry, buildHistory, undoService, buildSettings };
}
