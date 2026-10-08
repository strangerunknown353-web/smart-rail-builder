/**
 * undoRepeat.test.mjs
 *
 * v2.0.0, Project Step 2 — "Undo last build" and "Repeat last build".
 * Runs the real pipeline (tests/realGraphV2.mjs) against the mutable mock
 * world, then undoes it and checks the world and inventory really return
 * to how they were.
 *
 * Run: node tests/undoRepeat.test.mjs
 */

import { createMockDimension } from "./mockWorld.mjs";
import { createMockPlayer } from "./mockPlayer.mjs";
import { buildV2DependencyGraph } from "./realGraphV2.mjs";
import { queueFormResponse, resetFormResponses } from "@minecraft/server-ui";
import { BuildMenu, MenuAction } from "../BP/scripts/ui/BuildMenu.js";
import { BUILD_MODE_ORDER } from "../BP/scripts/config/BuildModes.js";
import { PipelineContext } from "../BP/scripts/core/pipeline/PipelineContext.js";
import { PipelineResultStatus } from "../BP/scripts/core/pipeline/PipelineResult.js";
import { InventoryManager } from "../BP/scripts/inventory/InventoryManager.js";
import { BuildJournal } from "../BP/scripts/core/BuildJournal.js";
import { PlayerBuildSettings, sanitizeSettings, LAST_BUILD_PROPERTY } from "../BP/scripts/core/PlayerBuildSettings.js";
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

/**
 * Scripted BuildMenu: `modeAnswers` is a queue of promptForMode results, one
 * per pipeline run. Records every call so tests can assert which screens
 * were (not) shown.
 */
function scriptedMenu({ modeAnswers, modeValue, length, materialId }) {
  const calls = { mode: [], material: 0, config: [], summary: [] };
  return {
    calls,
    async promptForMode(player, options) {
      calls.mode.push(options);
      return modeAnswers.shift();
    },
    async promptForBridgeMaterial(player, materials) {
      calls.material += 1;
      return { cancelled: false, materialId: materialId ?? materials[0]?.typeId };
    },
    async promptForConfiguration(player, mode, bounds) {
      calls.config.push(bounds);
      return { cancelled: false, modeValue, length };
    },
    async promptForSummary(player, details) {
      calls.summary.push(details);
      return { cancelled: false, confirmed: true };
    },
  };
}

function railCount(player, typeId = "minecraft:rail") {
  return new InventoryManager().buildReport(player, typeId, 0).totalAvailable;
}

/** typeId of every block in a box — taken before a build, compared after undo. */
function snapshot(dim, { x0, x1, y0, y1, z0, z1 }) {
  const out = {};
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) out[`${x},${y},${z}`] = dim.getBlock({ x, y, z }).typeId;
  return out;
}
function diffSnapshots(before, after) {
  return Object.keys(before).filter((key) => before[key] !== after[key]);
}

async function run(graph, player) {
  const context = new PipelineContext({ player, railTypeId: player.heldRail ?? "minecraft:rail" });
  const result = await graph.pipeline.run(context);
  return { context, result };
}

// ---------------------------------------------------------------------------
// 1. NORMAL, Survival: build 5, undo -> world back to air, 5 rails refunded,
//    undo slot consumed.
// ---------------------------------------------------------------------------
{
  const dim = createMockDimension({ groundY: 63 });
  const player = createMockPlayer({
    id: "u1",
    heldItemTypeId: "minecraft:rail",
    items: [{ typeId: "minecraft:rail", amount: 10 }],
    location: { x: 0, y: 64, z: 0 },
    rotation: { x: 0, y: 270 }, // EAST
    dimension: dim,
  });
  const menu = scriptedMenu({
    modeAnswers: [
      { cancelled: false, action: MenuAction.MODE, mode: "NORMAL" },
      { cancelled: false, action: MenuAction.UNDO },
      { cancelled: false, action: MenuAction.UNDO },
    ],
    length: 5,
  });
  const graph = buildV2DependencyGraph(menu);
  const box = { x0: 0, x1: 7, y0: 63, y1: 66, z0: -1, z1: 1 };
  const before = snapshot(dim, box);

  const build = await run(graph, player);
  assertEqual(build.result.status, PipelineResultStatus.SUCCESS, "normal: build succeeds");
  assertEqual(railCount(player), 5, "normal: 5 rails spent");
  assertEqual(build.context.buildSession.journal.size, 5, "normal: journal has one entry per placed rail");
  assertTrue(graph.undoService.canUndo(player), "normal: undo available after the build");
  assertEqual(menu.calls.mode[0].canUndo, false, "normal: first menu had no undo button");

  const undo = await run(graph, player);
  assertEqual(undo.result.reason, "UNDO_PERFORMED", "normal: undo ends the pipeline without building");
  assertEqual(menu.calls.mode[1].canUndo, true, "normal: second menu offered undo");
  assertEqual(diffSnapshots(before, snapshot(dim, box)), [], "normal: world exactly as before the build");
  assertEqual(railCount(player), 10, "normal: all 5 rails refunded");
  assertTrue(!graph.undoService.canUndo(player), "normal: undo slot consumed");
  assertTrue(
    player.sentChatMessages.some((m) => m.translate === LocalizationKeys.UNDO_COMPLETE && m.with[0] === "5" && m.with[1] === "5"),
    "normal: undo-complete message reports 5 restored, 5 returned"
  );

  // A stale UNDO answer (e.g. two quick taps) is harmless.
  await run(graph, player);
  assertTrue(
    player.sentChatMessages.some((m) => m.translate === LocalizationKeys.UNDO_NOTHING),
    "normal: undo with nothing to undo says so"
  );
}

// ---------------------------------------------------------------------------
// 2. A rail the player broke (and got back) after the build is skipped and
//    NOT refunded a second time; a block they put down is never overwritten.
// ---------------------------------------------------------------------------
{
  const dim = createMockDimension({ groundY: 63 });
  const player = createMockPlayer({
    id: "u2",
    heldItemTypeId: "minecraft:rail",
    items: [{ typeId: "minecraft:rail", amount: 10 }],
    location: { x: 0, y: 64, z: 0 },
    rotation: { x: 0, y: 270 },
    dimension: dim,
  });
  const menu = scriptedMenu({
    modeAnswers: [
      { cancelled: false, action: MenuAction.MODE, mode: "NORMAL" },
      { cancelled: false, action: MenuAction.UNDO },
    ],
    length: 5,
  });
  const graph = buildV2DependencyGraph(menu);
  await run(graph, player);

  dim.getBlock({ x: 2, y: 64, z: 0 }).setPermutation({ typeId: "minecraft:air", states: {} }); // player broke it
  dim.getBlock({ x: 4, y: 64, z: 0 }).setPermutation({ typeId: "minecraft:oak_planks", states: {} }); // replaced with planks

  await run(graph, player);
  assertEqual(dim.getBlock({ x: 4, y: 64, z: 0 }).typeId, "minecraft:oak_planks", "skip: player's own block untouched");
  assertEqual(dim.getBlock({ x: 1, y: 64, z: 0 }).typeId, "minecraft:air", "skip: untouched rail removed");
  assertEqual(railCount(player), 5 + 3, "skip: only the 3 restored rails refunded");
  assertTrue(
    player.sentChatMessages.some((m) => m.translate === LocalizationKeys.UNDO_SKIPPED && m.with[0] === "2"),
    "skip: player told 2 blocks were left alone"
  );
}

// ---------------------------------------------------------------------------
// 3. UNDERGROUND (Creative): excavated stone comes back too, nothing refunded.
// ---------------------------------------------------------------------------
{
  const dim = createMockDimension({ groundY: 100 });
  const player = createMockPlayer({
    id: "u3",
    gameMode: "Creative",
    heldItemTypeId: "minecraft:rail",
    location: { x: 0, y: 101, z: 0 },
    dimension: dim,
  });
  const menu = scriptedMenu({
    modeAnswers: [
      { cancelled: false, action: MenuAction.MODE, mode: "UNDERGROUND" },
      { cancelled: false, action: MenuAction.UNDO },
    ],
    modeValue: 5,
    length: 8,
  });
  const graph = buildV2DependencyGraph(menu);
  const box = { x0: -2, x1: 2, y0: 92, y1: 104, z0: 0, z1: 24 };
  const before = snapshot(dim, box);

  const build = await run(graph, player);
  assertEqual(build.result.status, PipelineResultStatus.SUCCESS, "underground: build succeeds");
  assertTrue(diffSnapshots(before, snapshot(dim, box)).length > 8, "underground: build changed rails AND excavated blocks");

  await run(graph, player);
  assertEqual(diffSnapshots(before, snapshot(dim, box)), [], "underground: every excavated block and rail restored");
  assertEqual(railCount(player), 0, "underground: Creative build refunds nothing");
}

// ---------------------------------------------------------------------------
// 4. BRIDGE (Survival): rails AND support material come back.
// ---------------------------------------------------------------------------
{
  const dim = createMockDimension({ groundY: 60 });
  const player = createMockPlayer({
    id: "u4",
    heldItemTypeId: "minecraft:rail",
    items: [
      { typeId: "minecraft:rail", amount: 20 },
      { typeId: "minecraft:cobblestone", amount: 40 },
    ],
    location: { x: 0, y: 64, z: 0 },
    dimension: dim,
  });
  const menu = scriptedMenu({
    modeAnswers: [
      { cancelled: false, action: MenuAction.MODE, mode: "BRIDGE" },
      { cancelled: false, action: MenuAction.UNDO },
    ],
    modeValue: 3,
    length: 9,
    materialId: "minecraft:cobblestone",
  });
  const graph = buildV2DependencyGraph(menu);
  const box = { x0: -2, x1: 2, y0: 58, y1: 70, z0: 0, z1: 20 };
  const before = snapshot(dim, box);

  const build = await run(graph, player);
  assertEqual(build.result.status, PipelineResultStatus.SUCCESS, "bridge: build succeeds");
  assertTrue(railCount(player) < 20 && railCount(player, "minecraft:cobblestone") < 40, "bridge: rails and cobblestone spent");

  await run(graph, player);
  assertEqual(diffSnapshots(before, snapshot(dim, box)), [], "bridge: world exactly as before");
  assertEqual(railCount(player), 20, "bridge: every rail refunded");
  assertEqual(railCount(player, "minecraft:cobblestone"), 40, "bridge: every support block refunded");
}

// ---------------------------------------------------------------------------
// 5. Repeat last build: skips material + configuration screens, reuses the
//    saved settings, still shows the summary.
// ---------------------------------------------------------------------------
{
  const dim = createMockDimension({ groundY: 60 });
  const player = createMockPlayer({
    id: "r1",
    heldItemTypeId: "minecraft:rail",
    items: [
      { typeId: "minecraft:rail", amount: 64 },
      { typeId: "minecraft:cobblestone", amount: 64 },
      { typeId: "minecraft:stone", amount: 64 },
    ],
    location: { x: 0, y: 64, z: 0 },
    dimension: dim,
  });
  const menu = scriptedMenu({
    modeAnswers: [
      { cancelled: false, action: MenuAction.MODE, mode: "BRIDGE" },
      { cancelled: false, action: MenuAction.REPEAT },
    ],
    modeValue: 4,
    length: 6,
    materialId: "minecraft:stone",
  });
  const graph = buildV2DependencyGraph(menu);

  await run(graph, player);
  assertEqual(menu.calls.mode[0].lastSettings, null, "repeat: first menu has nothing to repeat");
  assertEqual(
    graph.buildSettings.get(player),
    { mode: "BRIDGE", length: 6, modeValue: 4, materialId: "minecraft:stone" },
    "repeat: confirmed settings remembered"
  );

  player.location = { x: 10, y: 64, z: 0 }; // somewhere else, so it doesn't collide with build 1
  const second = await run(graph, player);
  assertEqual(menu.calls.mode[1].lastSettings?.mode, "BRIDGE", "repeat: menu offered the last build");
  assertEqual(menu.calls.material, 1, "repeat: material screen skipped (still carrying stone)");
  assertEqual(menu.calls.config.length, 1, "repeat: configuration screen skipped");
  assertEqual(menu.calls.summary.length, 2, "repeat: summary still shown");
  assertEqual(second.context.request.bridgeHeight, 4, "repeat: height reused");
  assertEqual(second.context.request.requestedLength, 6, "repeat: length reused");
  assertEqual(second.context.request.bridgeMaterialId, "minecraft:stone", "repeat: material reused");
}

// ---------------------------------------------------------------------------
// 6. Repeat when the remembered material is gone -> asks for material again.
//    Configuration screen remembers last values as defaults.
// ---------------------------------------------------------------------------
{
  const player = createMockPlayer({
    id: "r2",
    heldItemTypeId: "minecraft:rail",
    items: [
      { typeId: "minecraft:rail", amount: 64 },
      { typeId: "minecraft:cobblestone", amount: 64 },
    ],
    location: { x: 0, y: 64, z: 0 },
    dimension: createMockDimension({ groundY: 60 }),
  });
  const menu = scriptedMenu({
    modeAnswers: [
      { cancelled: false, action: MenuAction.REPEAT },
      { cancelled: false, action: MenuAction.MODE, mode: "BRIDGE" },
    ],
    modeValue: 3,
    length: 5,
  });
  const graph = buildV2DependencyGraph(menu);
  graph.buildSettings.save(player, { mode: "BRIDGE", length: 7, modeValue: 5, materialId: "minecraft:diamond_block" });

  await run(graph, player);
  assertEqual(menu.calls.material, 1, "repeat-missing-material: material screen shown instead");

  await run(graph, player);
  // The repeat above confirmed length 7 / height 5 (with the newly picked
  // material) — those are now the remembered values.
  assertEqual(menu.calls.config[0]?.defaultLength, 7, "remembered defaults: slider starts at the last length");
  assertEqual(menu.calls.config[0]?.defaultModeValue, 5, "remembered defaults: same mode -> last height pre-filled");
}

// ---------------------------------------------------------------------------
// 7. PlayerBuildSettings: validation + dynamic-property persistence.
// ---------------------------------------------------------------------------
{
  assertEqual(sanitizeSettings({ mode: "NORMAL", length: 32 }), { mode: "NORMAL", length: 32 }, "sanitize: valid normal");
  assertEqual(sanitizeSettings({ mode: "NORMAL", length: 999 }), null, "sanitize: length over max rejected");
  assertEqual(sanitizeSettings({ mode: "NORMAL", length: 2.5 }), null, "sanitize: non-integer length rejected");
  assertEqual(sanitizeSettings({ mode: "FLYING", length: 5 }), null, "sanitize: unknown mode rejected");
  assertEqual(sanitizeSettings({ mode: "BRIDGE", length: 5, modeValue: 99, materialId: "minecraft:stone" }), null, "sanitize: height out of range rejected");
  assertEqual(sanitizeSettings({ mode: "BRIDGE", length: 5, modeValue: 3 }), null, "sanitize: bridge without material rejected");
  assertEqual(sanitizeSettings("garbage"), null, "sanitize: non-object rejected");

  const store = new Map();
  const player = createMockPlayer({ id: "s1" });
  player.getDynamicProperty = (key) => store.get(key);
  player.setDynamicProperty = (key, value) => store.set(key, value);

  new PlayerBuildSettings().save(player, { mode: "UNDERGROUND", length: 12, modeValue: 7 });
  assertTrue(typeof store.get(LAST_BUILD_PROPERTY) === "string", "persist: written to the player's dynamic property");
  assertEqual(
    new PlayerBuildSettings().get(player),
    { mode: "UNDERGROUND", length: 12, modeValue: 7 },
    "persist: a fresh store (world reload) reads it back"
  );

  store.set(LAST_BUILD_PROPERTY, "{not json");
  assertEqual(new PlayerBuildSettings().get(player), null, "persist: corrupt data ignored, not thrown");

  const throwing = createMockPlayer({ id: "s2" });
  throwing.getDynamicProperty = () => {
    throw new Error("nope");
  };
  throwing.setDynamicProperty = () => {
    throw new Error("nope");
  };
  const s = new PlayerBuildSettings();
  s.save(throwing, { mode: "NORMAL", length: 3 });
  assertEqual(s.get(throwing), { mode: "NORMAL", length: 3 }, "persist: falls back to memory when dynamic properties fail");
}

// ---------------------------------------------------------------------------
// 8. Real BuildMenu: button layout and what each index means.
// ---------------------------------------------------------------------------
{
  const menu = new BuildMenu();
  const player = createMockPlayer({ id: "m1" });
  const last = { mode: "BRIDGE", length: 10, modeValue: 3, materialId: "minecraft:stone" };

  resetFormResponses();
  queueFormResponse(player, { canceled: false, selection: 0 });
  assertEqual(
    await menu.promptForMode(player, { lastSettings: last, canUndo: true }),
    { cancelled: false, action: MenuAction.REPEAT },
    "menu: first button is Repeat when last settings exist"
  );
  queueFormResponse(player, { canceled: false, selection: 1 });
  assertEqual(
    await menu.promptForMode(player, { lastSettings: last, canUndo: true }),
    { cancelled: false, action: MenuAction.MODE, mode: BUILD_MODE_ORDER[0] },
    "menu: modes shift down by one after Repeat"
  );
  queueFormResponse(player, { canceled: false, selection: BUILD_MODE_ORDER.length + 1 });
  assertEqual(
    await menu.promptForMode(player, { lastSettings: last, canUndo: true }),
    { cancelled: false, action: MenuAction.UNDO },
    "menu: last button is Undo"
  );
  queueFormResponse(player, { canceled: false, selection: 0 });
  assertEqual(
    await menu.promptForMode(player),
    { cancelled: false, action: MenuAction.MODE, mode: BUILD_MODE_ORDER[0] },
    "menu: no options -> plain v1 mode list"
  );
}

// ---------------------------------------------------------------------------
// 9. BuildJournal: a write that throws leaves no entry.
// ---------------------------------------------------------------------------
{
  const journal = new BuildJournal(createMockDimension());
  const badBlock = {
    typeId: "minecraft:air",
    permutation: {},
    setPermutation() {
      throw new Error("boom");
    },
  };
  let threw = false;
  try {
    journal.write(badBlock, { x: 0, y: 0, z: 0 }, {});
  } catch {
    threw = true;
  }
  assertTrue(threw, "journal: write error still propagates to the strategy");
  assertEqual(journal.size, 0, "journal: failed write not recorded");
}

if (failures.length > 0) {
  console.log("FAILURES:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
console.log(`${passed} passed, ${failed} failed (${passed + failed} assertions total).`);
process.exitCode = failed > 0 ? 1 : 0;
