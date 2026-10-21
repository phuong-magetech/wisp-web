/**
 * DOM HUD. Reads game state and writes the DOM overlay — it never touches Three.js. Text lives
 * here (not in WebGL); see the plugin's threejs-vs-dom guidance.
 *
 * Deliberately quiet: no numbers about growth, no streaks, nothing that nags. Idle shows a soft
 * hint; a session shows the time left; a finished session shows what it added, briefly.
 * DOM writes happen only when the text actually changes, not every frame.
 */

import type { Control, Game } from '@/core/Game';
import { t } from '@/i18n';

export class Hud {
  private readonly timerEl: HTMLElement;
  private readonly creditEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly controls: Record<Control, HTMLElement>;
  private shownSelection: Control | null = null;

  public constructor(private readonly game: Game) {
    this.timerEl = required('#timer');
    this.creditEl = required('#credit');
    this.hintEl = required('#hint');
    this.controls = { focus: required('#btn-focus'), pet: required('#btn-pet') };
  }

  /** Reflect current game state into the DOM. Call once per frame. */
  public update(): void {
    const focusing = this.game.getMode() === 'focusing';

    // The time left is a bare number, not copy, so it is not localized.
    setText(this.timerEl, focusing ? formatClock(this.game.getRemainingSeconds()) : '');

    const credit = this.game.getRecentCreditSeconds();
    setText(this.creditEl, credit === null ? '' : creditText(credit));

    setText(this.hintEl, t(focusing ? 'hintFocusing' : 'hintIdle'));

    setText(this.controls.focus, t(focusing ? 'controlStop' : 'controlFocus'));
    // [Focus] links to the focus screen; [Stop] is not a navigation, so it has no href.
    if (focusing === this.controls.focus.hasAttribute('href')) {
      if (focusing) {
        this.controls.focus.removeAttribute('href');
      } else {
        this.controls.focus.setAttribute('href', '#focus');
      }
    }
    setText(this.controls.pet, t('controlPet'));
    this.syncSelection(this.game.getSelectedControl());
  }

  /**
   * Keep browser focus on the selected control, so focus always shows what a pinch will press.
   * This is DOM output, not input: the selection itself comes from the D-pad via the game.
   * Re-applied whenever something else (e.g. Tab) has taken focus away.
   */
  private syncSelection(selected: Control): void {
    if (selected !== this.shownSelection) {
      this.shownSelection = selected;
      for (const [control, el] of Object.entries(this.controls) as [Control, HTMLElement][]) {
        const isSelected = control === selected;
        el.classList.toggle('selected', isSelected);
        el.setAttribute('aria-current', isSelected ? 'true' : 'false');
      }
    }
    const target = this.controls[selected];
    if (document.activeElement !== target) {
      target.focus({ preventScroll: true });
    }
  }
}

function required(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`HUD: ${selector} element not found.`);
  }
  return el;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) {
    el.textContent = text;
  }
}

/** m:ss, rounding up so the clock never shows 0:00 while time is left. */
function formatClock(seconds: number): string {
  const whole = Math.ceil(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** "+12 min", or "+40 s" for a session under a minute — partial sessions always count. */
function creditText(seconds: number): string {
  const whole = Math.floor(seconds);
  return whole >= 60
    ? t('creditMinutes', { count: Math.floor(whole / 60) })
    : t('creditSeconds', { count: whole });
}
