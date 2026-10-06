import { describe, it, expect } from 'vitest';
import { itemStatus, wastagePct, expectedFabric, canTransition, isPositiveInt, isNonNegInt, isYards } from '../src/domain.js';

describe('traffic light', () => {
  it('GREEN / YELLOW / RED / uncounted', () => {
    expect(itemStatus(100, 100)).toBe('GREEN');
    expect(itemStatus(100, 101)).toBe('YELLOW');
    expect(itemStatus(100, 99)).toBe('RED');
    expect(itemStatus(100, 0)).toBe('RED');
    expect(itemStatus(100, null)).toBeNull();
  });
});
describe('wastage', () => {
  it('matches the spec formula', () => {
    expect(expectedFabric(1.8, 50)).toBe(90);
    expect(wastagePct(94.5, 90)).toBe(5);
    expect(wastagePct(85, 90)).toBe(-5.56);
  });
});
describe('state machine', () => {
  it('only allows the documented transitions', () => {
    expect(canTransition('PENDING_VERIFICATION', 'VERIFIED')).toBe(true);
    expect(canTransition('REJECTED', 'VERIFIED')).toBe(false);
    expect(canTransition('PENDING_VERIFICATION', 'IN_SEWING')).toBe(false);
    expect(canTransition('VERIFIED', 'PENDING_VERIFICATION')).toBe(false);
    expect(canTransition('IN_SEWING', 'VERIFIED')).toBe(false);
  });
});
describe('input guards', () => {
  it('reject bad numbers', () => {
    for (const v of [-1, 0, 1.5, '5', NaN, Infinity, null, undefined]) expect(isPositiveInt(v)).toBe(false);
    expect(isNonNegInt(0)).toBe(true);
    expect(isNonNegInt(-1)).toBe(false);
    expect(isYards(12.35)).toBe(true);
    expect(isYards(12.345)).toBe(false);
  });
});