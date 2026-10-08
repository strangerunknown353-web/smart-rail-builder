/**
 * step4.test.mjs
 *
 * v2.0.0, Project Step 4 — cave gap filling, bridge guard rails, the
 * held-rail count fix for boosters, the Settings screen / preferences,
 * quick repeat, and two optimizations (same-tick scan reuse, per-build
 * game mode).
 *
 * Run: node tests/step4.test.mjs
 */

import { system } from "@minecraft/server";
import { queueFormResponse, resetFormResponses } from "@minecraft/server-ui";
import { createMockDimension, createBuildVector, AIR, WATER_SOURCE } from "./mockWorld.mjs";
import { createMockPlayer } from "./mockPlayer.mjs";
import { buildV2DependencyGraph } from "./realGraphV2.mjs";
import { BuildMenu, MenuAction } from "../BP/scripts/ui/BuildMenu.js";
import { TerrainScanner } from "../BP/scripts/terrain/TerrainScanner.js";
import { UndergroundRejectionReason } from "../BP/scripts/terrain/UndergroundPlan.js";
import { UNDERGROUND_CONFIG } from "../BP/scripts/config/UndergroundConfig.js";
import { EXTRAS_CONFIG } from "../BP/scripts/config/ExtrasConfig.js";
import { PipelineContext } from "../BP/scripts/core/pipeline/PipelineContext.js";
import { PipelineResultStatus } from "../BP/scripts/core/pipeline/PipelineResult.js";
import { FinalSafetyCheckStage } from "../BP/scripts/core/pipeline/stages/FinalSafetyCheckStage.js";
import { InventoryManager } from "../BP/scripts/inventory/InventoryManager.js";
import { heldRailsRequired } from "../BP/scripts/core/ExtrasPlan.js";
import {
  PlayerPreferences,
  sanitizePreferences,
  DEFAULT_PREFERENCES,
  PREFERENCES_PROPERTY,
} from "../BP/scripts/core/PlayerPreferences.js";
import { LocalizationKeys } from "../BP/scripts/localization/LocalizationKeys.js";

let passed = 0;
let failed = 0;
const failures = [];

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(actual, label) {
  assertEqual(Boolean(actual), true, label);
}

const key = (p) => `${p.x},${p.y},${p.z}`;
const count = (player, typeId) => new InventoryManager().buildReport(player, typeId, 0).totalAvailable;
const chatKeys = (player) => player.sentChatMessages.map((m) => m.translate);

/** Scripted menu: `modeAnswers` queue; `config` returned from the config screen; records calls. */
function scriptedMenu({ modeAnswers, config = {}, settingsAnswers = [], materialId }) {
  const calls = { mode: [], config: [], summary: 0, settings: [] };
  return {
    calls,
    async promptForMode(player, options) {
      calls.mode.push(options);
      return modeAnswers.shift();
    },
    async promptForBridgeMaterial(player, materials) {
      return { cancelled: false, materialId: materialId ?? materials[0]?.typeId };
    },
    async promptForConfiguration(player, mode, bounds) {
      calls.config.push(bounds);
      return { cancelled: false, ...config };
    },
    async promptForSummary() {
      calls.summary += 1;
      return { cancelled: false, confirmed: true };
    },
    async promptForSettings(player, current) {
      calls.settings.push(current);
      return settingsAnswers.shift() ?? { cancelled: true };
    },
  };
}

async function run(graph, player, railTypeId = "minecraft:rail") {
  const context = new PipelineContext({ player, railTypeId });
  const result = await graph.pipeline.run(context);
  return { context, result };
}

// ---------------------------------------------------------------------------
// 1. Cave gap filling (planner).
// ---------------------------------------------------------------------------
const UG_ORIGIN = { x: 0, y: 101, z: 1 };
function ugPlan(dim, fillCaveGaps) {
  return new TerrainScanner().planUnderground(createBuildVector(UG_ORIGIN, "south"), 12, dim, 5, { fillCaveGaps });
}
const cleanRails = ugPlan(createMockDimension({ groundY: 100 }), false).railSteps.map((s) => s.position);
const caveRail = cleanRails[8];
function caveDimension(depthOfCave, bottom = undefined) {
  const overrides = {};
  for (let d = 1; d <= depthOfCave; d++) overrides[key({ ...caveRail, y: caveRail.y - d })] = AIR;
  if (bottom) overrides[key({ ...caveRail, y: caveRail.y - depthOfCave - 1 })] = bottom;
  return createMockDimension({ groundY: 100, overrides });
}
{
  const off = ugPlan(caveDimension(3), false);
  assertEqual(off.rejectionReason, UndergroundRejectionReason.UNSUPPORTED_FLOOR, "cave: fill off -> still rejected (v1 behavior)");

  const on = ugPlan(caveDimension(3), true);
  assertTrue(on.feasible, "cave: fill on -> feasible");
  assertEqual(
    on.railSteps[8].floorFillPositions.map((p) => p.y),
    [caveRail.y - 3, caveRail.y - 2, caveRail.y - 1],
    "cave: 3-deep gap filled bottom-up"
  );
  assertEqual(on.terrainSummary.caveFillCount, 3, "cave: fill counted in the summary");
  assertEqual(on.railSteps[7].floorFillPositions, [], "cave: solid rows need no fill");

  const tooDeep = ugPlan(caveDimension(UNDERGROUND_CONFIG.CAVE_FILL_MAX_DEPTH + 1), true);
  assertEqual(tooDeep.rejectionReason, UndergroundRejectionReason.UNSUPPORTED_FLOOR, "cave: deeper than the limit -> rejected");

  const wet = ugPlan(caveDimension(2, WATER_SOURCE), true);
  assertEqual(wet.rejectionReason, UndergroundRejectionReason.UNSUPPORTED_FLOOR, "cave: water at the bottom -> rejected, never filled");
}

// ---------------------------------------------------------------------------
// 2. Cave gap filling through the real pipeline, plus undo.
// ---------------------------------------------------------------------------
{
  const dim = caveDimension(4);
  const player = createMockPlayer({
    id: "cave",
    gameMode: "Creative",
    heldItemTypeId: "minecraft:rail",
    location: { x: 0, y: 101, z: 0 },
    dimension: dim,
  });
  const graph = buildV2DependencyGraph(
    scriptedMenu({
      modeAnswers: [
        { cancelled: false, action: MenuAction.MODE, mode: "UNDERGROUND" },
        { cancelled: false, action: MenuAction.UNDO },
      ],
      config: { modeValue: 5, length: 12, fillCaveGaps: true, lightSpacing: 0 },
    })
  );
  const { context, result } = await run(graph, player);
  assertEqual(result.status, PipelineResultStatus.SUCCESS, "cave pipeline: builds across the cave");
  assertEqual(context.request.fillCaveGaps, true, "cave pipeline: request carries the toggle");
  const rail = context.buildPlan.railPositions[8];
  assertEqual(dim.getBlock(rail).typeId, "minecraft:rail", "cave pipeline: rail over the cave");
  for (let d = 1; d <= 4; d++) {
    assertEqual(dim.getBlock({ ...rail, y: rail.y - d }).typeId, UNDERGROUND_CONFIG.SEAL_BLOCK_ID, `cave pipeline: support block ${d} below`);
  }
  await run(graph, player);
  assertEqual(dim.getBlock({ ...rail, y: rail.y - 2 }).typeId, "minecraft:air", "cave pipeline undo: cave is open again");
}

// ---------------------------------------------------------------------------
// 3. Bridge guard rails.
// ---------------------------------------------------------------------------
for (const scenario of ["creative", "no-fences"]) {
  const dim = createMockDimension({ groundY: 63 }); // player stands ON the ground, so the ramps start at ground level
  const player = createMockPlayer({
    id: `guard-${scenario}`,
    gameMode: scenario === "creative" ? "Creative" : "Survival",
    heldItemTypeId: "minecraft:rail",
    items: [
      { typeId: "minecraft:rail", amount: 64 },
      { typeId: "minecraft:cobblestone", amount: 64 },
    ],
    location: { x: 0, y: 64, z: 0 },
    dimension: dim,
  });
  const graph = buildV2DependencyGraph(
    scriptedMenu({
      modeAnswers: [
        { cancelled: false, action: MenuAction.MODE, mode: "BRIDGE" },
        { cancelled: false, action: MenuAction.UNDO },
      ],
      config: { modeValue: 4, length: 16, guardRails: true },
      materialId: "minecraft:cobblestone",
    })
  );
  const { context, result } = await run(graph, player);
  assertEqual(result.status, PipelineResultStatus.SUCCESS, `guard (${scenario}): bridge builds`);
  const spots = context.buildPlan.extras.guardRails.flatMap((g) => g.positions);
  const fenced = spots.filter((p) => dim.getBlock(p).typeId === EXTRAS_CONFIG.FENCE_IDS[0]);

  if (scenario === "creative") {
    assertTrue(fenced.length > 0, "guard: fences placed along the span");
    assertTrue(
      fenced.every((p) => dim.getBlock({ ...p, y: p.y - 1 }).typeId === "minecraft:air"),
      "guard: every fence is over a drop"
    );
    assertTrue(fenced.length < spots.length, "guard: ramp ends on the ground get no fences");
    assertTrue(chatKeys(player).includes(LocalizationKeys.EXTRAS_FENCES_PLACED), "guard: count reported");
    assertTrue(spots.every((p) => context.buildPlan.containsPosition(p)), "guard: fence spots are inside the claimed area");
    await run(graph, player);
    assertTrue(fenced.every((p) => dim.getBlock(p).typeId === "minecraft:air"), "guard undo: fences removed");
  } else {
    assertEqual(fenced.length, 0, "guard (no fences): none placed");
    assertTrue(chatKeys(player).includes(LocalizationKeys.EXTRAS_NO_FENCES), "guard (no fences): told to carry fences");
  }
}

// ---------------------------------------------------------------------------
// 4. Held-rail count fix: affordable boosters reduce the rails required.
// ---------------------------------------------------------------------------
{
  const im = new InventoryManager();
  const withBoosterItems = createMockPlayer({
    id: "rc1",
    items: [
      { typeId: EXTRAS_CONFIG.BOOSTER_RAIL_ID, amount: 2 },
      { typeId: EXTRAS_CONFIG.POWER_BLOCK_ID, amount: 5 },
    ],
  });
  assertEqual(
    heldRailsRequired(im, withBoosterItems, { railTypeId: "minecraft:rail", boosterSpacing: 8 }, 17),
    15,
    "rail count: 3 boosters planned, only 2 affordable -> 15 plain rails"
  );
  assertEqual(heldRailsRequired(im, withBoosterItems, { railTypeId: "minecraft:rail", boosterSpacing: 0 }, 17), 17, "rail count: boosters off -> all");
  assertEqual(
    heldRailsRequired(im, withBoosterItems, { railTypeId: EXTRAS_CONFIG.BOOSTER_RAIL_ID, boosterSpacing: 8 }, 17),
    17,
    "rail count: holding powered rails -> no reduction"
  );

  // End to end: exactly 14 plain rails + 3 boosters' worth builds 17 (v2 Step 3 needed 17 plain).
  const dim = createMockDimension({ groundY: 63 });
  const player = createMockPlayer({
    id: "rc2",
    heldItemTypeId: "minecraft:rail",
    items: [
      { typeId: "minecraft:rail", amount: 14 },
      { typeId: EXTRAS_CONFIG.BOOSTER_RAIL_ID, amount: 3 },
      { typeId: EXTRAS_CONFIG.POWER_BLOCK_ID, amount: 3 },
    ],
    location: { x: 0, y: 64, z: 0 },
    rotation: { x: 0, y: 270 },
    dimension: dim,
  });
  const graph = buildV2DependencyGraph(
    scriptedMenu({
      modeAnswers: [{ cancelled: false, action: MenuAction.MODE, mode: "NORMAL" }],
      config: { length: 17, boosterSpacing: 8 },
    })
  );
  const { context, result } = await run(graph, player);
  assertEqual(result.status, PipelineResultStatus.SUCCESS, "rail count: 14 plain + 3 boosters builds a 17-rail line");
  assertEqual(context.buildSession.blocksPlaced, 17, "rail count: all 17 placed");
  assertEqual(
    [count(player, "minecraft:rail"), count(player, EXTRAS_CONFIG.BOOSTER_RAIL_ID), count(player, EXTRAS_CONFIG.POWER_BLOCK_ID)],
    [0, 0, 0],
    "rail count: everything used exactly"
  );
}

// ---------------------------------------------------------------------------
// 5. Preferences: validation, persistence.
// ---------------------------------------------------------------------------
{
  assertEqual(sanitizePreferences(undefined), { ...DEFAULT_PREFERENCES }, "prefs: nothing saved -> defaults");
  const mixed = sanitizePreferences({ defaultLength: 999, boosterSpacing: 16, showTips: "yes", quickRepeat: true });
  assertEqual(
    [mixed.defaultLength, mixed.boosterSpacing, mixed.showTips, mixed.quickRepeat],
    [DEFAULT_PREFERENCES.defaultLength, 16, true, true],
    "prefs: each bad field falls back alone, good ones kept"
  );

  const store = new Map();
  const player = createMockPlayer({ id: "pp" });
  player.getDynamicProperty = (k) => store.get(k);
  player.setDynamicProperty = (k, v) => store.set(k, v);
  new PlayerPreferences().save(player, { ...DEFAULT_PREFERENCES, defaultLength: 48, guardRails: true });
  assertTrue(typeof store.get(PREFERENCES_PROPERTY) === "string", "prefs: persisted on the player");
  const reloaded = new PlayerPreferences().get(player);
  assertEqual([reloaded.defaultLength, reloaded.guardRails], [48, true], "prefs: survive a world reload");
}

// ---------------------------------------------------------------------------
// 6. Settings flow in the stage: Settings -> save -> back to the menu ->
//    build uses the new defaults.
// ---------------------------------------------------------------------------
{
  const player = createMockPlayer({
    id: "set",
    gameMode: "Creative",
    heldItemTypeId: "minecraft:rail",
    location: { x: 0, y: 64, z: 0 },
    dimension: createMockDimension({ groundY: 63 }),
  });
  const newPrefs = { ...DEFAULT_PREFERENCES, defaultLength: 20, boosterSpacing: 24, guardRails: true };
  const menu = scriptedMenu({
    modeAnswers: [
      { cancelled: false, action: MenuAction.SETTINGS },
      { cancelled: false, action: MenuAction.MODE, mode: "NORMAL" },
    ],
    settingsAnswers: [{ cancelled: false, preferences: newPrefs }],
    config: { cancelled: true },
  });
  menu.promptForConfiguration = async (p, mode, bounds) => {
    menu.calls.config.push(bounds);
    return { cancelled: true };
  };
  const graph = buildV2DependencyGraph(menu);
  await run(graph, player);
  assertEqual(menu.calls.mode.length, 2, "settings: menu shown again after saving");
  assertTrue(menu.calls.mode[0].showSettings, "settings: Settings button offered");
  assertTrue(chatKeys(player).includes(LocalizationKeys.SETTINGS_SAVED), "settings: 'Settings saved' sent");
  assertEqual(graph.preferences.get(player).defaultLength, 20, "settings: saved");
  const bounds = menu.calls.config[0];
  assertEqual(
    [bounds.defaultLength, bounds.defaultBoosterSpacing, bounds.defaultGuardRails],
    [20, 24, true],
    "settings: config screen starts at the new preferences"
  );
}

// ---------------------------------------------------------------------------
// 7. Quick repeat skips the summary; without it the summary shows.
// ---------------------------------------------------------------------------
for (const quickRepeat of [true, false]) {
  const player = createMockPlayer({
    id: `qr-${quickRepeat}`,
    gameMode: "Creative",
    heldItemTypeId: "minecraft:rail",
    location: { x: 0, y: 64, z: 0 },
    rotation: { x: 0, y: 270 },
    dimension: createMockDimension({ groundY: 63 }),
  });
  const menu = scriptedMenu({
    modeAnswers: [
      { cancelled: false, action: MenuAction.MODE, mode: "NORMAL" },
      { cancelled: false, action: MenuAction.REPEAT },
    ],
    config: { length: 4 },
  });
  const graph = buildV2DependencyGraph(menu);
  graph.preferences.save(player, { ...DEFAULT_PREFERENCES, quickRepeat });
  await run(graph, player);
  player.location = { x: 0, y: 64, z: 10 };
  const second = await run(graph, player);
  assertEqual(second.result.status, PipelineResultStatus.SUCCESS, `quick repeat ${quickRepeat}: repeat builds`);
  assertEqual(menu.calls.summary, quickRepeat ? 1 : 2, `quick repeat ${quickRepeat}: summary shown ${quickRepeat ? "once" : "twice"}`);
}

// ---------------------------------------------------------------------------
// 8. Real BuildMenu: Settings button position, toggles, settings form.
// ---------------------------------------------------------------------------
{
  const menu = new BuildMenu();
  const player = createMockPlayer({ id: "ui" });
  resetFormResponses();

  queueFormResponse(player, { canceled: false, selection: 3 }); // 3 modes, then Settings
  assertEqual(
    await menu.promptForMode(player, { showSettings: true, canUndo: true }),
    { cancelled: false, action: MenuAction.SETTINGS },
    "menu: Settings comes right after the modes"
  );
  queueFormResponse(player, { canceled: false, selection: 4 });
  assertEqual(
    await menu.promptForMode(player, { showSettings: true, canUndo: true }),
    { cancelled: false, action: MenuAction.UNDO },
    "menu: Undo stays last"
  );

  const bounds = { minLength: 1, maxLength: 64, step: 1, defaultLength: 32 };
  queueFormResponse(player, { canceled: false, formValues: [5, 20, 0, 1, false] });
  const ug = await menu.promptForConfiguration(player, "UNDERGROUND", bounds);
  assertEqual(ug.fillCaveGaps, false, "menu: cave toggle read (Underground)");
  queueFormResponse(player, { canceled: false, formValues: [3, 20, 0, true] });
  const br = await menu.promptForConfiguration(player, "BRIDGE", bounds);
  assertEqual([br.guardRails, br.fillCaveGaps], [true, false], "menu: guard toggle read (Bridge)");
  queueFormResponse(player, { canceled: false, formValues: [3, 20] });
  const brDefault = await menu.promptForConfiguration(player, "BRIDGE", { ...bounds, defaultGuardRails: true });
  assertEqual(brDefault.guardRails, true, "menu: untouched toggle -> default");

  queueFormResponse(player, { canceled: false, formValues: [40, 1, 3, false, true, true, false] });
  const settings = await menu.promptForSettings(player, DEFAULT_PREFERENCES);
  assertEqual(
    settings.preferences,
    { defaultLength: 40, boosterSpacing: 8, lightSpacing: 12, fillCaveGaps: false, guardRails: true, quickRepeat: true, showTips: false },
    "menu: settings form maps every field"
  );
}

// ---------------------------------------------------------------------------
// 9. Optimizations.
// ---------------------------------------------------------------------------
{
  // Same-tick reuse: the final safety check skips its re-scan only when the
  // terrain scan happened this very tick.
  let scans = 0;
  const countingScanner = {
    scanPath() {
      scans += 1;
      return { buildReady: true };
    },
  };
  const stage = new FinalSafetyCheckStage(countingScanner, { sendActionBar() {} });
  const request = { buildingMode: "NORMAL", player: { name: "t" }, buildVector: {}, requestedLength: 5 };
  const hadTick = Object.prototype.hasOwnProperty.call(system, "currentTick");
  system.currentTick = 100;
  stage.execute({ request, terrainScannedAtTick: 100 });
  assertEqual(scans, 0, "same tick: re-scan skipped");
  stage.execute({ request, terrainScannedAtTick: 99 });
  assertEqual(scans, 1, "a tick passed: re-scan runs");
  if (!hadTick) delete system.currentTick;
  stage.execute({ request, terrainScannedAtTick: 100 });
  assertEqual(scans, 2, "tick unknown: re-scan runs (safe default)");

  // Game mode read once per build, not per block.
  const dim = createMockDimension({ groundY: 63 });
  const player = createMockPlayer({
    id: "gm",
    heldItemTypeId: "minecraft:rail",
    items: [{ typeId: "minecraft:rail", amount: 64 }],
    location: { x: 0, y: 64, z: 0 },
    rotation: { x: 0, y: 270 },
    dimension: dim,
  });
  let gameModeReads = 0;
  const realGetGameMode = player.getGameMode.bind(player);
  player.getGameMode = () => {
    gameModeReads += 1;
    return realGetGameMode();
  };
  const graph = buildV2DependencyGraph(
    scriptedMenu({ modeAnswers: [{ cancelled: false, action: MenuAction.MODE, mode: "NORMAL" }], config: { length: 40 } })
  );
  const { result } = await run(graph, player);
  assertEqual(result.status, PipelineResultStatus.SUCCESS, "game mode: 40-rail build succeeds");
  if (process.env.SHOW_PERF) console.log(`game mode reads: ${gameModeReads}`);
  assertTrue(gameModeReads < 10, `game mode: read ${gameModeReads} times for 40 rails (was once per rail)`);
}

if (failures.length > 0) {
  console.log("FAILURES:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
console.log(`${passed} passed, ${failed} failed (${passed + failed} assertions total).`);
process.exitCode = failed > 0 ? 1 : 0;
