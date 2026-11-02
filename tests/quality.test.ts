import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, TIERS, TIER_ORDER, pickTier, renderScale, resolveTier, type HardwareInfo } from '../src/render/quality';
import { defaultSettings } from '../src/core/settings';

const strong: HardwareInfo = { gpu: 'NVIDIA GeForce RTX 4070', cores: 16, memoryGb: 8, mobile: false, maxTextureSize: 16384 };

describe('quality tiers', () => {
  it('detail decreases monotonically from ultra to potato', () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const lo = TIERS[TIER_ORDER[i - 1]], hi = TIERS[TIER_ORDER[i]];
      expect(hi.level).toBeGreaterThan(lo.level);
      expect(hi.textureSize).toBeGreaterThanOrEqual(lo.textureSize);
      expect(hi.drawDistance).toBeGreaterThanOrEqual(lo.drawDistance);
      expect(hi.lights).toBeGreaterThanOrEqual(lo.lights);
      expect(hi.resolution).toBeGreaterThanOrEqual(lo.resolution);
    }
    expect(TIERS.potato.post).toBe('none'); expect(TIERS.potato.resolution).toBe(0.5); expect(TIERS.potato.dust).toBe(0);
  });
  it('Auto benchmark picks a tier from frame time and hardware caps', () => {
    expect(pickTier({ avgFrameMs: 3, frames: 20 }, strong)).toBe('ultra');
    expect(pickTier({ avgFrameMs: 9, frames: 20 }, strong)).toBe('high');
    expect(pickTier({ avgFrameMs: 15, frames: 20 }, strong)).toBe('medium');
    expect(pickTier({ avgFrameMs: 25, frames: 20 }, strong)).toBe('low');
    expect(pickTier({ avgFrameMs: 60, frames: 20 }, strong)).toBe('potato');
    expect(pickTier({ avgFrameMs: 3, frames: 20 }, { ...strong, gpu: 'ANGLE (Google, SwiftShader)' })).toBe('potato');
    expect(pickTier({ avgFrameMs: 3, frames: 20 }, { ...strong, mobile: true })).toBe('medium');
    expect(pickTier({ avgFrameMs: 3, frames: 20 }, { ...strong, memoryGb: 2 })).toBe('low');
  });
  it('resolves Auto vs explicit and combines the resolution scale', () => {
    expect(resolveTier('auto', 'medium').id).toBe('medium'); expect(resolveTier('ultra', 'medium').id).toBe('ultra');
    const s = defaultSettings();
    expect(renderScale(TIERS.high, s, 1)).toBe(1);
    expect(renderScale(TIERS.potato, s, 1)).toBe(0.5);
    expect(renderScale(TIERS.high, { ...s, batterySaver: true }, 0.8)).toBeCloseTo(0.6);
    expect(renderScale(TIERS.potato, s, 0.1)).toBe(0.35);
  });
  it('dynamic resolution lowers scale under load, recovers, and respects the floor', () => {
    const q = new AdaptiveQuality('high', true);
    let scaleActions = 0, last = 1;
    for (let i = 0; i < 2000; i++) { const a = q.update(40); if (a?.kind === 'scale') { scaleActions++; last = a.scale; } }
    expect(scaleActions).toBeGreaterThan(2); expect(last).toBeGreaterThanOrEqual(q.minScale);
    const q2 = new AdaptiveQuality('high', true); q2.scale = 0.7;
    let recovered = 1;
    for (let i = 0; i < 1500; i++) { const a = q2.update(7); if (a?.kind === 'scale') recovered = a.scale; }
    expect(recovered).toBe(1);
  });
  it('drops a tier after sustained slowness at the floor, and offers a tier up after long headroom', () => {
    const q = new AdaptiveQuality('high', true);
    const actions = new Set<string>();
    for (let i = 0; i < 4000; i++) { const a = q.update(60); if (a) actions.add(a.kind === 'tierDown' ? `down:${a.to}` : a.kind); }
    expect(actions.has('down:medium')).toBe(true);
    const u = new AdaptiveQuality('medium', true);
    let offered: string | null = null;
    for (let i = 0; i < 2500 && !offered; i++) { const a = u.update(5); if (a?.kind === 'offerUp') offered = a.to; }
    expect(offered).toBe('high');
  });
  it('does nothing when the user fixed the tier', () => {
    const q = new AdaptiveQuality('ultra', false);
    for (let i = 0; i < 3000; i++) expect(q.update(100)).toBeNull();
  });
});
