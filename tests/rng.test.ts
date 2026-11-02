import { describe, expect, it } from 'vitest';
import { Rng, hash3, hashString, deriveSeed, parseSeed, cellRng, randomSeedString } from '../src/gen/rng';

describe('rng', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 20 }, () => a.u32()), sb = Array.from({ length: 20 }, () => b.u32()), sc = Array.from({ length: 20 }, () => c.u32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });
  it('next() stays in [0,1) and int() is inclusive', () => {
    const r = new Rng(1);
    for (let i = 0; i < 5000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });
  it('is roughly uniform', () => {
    const r = new Rng(9); const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) buckets[Math.floor(r.next() * 10)]++;
    for (const b of buckets) expect(Math.abs(b - 2000)).toBeLessThan(250);
  });
  it('hash3 does not depend on call order', () => {
    const forward = [hash3(5, 1, 2), hash3(5, 3, 4), hash3(5, 1, 2, 9)];
    const reverse = [hash3(5, 1, 2, 9), hash3(5, 3, 4), hash3(5, 1, 2)].reverse();
    expect(forward).toEqual(reverse);
    expect(hash3(5, 1, 2)).not.toBe(hash3(5, 2, 1));
    expect(cellRng(7, 3, 3).next()).toBe(cellRng(7, 3, 3).next());
  });
  it('fork gives independent, reproducible streams', () => {
    const a = new Rng(10).fork('x'), b = new Rng(10).fork('x'), c = new Rng(10).fork('y');
    expect(a.u32()).toBe(b.u32());
    expect(new Rng(10).fork('x').u32()).not.toBe(c.u32());
  });
  it('shuffle is a permutation', () => {
    const arr = Array.from({ length: 30 }, (_, i) => i);
    const out = new Rng(3).shuffle([...arr]);
    expect([...out].sort((x, y) => x - y)).toEqual(arr);
  });
  it('seeds: strings hash stably, numbers pass through, derive differs per label', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(parseSeed('12345')).toBe(12345);
    expect(parseSeed('k7qd-93mx')).toBe(parseSeed('K7QD-93MX'));
    expect(deriveSeed(1, 'level:0')).not.toBe(deriveSeed(1, 'level:1'));
    expect(randomSeedString()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});
