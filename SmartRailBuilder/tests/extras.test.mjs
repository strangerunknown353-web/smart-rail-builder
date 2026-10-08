/**
 * extras.test.mjs
 *
 * v2.0.0, Project Step 3 — powered boosters and tunnel lights.
 * Planning (core/ExtrasPlan.js), placement through the real pipeline
 * (tests/realGraphV2.mjs) in every mode, graceful skipping when Survival
 * players lack the items, undo of extras, and the menu dropdowns.
 *
 * Run: node tests/extras.test.mjs
 */

import { createMockDimension } from "./mockWorld.mjs";
import { createMockPlayer } from "./mockPlayer.mjs";
import { buildV2DependencyGraph } from "./realGraphV2.mjs";
import { queueFormResponse, resetFormResponses } from "@minecraft/server-ui";
import { BuildMenu, MenuAction } from "../BP/scripts/ui/BuildMenu.js";
import { planExtras } from "../BP/scripts/core/ExtrasPlan.js";
import { EXTRAS_CONFIG } from "../BP/scripts/config/ExtrasConfig.js";
import { BuildRequest } from "../BP/scripts/core/BuildRequest.js";
import { PipelineContext } from "../BP/scripts/core/pipeline/PipelineContext.js";
import { PipelineResultStatus } from "../BP/scripts/core/pipeline/PipelineResult.js";
import { InventoryManager } from "../BP/scripts/inventory/InventoryManager.js";
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

const GOLDEN = EXTRAS_CONFIG.BOOSTER_RAIL_ID;
const REDSTONE = EXTRAS_CONFIG.POWER_BLOCK_ID;
const GLOWSTONE = "minecraft:glowstone";

function count(player, typeId) {
  return new InventoryManager().buildReport(player, typeId, 0).totalAvailable;
}
function below(p) {
  return { x: p.x, y: p.y - 1, z: p.z };
}
function chatKeys(player) {
  return player.sentChatMessages.map((m) => m.translate);
}

function menuStub({ mode, modeValue, length, materialId, boosterSpacing = 0, lightSpacing = 0, then = [] }) {
  const answers = [{ cancelled: false, action: MenuAction.MODE, mode }, ...then];
  return {
    async promptForMode() {
      return answers.shift();
    },
    async promptForBridgeMaterial(player, materials) {
      return { cancelled: false, materialId: materialId ?? materials[0]?.typeId };
    },
    async promptForConfiguration() {
      return { cancelled: false, modeValue, length, boosterSpacing, lightSpacing };
    },
    async promptForSummary() {
      return { cancelled: false, confirmed: true };
    },
  };
}

async function run(graph, player) {
  const context = new PipelineContext({ player, railTypeId: "minecraft:rail" });
  const result = await graph.pipeline.run(context);
  return { context, result };
}

// ---------------------------------------------------------------------------
// 1. planExtras: indices, positions, lights Underground-only, left wall.
// ---------------------------------------------------------------------------
{
  const rails = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 64, z: 0 })); // heading EAST
  const plan = planExtras({ buildingMode: "NORMAL", direction: "east", railPositions: rails, boosterSpacing: 8, lightSpacing: 8 });
  assertEqual(plan.boosters.map((b) => b.index), [0, 8, 16], "plan: boosters at 0, 8, 16");
  assertEqual(plan.boosters[1].powerPosition, { x: 8, y: 63, z: 0 }, "plan: power block directly under the rail");
  assertEqual(plan.lights, [], "plan: no lights outside Underground");

  const ug = planExtras({ buildingMode: "UNDERGROUND", direction: "east", railPositions: rails, lightSpacing: 8 });
  assertEqual(ug.boosters, [], "plan: boosters off when spacing 0");
  assertEqual(ug.lights.map((l) => l.index), [4, 12], "plan: lights offset by half a spacing");
  assertEqual(ug.lights[0].position, { x: 4, y: 65, z: -1 }, "plan: EAST -> light in the north (left) wall at head height");

  const left = { north: { x: -1, z: 0 }, south: { x: 1, z: 0 }, east: { x: 0, z: -1 }, west: { x: 0, z: 1 } };
  for (const [direction, offset] of Object.entries(left)) {
    const p = planExtras({ buildingMode: "UNDERGROUND", direction, railPositions: [{ x: 0, y: 10, z: 0 }], lightSpacing: 6 });
    assertEqual(p.lights, [], `plan: ${direction} — first light index 3 is past a 1-rail build`);
    const p2 = planExtras({
      buildingMode: "UNDERGROUND",
      direction,
      railPositions: Array.from({ length: 4 }, () => ({ x: 0, y: 10, z: 0 })),
      lightSpacing: 6,
    });
    assertEqual(p2.lights[0].position, { x: offset.x, y: 11, z: offset.z }, `plan: ${direction} light goes on the left`);
  }

  const req = new BuildRequest({ buildingMode: "NORMAL", boosterSpacing: 7, lightSpacing: 8 });
  assertEqual([req.boosterSpacing, req.lightSpacing], [0, 0], "request: unknown spacing -> off; lights forced off outside Underground");
}

// ---------------------------------------------------------------------------
// 2. NORMAL Survival, boosters every 8 over 17 rails -> 3 boosters.
// ---------------------------------------------------------------------------
{
  const dim = createMockDimension({ groundY: 63 });
  const player = createMockPlayer({
    id: "b1",
    heldItemTypeId: "minecraft:rail",
    items: [
      { typeId: "minecraft:rail", amount: 32 },
      { typeId: GOLDEN, amount: 10 },
      { typeId: REDSTONE, amount: 10 },
    ],
    location: { x: 0, y: 64, z: 0 },
    rotation: { x: 0, y: 270 }, // EAST
    dimension: dim,
  });
  const graph = buildV2DependencyGraph(
    menuStub({ mode: "NORMAL", length: 17, boosterSpacing: 8, then: [{ cancelled: false, action: MenuAction.UNDO }] })
  );
  const { context, result } = await run(graph, player);
  assertEqual(result.status, PipelineResultStatus.SUCCESS, "normal boosters: build succeeds");

  const rails = context.buildPlan.railPositions;
  for (const i of [0, 8, 16]) {
    assertEqual(dim.getBlock(rails[i]).typeId, GOLDEN, `normal boosters: rail ${i} is a powered rail`);
    assertEqual(dim.getBlock(below(rails[i])).typeId, REDSTONE, `normal boosters: redstone block under rail ${i}`);
  }
  assertEqual(dim.getBlock(rails[1]).typeId, "minecraft:rail", "normal boosters: other rails stay plain");
  assertEqual(dim.getBlock(below(rails[1])).typeId, "minecraft:stone", "normal boosters: ground untouched elsewhere");
  assertEqual(count(player, "minecraft:rail"), 32 - 14, "normal boosters: 14 plain rails spent (3 replaced by boosters)");
  assertEqual([count(player, GOLDEN), count(player, REDSTONE)], [7, 7], "normal boosters: 3 powered rails + 3 redstone blocks spent");
  assertTrue(
    player.sentChatMessages.some((m) => m.translate === LocalizationKeys.EXTRAS_BOOSTERS_PLACED && m.with.join() === "3,3"),
    "normal boosters: 'placed 3 of 3' reported"
  );
  assertTrue(
    rails.every((p, i) => (i % 8 === 0 ? context.buildPlan.containsPosition(below(p)) : true)),
    "normal boosters: power positions are inside the build's claimed area"
  );

  await run(graph, player); // undo
  assertEqual(dim.getBlock(below(rails[8])).typeId, "minecraft:stone", "normal boosters undo: ground restored under booster");
  assertEqual(dim.getBlock(rails[8]).typeId, "minecraft:air", "normal boosters undo: booster rail removed");
  assertEqual(
    [count(player, "minecraft:rail"), count(player, GOLDEN), count(player, REDSTONE)],
    [32, 10, 10],
    "normal boosters undo: every item refunded"
  );
}

// ---------------------------------------------------------------------------
// 3. Survival without boosters' items -> plain rails, nothing under them,
//    build still succeeds, shortfall explained.
// ---------------------------------------------------------------------------
{
  const dim = createMockDimension({ groundY: 63 });
  const player = createMockPlayer({
    id: "b2",
    heldItemTypeId: "minecraft:rail",
    items: [
      { typeId: "minecraft:rail", amount: 32 },
      { typeId: GOLDEN, amount: 1 }, // enough for one booster, no redstone at all
    ],
    location: { x: 0, y: 64, z: 0 },
    rotation: { x: 0, y: 270 },
    dimension: dim,
  });
  const graph = buildV2DependencyGraph(menuStub({ mode: "NORMAL", length: 10, boosterSpacing: 8 }));
  const { context, result } = await run(graph, player);
  assertEqual(result.status, PipelineResultStatus.SUCCESS, "booster shortfall: build still succeeds");
  const rails = context.buildPlan.railPositions;
  assertEqual(dim.getBlock(rails[0]).typeId, "minecraft:rail", "booster shortfall: plain rail instead");
  assertEqual(dim.getBlock(below(rails[0])).typeId, "minecraft:stone", "booster shortfall: no redstone placed");
  assertEqual(count(player, GOLDEN), 1, "booster shortfall: powered rail not consumed");
  assertTrue(chatKeys(player).includes(LocalizationKeys.EXTRAS_BOOSTERS_SHORT), "booster shortfall: explained to player");
}

// ---------------------------------------------------------------------------
// 4. UNDERGROUND Creative, lights every 8 -> glowstone in the left wall.
// ---------------------------------------------------------------------------
{
  const dim = createMockDimension({ groundY: 100 });
  const player = createMockPlayer({
    id: "l1",
    gameMode: "Creative",
    heldItemTypeId: "minecraft:rail",
    location: { x: 0, y: 101, z: 0 },
    dimension: dim,
  });
  const graph = buildV2DependencyGraph(
    menuStub({ mode: "UNDERGROUND", modeValue: 5, length: 20, lightSpacing: 8, then: [{ cancelled: false, action: MenuAction.UNDO }] })
  );
  const { context, result } = await run(graph, player);
  assertEqual(result.status, PipelineResultStatus.SUCCESS, "lights: underground build succeeds");
  const lights = context.buildPlan.extras.lights;
  assertTrue(lights.length >= 2, "lights: at least two planned");
  assertTrue(lights.every((l) => dim.getBlock(l.position).typeId === GLOWSTONE), "lights: every planned light is glowstone");
  assertTrue(
    lights.every((l) => dim.getBlock(context.buildPlan.railPositions[l.index]).typeId === "minecraft:rail"),
    "lights: rails beside the lights still in place"
  );
  assertTrue(chatKeys(player).includes(LocalizationKeys.EXTRAS_LIGHTS_PLACED), "lights: count reported");

  await run(graph, player); // undo
  assertTrue(lights.every((l) => dim.getBlock(l.position).typeId === "minecraft:stone"), "lights undo: walls back to stone");
}

// ---------------------------------------------------------------------------
// 5. UNDERGROUND Survival with no light blocks -> built without, told why.
//    With sea lanterns -> those are used.
// ---------------------------------------------------------------------------
{
  for (const [items, expectId, label] of [
    [[], null, "no light blocks"],
    [[{ typeId: "minecraft:sea_lantern", amount: 5 }], "minecraft:sea_lantern", "sea lanterns"],
  ]) {
    const dim = createMockDimension({ groundY: 100 });
    const player = createMockPlayer({
      id: `l-${label}`,
      heldItemTypeId: "minecraft:rail",
      items: [{ typeId: "minecraft:rail", amount: 64 }, ...items],
      location: { x: 0, y: 101, z: 0 },
      dimension: dim,
    });
    const graph = buildV2DependencyGraph(menuStub({ mode: "UNDERGROUND", modeValue: 5, length: 12, lightSpacing: 8 }));
    const { context, result } = await run(graph, player);
    assertEqual(result.status, PipelineResultStatus.SUCCESS, `lights (${label}): build succeeds`);
    const light = context.buildPlan.extras.lights[0];
    if (expectId) {
      assertEqual(dim.getBlock(light.position).typeId, expectId, `lights (${label}): carried light block used`);
      assertEqual(count(player, expectId), 4, `lights (${label}): one light block spent`);
    } else {
      assertEqual(dim.getBlock(light.position).typeId, "minecraft:stone", `lights (${label}): wall left alone`);
      assertTrue(chatKeys(player).includes(LocalizationKeys.EXTRAS_NO_LIGHT_BLOCKS), `lights (${label}): told to carry light blocks`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. BRIDGE Survival with boosters: redstone goes in as the surface block
//    where the deck needs one; every booster rail is powered.
// ---------------------------------------------------------------------------
{
  const dim = createMockDimension({ groundY: 60 });
  const player = createMockPlayer({
    id: "b3",
    heldItemTypeId: "minecraft:rail",
    items: [
      { typeId: "minecraft:rail", amount: 64 },
      { typeId: "minecraft:cobblestone", amount: 64 },
      { typeId: GOLDEN, amount: 10 },
      { typeId: REDSTONE, amount: 10 },
    ],
    location: { x: 0, y: 64, z: 0 },
    dimension: dim,
  });
  const graph = buildV2DependencyGraph(
    menuStub({ mode: "BRIDGE", modeValue: 3, length: 18, materialId: "minecraft:cobblestone", boosterSpacing: 8 })
  );
  const { context, result } = await run(graph, player);
  assertEqual(result.status, PipelineResultStatus.SUCCESS, "bridge boosters: build succeeds");
  const { boosters } = context.buildPlan.extras;
  const rails = context.buildPlan.railPositions;
  assertTrue(boosters.length >= 2, "bridge boosters: at least two planned");
  for (const b of boosters) {
    assertEqual(dim.getBlock(rails[b.index]).typeId, GOLDEN, `bridge boosters: deck rail ${b.index} powered`);
    assertEqual(dim.getBlock(b.powerPosition).typeId, REDSTONE, `bridge boosters: redstone under deck rail ${b.index}`);
  }
  const supportKeys = new Set(context.buildPlan.bridgeSupportPositions.map((p) => `${p.x},${p.y},${p.z}`));
  const surfaceBoosters = boosters.filter((b) => supportKeys.has(`${b.powerPosition.x},${b.powerPosition.y},${b.powerPosition.z}`));
  assertTrue(surfaceBoosters.length > 0, "bridge boosters: at least one booster sits on the bridge surface");
  assertEqual(
    count(player, "minecraft:cobblestone"),
    64 - (context.buildPlan.requiredMaterialCount - surfaceBoosters.length),
    "bridge boosters: no cobblestone wasted under boosters"
  );
}

// ---------------------------------------------------------------------------
// 7. Real BuildMenu: dropdowns, defaults, summary line.
// ---------------------------------------------------------------------------
{
  const menu = new BuildMenu();
  const player = createMockPlayer({ id: "m1" });
  const bounds = { minLength: 1, maxLength: 64, step: 1, defaultLength: 32 };
  resetFormResponses();

  queueFormResponse(player, { canceled: false, formValues: [20, 2] }); // length, booster index 2 -> 16
  const normal = await menu.promptForConfiguration(player, "NORMAL", bounds);
  assertEqual([normal.length, normal.boosterSpacing, normal.lightSpacing], [20, 16, 0], "menu: normal -> length + booster dropdown");

  queueFormResponse(player, { canceled: false, formValues: [6, 30, 0, 4] }); // depth, length, boosters off, lights index 4 -> 16
  const ug = await menu.promptForConfiguration(player, "UNDERGROUND", bounds);
  assertEqual([ug.modeValue, ug.length, ug.boosterSpacing, ug.lightSpacing], [6, 30, 0, 16], "menu: underground -> both dropdowns");

  queueFormResponse(player, { canceled: false, formValues: [6, 30] }); // dropdowns untouched
  const defaults = await menu.promptForConfiguration(player, "UNDERGROUND", { ...bounds, defaultBoosterSpacing: 24 });
  assertEqual([defaults.boosterSpacing, defaults.lightSpacing], [24, 8], "menu: untouched dropdowns -> remembered/default values");

  let summaryBody;
  const { MessageFormData } = await import("@minecraft/server-ui");
  const originalBody = MessageFormData.prototype.body;
  MessageFormData.prototype.body = function (b) {
    summaryBody = b;
    return originalBody ? originalBody.call(this, b) : this;
  };
  queueFormResponse(player, { canceled: false, selection: 0 });
  await menu.promptForSummary(player, {
    railTypeId: "minecraft:rail",
    mode: "NORMAL",
    length: 10,
    direction: "east",
    boosterSpacing: 8,
  });
  assertTrue(summaryBody?.rawtext?.[2]?.translate === LocalizationKeys.MENU_SUMMARY_EXTRAS, "menu: summary shows the extras line");
  queueFormResponse(player, { canceled: false, selection: 0 });
  await menu.promptForSummary(player, { railTypeId: "minecraft:rail", mode: "NORMAL", length: 10, direction: "east" });
  assertEqual(summaryBody?.translate, LocalizationKeys.MENU_SUMMARY_BODY_NORMAL, "menu: no extras -> v1 summary body");
  MessageFormData.prototype.body = originalBody;
}

// ---------------------------------------------------------------------------
// 8. Repeat keeps the extras choices.
// ---------------------------------------------------------------------------
{
  const player = createMockPlayer({
    id: "rp",
    gameMode: "Creative",
    heldItemTypeId: "minecraft:rail",
    location: { x: 0, y: 101, z: 0 },
    dimension: createMockDimension({ groundY: 100 }),
  });
  const graph = buildV2DependencyGraph(
    menuStub({
      mode: "UNDERGROUND",
      modeValue: 4,
      length: 10,
      boosterSpacing: 16,
      lightSpacing: 12,
      then: [{ cancelled: false, action: MenuAction.REPEAT }],
    })
  );
  await run(graph, player);
  player.location = { x: 20, y: 101, z: 0 };
  const second = await run(graph, player);
  assertEqual(
    [second.context.request.boosterSpacing, second.context.request.lightSpacing],
    [16, 12],
    "repeat: booster + light spacing reused"
  );
}

// ---------------------------------------------------------------------------
// 9. Optimization: inventory slot hints. 64 check+deduct cycles with the
//    rails sitting in the last slot read far fewer slots than full scans.
// ---------------------------------------------------------------------------
{
  const inventoryManager = new InventoryManager();
  const player = createMockPlayer({ id: "perf" });
  const container = player.getComponent("minecraft:inventory").container;
  for (let i = 0; i < 35; i++) container.addItem("minecraft:dirt", 1); // fill slots 0-34
  container.addItem("minecraft:rail", 64); // slot 35

  let reads = 0;
  const realGetItem = container.getItem.bind(container);
  container.getItem = (slot) => {
    reads += 1;
    return realGetItem(slot);
  };
  for (let i = 0; i < 64; i++) {
    assertTrue(inventoryManager.hasAtLeast(player, "minecraft:rail", 1), `perf: rail ${i} available`);
    inventoryManager.deductRailItems(player, "minecraft:rail", 1);
  }
  const fullScanReads = 64 * 2 * 36;
  if (process.env.SHOW_PERF) console.log(`slot reads: ${reads} (full scans would be ${fullScanReads})`);
  assertTrue(reads < fullScanReads / 10, `perf: ${reads} slot reads vs ${fullScanReads} without hints (>10x fewer)`);
  assertEqual(inventoryManager.countRailItems(player, "minecraft:rail"), 0, "perf: exactly 64 rails deducted");
  assertTrue(!inventoryManager.hasAtLeast(player, "minecraft:rail", 1), "perf: empty after the last deduction (stale hint is safe)");
}

if (failures.length > 0) {
  console.log("FAILURES:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
console.log(`${passed} passed, ${failed} failed (${passed + failed} assertions total).`);
process.exitCode = failed > 0 ? 1 : 0;
