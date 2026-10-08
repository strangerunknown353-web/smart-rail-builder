/**
 * interactionGate.test.mjs
 *
 * v2.0.0, Project Step 1 — crouch-to-open. Covers:
 *   1. core/InteractionGate.js's pure decision table.
 *   2. The real main.js wiring: imports main.js (which subscribes to the
 *      mock's world.beforeEvents.playerInteractWithBlock) and fires rail
 *      interactions at it, asserting on `event.cancel` and what gets
 *      scheduled via system.run.
 *   3. Every LocalizationKeys value has a line in RP/texts/en_US.lang.
 *
 * Run: node tests/interactionGate.test.mjs
 */

import { readFileSync } from "node:fs";
import { system, world } from "@minecraft/server";
import { InteractionGate, InteractionDecision } from "../BP/scripts/core/InteractionGate.js";
import { RAIL_ITEM_IDS } from "../BP/scripts/config/RailConfig.js";
import { LocalizationKeys } from "../BP/scripts/localization/LocalizationKeys.js";
import { createMockPlayer } from "./mockPlayer.mjs";

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

function makeEvent({ typeId = "minecraft:rail", isFirstEvent = true, isSneaking = false, player } = {}) {
  const p = player ?? createMockPlayer({ id: "p1" });
  p.isSneaking = isSneaking;
  return { itemStack: typeId ? { typeId } : undefined, isFirstEvent, player: p, cancel: false };
}

// ---------------------------------------------------------------------------
// 1. Decision table
// ---------------------------------------------------------------------------
{
  const gate = new InteractionGate(RAIL_ITEM_IDS);

  for (const railId of RAIL_ITEM_IDS) {
    assertEqual(gate.decide(makeEvent({ typeId: railId, isSneaking: true })), InteractionDecision.OPEN_MENU, `${railId}: crouching opens the menu`);
    assertEqual(gate.decide(makeEvent({ typeId: railId, isSneaking: false })), InteractionDecision.VANILLA, `${railId}: standing places vanilla`);
  }
  assertEqual(gate.decide(makeEvent({ typeId: "minecraft:stone", isSneaking: true })), InteractionDecision.IGNORE, "non-rail item is ignored");
  assertEqual(gate.decide(makeEvent({ typeId: null, isSneaking: true })), InteractionDecision.IGNORE, "empty hand is ignored");
  assertEqual(gate.decide(makeEvent({ isFirstEvent: false, isSneaking: true })), InteractionDecision.IGNORE, "held-button repeat (crouching) is ignored");
  assertEqual(gate.decide(makeEvent({ isFirstEvent: false, isSneaking: false })), InteractionDecision.IGNORE, "held-button repeat (standing) is ignored");

  const playerWithoutFlag = createMockPlayer({ id: "noflag" });
  const event = { itemStack: { typeId: "minecraft:rail" }, isFirstEvent: true, player: playerWithoutFlag };
  assertEqual(gate.decide(event), InteractionDecision.VANILLA, "missing isSneaking is treated as standing");

  const legacy = new InteractionGate(RAIL_ITEM_IDS, { requireSneak: false });
  assertEqual(legacy.decide(makeEvent({ isSneaking: false })), InteractionDecision.OPEN_MENU, "requireSneak:false restores v1.0.0 always-open behavior");

  assertTrue(gate.takeHint("a"), "hint: first call for a player returns true");
  assertTrue(!gate.takeHint("a"), "hint: second call for the same player returns false");
  assertTrue(gate.takeHint("b"), "hint: tracked per player");
}

// ---------------------------------------------------------------------------
// 2. Real main.js wiring
// ---------------------------------------------------------------------------
{
  await import("../BP/scripts/main.js");
  system.flushRunQueue(); // nothing should be queued at load, but start clean

  // Standing: vanilla placement goes through, one-time hint is scheduled.
  const stander = createMockPlayer({ id: "stander", heldItemTypeId: "minecraft:rail" });
  const standEvent = makeEvent({ player: stander, isSneaking: false });
  world.beforeEvents.playerInteractWithBlock.emit(standEvent);
  assertEqual(standEvent.cancel, false, "main.js: standing does NOT cancel vanilla placement");
  assertEqual(system.flushRunQueue(), 1, "main.js: standing schedules exactly one task (the hint)");
  assertEqual(
    stander.sentActionBarMessages.map((m) => m.translate),
    [LocalizationKeys.ACTIONBAR_CROUCH_HINT],
    "main.js: standing shows the crouch hint"
  );

  const standEvent2 = makeEvent({ player: stander, isSneaking: false });
  world.beforeEvents.playerInteractWithBlock.emit(standEvent2);
  assertEqual(standEvent2.cancel, false, "main.js: second standing placement still vanilla");
  assertEqual(system._runQueue.length, 0, "main.js: hint is not repeated for the same player");

  // Crouching: vanilla placement cancelled, the build is scheduled.
  const croucher = createMockPlayer({ id: "croucher", heldItemTypeId: "minecraft:rail" });
  const crouchEvent = makeEvent({ player: croucher, isSneaking: true });
  world.beforeEvents.playerInteractWithBlock.emit(crouchEvent);
  assertEqual(crouchEvent.cancel, true, "main.js: crouching cancels vanilla placement");
  assertEqual(system._runQueue.length, 1, "main.js: crouching schedules the build pipeline");
  system._runQueue.splice(0); // don't run the full pipeline against this bare mock player

  // Non-rail items are never touched.
  const otherEvent = makeEvent({ typeId: "minecraft:stone", isSneaking: true });
  world.beforeEvents.playerInteractWithBlock.emit(otherEvent);
  assertEqual(otherEvent.cancel, false, "main.js: non-rail item is never cancelled");
  assertEqual(system._runQueue.length, 0, "main.js: non-rail item schedules nothing");
}

// ---------------------------------------------------------------------------
// 3. Localization coverage
// ---------------------------------------------------------------------------
{
  const lang = readFileSync(new URL("../RP/texts/en_US.lang", import.meta.url), "utf8");
  const definedKeys = new Set(
    lang
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => line.slice(0, line.indexOf("=")).trim())
  );
  const missing = Object.values(LocalizationKeys).filter((key) => !definedKeys.has(key));
  assertEqual(missing, [], "every LocalizationKeys value has an en_US.lang entry");
}

if (failures.length > 0) {
  console.log("FAILURES:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
console.log(`${passed} passed, ${failed} failed (${passed + failed} assertions total).`);
process.exitCode = failed > 0 ? 1 : 0;
