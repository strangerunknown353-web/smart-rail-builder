import { BlockPermutation } from "@minecraft/server";
import { CardinalDirection } from "../utils/DirectionUtils.js";

/**
 * RailPermutationBuilder.js
 *
 * PURPOSE
 *   Computes the correct BlockPermutation for a straight rail segment,
 *   explicitly — not by relying on vanilla's neighbor-sensing auto-
 *   connection logic. See WHY EXPLICIT, NOT AUTO-CONNECTED below.
 *
 * BEDROCK RAIL BLOCK STATES (Project Prompt 10 — verified against a
 * community-maintained, Bedrock-specific block-states reference; NOT found
 * in an official, version-pinned Microsoft source — see
 * ARCHITECTURE.md §29.2 for the full disclosure of this uncertainty)
 *   - `minecraft:rail` has one relevant state: `rail_direction` (int 0-9).
 *     0 = straight, aligned north-south. 1 = straight, aligned east-west.
 *     2-5 = ascending (slopes — used starting Project Prompt 11, see
 *     ASCENDING RAIL DIRECTION MAPPING below). 6-9 = curves (not used yet).
 *   - `minecraft:golden_rail`, `minecraft:detector_rail`,
 *     `minecraft:activator_rail` have the same `rail_direction` (0-7 only —
 *     no curves for powered variants, matching vanilla) PLUS a second state,
 *     `rail_data_bit` (boolean), which is the "powered/active" bit. Set to
 *     `false` here — this addon places rails in their default, unpowered
 *     visual state; it does not attempt to control redstone power.
 *
 * ASCENDING RAIL DIRECTION MAPPING (Project Prompt 11 — THE SESSION'S
 * HIGHEST-RISK ASSUMPTION, higher even than the 0/1 values above)
 *   Neither an official Microsoft source nor a community reference with an
 *   explicit numeric table could be found this session for which of
 *   `rail_direction` 2-5 corresponds to which ascending compass direction —
 *   the search results that did turn up (e.g. minecraftitemids.com) describe
 *   a `shape` STRING enum, which is Java Edition's block-state scheme, not
 *   Bedrock's integer `rail_direction`. The mapping below follows the
 *   long-standing, pre-flattening Minecraft rail metadata convention (the
 *   same numbering Bedrock is understood to have carried forward for this
 *   block): 2 = ascending_east, 3 = ascending_west, 4 = ascending_north,
 *   5 = ascending_south. This is a HIGH-confidence recollection, not a
 *   confirmed one. If it's wrong, every ascending rail will visually face
 *   backwards (tilted the wrong way) rather than crash — `BlockPermutation.resolve()`
 *   would still succeed with any of the 4 values, since all are valid
 *   `rail_direction` states; only the visual/mechanical direction would be
 *   wrong. This is exactly why the manual testing checklist's first slope
 *   test asks you to build a single ascending step and visually confirm
 *   which way it tilts before testing anything more complex — see
 *   ARCHITECTURE.md §36.3.
 *   "ascending_D" means: this specific rail block's low edge (connecting
 *   down to a flat rail one block lower) faces away from D, and its high
 *   edge faces toward D — i.e. traveling in direction D across this block
 *   climbs. See TerrainScanner.js's `_resolveRailShapes()` for how the
 *   correct direction (not necessarily the direction of travel — see
 *   DESCENDING's case) is chosen for each sloped block.
 *
 * WHY EXPLICIT, NOT AUTO-CONNECTED
 *   Vanilla rail placement (a real player right-clicking) senses neighbors
 *   and auto-selects a connecting shape. `BlockPermutation`/`setPermutation`
 *   are lower-level APIs that set raw block data directly — they are not
 *   confirmed to run that same neighbor-sensing logic (see
 *   ARCHITECTURE.md §29.1). Rather than depend on unconfirmed side effects
 *   of a raw data-setting call, this addon computes the exact state itself:
 *   for a straight, single-direction railway (this addon's only supported
 *   shape — no curves), the correct state is fully determined by the
 *   travel direction and (as of Project Prompt 11) each block's resolved
 *   slope direction, both already known before placement — no
 *   neighbor-sensing is needed at all.
 *
 * FUTURE EXTENSIONS
 *   - Curved rails (Roadmap Phase 11+) would add a sibling function here,
 *     e.g. `buildCurvedRailPermutation()`, using states 6-9 — this function
 *     and buildAscendingRailPermutation() are unaffected.
 *
 * DEPENDENCIES
 *   - @minecraft/server (BlockPermutation)
 *   - utils/DirectionUtils.js (CardinalDirection)
 */

/** Vanilla rail item/block IDs that carry the extra rail_data_bit (powered) state. */
const POWERED_RAIL_TYPE_IDS = Object.freeze([
  "minecraft:golden_rail",
  "minecraft:detector_rail",
  "minecraft:activator_rail",
]);

/**
 * See ASCENDING RAIL DIRECTION MAPPING above — this is the session's
 * highest-risk unconfirmed assumption.
 * @type {Readonly<Record<string, number>>}
 */
// v2.0.0 optimization: a build places the same few rail permutations over
// and over (one rail type x 2 straight orientations + 4 slopes), so each
// resolved BlockPermutation is cached by type + rail_direction instead of
// being re-resolved for every rail. A failed resolve throws before caching,
// so an invalid type is never remembered.
const _permutationCache = new Map();

function resolveRailPermutation(railTypeId, railDirection) {
  const key = `${railTypeId}|${railDirection}`;
  let permutation = _permutationCache.get(key);
  if (!permutation) {
    const states = POWERED_RAIL_TYPE_IDS.includes(railTypeId)
      ? { rail_direction: railDirection, rail_data_bit: false }
      : { rail_direction: railDirection };
    permutation = BlockPermutation.resolve(railTypeId, states);
    _permutationCache.set(key, permutation);
  }
  return permutation;
}

const ASCENDING_RAIL_DIRECTION = Object.freeze({
  [CardinalDirection.EAST]: 2,
  [CardinalDirection.WEST]: 3,
  [CardinalDirection.NORTH]: 4,
  [CardinalDirection.SOUTH]: 5,
});

/**
 * @param {string} railTypeId Vanilla rail item/block type ID, see config/RailConfig.js.
 * @param {import("../utils/DirectionUtils.js").CardinalDirection} direction Direction of travel for this straight railway.
 * @returns {import("@minecraft/server").BlockPermutation}
 */
export function buildStraightRailPermutation(railTypeId, direction) {
  const isNorthSouth = direction === CardinalDirection.NORTH || direction === CardinalDirection.SOUTH;
  const railDirection = isNorthSouth ? 0 : 1;

  return resolveRailPermutation(railTypeId, railDirection);
}

/**
 * Added Project Prompt 11 (Roadmap Phase 11). See ASCENDING RAIL DIRECTION
 * MAPPING above for the exact int values used and their confidence level.
 *
 * @param {string} railTypeId Vanilla rail item/block type ID, see config/RailConfig.js.
 * @param {import("../utils/DirectionUtils.js").CardinalDirection} ascendingDirection
 *   The compass direction this specific block should visually climb toward
 *   — from `TerrainPositionFact.slopeDirection` (see terrain/TerrainScanner.js),
 *   not necessarily the overall direction of travel (a descending step's
 *   sloped block climbs toward where the player came from — see that
 *   file's `_resolveRailShapes()`).
 * @returns {import("@minecraft/server").BlockPermutation}
 */
export function buildAscendingRailPermutation(railTypeId, ascendingDirection) {
  const railDirection = ASCENDING_RAIL_DIRECTION[ascendingDirection];
  if (railDirection === undefined) {
    throw new Error(`RailPermutationBuilder: unknown ascending direction "${ascendingDirection}"`);
  }

  return resolveRailPermutation(railTypeId, railDirection);
}
