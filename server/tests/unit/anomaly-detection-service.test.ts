/**
 * Unit tests: Anomaly Detection Service
 * Tests z-score computation, cosine distance, classification thresholds,
 * and the three classification tiers (NORMAL, SUSPECT, ANOMALOUS).
 */
import { describe, it, expect } from 'vitest';

function cosineDistance(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 1.0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 1.0;
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return 1.0 - Math.max(-1, Math.min(1, similarity));
}

function classifyZScore(z: number, confidence: number): {
  classification: string;
  adjustedConfidence: number;
  shouldQuarantine: boolean;
} {
  if (z < 2) {
    return { classification: 'NORMAL', adjustedConfidence: confidence, shouldQuarantine: false };
  } else if (z < 3) {
    return { classification: 'SUSPECT', adjustedConfidence: confidence * 0.5, shouldQuarantine: false };
  } else {
    return { classification: 'ANOMALOUS', adjustedConfidence: 0.0, shouldQuarantine: true };
  }
}

describe('Anomaly Detection — Cosine Distance', () => {
  it('identical vectors have distance 0', () => {
    const v = [1, 2, 3];
    expect(cosineDistance(v, v)).toBeCloseTo(0, 5);
  });

  it('orthogonal vectors have distance 1', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineDistance(a, b)).toBeCloseTo(1.0, 5);
  });

  it('opposite vectors have distance 2', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineDistance(a, b)).toBeCloseTo(2.0, 5);
  });

  it('similar but not identical vectors have small distance', () => {
    const a = [1, 2, 3];
    const b = [1.1, 2.1, 3.1];
    const d = cosineDistance(a, b);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(0.01);
  });

  it('empty vectors return distance 1', () => {
    expect(cosineDistance([], [])).toBe(1.0);
    expect(cosineDistance([1], [])).toBe(1.0);
  });

  it('zero vectors return distance 1', () => {
    expect(cosineDistance([0, 0, 0], [1, 2, 3])).toBe(1.0);
  });

  it('handles vectors of different lengths', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [1, 2, 3];
    const d = cosineDistance(a, b);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(2);
  });

  it('high-dimensional identical vectors', () => {
    const v = Array.from({ length: 384 }, (_, i) => i * 0.01);
    expect(cosineDistance(v, v)).toBeCloseTo(0, 5);
  });
});

describe('Anomaly Detection — Z-Score Classification', () => {
  it('z < 2 classifies as NORMAL', () => {
    const result = classifyZScore(0, 0.9);
    expect(result.classification).toBe('NORMAL');
    expect(result.adjustedConfidence).toBe(0.9);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('z = 1.99 classifies as NORMAL', () => {
    const result = classifyZScore(1.99, 0.8);
    expect(result.classification).toBe('NORMAL');
    expect(result.adjustedConfidence).toBe(0.8);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('2 <= z < 3 classifies as SUSPECT with halved confidence', () => {
    const result = classifyZScore(2.0, 0.8);
    expect(result.classification).toBe('SUSPECT');
    expect(result.adjustedConfidence).toBeCloseTo(0.4, 5);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('z = 2.99 classifies as SUSPECT', () => {
    const result = classifyZScore(2.99, 0.8);
    expect(result.classification).toBe('SUSPECT');
    expect(result.adjustedConfidence).toBeCloseTo(0.4, 5);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('z >= 3 classifies as ANOMALOUS and quarantines', () => {
    const result = classifyZScore(3.0, 0.8);
    expect(result.classification).toBe('ANOMALOUS');
    expect(result.adjustedConfidence).toBe(0.0);
    expect(result.shouldQuarantine).toBe(true);
  });

  it('z = 10 strongly anomalous', () => {
    const result = classifyZScore(10.0, 0.9);
    expect(result.classification).toBe('ANOMALOUS');
    expect(result.adjustedConfidence).toBe(0.0);
    expect(result.shouldQuarantine).toBe(true);
  });

  it('negative z still normal', () => {
    const result = classifyZScore(-1.0, 0.8);
    expect(result.classification).toBe('NORMAL');
    expect(result.adjustedConfidence).toBe(0.8);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('confidence is preserved for NORMAL', () => {
    for (let z = -1; z < 2; z += 0.5) {
      const result = classifyZScore(z, 0.75);
      expect(result.adjustedConfidence).toBe(0.75);
    }
  });

  it('confidence is halved for SUSPECT', () => {
    const result = classifyZScore(2.5, 0.6);
    expect(result.adjustedConfidence).toBeCloseTo(0.3, 5);
  });

  it('confidence is zero for ANOMALOUS', () => {
    const result = classifyZScore(5.0, 0.99);
    expect(result.adjustedConfidence).toBe(0.0);
  });
});

describe('Anomaly Detection — Edge Cases', () => {
  it('z exactly at boundaries', () => {
    expect(classifyZScore(2.0, 1.0).classification).toBe('SUSPECT');
    expect(classifyZScore(3.0, 1.0).classification).toBe('ANOMALOUS');
    expect(classifyZScore(1.999999, 1.0).classification).toBe('NORMAL');
  });

  it('handles very large z-scores', () => {
    const result = classifyZScore(1e6, 0.5);
    expect(result.classification).toBe('ANOMALOUS');
    expect(result.shouldQuarantine).toBe(true);
  });
});
