/**
 * The game orchestrator. Renderer- and input-agnostic: it receives a `Renderer`, an
 * `InputManager`, a `KeyValueStore` and a clock through its constructor and never imports
 * `three` or touches the DOM. That is what makes it unit-testable (see `Game.test.ts`).
 *
 * Wisp: a small companion fed by your focus.
 * - Two controls, [Focus] and [Pet]. D-pad left/right (arrow keys) moves the selection between
 *   them; the index pinch (`pinchTap`, Enter on desktop) presses the selected one.
 * - [Focus] starts a focus session; pressing it again ends it early. Partial sessions always count.
 * - D-pad up/down pets Wisp directly ("a silent stroke"), as does pressing [Pet].
 * - Focused time grows Wisp through stages. A long absence makes it wistful, never gone.
 * - Still at rest: Wisp moves only in response to an action, and a frame is drawn only when
 *   something visible changed. At rest nothing is redrawn, which is what the battery wants.
 *
 * TAP-ONLY: no drag channel. See the plugin's docs/drag-channel.md if that ever changes.
 */

import { FEEL, GROWTH, LAYOUT, MOOD, SESSION } from '@/config/gameplayConstants';
import { FocusSession } from '@/core/FocusSession';
import { isWistful, stageFor } from '@/core/growth';
import { WispMemory } from '@/core/WispMemory';
import type { DpadDirection, InputManager } from '@/framework/input/InputManager';
import { Vector3 } from '@/framework/math/Vector3';
import type { Renderer, RenderHandle } from '@/framework/render/Renderer';
import type { KeyValueStore } from '@/framework/storage/KeyValueStore';
import type { ModelId } from '@/models';

export type Mode = 'idle' | 'focusing';

/** The on-screen controls, in left-to-right order. */
export const CONTROLS = ['focus', 'pet'] as const;
export type Control = (typeof CONTROLS)[number];

export interface GameOptions {
  /** Persistence for growth, last visit, and a session in progress. */
  store: KeyValueStore;
  /** Wall clock in ms since epoch. `Date.now` in the app; a fake in tests. */
  now: () => number;
  /** Length of a new focus session, in seconds. Defaults to `SESSION.durationSeconds`. */
  sessionSeconds?: number;
}

export class Game {
  private readonly memory: WispMemory;
  private readonly now: () => number;
  private readonly sessionSeconds: number;

  private readonly halo: RenderHandle;
  private readonly core: RenderHandle;
  private readonly eyes: [RenderHandle, RenderHandle];
  /** Halo and core, which move and fade together. Kept as a field so drawing allocates nothing. */
  private readonly body: RenderHandle[];
  private readonly ringDots: RenderHandle[] = [];
  private readonly scratch = new Vector3(0, 0, 0);
  private readonly scaleScratch = new Vector3(1, 1, 1);
  private readonly eyeScale = new Vector3(1, 1, 1);

  private session: FocusSession | null = null;
  /** Index into CONTROLS of the selected control. */
  private selectedIndex = 0;
  private wistful: boolean;
  /** Seconds since start; drives the optional idle breathing. */
  private clock = 0;
  /** Set when the scene changed since the last draw; `render()` draws only then. */
  private needsRender = true;
  /** What was last pushed to the renderer, so an unchanged pose is not pushed or drawn again. */
  private readonly drawn = { y: NaN, scaleX: NaN, scaleY: NaN, size: NaN, brightness: NaN, eyeOpen: NaN };
  private drawnRing = { visible: false, lit: -1 };
  /** 1 right after an action, fading to 0 over `FEEL.fadeBackSeconds`. */
  private activity = 0;
  /** Seconds left in the current pet wiggle (0 = not petting). */
  private petTimer = 0;
  /** The credit from the session that just ended, and how long it stays shown. */
  private lastCreditSeconds = 0;
  private creditTimer = 0;

  public constructor(
    private readonly renderer: Renderer<ModelId>,
    private readonly input: InputManager,
    options: GameOptions,
  ) {
    this.memory = new WispMemory(options.store);
    this.now = options.now;
    this.sessionSeconds = options.sessionSeconds ?? SESSION.durationSeconds;

    const nowMs = this.now();
    this.wistful = isWistful(this.memory.lastSeenMs(), nowMs);
    this.memory.markSeen(nowMs);

    // A session that was running when the app closed keeps running: it is wall-clock timed, so
    // the time away counts. If it finished meanwhile, the first update() credits it.
    const saved = this.memory.savedSession();
    if (saved) {
      this.session = new FocusSession(saved.startMs, saved.lengthSeconds);
    }

    this.halo = this.renderer.addModel('halo');
    this.core = this.renderer.addModel('core');
    this.eyes = [this.renderer.addModel('eye'), this.renderer.addModel('eye')];
    this.body = [this.halo, this.core];
    for (let i = 0; i < LAYOUT.ringDots; i++) {
      const dot = this.renderer.addModel('ringDot');
      const angle = Math.PI / 2 - (i / LAYOUT.ringDots) * Math.PI * 2; // clockwise from 12 o'clock
      this.scratch.set(
        Math.cos(angle) * LAYOUT.ringRadius,
        LAYOUT.centerY + Math.sin(angle) * LAYOUT.ringRadius,
        0,
      );
      this.renderer.setTransform(dot, this.scratch);
      this.ringDots.push(dot);
    }

    this.input.on('pinchTap', () => this.onPinch());
    this.input.on('dpadSwipe', (direction) => this.onSwipe(direction));
  }

  // --- State read by the HUD ------------------------------------------------------------------

  /** The control the pinch will press. */
  public getSelectedControl(): Control {
    return CONTROLS[this.selectedIndex];
  }

  public getMode(): Mode {
    return this.session ? 'focusing' : 'idle';
  }

  /** Seconds left in the running session, or 0 when idle. */
  public getRemainingSeconds(): number {
    return this.session ? this.session.remainingSeconds(this.now()) : 0;
  }

  /** Seconds credited by the session that just ended, while it is still shown; else null. */
  public getRecentCreditSeconds(): number | null {
    return this.creditTimer > 0 ? this.lastCreditSeconds : null;
  }

  public getTotalFocusSeconds(): number {
    return this.memory.totalFocusSeconds();
  }

  public getStage(): number {
    return stageFor(this.memory.totalFocusSeconds());
  }

  public isWistful(): boolean {
    return this.wistful;
  }

  /**
   * Whether anything is mid-animation: the pet wiggle, the brightening fade, the credit message,
   * or idle breathing if it is turned on. The app runs frames only while this is true (plus a
   * once-a-second tick during a session); see `core/wake.ts`.
   */
  public isAnimating(): boolean {
    return (
      this.activity > 0 || this.petTimer > 0 || this.creditTimer > 0 || FEEL.breatheAmplitude > 0
    );
  }

  // --- Loop ------------------------------------------------------------------------------------

  /** Advance the simulation by one frame. */
  public update(dt: number): void {
    this.clock += dt;
    this.activity = Math.max(0, this.activity - dt / FEEL.fadeBackSeconds);
    this.petTimer = Math.max(0, this.petTimer - dt);
    this.creditTimer = Math.max(0, this.creditTimer - dt);

    const nowMs = this.now();
    if (this.session?.isComplete(nowMs)) {
      this.endSession(nowMs);
    }

    this.drawWisp();
    this.drawRing(nowMs);
  }

  /** Draw a frame if anything visible changed since the last one. Returns whether it drew. */
  public render(): boolean {
    if (!this.needsRender) {
      return false;
    }
    this.renderer.render();
    this.needsRender = false;
    return true;
  }

  // --- Input -----------------------------------------------------------------------------------

  /** Start a session if none is running. For arriving at the focus screen by URL. */
  public startSession(): void {
    if (!this.session) {
      this.toggleSession();
    }
  }

  /**
   * End the running session, if any, crediting the time so far. For leaving the focus screen by
   * browser Back; the in-game path is pressing [Focus]/[Stop].
   */
  public stopSession(): void {
    if (this.session) {
      const nowMs = this.now();
      this.greet(nowMs);
      this.endSession(nowMs);
    }
  }

  /** Pinch: press the selected control. */
  private onPinch(): void {
    if (this.getSelectedControl() === 'pet') {
      this.onPet();
    } else {
      this.toggleSession();
    }
  }

  /** Left/right moves between the controls (clamped at the ends); up/down pets. */
  private onSwipe(direction: DpadDirection): void {
    if (direction === 'left' || direction === 'right') {
      const step = direction === 'left' ? -1 : 1;
      this.selectedIndex = Math.min(Math.max(this.selectedIndex + step, 0), CONTROLS.length - 1);
      return;
    }
    this.onPet();
  }

  /** Start a session, or end the running one early (the time still counts). */
  private toggleSession(): void {
    const nowMs = this.now();
    this.greet(nowMs);
    if (this.session) {
      this.endSession(nowMs);
      return;
    }
    this.session = new FocusSession(nowMs, this.sessionSeconds);
    this.memory.saveSession({ startMs: nowMs, lengthSeconds: this.sessionSeconds });
  }

  /** Pet. Silent; Wisp just brightens and wiggles. */
  private onPet(): void {
    this.greet(this.now());
    this.petTimer = FEEL.petSeconds;
  }

  /** Any interaction brightens the window and lifts a wistful mood. */
  private greet(nowMs: number): void {
    this.activity = 1;
    this.wistful = false;
    this.memory.markSeen(nowMs);
  }

  private endSession(nowMs: number): void {
    if (!this.session) {
      return;
    }
    const credit = this.session.elapsedSeconds(nowMs);
    this.memory.addFocusSeconds(credit);
    this.memory.clearSession();
    this.session = null;
    this.lastCreditSeconds = credit;
    this.creditTimer = SESSION.creditShowSeconds;
    this.activity = 1;
  }

  // --- Drawing ---------------------------------------------------------------------------------

  private drawWisp(): void {
    const stage = this.getStage();
    const focusing = this.session !== null;

    // Position: centered, drooping while wistful. No idle drift: Wisp is still at rest.
    const x = 0;
    const y = LAYOUT.centerY - (this.wistful ? MOOD.wistfulDroop : 0);

    // Size: stage, working pose, optional breathing, and the pet squash-and-stretch.
    const breathe =
      1 + Math.sin((this.clock / FEEL.breathePeriodSeconds) * Math.PI * 2) * FEEL.breatheAmplitude;
    const size = GROWTH.stageScale[stage] * (focusing ? FEEL.workingScale : 1) * breathe;
    const petProgress = this.petTimer > 0 ? 1 - this.petTimer / FEEL.petSeconds : 0;
    const squash = Math.sin(petProgress * Math.PI) * FEEL.petSquash;
    const scaleX = size * (1 + squash);
    const scaleY = size * (1 - squash);

    // Brightness: rests dim, flashes with your action, dimmer while wistful.
    const brightness =
      GROWTH.stageGlow[stage] *
      (FEEL.restBrightness + (1 - FEEL.restBrightness) * this.activity) *
      (this.wistful ? MOOD.wistfulDim : 1);

    const eyeOpen = focusing ? FEEL.workingEyeOpen : this.wistful ? MOOD.wistfulEyeOpen : 1;

    const last = this.drawn;
    if (
      y === last.y &&
      scaleX === last.scaleX &&
      scaleY === last.scaleY &&
      size === last.size &&
      brightness === last.brightness &&
      eyeOpen === last.eyeOpen
    ) {
      return; // Nothing visible changed: push nothing, draw nothing.
    }
    Object.assign(last, { y, scaleX, scaleY, size, brightness, eyeOpen });
    this.needsRender = true;

    this.scaleScratch.set(scaleX, scaleY, 1);
    for (const handle of this.body) {
      this.scratch.set(x, y, 0);
      this.renderer.setTransform(handle, this.scratch);
      this.renderer.setScale?.(handle, this.scaleScratch);
      this.renderer.setOpacity?.(handle, brightness);
    }

    this.eyes.forEach((eye, index) => {
      const side = index === 0 ? -1 : 1;
      this.scratch.set(
        x + side * LAYOUT.eyeOffsetX * this.scaleScratch.x,
        y + LAYOUT.eyeOffsetY * this.scaleScratch.y,
        0,
      );
      this.renderer.setTransform(eye, this.scratch);
      this.eyeScale.set(size, size * eyeOpen, 1);
      this.renderer.setScale?.(eye, this.eyeScale);
    });
  }

  /** The ring changes only when a dot lights (every ~31 s in a 25 min session) or it shows/hides. */
  private drawRing(nowMs: number): void {
    const visible = this.session !== null;
    const lit = this.session ? Math.floor(this.session.progress(nowMs) * this.ringDots.length) : 0;
    if (visible === this.drawnRing.visible && lit === this.drawnRing.lit) {
      return;
    }
    this.drawnRing = { visible, lit };
    this.needsRender = true;
    this.ringDots.forEach((dot, index) => {
      this.renderer.setVisible(dot, visible);
      this.renderer.setOpacity?.(dot, index < lit ? FEEL.ringFilled : FEEL.ringTrack);
    });
  }
}
