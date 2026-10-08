/**
 * Constants.js
 *
 * PURPOSE
 *   Single source of truth for global, non-domain-specific tunables used across
 *   the addon. Nothing in this file should contain logic — it is data only.
 *
 * RESPONSIBILITIES
 *   - Hold the addon-wide identity (namespace, version) used for logging and
 *     dynamic property keys elsewhere in the project.
 *   - Hold cross-cutting tunables that are not specific to rails (logging,
 *     progress feedback, build limits) so every future module reads from one
 *     place instead of hardcoding numbers.
 *
 * FUTURE EXTENSIONS
 *   - Multiplayer-specific tunables (per-player build cooldown, dedicated
 *     server toggles) will be added here once Roadmap Phase 10/11+ begins.
 *   - Feature toggles for slopes/tunnels/bridges/underwater will be added as
 *     flat booleans here once those milestones start, so they can be flipped
 *     off without touching the modules that implement them.
 *
 * DEPENDENCIES
 *   None. This file must never import from other project modules — everything
 *   else imports from it, not the other way around.
 */

/** Addon-wide identity, used by Logger and any future dynamic property keys. */
export const ADDON = Object.freeze({
  // NAMESPACE stays "ryzenRailBuilder" — Project Prompt 10 renamed the product to
  // "Smart Rail Builder," but this string is an internal, player-invisible prefix used
  // in every localization key ("ryzenRailBuilder.menu.title", etc.) and log line.
  // Renaming it would mean touching every key across LocalizationKeys.js and
  // en_US.lang for zero player-facing benefit — deliberately left as-is; see
  // CHANGELOG.md's Project Prompt 10 entry for the full rename scope decision.
  NAMESPACE: "ryzenRailBuilder",
  DISPLAY_NAME: "Smart Rail Builder",
  // FIXED Project Prompt 15: this had drifted to "0.1.0" while BP/manifest.json's
  // header/module version had already advanced to 0.1.6 — meaning every startup
  // log line since at least Project Prompt 6 has misreported the running version
  // by several releases. Found while bumping the manifest for this session (also
  // discovered RP/manifest.json's own version was independently stuck at 0.1.0 —
  // fixed alongside this one). All three numbers — this constant, BP/manifest.json,
  // and RP/manifest.json — should be bumped together going forward. See
  // CHANGELOG.md's Project Prompt 15 entry and TODO.md for the full write-up of
  // this finding. Bumped to 0.1.13 this session (Project Prompt 20 — Full
  // Integration, Stability & Real-World Test Build); all three numbers
  // confirmed in sync. Bumped to 0.1.20 for Project Prompt 27 (Final
  // Engineering, Bug Fixing, Compatibility & Stability Pass) — see
  // CHANGELOG.md's Project Prompt 27 entry.
  //
  // RELEASE CANDIDATE LABELING (Project Prompt 28): the three numeric
  // version fields (this constant + both manifests' header/module arrays)
  // continue the project's existing sequential integer convention,
  // unbroken, bumped together as always — now 0.1.21. Manifest version
  // fields are a strict [major, minor, patch] integer array and cannot
  // carry a suffix; this string constant is free-form (its only consumer
  // is a single Content Log line, see main.js), so it alone also carries
  // the "-rc1" Release Candidate label Project Prompt 28 asks for, making
  // the RC status visible in-game without touching the manifest format.
  // The .mcaddon filename carries the same "-rc1" suffix for the same
  // reason. Prompt 28 is explicitly NOT the final release — see
  // CHANGELOG.md's Project Prompt 28 entry and ROADMAP.md's Phase 28 note.
  //
  // BRANDING PASS (Project Prompt 29): bumped to 0.1.22, "-rc2" — this is
  // the Release Candidate from Prompt 28 with official branding (pack
  // icon, logo, UI title branding, branded completion messages) added on
  // top, no gameplay logic changed. Still explicitly NOT the final
  // release — Project Prompt 30 owns that designation. See CHANGELOG.md's
  // Project Prompt 29 entry.
  //
  // FINAL RELEASE (Project Prompt 30): 1.0.0 — no "-rc" suffix, no
  // pre-release label of any kind, per Project Prompt 30's explicit
  // requirement that the shipped project not remain labeled rc/beta/test/
  // development. The 0.1.x sequence that ran from Project Prompt 2 through
  // the two release candidates ends here; 1.0.0 is the first (and, per the
  // roadmap, final planned) stable release. All four numeric fields — this
  // constant, BP/manifest.json's header + script module, and
  // RP/manifest.json's header + resources module — are [1, 0, 0] and were
  // bumped together, as this file's own standing rule has required since
  // Project Prompt 15. See CHANGELOG.md's Project Prompt 30 entry and
  // README.md.
  VERSION: "1.0.0",
});

/**
 * Logging configuration. See utils/Logger.js.
 * Set ENABLED to false to silence all logging output with zero behavior change
 * elsewhere — no module should ever call console directly, only Logger.
 */
export const LOGGING = Object.freeze({
  ENABLED: true,
  /** One of LogLevel values in utils/Logger.js. Messages below this level are dropped. */
  MIN_LEVEL: "DEBUG",
});

/**
 * Progress feedback configuration. Consumed by ui/ProgressReporter.js once the
 * build pipeline exists (Roadmap Phase 9).
 */
export const PROGRESS = Object.freeze({
  /** Only show progress feedback for builds at least this long. */
  MIN_LENGTH_FOR_PROGRESS_UPDATES: 16,
  /** Send an actionbar update every N blocks placed, not every block. */
  UPDATE_INTERVAL_BLOCKS: 8,
});

/**
 * Reserved for future multiplayer-scope tunables (Roadmap Phase 10/11+).
 * Present now, empty by design, so BuildSession/CancellationWatcher can be
 * written today against a stable import even though nothing reads from this
 * yet.
 */
export const MULTIPLAYER = Object.freeze({
  // Intentionally empty during Roadmap Phase 2 (Project Skeleton).
  // Confirmed scope per Project Prompt 2: Singleplayer + LAN for v1.
});
