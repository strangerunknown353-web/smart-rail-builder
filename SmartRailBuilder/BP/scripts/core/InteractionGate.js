/**
 * InteractionGate.js
 *
 * PURPOSE
 *   Decides what a single rail-item block interaction should do, before
 *   main.js touches the event. Kept separate from main.js (which subscribes
 *   a real world event at module load) so the decision is unit-testable on
 *   its own — see tests/interactionGate.test.mjs.
 *
 * CROUCH-TO-OPEN (v2.0.0, Project Step 1)
 *   Up to v1.0.0 every rail-item interaction was cancelled and opened the
 *   build menu, so a player could never place a single rail by hand while
 *   the addon was installed. Now:
 *     - Crouching (sneaking) + use  -> OPEN_MENU  (vanilla placement cancelled,
 *                                                  build pipeline runs)
 *     - Standing + use              -> VANILLA    (event left untouched — the
 *                                                  game places one rail)
 *   `player.isSneaking` is true for both the held-sneak control (keyboard,
 *   controller) and the toggled sneak button on touch controls, so the same
 *   rule covers every platform.
 *
 * ONE-TIME HINT
 *   Because the menu no longer opens on a plain tap, a player who places a
 *   rail standing up gets one actionbar hint ("Crouch + use a rail to open
 *   Smart Rail Builder") the first time per world session. `takeHint()`
 *   returns true exactly once per player id.
 */

/** @enum {string} */
export const InteractionDecision = Object.freeze({
  /** Not a rail item, or a held-button repeat — leave the event alone. */
  IGNORE: "IGNORE",
  /** Standing with a rail — let vanilla place a single rail. */
  VANILLA: "VANILLA",
  /** Crouching with a rail — cancel vanilla placement and open the build menu. */
  OPEN_MENU: "OPEN_MENU",
});

export class InteractionGate {
  /**
   * @param {readonly string[]} railItemIds Item ids this addon handles (config/RailConfig.js's RAIL_ITEM_IDS).
   * @param {{ requireSneak?: boolean }} [options] `requireSneak: false` restores the v1.0.0 always-open behavior.
   */
  constructor(railItemIds, { requireSneak = true } = {}) {
    this._railItemIds = new Set(railItemIds);
    this._requireSneak = requireSneak;
    /** @type {Set<string>} player ids that have already been shown the crouch hint */
    this._hintedPlayerIds = new Set();
  }

  /**
   * @param {{ itemStack?: { typeId: string }, isFirstEvent: boolean, player: { isSneaking?: boolean } }} event
   *   A PlayerInteractWithBlockBeforeEvent (or a test double with the same fields).
   * @returns {string} One of InteractionDecision's values.
   */
  decide(event) {
    const itemStack = event.itemStack;
    if (!itemStack || !this._railItemIds.has(itemStack.typeId)) return InteractionDecision.IGNORE;
    if (!event.isFirstEvent) return InteractionDecision.IGNORE; // ignore repeats fired while the button is held

    if (this._requireSneak && !event.player?.isSneaking) return InteractionDecision.VANILLA;
    return InteractionDecision.OPEN_MENU;
  }

  /**
   * @param {string} playerId
   * @returns {boolean} true the first time it's called for `playerId`, false afterwards.
   */
  takeHint(playerId) {
    if (this._hintedPlayerIds.has(playerId)) return false;
    this._hintedPlayerIds.add(playerId);
    return true;
  }
}
