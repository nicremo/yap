/**
 * Turns raw hotkey presses into dictation actions.
 *
 *   hold            start on press, stop on release (push to talk)
 *   double tap      start on the first press, keep recording hands-free,
 *                   the next press stops
 *   single tap      start on press, cancel when no second tap follows
 *
 * Recording starts on the very first press in every case. Waiting to find
 * out whether a press is a tap or a hold would cut off the first words.
 */

export type GestureAction = 'start' | 'stop' | 'cancel' | 'handsfree';
export type GestureState = 'idle' | 'holding' | 'tap-pending' | 'handsfree' | 'releasing';

export interface GestureClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: GestureClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A press shorter than this counts as a tap. */
export const TAP_MAX_MS = 250;
/** How long after a tap a second press still makes it a double tap. */
export const DOUBLE_TAP_WINDOW_MS = 350;

export class GestureMachine {
  private state: GestureState = 'idle';
  private downAt = 0;
  private timer: unknown = null;

  constructor(
    private readonly onAction: (action: GestureAction) => void,
    private readonly clock: GestureClock = systemClock,
  ) {}

  get current(): GestureState {
    return this.state;
  }

  keyDown(): void {
    switch (this.state) {
      case 'idle':
        this.state = 'holding';
        this.downAt = this.clock.now();
        this.onAction('start');
        break;
      case 'tap-pending':
        this.clearTimer();
        this.state = 'handsfree';
        this.onAction('handsfree');
        break;
      case 'handsfree':
        this.state = 'releasing';
        this.onAction('stop');
        break;
      case 'holding':
      case 'releasing':
        // A second down without an up in between: the up was lost. Ignore.
        break;
    }
  }

  keyUp(): void {
    switch (this.state) {
      case 'holding':
        if (this.clock.now() - this.downAt < TAP_MAX_MS) {
          this.state = 'tap-pending';
          this.timer = this.clock.setTimeout(() => {
            this.timer = null;
            if (this.state === 'tap-pending') {
              this.state = 'idle';
              this.onAction('cancel');
            }
          }, DOUBLE_TAP_WINDOW_MS);
        } else {
          this.state = 'idle';
          this.onAction('stop');
        }
        break;
      case 'releasing':
        this.state = 'idle';
        break;
      case 'handsfree':
      case 'tap-pending':
      case 'idle':
        break;
    }
  }

  /** Another key went down while the hotkey was held: it is being used as a modifier. */
  chord(): void {
    if (this.state === 'holding') {
      this.state = 'releasing';
      this.onAction('cancel');
    }
  }

  /** The recording ended for another reason (error, length limit). */
  reset(): void {
    this.clearTimer();
    // A key that is still held must not count as a tap when it is released.
    this.state = this.state === 'holding' ? 'releasing' : 'idle';
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
