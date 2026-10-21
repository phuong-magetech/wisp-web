/**
 * Centralized tunable constants. Every gameplay number lives here as a named export —
 * never inline magic numbers in gameplay code. Tuning the game is then a single-file edit.
 *
 * Tunable blocks are deliberately NOT `as const`: their members type as `number`, so a mutable
 * field seeded from one stays assignable (`private timeLeft = ROUND.duration` infers `number`,
 * not the literal `60`). Only fixed device facts — `DISPLAY` — keep `as const`. New blocks you
 * add here are tunables: leave `as const` off them.
 */

/** Fixed 600x600 Meta Display Glasses canvas. Device fact, not a tunable. */
export const DISPLAY = {
  width: 600,
  height: 600,
} as const;

/** Frame scheduling (see src/main.ts and src/core/wake.ts). */
export const LOOP = {
  /** Cap on a single frame's delta (ms) so a long pause doesn't produce a huge jump. */
  maxFrameMs: 250,
  /** The glasses' panel refresh rate. Frames faster than this are never drawn. */
  targetFps: 30,
  /**
   * Fraction of a 30 Hz frame that must have passed before drawing again. Below 1 so a real
   * 30 Hz display's timing jitter (a 32 ms frame) never skips a frame and halves the rate.
   */
  frameCapTolerance: 0.75,
};

/*
 * There is no INPUT block here: a tap-only game has nothing to tune. The pointer-drag
 * sensitivity / tap-travel constants belong to the opt-in drag channel — see the plugin's
 * docs/drag-channel.md, which ships them ready to paste.
 */

/**
 * 0xRRGGBB colors for the scene. On the additive display black is see-through, so the eyes are
 * pure black on purpose: they read as holes in Wisp's light. The halo is a dimmer blue than the
 * core so it glows softly around it instead of competing.
 */
export const COLORS = {
  core: 0xc8f4ff,
  halo: 0x1f6f9f,
  eye: 0x000000,
  ring: 0x9be7ff,
};

/** Where Wisp sits and how it is laid out (world units; the ortho view is -5..5 on each axis). */
export const LAYOUT = {
  /** Half-height of the visible area, passed to the orthographic camera. */
  viewSize: 5,
  /** Wisp's resting center. Slightly above middle, leaving room for the HUD below the ring. */
  centerY: 0.5,
  /** Eye offset from Wisp's center, before stage scaling. */
  eyeOffsetX: 0.22,
  eyeOffsetY: 0.12,
  /** Radius of the focus-session ring around Wisp. */
  ringRadius: 2.2,
  /** Number of dots that make up the ring; they light one by one as the session fills. */
  ringDots: 48,
};

/** Focus sessions. Partial sessions always count: every focused second is credited. */
export const SESSION = {
  /** A normal session, in seconds (25 min). */
  durationSeconds: 25 * 60,
  /** Session length under the `?debug` URL flag, so the whole loop can be tested quickly. */
  debugDurationSeconds: 30,
  /** How long the "+N min" credit stays on screen after a session ends. */
  creditShowSeconds: 4,
};

/**
 * Growth: total focused minutes -> stage. Growth only ever goes up; it remembers the focus,
 * it never punishes a gap. One entry per stage, lowest first.
 */
export const GROWTH = {
  stageMinutes: [0, 25, 100, 300],
  /** Wisp's size at each stage. */
  stageScale: [1, 1.2, 1.4, 1.6],
  /** Wisp's brightness ceiling at each stage (opacity over black = brightness on device). */
  stageGlow: [0.8, 0.87, 0.94, 1],
};

/** Mood. Wistful, never gone: no streaks, no shame, no dead pet. */
export const MOOD = {
  /** Days away before Wisp greets you wistful. */
  wistfulAfterDays: 2,
  /** Brightness multiplier while wistful. */
  wistfulDim: 0.6,
  /** How far Wisp droops while wistful (world units). */
  wistfulDroop: 0.3,
  /** Eye height while wistful (1 = open). */
  wistfulEyeOpen: 0.6,
};

/**
 * Feel. The window brightens only with your action: Wisp rests dim and still, lights up when you
 * pinch or pet, then fades back. There is no idle motion, so at rest nothing is redrawn.
 */
export const FEEL = {
  /** Brightness at rest, as a fraction of the stage's glow. */
  restBrightness: 0.55,
  /** Seconds for a full-brightness flash to fade back to rest. */
  fadeBackSeconds: 4,
  /**
   * Idle breathing: scale amplitude and period (seconds). 0 = still at rest, so nothing is redrawn
   * until something changes. Above 0, Wisp changes every frame and is redrawn every frame. Kept at
   * 0: drawing every frame did not change the perf scorecard's jank number (48% vs 45-59%), so the
   * battery saving wins. Try 0.04 if Wisp should look more alive.
   */
  breatheAmplitude: 0,
  breathePeriodSeconds: 4,
  /** Working pose: Wisp tucks in and closes its eyes to concentrate. */
  workingScale: 0.85,
  workingEyeOpen: 0.2,
  /** Pet: squash-and-stretch amount and duration (seconds). */
  petSquash: 0.18,
  petSeconds: 0.6,
  /** Ring dot brightness: filled vs. the unfilled track. */
  ringFilled: 0.9,
  ringTrack: 0.15,
};
