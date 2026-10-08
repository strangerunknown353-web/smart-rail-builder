/**
 * mockPlayer.mjs
 *
 * PURPOSE
 *   Added Project Prompt 19, alongside the new `node_modules/@minecraft/server`
 *   mock (see that package's own header) — together these unlock testing the
 *   EXECUTION-side classes that Project Prompt 18's harness couldn't reach
 *   (every class that reads/writes a live Player's inventory or game mode).
 *   A minimal, in-memory `Player` + inventory `Container` matching exactly
 *   the surface `inventory/InventoryManager.js` and
 *   `core/validation/HeldItemValidator.js` actually call — confirmed by
 *   reading both files directly, not guessed.
 */

class MockContainer {
  constructor(slotCount = 36) {
    this.size = slotCount;
    this._slots = new Array(slotCount).fill(undefined);
  }

  getItem(slot) {
    return this._slots[slot];
  }

  /** Real Container.setItem(slot) with no second argument clears the slot. */
  setItem(slot, item) {
    this._slots[slot] = item;
  }

  /**
   * Two shapes: `addItem(typeId, amount)` is a TEST-ONLY setup convenience
   * (throws when full); `addItem(itemStack)` mirrors the real
   * Container.addItem (v2.0.0, undo refunds) — merges into matching stacks,
   * then empty slots, and returns the leftover stack or undefined.
   */
  addItem(typeIdOrStack, amount) {
    if (typeof typeIdOrStack === "string") {
      const emptySlot = this._slots.findIndex((s) => s === undefined);
      if (emptySlot === -1) throw new Error("MockContainer: no empty slot (test setup error).");
      this._slots[emptySlot] = { typeId: typeIdOrStack, amount };
      return undefined;
    }
    const { typeId } = typeIdOrStack;
    let remaining = typeIdOrStack.amount;
    for (let i = 0; i < this.size && remaining > 0; i++) {
      const slot = this._slots[i];
      if (slot && slot.typeId === typeId && slot.amount < 64) {
        const take = Math.min(64 - slot.amount, remaining);
        slot.amount += take;
        remaining -= take;
      }
    }
    for (let i = 0; i < this.size && remaining > 0; i++) {
      if (this._slots[i] === undefined) {
        const take = Math.min(64, remaining);
        this._slots[i] = { typeId, amount: take };
        remaining -= take;
      }
    }
    return remaining > 0 ? { typeId, amount: remaining } : undefined;
  }
}

export function createMockPlayer({
  id,
  name = id,
  gameMode = "Survival",
  heldItemTypeId,
  items = [],
  location = { x: 0, y: 64, z: 0 },
  rotation = { x: 0, y: 0 },
  dimension,
  isValid = true,
} = {}) {
  const container = new MockContainer();
  for (const { typeId, amount } of items) {
    container.addItem(typeId, amount);
  }

  let currentGameMode = gameMode;
  // Added Project Prompt 22 (BuildPlanStage revalidation tests): lets a test
  // simulate a player swapping items — or a dimension change — between
  // planning and the final pre-construction check, the same way
  // `setGameMode` already simulates a mid-build game mode change.
  let currentHeldItemTypeId = heldItemTypeId;
  let currentDimension = dimension;
  // Added Project Prompt 20 (full-pipeline integration test): every message
  // MessageService sends is recorded here rather than silently swallowed —
  // MessageService already catches a missing sendMessage/onScreenDisplay
  // gracefully (confirmed: earlier drafts of this test ran fine without
  // this, just noisily, since that's exactly the "player disconnected mid-send"
  // resilience it's designed for), but a real mock lets tests assert on
  // what was actually said, and keeps test output readable.
  const sentChatMessages = [];
  const sentActionBarMessages = [];

  return {
    id,
    name,
    // Added Project Prompt 20 (full-pipeline integration test): PlayerValidator
    // reads this directly ("has the player disconnected between the menu
    // opening and this validation running") — every prior test bypassed
    // ValidationManager entirely, so this was never previously needed.
    isValid,
    // Added Project Prompt 20: BuildRequestCreationStage reads
    // `player.dimension` directly when constructing a BuildRequest. A
    // getter (Project Prompt 22) so `setDimension()` below is actually
    // visible on the next read, the same way `getGameMode()` already
    // reflects `setGameMode()`.
    get dimension() {
      return currentDimension;
    },
    location,
    /** TEST-ONLY: every {translate, with} payload sent via sendMessage(), in order. */
    sentChatMessages,
    /** TEST-ONLY: every {translate, with} payload sent via onScreenDisplay.setActionBar(), in order. */
    sentActionBarMessages,
    sendMessage(rawMessage) {
      sentChatMessages.push(rawMessage);
    },
    onScreenDisplay: {
      setActionBar(rawMessage) {
        sentActionBarMessages.push(rawMessage);
      },
    },
    getRotation() {
      return rotation;
    },
    getGameMode() {
      return currentGameMode;
    },
    /** TEST-ONLY convenience: simulate a mid-build Survival<->Creative switch. */
    setGameMode(mode) {
      currentGameMode = mode;
    },
    /** TEST-ONLY convenience (Project Prompt 22): simulate the player swapping their held item. */
    setHeldItem(typeId) {
      currentHeldItemTypeId = typeId;
    },
    /** TEST-ONLY convenience (Project Prompt 22): simulate a dimension change. */
    setDimension(newDimension) {
      currentDimension = newDimension;
    },
    getComponent(componentId) {
      if (componentId === "minecraft:inventory") {
        return { container };
      }
      if (componentId === "minecraft:equippable") {
        return {
          getEquipment() {
            return currentHeldItemTypeId ? { typeId: currentHeldItemTypeId } : undefined;
          },
        };
      }
      return undefined;
    },
  };
}
