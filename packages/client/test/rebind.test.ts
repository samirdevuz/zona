import { describe, expect, it } from 'vitest';
import { ACTIONS, FIXED_KEYS, rebind } from '../src/input';

describe('rebind', () => {
  it('binds a free key', () => {
    expect(rebind(ACTIONS, {}, 'forward', 'KeyI')).toEqual({ forward: 'KeyI' });
  });

  it('swaps with the action that used the key', () => {
    const out = rebind(ACTIONS, {}, 'jump', 'KeyW');
    expect(out.jump).toBe('KeyW');
    expect(out.forward).toBe('Space');
  });

  it('takes a key from an alternate default (Ctrl from crouch)', () => {
    const out = rebind(ACTIONS, {}, 'reload', 'ControlLeft');
    expect(out.reload).toBe('ControlLeft');
    expect(out.crouch).toBe('KeyR');
  });

  it('swaps with an earlier override', () => {
    const out = rebind(ACTIONS, { forward: 'KeyI' }, 'back', 'KeyI');
    expect(out).toEqual({ forward: 'KeyS', back: 'KeyI' });
  });

  it('fixed keys are recognised', () => {
    for (const k of ['Escape', 'Tab', 'F3', 'Digit1', 'Digit4']) expect(FIXED_KEYS.test(k)).toBe(true);
    for (const k of ['Digit5', 'KeyF', 'F4']) expect(FIXED_KEYS.test(k)).toBe(false);
  });
});
