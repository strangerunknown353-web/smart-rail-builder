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
