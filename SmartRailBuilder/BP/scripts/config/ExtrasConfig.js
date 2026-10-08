/**
 * ExtrasConfig.js
 *
 * PURPOSE (v2.0.0, Project Step 3)
 *   Tunables for the two optional "extras" a build can add on top of its
 *   rails — see core/ExtrasPlan.js (where they go) and builder/ExtrasBuilder.js
 *   (how they're placed).
 *
 *   - BOOSTERS: every Nth rail becomes a powered rail with a redstone block
 *     directly underneath it (a redstone block powers the rail above it), so
 *     minecarts keep their speed over long lines. Any build mode.
 *   - TUNNEL LIGHTS: every Nth step of an Underground tunnel gets a light
 *     block set into the tunnel wall at head height — lights the tunnel so
 *     mobs don't spawn in it, without narrowing the 1-wide corridor. A full
 *     light block (not a torch) also keeps the wall waterproof.
 *
 *   Spacing values are offered as fixed choices (a dropdown), not a free
 *   slider: 0 means "off".
 */

export const EXTRAS_CONFIG = Object.freeze({
  /**
   * v2.0.0 Step 4 — bridge guard rails: fences either side of the deck.
   * Fences only (no walls): Bedrock fences connect on their own, while
   * walls carry connection states setPermutation() wouldn't update.
   * Survival uses the first fence type carried; Creative the first listed.
   */
  FENCE_IDS: Object.freeze([
    "minecraft:oak_fence",
    "minecraft:spruce_fence",
    "minecraft:birch_fence",
    "minecraft:jungle_fence",
    "minecraft:acacia_fence",
    "minecraft:dark_oak_fence",
    "minecraft:mangrove_fence",
    "minecraft:cherry_fence",
    "minecraft:pale_oak_fence",
    "minecraft:bamboo_fence",
    "minecraft:crimson_fence",
    "minecraft:warped_fence",
    "minecraft:nether_brick_fence",
  ]),

  /** Dropdown choices for booster spacing, in rails. 0 = off. */
  BOOSTER_SPACING_OPTIONS: Object.freeze([0, 8, 16, 24, 32]),
  /** Off by default: boosters cost powered rails + redstone blocks. */
  DEFAULT_BOOSTER_SPACING: 0,

  /** Dropdown choices for tunnel light spacing, in rails. 0 = off. */
  LIGHT_SPACING_OPTIONS: Object.freeze([0, 6, 8, 12, 16]),
  /** On by default: unlit tunnels spawn mobs (ARCHITECTURE.md §45.12). */
  DEFAULT_LIGHT_SPACING: 8,

  BOOSTER_RAIL_ID: "minecraft:golden_rail",
  POWER_BLOCK_ID: "minecraft:redstone_block",

  /**
   * Full-cube light blocks a Survival player can supply, in preference order
   * (the first one they carry is used). Creative always uses the first.
   */
  LIGHT_BLOCK_IDS: Object.freeze([
    "minecraft:glowstone",
    "minecraft:sea_lantern",
    "minecraft:shroomlight",
    "minecraft:ochre_froglight",
    "minecraft:verdant_froglight",
    "minecraft:pearlescent_froglight",
  ]),
});

/**
 * @param {any} value
 * @param {ReadonlyArray<number>} options
 * @param {number} fallback
 * @returns {number} `value` when it's one of `options`, otherwise `fallback`.
 */
export function pickSpacing(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}
