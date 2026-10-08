# Smart Rail Builder v2.0.0 — What's New

Full technical detail is in `CHANGELOG.md`. The step-by-step lists below say exactly what each
project step added.

## Everything in v2 at a glance

**New features (12)**
1. Crouch + use a rail opens the builder; standing places rails one at a time like vanilla
2. Repeat last build (one tap, same settings, current direction)
3. Remembered settings (sliders start at your last build; saved across sessions)
4. Undo last build (restores the world, refunds items, never touches blocks you changed since)
5. Powered boosters (powered rail + redstone block every N rails, all modes)
6. Tunnel lights (light blocks in the walls of Underground tunnels, on by default)
7. Fill cave gaps (Underground tunnels can cross open caves, on by default)
8. Bridge guard rails (fences along the raised part of a bridge)
9. Settings screen (your own defaults, Quick repeat, Show tips)
10. Fewer rails needed when boosters are on
11. The confirm screen shows boosters, lights, cave filling and guard rails
12. New logo and pack icons

**Optimizations (10)**
1. Rail shapes worked out once per build, not once per rail
2. The "air" block for tunnels looked up once, not once per block dug
3. Undo spread over game ticks (32 blocks per tick)
4. Inventory checks ~28× cheaper (163 slot reads instead of 4,608 for 64 rails)
5. Bridge-material checks remembered instead of re-tested (and re-thrown) every time
6. Booster, light and fence block types looked up once per session
7. Logging at INFO instead of DEBUG (no Content Log spam)
8. The final safety check reuses the route scan from the same tick instead of scanning twice
9. Game mode read once per build (4 reads for 40 rails, was 40+)
10. Extras never stop a build: a missing item or odd block just skips that one extra

**Fixes (3)**
1. The behavior pack showed as "pack.name" in the pack list — it now has its own name text
2. With boosters on, a player carrying exactly enough rails could be stopped at a booster spot
3. The "Show tips" setting is read outside Minecraft's restricted before-event mode

## Step 1 — Crouch-to-open
**Features**
- **Crouch + use a rail** opens the Smart Rail Builder menu.
- **Standing + use a rail** places one rail normally, like vanilla (v1 always opened the menu).
- One-time tip on screen the first time you place a rail standing up.
- New logo and pack icons.

## Step 2 — Repeat & Undo
**Features**
- **Repeat last build** — the first button in the menu. It reuses your last mode, length,
  height/depth and bridge material and goes straight to the confirm screen (direction is
  always where you face now). If you no longer carry that bridge material, it asks you to pick again.
- **Remembered settings** — the length and height/depth sliders start at your last values.
  Settings are saved on your player, so they survive leaving and rejoining the world.
- **Undo last build** — the last button in the menu. It removes everything your last build
  placed and refills everything it dug out, including tunnels, bridge supports and waterproof seals.
  - In Survival it returns the rails and bridge blocks the build used.
  - Blocks you changed after the build (a rail you broke, a block you placed) are left alone,
    and you're told how many were skipped, so you never get the same item back twice.
  - Works on partial and cancelled builds too. You get one undo, for your most recent build;
    it's cleared when the world is closed.

**Optimizations**
- Rail shapes are worked out once per build instead of once per rail placed.
- The "air" block used when digging tunnels is looked up once instead of once per block dug.
- Undo spreads its work across game ticks (32 blocks per tick), so undoing a big build doesn't freeze the game.

## Step 3 — Powered boosters & tunnel lights
**Features**
- **Powered boosters** — new "Powered boosters" dropdown on the settings screen (Off / every 8 / 16 /
  24 / 32 blocks), in every mode. Every Nth rail becomes a **powered rail with a redstone block under
  it**, so minecarts keep full speed on long lines.
  - Bridges: under a booster rail the redstone block replaces the bridge's own surface block, so no
    material is wasted.
  - Survival: uses powered rails and redstone blocks from your inventory. If you run out, the build
    just places normal rails and tells you how many boosters it managed — it never fails because of this.
- **Tunnel lights** — new "Tunnel lights" dropdown for Underground mode (Off / every 6 / 8 / 12 / 16,
  **on at every 8 by default**). A light block is set into the tunnel wall at head height, so tunnels
  are lit and mobs don't spawn inside. It doesn't narrow the tunnel and keeps the wall waterproof.
  - Uses glowstone, sea lanterns, shroomlights or froglights from your inventory (Creative: glowstone).
    If you have none, the tunnel is built without lights and you're told what to carry.
- The confirm screen shows your booster and light choices, and **Repeat last build** remembers them.
  (From Step 4, the dropdowns start at your **Settings** defaults rather than your last build.)
- **Undo** removes boosters and lights too, and returns the powered rails, redstone blocks and light blocks.

**Optimizations**
- **Inventory checks ~28× cheaper:** the mod remembers which slot last held each item and checks it
  first. Measured on a 64-rail build: 163 slot reads instead of 4,608.
- Checking which blocks can be used as bridge material is remembered, instead of being re-tested (with
  an error thrown for every non-block item) each time the material screen opens.
- Booster and light block types are looked up once per world session, not once per placement.
- **Quieter logging:** release logging is now INFO instead of DEBUG — v1 wrote ~15 Content Log lines
  per build plus one per existing rail it passed.

## Step 4 — Cave filling, guard rails & Settings
**Features**
- **Fill cave gaps (Underground)** — new toggle, on by default. When the tunnel crosses an open cave,
  a short stone support column (up to 12 blocks tall) is built under the rail instead of refusing to
  build. Free, like the waterproof seals. Deeper drops, or caves with water/lava at the bottom, are still
  refused safely. Undo puts the cave back.
- **Guard rails (Bridge)** — new toggle. Fences go on both sides of the bridge deck wherever there's a
  drop below, so the raised part of the bridge gets railings and the ramp ends on the ground don't.
  Uses any fence type you carry (Creative: oak). If you have none, or run out, you're told.
- **Settings screen** — new **Settings** button in the crouch menu. Your own defaults, saved on your
  player:
  - default railway length
  - default powered boosters and tunnel lights
  - fill cave gaps on/off, guard rails on/off
  - **Quick repeat** — "Repeat last build" builds straight away without the confirm screen
  - **Show tips** — turn off the "crouch to open" tip
  After saving, the menu reopens so you can build right away.
- **Fewer rails needed with boosters** — the inventory check no longer asks for plain rails at spots
  that will become powered rails. Example: a 17-rail line with boosters every 8 now needs 14 rails plus
  3 powered rails and 3 redstone blocks (v2 Step 3 asked for 17 rails).

**Optimizations**
- **One terrain scan instead of two:** the final safety check reuses the first route scan when no
  game tick has passed since it, because the world can't change mid-tick. If a tick has passed, it
  re-scans fully as before. This skips reading every block along the route a second time.
- **Game mode read once per build** instead of once per block: 4 reads for a 40-rail build, down
  from 40+. Safe because changing game mode cancels a running build.

## Step 5 — Review, fixes & release
**Fixes found in the final review**
- The behavior pack had no language file of its own, so the behavior pack list showed the raw key
  "pack.name". It now shows "Smart Rail Builder" with a description (this was also true in v1.0.0).
- Boosters, lights and guard rails can no longer stop a build if a block read fails unexpectedly;
  that one extra is skipped instead.
- The "Show tips" setting is no longer read inside Minecraft's restricted before-event callback.

**Release**
- Version **2.0.0** everywhere (both manifests, the script, and the behavior pack's dependency on the
  resource pack). The pack IDs are the same as v1, so installing v2 **upgrades** v1 in existing
  worlds instead of adding a second copy.
- `tools/package.py` builds the `.mcaddon` and both `.mcpack` files the same way every time
  (byte-identical rebuilds), with the same layout as the v1 files.
- `tests/release.test.mjs` checks versions, pack IDs, pack names/icons, and that every script parses.

## In-game test checklist
1. Stand + use a rail → one rail placed, tip shown once. Crouch + use a rail → menu, no rail placed.
2. Build Normal / Bridge / Underground once each in Survival and Creative.
3. Repeat last build facing a new direction; turn on Quick repeat in Settings and repeat again.
4. Undo after each mode; break one rail first once and check the "left as they are" message.
5. Boosters every 8 on a flat line: powered rails light up and carts keep speed.
6. Underground with lights (glowstone in inventory) and through a cave with Fill cave gaps on.
7. Bridge with Guard rails on (fences in inventory): fences only on the raised part, and they connect.
8. Settings: change every option, leave and rejoin the world, check they were kept.
9. Behavior pack list shows "Smart Rail Builder" with the new icon.
