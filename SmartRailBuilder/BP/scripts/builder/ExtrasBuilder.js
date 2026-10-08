/**
 * ExtrasBuilder.js
 *
 * PURPOSE (v2.0.0, Project Step 3)
 *   Places the boosters and tunnel lights planned by core/ExtrasPlan.js,
 *   from inside the existing strategies' placement loops. Stateless apart
 *   from the injected InventoryManager; per-build state lives on
 *   `session.extras` (see `createExtrasState()` below), so a session without
 *   extras (every pre-v2 caller and test) makes every method a no-op.
 *
 * NEVER FAILS A BUILD
 *   Extras are a bonus on top of the railway. When one can't be placed —
 *   the Survival player ran out of powered rails / redstone blocks / light
 *   blocks, or the target block isn't safe to replace — it is skipped and
 *   counted, and the rail is placed as normal. PlacementStage reports the
 *   placed/skipped counts at the end.
 *
 * SAFE TO REPLACE
 *   A power or light block only replaces a block that is solid-ish ground or
 *   wall: not air/liquid, not a rail, not unbreakable or a protected
 *   structure block, not a hazard, not a replaceable plant/snow layer. Every
 *   write goes through the session journal, so undo restores it and refunds
 *   the item.
 */

import { BlockPermutation, GameMode } from "@minecraft/server";
import { EXTRAS_CONFIG } from "../config/ExtrasConfig.js";
import { HAZARD_BLOCK_ID_SET } from "../config/HazardRegistry.js";
import { RAIL_ITEM_ID_SET } from "../config/RailConfig.js";
import { REPLACEABLE_BLOCK_ID_SET } from "../config/ReplaceableBlockRegistry.js";
import { UNBREAKABLE_BLOCK_ID_SET } from "../config/UnbreakableBlockRegistry.js";
import { readBlock } from "../utils/BlockReader.js";
import { positionKey } from "../utils/PositionKey.js";
import { Logger } from "../utils/Logger.js";

/**
 * Per-build extras state, attached as `session.extras` by PlacementStage.
 *
 * @param {import("../core/ExtrasPlan.js").ExtrasPlan} plan
 * @param {import("@minecraft/server").Player} player
 * @param {import("../inventory/InventoryManager.js").InventoryManager} inventoryManager
 */
export function createExtrasState(plan, player, inventoryManager) {
  const isCreative = player.getGameMode() === GameMode.Creative;
  const guardRails = plan.guardRails ?? [];
  let fenceId = null;
  if (guardRails.length > 0) {
    fenceId = isCreative
      ? EXTRAS_CONFIG.FENCE_IDS[0]
      : (EXTRAS_CONFIG.FENCE_IDS.find((id) => inventoryManager.hasAtLeast(player, id, 1)) ?? null);
  }
  let lightBlockId = null;
  if (plan.lights.length > 0) {
    lightBlockId = isCreative
      ? EXTRAS_CONFIG.LIGHT_BLOCK_IDS[0]
      : (EXTRAS_CONFIG.LIGHT_BLOCK_IDS.find((id) => inventoryManager.hasAtLeast(player, id, 1)) ?? null);
  }
  return {
    boosterByIndex: new Map(plan.boosters.map((b) => [b.index, b])),
    powerKeys: new Set(plan.boosters.map((b) => positionKey(b.powerPosition))),
    lightByIndex: new Map(plan.lights.map((l) => [l.index, l])),
    lightBlockId,
    boostersRequested: plan.boosters.length,
    boostersPlaced: 0,
    lightsRequested: plan.lights.length,
    lightsPlaced: 0,
    guardRailByIndex: new Map(guardRails.map((g) => [g.index, g])),
    guardRailsRequested: guardRails.length > 0,
    fenceId,
    fencesPlaced: 0,
    fencesRanOut: false,
  };
}

/** Can a power/light block go where `block` is? See this file's header. */
function isSafeToReplace(block) {
  if (block.isAir || block.isLiquid) return false;
  const id = block.typeId;
  return (
    !RAIL_ITEM_ID_SET.has(id) &&
    !UNBREAKABLE_BLOCK_ID_SET.has(id) &&
    !HAZARD_BLOCK_ID_SET.has(id) &&
    !REPLACEABLE_BLOCK_ID_SET.has(id)
  );
}

// Resolved once per world session — same caching idea as RailPermutationBuilder.
const _permutations = new Map();
function permutationFor(typeId) {
  let permutation = _permutations.get(typeId);
  if (!permutation) {
    permutation = BlockPermutation.resolve(typeId);
    _permutations.set(typeId, permutation);
  }
  return permutation;
}

export class ExtrasBuilder {
  /**
   * @param {import("../inventory/InventoryManager.js").InventoryManager} inventoryManager
   */
  constructor(inventoryManager) {
    this._inventoryManager = inventoryManager;
  }

  /**
   * Called by a strategy right before it places the rail at `railIndex`.
   * If this index is a booster and everything it needs is available, puts
   * the redstone block under it (unless one is already there — Bridge Mode
   * places it as the deck surface) and returns the powered-rail type the
   * strategy should place instead of the held rail. Otherwise returns
   * `railTypeId` unchanged.
   *
   * @param {import("../core/BuildSession.js").BuildSession} session
   * @param {number} railIndex
   * @param {string} railTypeId the held rail type
   * @returns {string} the rail type to place at this index
   */
  prepareRail(session, railIndex, railTypeId) {
    const booster = session.extras?.boosterByIndex.get(railIndex);
    if (!booster) return railTypeId;

    const { player, dimension } = session;
    const isSurvival = session.isSurvival;
    const boosterRailId = EXTRAS_CONFIG.BOOSTER_RAIL_ID;
    const powerId = EXTRAS_CONFIG.POWER_BLOCK_ID;

    if (isSurvival && !this._inventoryManager.hasAtLeast(player, boosterRailId, 1)) return railTypeId;

    const read = readBlock(dimension, booster.powerPosition);
    if (read.status !== "OK") return railTypeId;
    if (read.block.typeId !== powerId) {
      if (!isSafeToReplace(read.block)) return railTypeId;
      if (isSurvival && !this._inventoryManager.hasAtLeast(player, powerId, 1)) return railTypeId;
      try {
        session.journal.write(read.block, booster.powerPosition, permutationFor(powerId), isSurvival ? powerId : undefined);
      } catch (error) {
        Logger.warn(`Booster power block failed for ${player.name} at rail ${railIndex}.`, error);
        return railTypeId;
      }
      if (isSurvival) this._inventoryManager.deductRailItems(player, powerId, 1);
    }

    session.extras.boostersPlaced += 1;
    return boosterRailId;
  }

  /**
   * Bridge Mode: the block under a booster rail is a deck-surface block the
   * bridge places itself. Placing the redstone block there instead (when
   * affordable) avoids building the surface block only to replace it.
   *
   * @param {import("../core/BuildSession.js").BuildSession} session
   * @param {{x:number,y:number,z:number}} position a support/surface position
   * @param {string} materialId the bridge material
   * @returns {string} the block type to place there
   */
  bridgeSurfaceBlockFor(session, position, materialId) {
    if (!session.extras?.powerKeys.has(positionKey(position))) return materialId;
    const { player } = session;
    const isSurvival = session.isSurvival;
    if (
      isSurvival &&
      (!this._inventoryManager.hasAtLeast(player, EXTRAS_CONFIG.POWER_BLOCK_ID, 1) ||
        !this._inventoryManager.hasAtLeast(player, EXTRAS_CONFIG.BOOSTER_RAIL_ID, 1))
    ) {
      return materialId;
    }
    return EXTRAS_CONFIG.POWER_BLOCK_ID;
  }

  /**
   * v2.0.0 Step 4 — called by BridgeExecutionStrategy right after it places
   * the deck rail at `railIndex`. Puts a fence on each side of the rail, but
   * only where the side is open (air or a replaceable plant) AND there's a
   * drop under it — so the bridge's elevated span gets railings while ramps
   * on the ground, and anything solid beside the deck, are left alone.
   *
   * @param {import("../core/BuildSession.js").BuildSession} session
   * @param {number} railIndex
   */
  placeGuardRails(session, railIndex) {
    const extras = session.extras;
    const spot = extras?.guardRailByIndex.get(railIndex);
    if (!spot || !extras.fenceId || extras.fencesRanOut) return;

    const { player, dimension } = session;
    const isSurvival = session.isSurvival;
    const fenceId = extras.fenceId;
    for (const position of spot.positions) {
      const read = readBlock(dimension, position);
      if (read.status !== "OK") continue;
      const target = read.block;
      if (!(target.isAir || REPLACEABLE_BLOCK_ID_SET.has(target.typeId)) || target.isLiquid) continue;
      const under = readBlock(dimension, { x: position.x, y: position.y - 1, z: position.z });
      if (under.status !== "OK" || !(under.block.isAir || under.block.isLiquid)) continue;

      if (isSurvival && !this._inventoryManager.hasAtLeast(player, fenceId, 1)) {
        extras.fencesRanOut = true;
        return;
      }
      try {
        session.journal.write(target, position, permutationFor(fenceId), isSurvival ? fenceId : undefined);
      } catch (error) {
        Logger.warn(`Guard rail failed for ${player.name} at rail ${railIndex}.`, error);
        continue;
      }
      if (isSurvival) this._inventoryManager.deductRailItems(player, fenceId, 1);
      extras.fencesPlaced += 1;
    }
  }

  /**
   * Called by UndergroundExecutionStrategy right after it places the rail at
   * `railIndex`. Sets a light block into the wall if one is planned here.
   *
   * @param {import("../core/BuildSession.js").BuildSession} session
   * @param {number} railIndex
   */
  placeLight(session, railIndex) {
    const extras = session.extras;
    const light = extras?.lightByIndex.get(railIndex);
    if (!light || !extras.lightBlockId) return;

    const { player, dimension } = session;
    const isSurvival = session.isSurvival;
    const lightId = extras.lightBlockId;
    if (isSurvival && !this._inventoryManager.hasAtLeast(player, lightId, 1)) return;

    const read = readBlock(dimension, light.position);
    if (read.status !== "OK" || !isSafeToReplace(read.block)) return;
    try {
      session.journal.write(read.block, light.position, permutationFor(lightId), isSurvival ? lightId : undefined);
    } catch (error) {
      Logger.warn(`Tunnel light failed for ${player.name} at rail ${railIndex}.`, error);
      return;
    }
    if (isSurvival) this._inventoryManager.deductRailItems(player, lightId, 1);
    extras.lightsPlaced += 1;
  }
}
