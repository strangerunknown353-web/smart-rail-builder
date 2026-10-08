/**
 * ExtrasPlan.js
 *
 * PURPOSE (v2.0.0, Project Step 3)
 *   Pure planning for boosters and tunnel lights (config/ExtrasConfig.js):
 *   given the build's ordered rail positions, decide which rail indices get
 *   a booster and where each power block / light block goes. Computed once
 *   in BuildPlan.fromContext(), so the positions join the build's
 *   modificationBoundary (multiplayer claims, undo, safety checks) like
 *   every other block the build touches.
 *
 * INDEXING
 *   Rail index i is the same index each strategy's placement loop uses
 *   (terrain report position, underground rail step, bridge deck position).
 *
 * GEOMETRY
 *   - Power block: directly below the rail (rail y - 1).
 *   - Light block: in the tunnel wall to the travel direction's left, at
 *     head height (rail y + 1). The corridor is exactly 1 wide, so that
 *     position is always wall, never corridor.
 *   - Lights sit halfway between boosters' spacing grid (offset by half a
 *     spacing), so the first light isn't right at the tunnel mouth.
 */

import { BuildingMode } from "../config/BuildModes.js";
import { DirectionUtils } from "../utils/DirectionUtils.js";

/**
 * @typedef {Object} ExtrasPlan
 * @property {number} boosterSpacing
 * @property {number} lightSpacing
 * @property {ReadonlyArray<{index: number, powerPosition: {x:number,y:number,z:number}}>} boosters
 * @property {ReadonlyArray<{index: number, position: {x:number,y:number,z:number}}>} lights
 */

/** The block to the LEFT of `direction`, one step sideways. */
function leftOf(direction) {
  const { x, z } = DirectionUtils.toStepVector(direction);
  return { x: z, z: -x };
}

/**
 * @param {Object} params
 * @param {string} params.buildingMode
 * @param {string} params.direction
 * @param {ReadonlyArray<{x:number,y:number,z:number}>} params.railPositions in placement order
 * @param {number} [params.boosterSpacing] 0/undefined = off
 * @param {number} [params.lightSpacing] 0/undefined = off; Underground only
 * @returns {ExtrasPlan}
 */
export function planExtras({ buildingMode, direction, railPositions, boosterSpacing = 0, lightSpacing = 0 }) {
  const boosters = [];
  if (boosterSpacing > 0) {
    for (let i = 0; i < railPositions.length; i += boosterSpacing) {
      const p = railPositions[i];
      boosters.push({ index: i, powerPosition: { x: p.x, y: p.y - 1, z: p.z } });
    }
  }

  const lights = [];
  const effectiveLightSpacing = buildingMode === BuildingMode.UNDERGROUND ? lightSpacing : 0;
  if (effectiveLightSpacing > 0) {
    const side = leftOf(direction);
    for (let i = Math.floor(effectiveLightSpacing / 2); i < railPositions.length; i += effectiveLightSpacing) {
      const p = railPositions[i];
      lights.push({ index: i, position: { x: p.x + side.x, y: p.y + 1, z: p.z + side.z } });
    }
  }

  return { boosterSpacing, lightSpacing: effectiveLightSpacing, boosters, lights };
}

/** An empty plan — what builds without extras (and pre-v2 callers) get. */
export const NO_EXTRAS = Object.freeze({ boosterSpacing: 0, lightSpacing: 0, boosters: Object.freeze([]), lights: Object.freeze([]) });
