/**
 * UndergroundConfig.js
 *
 * PURPOSE
 *   Single source of truth for Underground Mode's construction constants —
 *   added Roadmap Phase 17 (Project Prompt 17), matching
 *   `config/TunnelConfig.js`/`config/BridgeConfig.js`'s existing pattern.
 *   Project Prompt 17 asked explicitly to "keep dimensions centralized and
 *   configurable for future updates"; this file is that.
 *
 * WHY A SEPARATE FILE FROM TunnelConfig.js
 *   `TUNNEL_CONFIG` describes NORMAL mode's incidental bore-through-a-hill
 *   tunnels, whose `MAX_SEARCH_LENGTH` has its own hard-won tuning history
 *   (see that file). Underground Mode is a different feature with a
 *   different reason to change — reusing `TUNNEL_CONFIG` directly would
 *   mean a future tweak to one silently altering the other. The two share
 *   the same VALUES for width/height today, deliberately (a player-sized
 *   tunnel is a player-sized tunnel), and `WIDTH`/`RAIL_LEVEL_CLEARANCE`
 *   below document that they're expected to stay in sync — but they're
 *   free to diverge without one breaking the other.
 *
 * DEPENDENCIES
 *   None.
 */

export const UNDERGROUND_CONFIG = Object.freeze({
  /**
   * Horizontal width of the excavated corridor — always 1, same as
   * TUNNEL_CONFIG.WIDTH, since this addon's rails never curve or widen.
   */
  WIDTH: 1,

  /**
   * Vertical clearance at a FLAT underground rail position: the rail's own
   * block plus one block of headroom above it. Matches TUNNEL_CONFIG.HEIGHT
   * and its established interpretation (Project Prompt 12, ARCHITECTURE.md
   * §37.2): "2 blocks of clearance" means 2 total INCLUDING the rail level,
   * which is exactly a player's 2-block hitbox.
   */
  RAIL_LEVEL_CLEARANCE: 2,

  /**
   * Vertical clearance at a SLOPED (descending-ramp) rail position — one
   * block MORE than a flat position.
   *
   * WHY SLOPES GET AN EXTRA BLOCK (a deliberate, documented choice, not an
   * oversight in either direction)
   *   A minecart on a sloped rail sits partway up its block, so a rider's
   *   head occupies a higher point than it does on flat track. A strictly
   *   2-high diagonal corridor is the geometric minimum and mostly works,
   *   but leaves zero margin exactly where Project Prompt 17 asks for the
   *   most care ("the tunnel should allow a player to travel through it
   *   without suffocation under normal circumstances"). One extra block
   *   per ramp position costs at most `depth` additional excavated blocks
   *   (64 in the worst case) and buys real margin on the only part of the
   *   route where clearance is genuinely tight. This is NOT "blindly
   *   clearing a huge vertical shaft" — it applies only to the ramp
   *   positions, never to the flat run, and is bounded by `depth`.
   *   Flagged for your review: if in-game testing shows 2 is plainly
   *   enough, dropping this to 2 makes ramps cheaper and is a one-line
   *   change here, affecting nothing else.
   */
  SLOPE_LEVEL_CLEARANCE: 3,

  /**
   * How Underground excavation treats ore blocks in its path. See
   * config/OreRegistry.js's header for why the default is the middle
   * option rather than either extreme, and ARCHITECTURE.md §45.6 for the
   * full policy write-up.
   *
   *   "PROTECT_VALUABLE" (default) — a VALUABLE_ORE_IDS block anywhere in
   *     the excavation volume rejects the plan before anything is
   *     modified, reporting the exact blocking coordinate. COMMON_ORE_IDS
   *     blocks are excavated, but counted and reported to the player on
   *     completion — never destroyed silently.
   *   "PROTECT_ALL" — ANY ore (either tier) rejects the plan. Safest, but
   *     will fail most real tunnels below y=0.
   *   "EXCAVATE_ALL" — no ore ever blocks a build; all excavated ores are
   *     still counted and reported.
   *
   * All three are fully implemented in terrain/TerrainScanner.js's
   * `planUnderground()` — switching is genuinely a one-constant change,
   * which is the "prepare the foundation for future settings" Project
   * Prompt 17 asked for without building the settings UI it explicitly
   * scoped out.
   */
  ORE_POLICY: "PROTECT_VALUABLE",

  /**
   * WATERPROOF TUNNEL (Project Prompt 18): the block used to seal the
   * lateral/roof faces where excavation intersects a body of water — see
   * terrain/WaterDetector.js's `findLateralSealPositions()` and
   * terrain/TerrainScanner.js's `planUnderground()` for how those positions
   * are found. Chosen for the same reason `BridgeConfig.js`'s
   * `FALLBACK_MATERIAL_ID` uses cobblestone: solid, non-flammable, and
   * doesn't interact unusually with water. Placed for free, like every
   * other excavation-adjacent write this addon makes (see
   * builder/TunnelExcavator.js's established "no resource cost" precedent)
   * — sealing a tunnel against flooding is a structural safety necessity of
   * tunneling through water, not a player-chosen material the way Bridge
   * Mode's deck is (Project Prompt 18 explicitly asked not to introduce a
   * second material-selection system for Underground Mode). Flagged for
   * your review like every other unspecified default in this project — a
   * one-line change, nothing else depends on the specific block chosen.
   */
  SEAL_BLOCK_ID: "minecraft:stone",

  /**
   * v2.0.0 Step 4 — cave gap filling. When "Fill cave gaps" is on and an
   * underground rail would sit over an open cave, a support column of
   * SEAL_BLOCK_ID is built from the first solid block below up to the
   * rail's floor, at most this many blocks tall. Deeper drops are still
   * rejected (UNSUPPORTED_FLOOR), exactly as before. Free like seals: the
   * tunnel already removes far more stone than it ever puts back.
   */
  CAVE_FILL_MAX_DEPTH: 12,
});
