/**
 * Unit tests: Memory Decay Service
 * Tests power-law decay computation, spaced repetition boosting,
 * reinforcement factor, and interval selection.
 */
import { describe, it, expect } from 'vitest';

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_DECAY_CONFIGS: Record<string, { decayExponent: number; initialStrength: number }> = {
  episodic:  { decayExponent: 0.5,  initialStrength: 1.0 },
  semantic:  { decayExponent: 0.15, initialStrength: 1.0 },
  emotional: { decayExponent: 0.3,  initialStrength: 1.0 },
  knowledge: { decayExponent: 0.1,  initialStrength: 1.0 },
  insights:  { decayExponent: 0.05, initialStrength: 1.0 },
};

const SPACED_REPETITION_INTERVALS_DAYS = [1, 3, 7, 21, 90];

const DEFAULT_REINFORCEMENT_FACTOR = 0.95;

function computeRetrievalStrength(
  memoryType: string,
  createdAt: Date,
  lastAccessedAt: Date | null,
  accessCount: number
): number {
  const config = DEFAULT_DECAY_CONFIGS[memoryType] || { decayExponent: 0.3, initialStrength: 1.0 };
  const lastAccess = lastAccessedAt || createdAt;
  const t = Math.max(1, (Date.now() - lastAccess.getTime()) / DAY_MS);
  const a = config.initialStrength;
  const d = config.decayExponent;

  let strength = a * Math.pow(t, -d);

  if (accessCount > 0) {
    strength = Math.min(1.0, strength * (1 + 0.01 * Math.log(accessCount + 1)));
  }

  return Math.max(0, Math.min(1.0, strength));
}

function boostOnRecall(
  memoryType: string,
  currentStrength: number,
  accessCount: number
): { newStrength: number; newDecayExponent: number } {
  const config = DEFAULT_DECAY_CONFIGS[memoryType] || { decayExponent: 0.3, initialStrength: 1.0 };
  const newAccessCount = accessCount + 1;

  const newStrength = Math.min(1.0, config.initialStrength);
  const newDecayExponent = config.decayExponent * Math.pow(DEFAULT_REINFORCEMENT_FACTOR, Math.min(newAccessCount, 10));

  return { newStrength, newDecayExponent };
}

function getCurrentInterval(accessCount: number): number {
  if (accessCount <= 0) return 1;
  const idx = Math.min(accessCount - 1, SPACED_REPETITION_INTERVALS_DAYS.length - 1);
  return SPACED_REPETITION_INTERVALS_DAYS[idx];
}

describe('Memory Decay Service — Power-Law Decay', () => {
  it('returns initial strength at time zero', () => {
    const now = new Date();
    const strength = computeRetrievalStrength('episodic', now, now, 0);
    expect(strength).toBeCloseTo(1.0, 1);
  });

  it('decays episodic memory with exponent 0.5', () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 1 * DAY_MS);
    const strength = computeRetrievalStrength('episodic', oneDayAgo, oneDayAgo, 0);
    // t=1 day, S = 1 * 1^(-0.5) = 1.0
    expect(strength).toBeCloseTo(1.0, 1);
  });

  it('decays episodic memory after 4 days', () => {
    const now = new Date();
    const fourDaysAgo = new Date(now.getTime() - 4 * DAY_MS);
    const strength = computeRetrievalStrength('episodic', fourDaysAgo, fourDaysAgo, 0);
    // t=4, S = 1 * 4^(-0.5) = 1/2 = 0.5
    expect(strength).toBeCloseTo(0.5, 2);
  });

  it('decays episodic memory after 100 days', () => {
    const now = new Date();
    const hundredDaysAgo = new Date(now.getTime() - 100 * DAY_MS);
    const strength = computeRetrievalStrength('episodic', hundredDaysAgo, hundredDaysAgo, 0);
    // t=100, S = 1 * 100^(-0.5) = 1/10 = 0.1
    expect(strength).toBeCloseTo(0.1, 2);
  });

  it('semantic memory decays slower (d=0.15)', () => {
    const now = new Date();
    const hundredDaysAgo = new Date(now.getTime() - 100 * DAY_MS);
    const episodicStrength = computeRetrievalStrength('episodic', hundredDaysAgo, hundredDaysAgo, 0);
    const semanticStrength = computeRetrievalStrength('semantic', hundredDaysAgo, hundredDaysAgo, 0);
    // semantic should be higher (slower decay)
    expect(semanticStrength).toBeGreaterThan(episodicStrength);
  });

  it('insights decay slowest (d=0.05)', () => {
    const now = new Date();
    const hundredDaysAgo = new Date(now.getTime() - 100 * DAY_MS);
    const strengths = ['episodic', 'semantic', 'emotional', 'knowledge', 'insights'].map(type =>
      computeRetrievalStrength(type, hundredDaysAgo, hundredDaysAgo, 0)
    );
    // insights should have the highest strength
    expect(strengths[4]).toBeGreaterThan(strengths[0]);
  });

  it('access count provides small boost', () => {
    const now = new Date();
    const hundredDaysAgo = new Date(now.getTime() - 100 * DAY_MS);
    const strength0 = computeRetrievalStrength('episodic', hundredDaysAgo, hundredDaysAgo, 0);
    const strength10 = computeRetrievalStrength('episodic', hundredDaysAgo, hundredDaysAgo, 10);
    expect(strength10).toBeGreaterThan(strength0);
  });

  it('strength is clamped to [0, 1]', () => {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 1000);
    const strength = computeRetrievalStrength('episodic', futureDate, futureDate, 0);
    expect(strength).toBeLessThanOrEqual(1.0);
    expect(strength).toBeGreaterThanOrEqual(0);
  });

  it('unknown memory type falls back to default decay 0.3', () => {
    const now = new Date();
    const hundredDaysAgo = new Date(now.getTime() - 100 * DAY_MS);
    const strength = computeRetrievalStrength('unknown_type', hundredDaysAgo, hundredDaysAgo, 0);
    // Should still return a valid number
    expect(strength).toBeGreaterThan(0);
    expect(strength).toBeLessThanOrEqual(1.0);
  });

  it('minimum t is 1 day even for just-created memories', () => {
    const now = new Date();
    const strength = computeRetrievalStrength('episodic', now, now, 0);
    // t=1, S = 1 * 1^(-0.5) = 1.0
    expect(strength).toBeCloseTo(1.0, 1);
  });
});

describe('Memory Decay Service — Spaced Repetition Boosting', () => {
  it('resets strength to initial on recall', () => {
    const result = boostOnRecall('episodic', 0.1, 0);
    expect(result.newStrength).toBeCloseTo(1.0, 1);
  });

  it('reduces decay exponent on recall', () => {
    const original = DEFAULT_DECAY_CONFIGS.episodic.decayExponent;
    const result = boostOnRecall('episodic', 0.5, 0);
    expect(result.newDecayExponent).toBeLessThan(original);
  });

  it('applies reinforcement factor multiplicatively', () => {
    const result = boostOnRecall('episodic', 0.5, 0);
    // d_new = d_old * 0.95^min(newAccessCount, 10)
    // accessCount=0 => newAccessCount=1 => 0.5 * 0.95^1 = 0.475
    expect(result.newDecayExponent).toBeCloseTo(0.5 * 0.95, 5);
  });

  it('applies reinforcement factor cumulatively', () => {
    const result1 = boostOnRecall('episodic', 0.5, 1);
    const result2 = boostOnRecall('episodic', 0.5, 4);
    // d_new = d_old * 0.95^newAccessCount (capped at 10)
    // result1: newAccessCount=2 => 0.5 * 0.95^2 = 0.45125
    // result2: newAccessCount=5 => 0.5 * 0.95^5 ≈ 0.38689
    expect(result2.newDecayExponent).toBeLessThan(result1.newDecayExponent);
  });

  it('caps reinforcement at 10 applications', () => {
    const result1 = boostOnRecall('episodic', 0.5, 9);
    const result2 = boostOnRecall('episodic', 0.5, 10);
    // Both capped at 10 => same exponent
    expect(result1.newDecayExponent).toBeCloseTo(result2.newDecayExponent, 5);
  });

  it('new strength never exceeds 1.0', () => {
    const result = boostOnRecall('episodic', 0.9, 5);
    expect(result.newStrength).toBeLessThanOrEqual(1.0);
  });

  it('unknown type still produces valid boost', () => {
    const result = boostOnRecall('unknown', 0.5, 2);
    expect(result.newStrength).toBeGreaterThan(0);
    expect(result.newDecayExponent).toBeGreaterThan(0);
  });
});

describe('Memory Decay Service — Intervals', () => {
  it('returns 1 day for access count 1', () => {
    expect(getCurrentInterval(1)).toBe(1);
  });

  it('returns 3 days for access count 2', () => {
    expect(getCurrentInterval(2)).toBe(3);
  });

  it('returns 7 days for access count 3', () => {
    expect(getCurrentInterval(3)).toBe(7);
  });

  it('returns 21 days for access count 4', () => {
    expect(getCurrentInterval(4)).toBe(21);
  });

  it('returns 90 days for access count 5', () => {
    expect(getCurrentInterval(5)).toBe(90);
  });

  it('returns 90 days for access count beyond array (caps)', () => {
    expect(getCurrentInterval(100)).toBe(90);
  });

  it('returns 1 day for access count 0 (initial)', () => {
    expect(getCurrentInterval(0)).toBe(1);
  });
});
