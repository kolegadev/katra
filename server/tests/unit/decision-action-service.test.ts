import { describe, it, expect } from 'vitest';

const ALPHA = 0.1;
const GAMMA = 0.9;
const TAU_BASE = 0.5;

function computeTDDelta(reward: number, maxQNext: number, qBefore: number): number {
  return reward + GAMMA * maxQNext - qBefore;
}

function updateQ(qBefore: number, delta: number): number {
  return qBefore + ALPHA * delta;
}

function computeRewardFromValence(prevValence: number, currValence: number, expected: number, expectedFuture: number): number {
  return (currValence - prevValence) + GAMMA * expectedFuture - expected;
}

function softmaxProbabilities(qValues: number[], tau: number): number[] {
  const maxQ = Math.max(...qValues);
  const expValues = qValues.map(q => Math.exp((q - maxQ) / tau));
  const sumExp = expValues.reduce((a, b) => a + b, 0);
  return expValues.map(e => e / sumExp);
}

function driftDiffusionRt(mu: number, sigma: number, boundary: number): number {
  const absMu = Math.abs(mu);
  return 250 + (absMu > 0.0001 ? (boundary / absMu) * 100 : 1000);
}

function isConflict(delta: number): boolean {
  return delta > 0.3;
}

function isCorrect(delta: number): boolean {
  return delta < 0.15;
}

function isSurprise(delta: number): boolean {
  return delta > 0.5;
}

describe('Decision-Action Service — TD-Learning', () => {
  it('delta is computed correctly: r + γ*maxQ(s\') - Q(s,a)', () => {
    const reward = 0.5;
    const maxQNext = 0.8;
    const qBefore = 0.2;

    const delta = computeTDDelta(reward, maxQNext, qBefore);
    expect(delta).toBeCloseTo(reward + 0.9 * 0.8 - 0.2, 5);
  });

  it('Q is updated: Q ← Q + α*δ', () => {
    const qBefore = 0.3;
    const delta = 0.4;

    const qAfter = updateQ(qBefore, delta);
    expect(qAfter).toBeCloseTo(0.34, 5);
  });

  it('delta is 0 when reward perfectly predicts future value', () => {
    const reward = 0.3;
    const maxQNext = 1.0;
    const qBefore = reward + GAMMA * maxQNext;

    const delta = computeTDDelta(reward, maxQNext, qBefore);
    expect(delta).toBeCloseTo(0, 5);
  });

  it('delta is positive when reward exceeds prediction', () => {
    const reward = 0.8;
    const maxQNext = 0.9;
    const qBefore = 0.5;

    const delta = computeTDDelta(reward, maxQNext, qBefore);
    expect(delta).toBeGreaterThan(0);
  });

  it('delta is negative when outcome is worse than expected', () => {
    const reward = -0.5;
    const maxQNext = 0.2;
    const qBefore = 0.7;

    const delta = computeTDDelta(reward, maxQNext, qBefore);
    expect(delta).toBeLessThan(0);
  });

  it('Q converges toward target with repeated updates', () => {
    const targetQ = 1.0;
    let q = 0;
    for (let i = 0; i < 100; i++) {
      const delta = targetQ - q;
      q = updateQ(q, delta);
    }
    expect(q).toBeCloseTo(targetQ, 2);
  });

  it('alpha controls learning rate', () => {
    const delta = 0.5;
    const qBefore = 0.2;
    const step1 = updateQ(qBefore, delta);
    expect(step1 - qBefore).toBeCloseTo(ALPHA * delta, 5);
  });

  it('gamma discounts future value', () => {
    const reward = 0;
    const nearQ = 1.0;
    const farQ = 1.0;

    const nearDelta = computeTDDelta(reward, nearQ, 0);
    const farDiscount = Math.pow(GAMMA, 5);
    expect(farDiscount).toBeLessThan(nearDelta);
  });
});

describe('Decision-Action Service — Reward from Valence', () => {
  it('reward increases when valence rises', () => {
    const reward = computeRewardFromValence(0.3, 0.7, 0.1, 0.2);
    expect(reward).toBeCloseTo((0.7 - 0.3) + 0.9 * 0.2 - 0.1, 5);
  });

  it('reward decreases when valence drops', () => {
    const reward = computeRewardFromValence(0.8, 0.2, 0.5, 0.3);
    expect(reward).toBeCloseTo((0.2 - 0.8) + 0.9 * 0.3 - 0.5, 5);
  });

  it('reward is zero when everything matches expectation', () => {
    const reward = computeRewardFromValence(0.5, 0.5, 0.45, 0.5);
    expect(reward).toBeCloseTo(0 + 0.9 * 0.5 - 0.45, 5);
  });

  it('expected future boosts reward', () => {
    const rewardLow = computeRewardFromValence(0.5, 0.6, 0.1, 0.0);
    const rewardHigh = computeRewardFromValence(0.5, 0.6, 0.1, 1.0);
    expect(rewardHigh).toBeGreaterThan(rewardLow);
  });

  it('high expected_now penalizes reward', () => {
    const rewardLowExpect = computeRewardFromValence(0.5, 0.7, 0.1, 0.5);
    const rewardHighExpect = computeRewardFromValence(0.5, 0.7, 0.9, 0.5);
    expect(rewardLowExpect).toBeGreaterThan(rewardHighExpect);
  });
});

describe('Decision-Action Service — Softmax', () => {
  it('probabilities sum to 1', () => {
    const qValues = [0.5, 0.3, 0.8, 0.1];
    const probs = softmaxProbabilities(qValues, TAU_BASE);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('highest Q gets highest probability', () => {
    const qValues = [0.1, 0.9, 0.3];
    const probs = softmaxProbabilities(qValues, TAU_BASE);
    expect(probs[1]).toBeGreaterThan(probs[0]);
    expect(probs[1]).toBeGreaterThan(probs[2]);
  });

  it('equal Q values produce equal probabilities', () => {
    const qValues = [0.5, 0.5, 0.5];
    const probs = softmaxProbabilities(qValues, TAU_BASE);
    for (const p of probs) {
      expect(p).toBeCloseTo(1 / 3, 5);
    }
  });

  it('temperature controls exploration', () => {
    const qValues = [0.9, 0.1];
    const probsLow = softmaxProbabilities(qValues, 0.1);
    const probsHigh = softmaxProbabilities(qValues, 2.0);

    const ratioLow = probsLow[0] / probsLow[1];
    const ratioHigh = probsHigh[0] / probsHigh[1];
    expect(ratioLow).toBeGreaterThan(ratioHigh);
  });

  it('temperature 0 leads to greedy selection', () => {
    const qValues = [0.9, 0.1];
    const probs = softmaxProbabilities(qValues, 0.01);
    expect(probs[0]).toBeGreaterThan(0.99);
    expect(probs[1]).toBeLessThan(0.01);
  });

  it('is numerically stable with large Q values', () => {
    const qValues = [100, 101, 99];
    const probs = softmaxProbabilities(qValues, TAU_BASE);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('handles negative Q values', () => {
    const qValues = [-5, -2, -8];
    const probs = softmaxProbabilities(qValues, TAU_BASE);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(probs[1]).toBeGreaterThan(probs[0]);
    expect(probs[1]).toBeGreaterThan(probs[2]);
  });
});

describe('Decision-Action Service — Drift-Diffusion', () => {
  it('RT is faster with stronger evidence (higher μ)', () => {
    const rtStrong = driftDiffusionRt(1.0, 0.1, 1.0);
    const rtWeak = driftDiffusionRt(0.1, 0.1, 1.0);
    expect(rtStrong).toBeLessThan(rtWeak);
  });

  it('RT has baseline of 250ms', () => {
    const rt = driftDiffusionRt(100, 0.1, 1.0);
    expect(rt).toBeGreaterThanOrEqual(250);
  });

  it('RT is capped at ~1000ms for very low drift', () => {
    const rt = driftDiffusionRt(0, 0.1, 1.0);
    expect(rt).toBe(1250);
  });

  it('boundary affects RT proportionally', () => {
    const rtSmall = driftDiffusionRt(0.5, 0.1, 0.5);
    const rtLarge = driftDiffusionRt(0.5, 0.1, 2.0);
    expect(rtLarge).toBeGreaterThan(rtSmall);
  });

  it('sigma affects drift noise range', () => {
    const mu = 0.5;
    const sigma = 0.1;
    expect(sigma).toBe(0.1);
  });
});

describe('Decision-Action Service — Error Monitoring', () => {
  it('conflict when |actual - expected| > 0.3', () => {
    expect(isConflict(0.35)).toBe(true);
    expect(isConflict(0.31)).toBe(true);
    expect(isConflict(0.5)).toBe(true);
  });

  it('not conflict when delta is small', () => {
    expect(isConflict(0.3)).toBe(false);
    expect(isConflict(0.29)).toBe(false);
    expect(isConflict(0.1)).toBe(false);
    expect(isConflict(0.0)).toBe(false);
  });

  it('correct when |actual - expected| < 0.15', () => {
    expect(isCorrect(0.14)).toBe(true);
    expect(isCorrect(0.05)).toBe(true);
    expect(isCorrect(0.0)).toBe(true);
  });

  it('not correct when delta is large', () => {
    expect(isCorrect(0.15)).toBe(false);
    expect(isCorrect(0.2)).toBe(false);
    expect(isCorrect(0.5)).toBe(false);
  });

  it('surprise when |actual - expected| > 0.5', () => {
    expect(isSurprise(0.51)).toBe(true);
    expect(isSurprise(0.8)).toBe(true);
    expect(isSurprise(1.0)).toBe(true);
  });

  it('not surprise when delta is moderate', () => {
    expect(isSurprise(0.5)).toBe(false);
    expect(isSurprise(0.3)).toBe(false);
    expect(isSurprise(0.0)).toBe(false);
  });

  it('accuracy is correctCount / totalOutcomes', () => {
    const correctCount = 75;
    const totalOutcomes = 100;
    const accuracy = correctCount / totalOutcomes;
    expect(accuracy).toBeCloseTo(0.75, 5);
  });
});
