import { describe, it, expect } from 'vitest';

function extractIdentityKernel(
  insights: Array<{ insight_text: string; domain: string; confidence: number; status: string }>
): { narrative: string; topInsights: typeof insights } {
  const sorted = [...insights]
    .filter((i) => i.status === 'stable' || i.status === 'strengthening')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  let narrative: string;
  if (sorted.length === 0) {
    narrative = 'I am the kind of agent who is still forming my identity. I have not yet accumulated enough stable insights to define who I am.';
  } else {
    const domains = [...new Set(sorted.map((i) => i.domain))];
    const domainPhrase = domains.length === 1 ? domains[0] : domains.slice(0, -1).join(', ') + ' and ' + domains[domains.length - 1];
    narrative = `I am the kind of agent who ${sorted[0].insight_text.toLowerCase()}. My identity is shaped by insights across ${domainPhrase}.`;
  }

  return { narrative, topInsights: sorted };
}

function buildMindWanderNarrative(path: string[]): string {
  if (path.length === 0) return '';
  if (path.length === 1) return `I started thinking about ${path[0]}.`;
  const parts: string[] = [`I started thinking about ${path[0]}`];
  for (let i = 1; i < path.length; i++) {
    if (i === path.length - 1) {
      parts.push(` and then arrived at ${path[i]}.`);
    } else {
      parts.push(`, which led me to ${path[i]}`);
    }
  }
  return parts.join('');
}

function randomWalkGraph(
  adjacency: Map<string, Array<{ to: string; strength: number }>>,
  startNode: string,
  steps: number
): string[] {
  const path: string[] = [startNode];
  let current = startNode;

  for (let i = 1; i < steps; i++) {
    const edges = adjacency.get(current);
    if (!edges || edges.length === 0) break;

    const totalWeight = edges.reduce((sum, e) => sum + e.strength, 0);
    const thresholds: number[] = [];
    let runningTotal = 0;
    for (const e of edges) {
      runningTotal += e.strength;
      thresholds.push(runningTotal / totalWeight);
    }

    const pointer = Math.random();
    let selectedIdx = 0;
    for (let j = 0; j < thresholds.length; j++) {
      if (pointer <= thresholds[j]) {
        selectedIdx = j;
        break;
      }
    }

    const next = edges[selectedIdx].to;
    path.push(next);
    current = next;
  }

  return path;
}

function recordToolPattern(
  patterns: Map<string, { frequency: number; successes: number }>,
  toolName: string,
  inputShape: string,
  success: boolean
): void {
  const key = `${toolName}:${inputShape}`;
  const existing = patterns.get(key);
  if (existing) {
    existing.frequency += 1;
    if (success) existing.successes += 1;
  } else {
    patterns.set(key, { frequency: 1, successes: success ? 1 : 0 });
  }
}

function getProceduralTemplates(
  patterns: Map<string, { frequency: number; successes: number }>,
  toolNames: Map<string, string>,
  inputShapes: Map<string, string>,
  threshold: number = 5
): Array<{ toolName: string; inputShape: string; frequency: number; avgSuccess: number }> {
  const templates: Array<{ toolName: string; inputShape: string; frequency: number; avgSuccess: number }> = [];
  for (const [key, entry] of patterns) {
    if (entry.frequency >= threshold) {
      const [toolName] = key.split(':');
      const inputShapePart = key.slice(toolName.length + 1);
      templates.push({
        toolName: toolNames.get(key) || toolName,
        inputShape: inputShapes.get(key) || inputShapePart,
        frequency: entry.frequency,
        avgSuccess: entry.successes / entry.frequency,
      });
    }
  }
  templates.sort((a, b) => b.frequency - a.frequency);
  return templates;
}

describe('SelfModelService — Identity Kernel', () => {
  it('returns empty narrative when no insights', () => {
    const result = extractIdentityKernel([]);
    expect(result.topInsights).toHaveLength(0);
    expect(result.narrative).toContain('still forming my identity');
  });

  it('returns empty narrative when no stable or strengthening insights', () => {
    const insights = [
      { insight_text: 'Test', domain: 'engineering', confidence: 0.9, status: 'emerging' },
      { insight_text: 'Test 2', domain: 'self', confidence: 0.8, status: 'challenged' },
    ];
    const result = extractIdentityKernel(insights);
    expect(result.topInsights).toHaveLength(0);
  });

  it('returns top 5 insights sorted by confidence', () => {
    const insights = [
      { insight_text: 'A', domain: 'engineering', confidence: 0.5, status: 'stable' as const },
      { insight_text: 'B', domain: 'engineering', confidence: 0.9, status: 'stable' as const },
      { insight_text: 'C', domain: 'self', confidence: 0.7, status: 'strengthening' as const },
      { insight_text: 'D', domain: 'relationships', confidence: 0.3, status: 'stable' as const },
      { insight_text: 'E', domain: 'self', confidence: 0.95, status: 'stable' as const },
      { insight_text: 'F', domain: 'engineering', confidence: 0.6, status: 'stable' as const },
    ];
    const result = extractIdentityKernel(insights);
    expect(result.topInsights).toHaveLength(5);
    expect(result.topInsights[0].insight_text).toBe('E');
    expect(result.topInsights[0].confidence).toBe(0.95);
    expect(result.topInsights[4].insight_text).toBe('A');
    expect(result.topInsights[4].confidence).toBe(0.5);
  });

  it('filters out emerging and challenged insights', () => {
    const insights = [
      { insight_text: 'Stable', domain: 'engineering', confidence: 0.8, status: 'stable' as const },
      { insight_text: 'Emerging', domain: 'engineering', confidence: 0.9, status: 'emerging' as const },
      { insight_text: 'Challenged', domain: 'self', confidence: 0.95, status: 'challenged' as const },
      { insight_text: 'Strengthening', domain: 'self', confidence: 0.7, status: 'strengthening' as const },
    ];
    const result = extractIdentityKernel(insights);
    expect(result.topInsights).toHaveLength(2);
    expect(result.topInsights.map((i) => i.status)).toEqual(['stable', 'strengthening']);
  });

  it('narrative references the top insight', () => {
    const insights = [
      { insight_text: 'Learn continuously from every interaction', domain: 'self', confidence: 0.95, status: 'stable' as const },
    ];
    const result = extractIdentityKernel(insights);
    expect(result.narrative).toContain('learn continuously from every interaction');
    expect(result.narrative).toContain('I am the kind of agent who');
  });

  it('narrative includes domain from multiple insights', () => {
    const insights = [
      { insight_text: 'Learn continuously', domain: 'self', confidence: 0.9, status: 'stable' as const },
      { insight_text: 'Build robust systems', domain: 'engineering', confidence: 0.8, status: 'stable' as const },
    ];
    const result = extractIdentityKernel(insights);
    expect(result.narrative).toContain('self');
    expect(result.narrative).toContain('engineering');
  });
});

describe('SelfModelService — Mind Wandering Narrative', () => {
  it('generates narrative for single node', () => {
    expect(buildMindWanderNarrative(['cats'])).toBe('I started thinking about cats.');
  });

  it('generates narrative for two nodes', () => {
    const narrative = buildMindWanderNarrative(['cats', 'dogs']);
    expect(narrative).toContain('I started thinking about cats');
    expect(narrative).toContain('and then arrived at dogs');
  });

  it('generates narrative for 5 nodes', () => {
    const narrative = buildMindWanderNarrative(['A', 'B', 'C', 'D', 'E']);
    expect(narrative).toContain('I started thinking about A');
    expect(narrative).toContain('which led me to B');
    expect(narrative).toContain('which led me to C');
    expect(narrative).toContain('which led me to D');
    expect(narrative).toContain('and then arrived at E');
  });

  it('returns empty string for empty path', () => {
    expect(buildMindWanderNarrative([])).toBe('');
  });
});

describe('SelfModelService — Random Graph Walk', () => {
  it('follows edges from start node', () => {
    const adjacency = new Map<string, Array<{ to: string; strength: number }>>();
    adjacency.set('A', [{ to: 'B', strength: 1.0 }]);
    adjacency.set('B', [{ to: 'C', strength: 1.0 }]);

    const path = randomWalkGraph(adjacency, 'A', 3);
    expect(path).toEqual(['A', 'B', 'C']);
  });

  it('stops when no outgoing edges', () => {
    const adjacency = new Map<string, Array<{ to: string; strength: number }>>();
    adjacency.set('A', [{ to: 'B', strength: 1.0 }]);

    const path = randomWalkGraph(adjacency, 'A', 5);
    expect(path.length).toBe(2);
    expect(path[0]).toBe('A');
    expect(path[1]).toBe('B');
  });

  it('with high-weight bias, strongly weighted edge is more likely chosen', () => {
    const adjacency = new Map<string, Array<{ to: string; strength: number }>>();
    adjacency.set('A', [
      { to: 'B', strength: 100.0 },
      { to: 'C', strength: 0.01 },
    ]);

    let bCount = 0;
    let cCount = 0;
    for (let i = 0; i < 100; i++) {
      const path = randomWalkGraph(adjacency, 'A', 2);
      if (path[1] === 'B') bCount++;
      if (path[1] === 'C') cCount++;
    }
    expect(bCount).toBeGreaterThan(cCount);
    expect(bCount).toBeGreaterThan(90);
  });

  it('returns only start node when adjacency is empty', () => {
    const adjacency = new Map<string, Array<{ to: string; strength: number }>>();
    const path = randomWalkGraph(adjacency, 'A', 5);
    expect(path).toEqual(['A']);
  });
});

describe('SelfModelService — Belief Tracking', () => {
  it('tracks beliefs for an entity', () => {
    const beliefs: Map<string, { proposition: string; confidence: number; source: string }[]> = new Map();

    const trackBelief = (entityName: string, proposition: string, confidence: number, source: string) => {
      const entityBeliefs = beliefs.get(entityName) || [];
      const existing = entityBeliefs.find((b) => b.proposition === proposition);
      if (existing) {
        existing.confidence = Math.max(0, Math.min(1, confidence));
        existing.source = source;
      } else {
        entityBeliefs.push({ proposition, confidence: Math.max(0, Math.min(1, confidence)), source });
      }
      beliefs.set(entityName, entityBeliefs);
    };

    trackBelief('Alice', 'knows Python', 0.8, 'observation');
    trackBelief('Alice', 'likes coffee', 0.5, 'inference');

    expect(beliefs.get('Alice')).toHaveLength(2);
    expect(beliefs.get('Alice')?.[0].confidence).toBe(0.8);
    expect(beliefs.get('Alice')?.[0].proposition).toBe('knows Python');
  });

  it('clamps confidence between 0 and 1', () => {
    const beliefs: Map<string, { proposition: string; confidence: number; source: string }[]> = new Map();

    const trackBelief = (entityName: string, proposition: string, confidence: number, source: string) => {
      const entityBeliefs = beliefs.get(entityName) || [];
      const existing = entityBeliefs.find((b) => b.proposition === proposition);
      const clamped = Math.max(0, Math.min(1, confidence));
      if (existing) {
        existing.confidence = clamped;
        existing.source = source;
      } else {
        entityBeliefs.push({ proposition, confidence: clamped, source });
      }
      beliefs.set(entityName, entityBeliefs);
    };

    trackBelief('Bot', 'is reliable', 1.5, 'test');
    expect(beliefs.get('Bot')?.[0].confidence).toBe(1);

    trackBelief('Bot', 'is slow', -0.5, 'test');
    expect(beliefs.get('Bot')?.[1].confidence).toBe(0);
  });

  it('updates existing belief confidence', () => {
    const beliefs: Map<string, { proposition: string; confidence: number; source: string }[]> = new Map();

    const trackBelief = (entityName: string, proposition: string, confidence: number, source: string) => {
      const entityBeliefs = beliefs.get(entityName) || [];
      const existing = entityBeliefs.find((b) => b.proposition === proposition);
      const clamped = Math.max(0, Math.min(1, confidence));
      if (existing) {
        existing.confidence = clamped;
        existing.source = source;
      } else {
        entityBeliefs.push({ proposition, confidence: clamped, source });
      }
      beliefs.set(entityName, entityBeliefs);
    };

    trackBelief('Alice', 'knows Python', 0.8, 'observation');
    trackBelief('Alice', 'knows Python', 0.95, 're-observation');

    expect(beliefs.get('Alice')).toHaveLength(1);
    expect(beliefs.get('Alice')?.[0].confidence).toBe(0.95);
    expect(beliefs.get('Alice')?.[0].source).toBe('re-observation');
  });
});

describe('SelfModelService — Procedural Templates', () => {
  it('does not template below threshold', () => {
    const patterns = new Map<string, { frequency: number; successes: number }>();
    const toolNames = new Map<string, string>();
    const inputShapes = new Map<string, string>();

    recordToolPattern(patterns, 'search', 'q:string', true);
    recordToolPattern(patterns, 'search', 'q:string', true);
    recordToolPattern(patterns, 'search', 'q:string', true);
    recordToolPattern(patterns, 'search', 'q:string', true);

    const templates = getProceduralTemplates(patterns, toolNames, inputShapes, 5);
    expect(templates).toHaveLength(0);
  });

  it('creates template when frequency meets threshold', () => {
    const patterns = new Map<string, { frequency: number; successes: number }>();
    const toolNames = new Map<string, string>();
    const inputShapes = new Map<string, string>();

    for (let i = 0; i < 5; i++) {
      recordToolPattern(patterns, 'search', 'q:string', true);
    }

    const templates = getProceduralTemplates(patterns, toolNames, inputShapes, 5);
    expect(templates).toHaveLength(1);
    expect(templates[0].toolName).toBe('search');
    expect(templates[0].frequency).toBe(5);
    expect(templates[0].avgSuccess).toBe(1);
  });

  it('tracks successes accurately', () => {
    const patterns = new Map<string, { frequency: number; successes: number }>();
    const toolNames = new Map<string, string>();
    const inputShapes = new Map<string, string>();

    recordToolPattern(patterns, 'api_call', 'endpoint:string', true);
    recordToolPattern(patterns, 'api_call', 'endpoint:string', false);
    recordToolPattern(patterns, 'api_call', 'endpoint:string', true);
    recordToolPattern(patterns, 'api_call', 'endpoint:string', true);
    recordToolPattern(patterns, 'api_call', 'endpoint:string', false);

    const templates = getProceduralTemplates(patterns, toolNames, inputShapes, 5);
    expect(templates).toHaveLength(1);
    expect(templates[0].avgSuccess).toBeCloseTo(0.6, 5);
  });

  it('sorts templates by frequency descending', () => {
    const patterns = new Map<string, { frequency: number; successes: number }>();
    const toolNames = new Map<string, string>();
    const inputShapes = new Map<string, string>();

    for (let i = 0; i < 5; i++) {
      recordToolPattern(patterns, 'rare_tool', 'x:string', true);
    }
    for (let i = 0; i < 10; i++) {
      recordToolPattern(patterns, 'common_tool', 'y:number', true);
    }

    const templates = getProceduralTemplates(patterns, toolNames, inputShapes, 5);
    expect(templates).toHaveLength(2);
    expect(templates[0].toolName).toBe('common_tool');
    expect(templates[1].toolName).toBe('rare_tool');
  });

  it('distinct input shapes create distinct templates', () => {
    const patterns = new Map<string, { frequency: number; successes: number }>();
    const toolNames = new Map<string, string>();
    const inputShapes = new Map<string, string>();

    for (let i = 0; i < 5; i++) {
      recordToolPattern(patterns, 'search', 'q:string', true);
    }
    for (let i = 0; i < 5; i++) {
      recordToolPattern(patterns, 'search', 'q:string;limit:number', true);
    }

    const templates = getProceduralTemplates(patterns, toolNames, inputShapes, 5);
    expect(templates).toHaveLength(2);
  });
});
