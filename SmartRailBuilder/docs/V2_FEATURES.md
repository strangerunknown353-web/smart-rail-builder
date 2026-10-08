# Smart Rail Builder v2.0.0 — What's New

A running list, updated after every project step. Full technical detail is in `CHANGELOG.md`.

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
- **Undo** removes boosters and lights too, and returns the powered rails, redstone blocks and light blocks.

**Optimizations**
- **Inventory checks ~28× cheaper:** the mod remembers which slot last held each item and checks it
  first. Measured on a 64-rail build: 163 slot reads instead of 4,608.
- Checking which blocks can be used as bridge material is remembered, instead of being re-tested (with
  an error thrown for every non-block item) each time the material screen opens.
- Booster and light block types are looked up once per world session, not once per placement.
- **Quieter logging:** release logging is now INFO instead of DEBUG — v1 wrote ~15 Content Log lines
  per build plus one per existing rail it passed.
