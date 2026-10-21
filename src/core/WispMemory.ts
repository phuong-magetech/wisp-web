/**
 * What Wisp remembers across visits, on top of the injected `KeyValueStore` (the browser's
 * storage in `main.ts`, an in-memory store in tests). Gameplay never touches `localStorage`.
 */

import type { KeyValueStore } from '@/framework/storage/KeyValueStore';

const KEYS = {
  focusSeconds: 'focusSeconds',
  lastSeenMs: 'lastSeenMs',
  sessionStartMs: 'sessionStartMs',
  sessionLengthSeconds: 'sessionLengthSeconds',
} as const;

/** A session that was running when the app was last closed. */
export interface SavedSession {
  startMs: number;
  lengthSeconds: number;
}

export class WispMemory {
  public constructor(private readonly store: KeyValueStore) {}

  /** Total focused seconds, ever. */
  public totalFocusSeconds(): number {
    return readNumber(this.store.get(KEYS.focusSeconds)) ?? 0;
  }

  public addFocusSeconds(seconds: number): void {
    this.store.set(KEYS.focusSeconds, String(this.totalFocusSeconds() + seconds));
  }

  /** When the wearer last interacted with Wisp, or null on the very first visit. */
  public lastSeenMs(): number | null {
    return readNumber(this.store.get(KEYS.lastSeenMs));
  }

  public markSeen(nowMs: number): void {
    this.store.set(KEYS.lastSeenMs, String(nowMs));
  }

  public savedSession(): SavedSession | null {
    const startMs = readNumber(this.store.get(KEYS.sessionStartMs));
    const lengthSeconds = readNumber(this.store.get(KEYS.sessionLengthSeconds));
    if (startMs === null || lengthSeconds === null || lengthSeconds <= 0) {
      return null;
    }
    return { startMs, lengthSeconds };
  }

  public saveSession(session: SavedSession): void {
    this.store.set(KEYS.sessionStartMs, String(session.startMs));
    this.store.set(KEYS.sessionLengthSeconds, String(session.lengthSeconds));
  }

  public clearSession(): void {
    this.store.remove(KEYS.sessionStartMs);
    this.store.remove(KEYS.sessionLengthSeconds);
  }
}

/** A stored number, or null if missing or corrupt. */
function readNumber(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
