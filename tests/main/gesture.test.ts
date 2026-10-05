import { beforeEach, describe, expect, it } from 'vitest';

import { DOUBLE_TAP_WINDOW_MS, GestureMachine, TAP_MAX_MS, type GestureAction, type GestureClock } from '../../src/main/dictation/gesture';

class FakeClock implements GestureClock {
  time = 0;
  private timers: Array<{ at: number; callback: () => void; id: number }> = [];
  private nextId = 1;

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ at: this.time + ms, callback, id });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  advance(ms: number): void {
    this.time += ms;
    const due = this.timers.filter((timer) => timer.at <= this.time);
    this.timers = this.timers.filter((timer) => timer.at > this.time);
    for (const timer of due) timer.callback();
  }
}

let clock: FakeClock;
let actions: GestureAction[];
let machine: GestureMachine;

beforeEach(() => {
  clock = new FakeClock();
  actions = [];
  machine = new GestureMachine((action) => actions.push(action), clock);
});

describe('GestureMachine', () => {
  it('starts recording on the very first press', () => {
    machine.keyDown();
    expect(actions).toEqual(['start']);
  });

  it('stops on release after a hold', () => {
    machine.keyDown();
    clock.advance(1_200);
    machine.keyUp();
    expect(actions).toEqual(['start', 'stop']);
    expect(machine.current).toBe('idle');
  });

  it('cancels a single short tap once the double-tap window passed', () => {
    machine.keyDown();
    clock.advance(TAP_MAX_MS - 50);
    machine.keyUp();
    expect(actions).toEqual(['start']);

    clock.advance(DOUBLE_TAP_WINDOW_MS);
    expect(actions).toEqual(['start', 'cancel']);
    expect(machine.current).toBe('idle');
  });

  it('switches to hands-free on a double tap and stops on the next press', () => {
    machine.keyDown();
    clock.advance(80);
    machine.keyUp();
    clock.advance(120);
    machine.keyDown();
    clock.advance(80);
    machine.keyUp();
    expect(actions).toEqual(['start', 'handsfree']);
    expect(machine.current).toBe('handsfree');

    clock.advance(DOUBLE_TAP_WINDOW_MS * 4);
    expect(actions).toEqual(['start', 'handsfree']);

    machine.keyDown();
    expect(actions).toEqual(['start', 'handsfree', 'stop']);
    machine.keyUp();
    expect(machine.current).toBe('idle');
  });

  it('ignores a repeated down without an up in between', () => {
    machine.keyDown();
    machine.keyDown();
    expect(actions).toEqual(['start']);
  });

  it('swallows the release of a key that was held when the recording was reset', () => {
    machine.keyDown();
    machine.reset();
    clock.advance(1_000);
    machine.keyUp();
    expect(actions).toEqual(['start']);
    expect(machine.current).toBe('idle');

    machine.keyDown();
    expect(actions).toEqual(['start', 'start']);
  });

  it('cancels when the held key turns out to be a modifier for another key', () => {
    machine.keyDown();
    clock.advance(400);
    machine.chord();
    expect(actions).toEqual(['start', 'cancel']);

    machine.keyUp();
    expect(actions).toEqual(['start', 'cancel']);
    expect(machine.current).toBe('idle');
  });

  it('ignores chords outside a held press', () => {
    machine.keyDown();
    machine.keyUp();
    machine.keyDown();
    machine.keyUp();
    machine.chord();
    expect(actions).toEqual(['start', 'handsfree']);
  });

  it('returns straight to idle when reset during hands-free', () => {
    machine.keyDown();
    machine.keyUp();
    machine.keyDown();
    machine.keyUp();
    machine.reset();
    expect(machine.current).toBe('idle');

    machine.keyDown();
    expect(actions).toEqual(['start', 'handsfree', 'start']);
  });
});
