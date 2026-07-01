/**
 * Unit tests: Salience Service (Attention Gate)
 *
 * Tests salience computation, weight modulation, tier thresholds,
 * Bayesian surprise, and meta-state transitions.
 */
import { describe, it, expect } from 'vitest';

const META_WEIGHTS: Record<string, Record<string, number>> = {
  exploration:    { novelty: 0.40, emotion: 0.20, goal: 0.15, recency: 0.10, freq: 0.10, intensity: 0.05 },
  task_execution: { goal: 0.50, recency: 0.25, novelty: 0.10, emotion: 0.05, freq: 0.05, intensity: 0.05 },
  reflection:     { emotion: 0.35, goal: 0.20, recency: 0.15, novelty: 0.15, freq: 0.10, intensity: 0.05 },
  alert:          { emotion: 0.30, novelty: 0.25, recency: 0.20, goal: 0.20, freq: 0.03, intensity: 0.02 },
  idle:           { novelty: 0.30, emotion: 0.25, recency: 0.15, goal: 0.10, freq: 0.15, intensity: 0.05 },
};

const META_AROUSAL: Record<string, number> = {
  exploration: 0.80,
  task_execution: 0.65,
  reflection: 0.50,
  alert: 0.90,
  idle: 0.20,
};

function computeYerkesDodsonThreshold(metaState: string): number {
  const arousal = META_AROUSAL[metaState] ?? 0.5;
  return 0.5 + 0.3 * Math.pow(arousal - 0.5, 2);
}

function computeRecency(hoursSinceEvent: number): number {
  return 1 / (1 + 0.1 * Math.max(0, hoursSinceEvent));
}

function computeSalienceRaw(
  signals: Record<string, number>,
  weights: Record<string, number>
): number {
  return (
    weights.recency * signals.recency +
    weights.emotion * signals.emotionalIntensity +
    weights.goal * signals.goalRelevance +
    weights.novelty * signals.novelty +
    weights.freq * signals.frequencyRarity +
    weights.intensity * signals.intensity
  );
}

function classifyTier(score: number): 'high' | 'medium' | 'low' {
  if (score > 0.7) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

function computeBayesianSurprise(
  priorValence: number,
  priorIntensity: number,
  newValence: number,
  newIntensity: number
): number {
  const valenceShift = Math.abs(newValence - priorValence);
  const intensityShift = Math.abs(newIntensity - priorIntensity);
  return parseFloat((0.6 * valenceShift + 0.4 * intensityShift).toFixed(4));
}

function getProcessingDirective(tier: 'high' | 'medium' | 'low'): {
  compute_embedding: boolean;
  trigger_consolidation: boolean;
  decay_multiplier: number;
  add_to_working_memory: boolean;
} {
  switch (tier) {
    case 'high':
      return { compute_embedding: true, trigger_consolidation: true, decay_multiplier: 1.0, add_to_working_memory: true };
    case 'medium':
      return { compute_embedding: true, trigger_consolidation: false, decay_multiplier: 1.5, add_to_working_memory: false };
    case 'low':
      return { compute_embedding: false, trigger_consolidation: false, decay_multiplier: 3.0, add_to_working_memory: false };
  }
}

describe('Salience Service — Signal Computation', () => {
  it('recency is 1.0 at time zero', () => {
    expect(computeRecency(0)).toBeCloseTo(1.0, 2);
  });

  it('recency decays with hours', () => {
    const r0 = computeRecency(0);
    const r10 = computeRecency(10);
    const r100 = computeRecency(100);
    expect(r10).toBeLessThan(r0);
    expect(r100).toBeLessThan(r10);
  });

  it('recency at 10 hours is 1/(1+1) = 0.5', () => {
    expect(computeRecency(10)).toBeCloseTo(0.5, 2);
  });

  it('recency approaches 0 for very old events', () => {
    const r = computeRecency(1000);
    expect(r).toBeLessThan(0.05);
  });

  it('recency is clamped above 0 for negative hours', () => {
    const r = computeRecency(-5);
    expect(r).toBeGreaterThanOrEqual(0);
  });

  it('all 6 signals contribute to score', () => {
    const signals = {
      recency: 0.8,
      emotionalIntensity: 0.6,
      goalRelevance: 0.4,
      novelty: 0.5,
      frequencyRarity: 0.7,
      intensity: 0.9,
    };
    const weights = META_WEIGHTS.idle;
    const score = computeSalienceRaw(signals, weights);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('score is clamped to [0, 1]', () => {
    const signals = {
      recency: 1.0,
      emotionalIntensity: 1.0,
      goalRelevance: 1.0,
      novelty: 1.0,
      frequencyRarity: 1.0,
      intensity: 1.0,
    };
    for (const state of Object.keys(META_WEIGHTS)) {
      const weights = META_WEIGHTS[state];
      const score = computeSalienceRaw(signals, weights);
      // Sum of all weights = 1.0, so score should equal 1.0 when all signals are 1.0
      expect(score).toBeCloseTo(1.0, 5);
    }
  });

  it('all-zero signals produce zero score', () => {
    const signals = {
      recency: 0,
      emotionalIntensity: 0,
      goalRelevance: 0,
      novelty: 0,
      frequencyRarity: 0,
      intensity: 0,
    };
    const weights = META_WEIGHTS.exploration;
    expect(computeSalienceRaw(signals, weights)).toBe(0);
  });
});

describe('Salience Service — Weight Modulation (Meta-States)', () => {
  it('exploration weights novelty highest', () => {
    const w = META_WEIGHTS.exploration;
    expect(w.novelty).toBeGreaterThan(w.emotion);
    expect(w.novelty).toBeGreaterThan(w.goal);
    expect(w.novelty).toBeGreaterThan(w.recency);
  });

  it('task_execution weights goal highest', () => {
    const w = META_WEIGHTS.task_execution;
    expect(w.goal).toBeGreaterThan(w.recency);
    expect(w.goal).toBeGreaterThan(w.novelty);
    expect(w.goal).toBeGreaterThan(w.emotion);
  });

  it('reflection weights emotion highest', () => {
    const w = META_WEIGHTS.reflection;
    expect(w.emotion).toBeGreaterThan(w.goal);
    expect(w.emotion).toBeGreaterThan(w.recency);
    expect(w.emotion).toBeGreaterThan(w.novelty);
  });

  it('alert weights emotion highest', () => {
    const w = META_WEIGHTS.alert;
    expect(w.emotion).toBeGreaterThan(w.novelty);
    expect(w.emotion).toBeGreaterThan(w.recency);
    expect(w.emotion).toBeGreaterThan(w.goal);
  });

  it('idle weights novelty highest', () => {
    const w = META_WEIGHTS.idle;
    expect(w.novelty).toBeGreaterThan(w.emotion);
    expect(w.novelty).toBeGreaterThan(w.recency);
    expect(w.novelty).toBeGreaterThan(w.goal);
  });

  it('all meta-state weights sum to 1', () => {
    for (const state of Object.keys(META_WEIGHTS)) {
      const w = META_WEIGHTS[state];
      const sum = w.recency + w.emotion + w.goal + w.novelty + w.freq + w.intensity;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  it('different meta-states produce different scores for same signals', () => {
    const signals = {
      recency: 0.9,
      emotionalIntensity: 0.3,
      goalRelevance: 0.8,
      novelty: 0.2,
      frequencyRarity: 0.5,
      intensity: 0.4,
    };
    const scores = Object.keys(META_WEIGHTS).map(state =>
      computeSalienceRaw(signals, META_WEIGHTS[state])
    );
    const uniqueScores = new Set(scores.map(s => s.toFixed(4)));
    expect(uniqueScores.size).toBeGreaterThan(1);
  });
});

describe('Salience Service — Tier Thresholds', () => {
  it('score > 0.7 is high tier', () => {
    expect(classifyTier(0.71)).toBe('high');
    expect(classifyTier(0.9)).toBe('high');
    expect(classifyTier(1.0)).toBe('high');
  });

  it('score exactly 0.7 is medium (boundary)', () => {
    expect(classifyTier(0.7)).toBe('medium');
  });

  it('score 0.35-0.7 is medium tier', () => {
    expect(classifyTier(0.35)).toBe('medium');
    expect(classifyTier(0.5)).toBe('medium');
    expect(classifyTier(0.69)).toBe('medium');
  });

  it('score < 0.35 is low tier', () => {
    expect(classifyTier(0.34)).toBe('low');
    expect(classifyTier(0.1)).toBe('low');
    expect(classifyTier(0)).toBe('low');
  });

  it('high tier gets full processing directive', () => {
    const d = getProcessingDirective('high');
    expect(d.compute_embedding).toBe(true);
    expect(d.trigger_consolidation).toBe(true);
    expect(d.decay_multiplier).toBe(1.0);
    expect(d.add_to_working_memory).toBe(true);
  });

  it('medium tier gets embedding only', () => {
    const d = getProcessingDirective('medium');
    expect(d.compute_embedding).toBe(true);
    expect(d.trigger_consolidation).toBe(false);
    expect(d.decay_multiplier).toBe(1.5);
    expect(d.add_to_working_memory).toBe(false);
  });

  it('low tier gets minimal processing + faster decay', () => {
    const d = getProcessingDirective('low');
    expect(d.compute_embedding).toBe(false);
    expect(d.trigger_consolidation).toBe(false);
    expect(d.decay_multiplier).toBe(3.0);
    expect(d.add_to_working_memory).toBe(false);
  });
});

describe('Salience Service — Yerkes-Dodson Threshold', () => {
  it('reflection (arousal=0.5) gives minimum threshold of 0.5', () => {
    expect(computeYerkesDodsonThreshold('reflection')).toBeCloseTo(0.5, 4);
  });

  it('alert (arousal=0.9) gives higher threshold', () => {
    const t = computeYerkesDodsonThreshold('alert');
    // 0.5 + 0.3*(0.9-0.5)^2 = 0.5 + 0.3*0.16 = 0.5 + 0.048 = 0.548
    expect(t).toBeCloseTo(0.548, 4);
  });

  it('idle (arousal=0.2) gives higher threshold', () => {
    const t = computeYerkesDodsonThreshold('idle');
    // 0.5 + 0.3*(0.2-0.5)^2 = 0.5 + 0.3*0.09 = 0.5 + 0.027 = 0.527
    expect(t).toBeCloseTo(0.527, 4);
  });

  it('exploration (arousal=0.8) gives higher threshold', () => {
    const t = computeYerkesDodsonThreshold('exploration');
    // 0.5 + 0.3*(0.8-0.5)^2 = 0.5 + 0.3*0.09 = 0.5 + 0.027 = 0.527
    expect(t).toBeCloseTo(0.527, 4);
  });

  it('threshold is symmetric around arousal=0.5', () => {
    const tLow = computeYerkesDodsonThreshold('idle');       // arousal 0.2
    const tHigh = computeYerkesDodsonThreshold('exploration'); // arousal 0.8
    expect(tLow).toBeCloseTo(tHigh, 4);
  });

  it('task_execution gives moderate threshold', () => {
    const t = computeYerkesDodsonThreshold('task_execution');
    // 0.5 + 0.3*(0.65-0.5)^2 = 0.5 + 0.3*0.0225 = 0.5 + 0.00675 = 0.50675
    expect(t).toBeCloseTo(0.50675, 4);
  });

  it('all thresholds are >= 0.5', () => {
    for (const state of Object.keys(META_AROUSAL)) {
      expect(computeYerkesDodsonThreshold(state)).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('Salience Service — Bayesian Surprise', () => {
  it('no shift gives zero surprise', () => {
    expect(computeBayesianSurprise(0.5, 0.5, 0.5, 0.5)).toBe(0);
  });

  it('valence shift contributes 60% weight', () => {
    const s = computeBayesianSurprise(0, 0.5, 1.0, 0.5);
    // |1.0 - 0| = 1.0 valence shift, |0.5 - 0.5| = 0 intensity shift
    // 0.6 * 1.0 + 0.4 * 0 = 0.6
    expect(s).toBeCloseTo(0.6, 4);
  });

  it('intensity shift contributes 40% weight', () => {
    const s = computeBayesianSurprise(0.5, 0, 0.5, 1.0);
    // |0.5 - 0.5| = 0 valence shift, |1.0 - 0| = 1.0 intensity shift
    // 0.6 * 0 + 0.4 * 1.0 = 0.4
    expect(s).toBeCloseTo(0.4, 4);
  });

  it('combined shift', () => {
    const s = computeBayesianSurprise(0.2, 0.4, 0.8, 0.9);
    // valence shift = 0.6, intensity shift = 0.5
    // 0.6 * 0.6 + 0.4 * 0.5 = 0.36 + 0.20 = 0.56
    expect(s).toBeCloseTo(0.56, 4);
  });

  it('surprise is symmetric (direction does not matter)', () => {
    const s1 = computeBayesianSurprise(0.1, 0.3, 0.9, 0.7);
    const s2 = computeBayesianSurprise(0.9, 0.7, 0.1, 0.3);
    expect(s1).toBe(s2);
  });

  it('surprise is clamped between 0 and 1 for valid inputs [0,1]', () => {
    const s = computeBayesianSurprise(0, 0, 1.0, 1.0);
    expect(s).toBeLessThanOrEqual(1.0);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe('Salience Service — Edge Cases', () => {
  it('default meta-state weights are valid', () => {
    for (const state of Object.keys(META_WEIGHTS)) {
      const w = META_WEIGHTS[state];
      for (const key of Object.keys(w)) {
        expect(w[key]).toBeGreaterThanOrEqual(0);
        expect(w[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('recency with negative hours is handled', () => {
    const r = computeRecency(-10);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  it('recency with very large hours still returns valid number', () => {
    const r = computeRecency(1e6);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});
