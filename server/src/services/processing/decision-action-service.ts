import { get_database, is_database_connected } from '../../database/connection.js';

export interface TDError {
  stateKey: string;
  actionId: string;
  reward: number;
  qBefore: number;
  qAfter: number;
  delta: number;
  nextStateKey: string;
  maxQNext: number;
  timestamp: Date;
}

export interface DecisionResult {
  selected_action: string;
  confidence: number;
  exploration: number;
  evidence: number;
  threshold: number;
  reaction_time_ms: number;
  q_values: Record<string, number>;
  crossed: boolean;
  allProbabilities: Record<string, number>;
}

export interface ErrorReport {
  accuracy: number;
  avgTdError: number;
  surpriseRate: number;
  conflictCount: number;
  totalOutcomes: number;
  correctCount: number;
  surpriseCount: number;
  recentDeltas: number[];
}

export interface PolicyEntry {
  actionId: string;
  qValue: number;
  probability: number;
}

const ALPHA = 0.1;
const GAMMA = 0.9;
const TAU_BASE = 0.5;
const DRIFT_SIGMA = 0.1;
const DRIFT_BOUNDARY = 1.0;

export class DecisionActionService {
  private static instance: DecisionActionService;
  private qTable: Map<string, Map<string, number>> = new Map();
  private stateVisitCounts: Map<string, number> = new Map();
  private actionVisitCounts: Map<string, Map<string, number>> = new Map();
  private outcomeLog: Array<{
    stateKey: string;
    actionId: string;
    expected: number;
    actual: number;
    delta: number;
    timestamp: Date;
  }> = [];
  private conflictCount = 0;
  private correctCount = 0;
  private surpriseCount = 0;
  private actionLog: TDError[] = [];

  private constructor() {}

  static get_instance(): DecisionActionService {
    if (!DecisionActionService.instance) {
      DecisionActionService.instance = new DecisionActionService();
    }
    return DecisionActionService.instance;
  }

  computeTDError(stateKey: string, actionId: string, reward: number, nextStateKey: string): TDError {
    const qBefore = this.getQValue(stateKey, actionId);
    const maxQNext = this.getMaxQValue(nextStateKey);
    const delta = reward + GAMMA * maxQNext - qBefore;
    const qAfter = qBefore + ALPHA * delta;

    this.setQValue(stateKey, actionId, qAfter);

    this.stateVisitCounts.set(stateKey, (this.stateVisitCounts.get(stateKey) || 0) + 1);
    let actionMap = this.actionVisitCounts.get(stateKey);
    if (!actionMap) {
      actionMap = new Map();
      this.actionVisitCounts.set(stateKey, actionMap);
    }
    actionMap.set(actionId, (actionMap.get(actionId) || 0) + 1);

    const tdError: TDError = {
      stateKey,
      actionId,
      reward: parseFloat(reward.toFixed(4)),
      qBefore: parseFloat(qBefore.toFixed(4)),
      qAfter: parseFloat(qAfter.toFixed(4)),
      delta: parseFloat(delta.toFixed(4)),
      nextStateKey,
      maxQNext: parseFloat(maxQNext.toFixed(4)),
      timestamp: new Date(),
    };

    this.actionLog.push(tdError);
    if (this.actionLog.length > 1000) {
      this.actionLog.shift();
    }

    return tdError;
  }

  computeRewardFromValence(prevValence: number, currValence: number, expected: number, expectedFuture: number): number {
    return parseFloat(((currValence - prevValence) + GAMMA * expectedFuture - expected).toFixed(4));
  }

  getQValue(stateKey: string, actionId: string): number {
    const stateMap = this.qTable.get(stateKey);
    if (!stateMap) {
      return 0;
    }
    return stateMap.get(actionId) || 0;
  }

  getVisitCount(stateKey: string): number {
    return this.stateVisitCounts.get(stateKey) || 0;
  }

  getActionVisitCount(stateKey: string, actionId: string): number {
    const actionMap = this.actionVisitCounts.get(stateKey);
    if (!actionMap) return 0;
    return actionMap.get(actionId) || 0;
  }

  getMaxQValue(stateKey: string): number {
    const stateMap = this.qTable.get(stateKey);
    if (!stateMap || stateMap.size === 0) {
      return 0;
    }
    let maxVal = -Infinity;
    for (const val of stateMap.values()) {
      if (val > maxVal) maxVal = val;
    }
    return maxVal === -Infinity ? 0 : maxVal;
  }

  private setQValue(stateKey: string, actionId: string, value: number): void {
    let stateMap = this.qTable.get(stateKey);
    if (!stateMap) {
      stateMap = new Map();
      this.qTable.set(stateKey, stateMap);
    }
    stateMap.set(actionId, value);
  }

  selectAction(stateKey: string, availableActions: string[], tau?: number): DecisionResult {
    const temperature = tau ?? TAU_BASE;

    const qValues: number[] = availableActions.map(a => this.getQValue(stateKey, a));
    const maxQ = Math.max(...qValues);

    const expValues: number[] = qValues.map(q => Math.exp((q - maxQ) / temperature));
    const sumExp = expValues.reduce((a, b) => a + b, 0);

    const probabilities: number[] = expValues.map(e => e / sumExp);

    const rand = Math.random();
    let cumulative = 0;
    let selectedIndex = 0;
    for (let i = 0; i < probabilities.length; i++) {
      cumulative += probabilities[i];
      if (rand < cumulative) {
        selectedIndex = i;
        break;
      }
    }

    const selectedQ = qValues[selectedIndex];
    const absMu = Math.abs(selectedQ);
    const rt = 250 + (absMu > 0.0001 ? (DRIFT_BOUNDARY / absMu) * 100 : 1000);

    const driftEvidence = Math.max(-DRIFT_BOUNDARY, Math.min(DRIFT_BOUNDARY, selectedQ + DRIFT_SIGMA * (Math.random() * 2 - 1)));
    const crossed = Math.abs(driftEvidence) >= DRIFT_BOUNDARY;

    const allProbabilities: Record<string, number> = {};
    const qValuesMap: Record<string, number> = {};
    for (let i = 0; i < availableActions.length; i++) {
      allProbabilities[availableActions[i]] = parseFloat(probabilities[i].toFixed(4));
      qValuesMap[availableActions[i]] = parseFloat(qValues[i].toFixed(4));
    }

    const maxUnselectedProb = probabilities.filter((_, i) => i !== selectedIndex).reduce((a, b) => Math.max(a, b), 0);
    const exploration = 1 - (probabilities[selectedIndex] - maxUnselectedProb);

    return {
      selected_action: availableActions[selectedIndex],
      confidence: parseFloat(probabilities[selectedIndex].toFixed(4)),
      exploration: parseFloat(exploration.toFixed(4)),
      evidence: parseFloat(driftEvidence.toFixed(4)),
      threshold: DRIFT_BOUNDARY,
      reaction_time_ms: parseFloat(rt.toFixed(0)),
      q_values: qValuesMap,
      crossed,
      allProbabilities,
    };
  }

  recordOutcome(stateKey: string, actionId: string, expected: number, actual: number): void {
    const delta = Math.abs(actual - expected);
    const isConflict = delta > 0.3;
    const isCorrect = delta < 0.15;
    const isSurprise = delta > 0.5;

    if (isConflict) this.conflictCount++;
    if (isCorrect) this.correctCount++;

    this.outcomeLog.push({
      stateKey,
      actionId,
      expected,
      actual,
      delta: parseFloat(delta.toFixed(4)),
      timestamp: new Date(),
    });

    if (isSurprise) this.surpriseCount++;

    if (this.outcomeLog.length > 1000) {
      this.outcomeLog.shift();
    }
  }

  getErrorReport(): ErrorReport {
    const totalOutcomes = this.outcomeLog.length;
    const accuracy = totalOutcomes > 0 ? parseFloat((this.correctCount / totalOutcomes).toFixed(4)) : 0;

    const recentDeltas = this.actionLog.slice(-50).map(e => e.delta);
    const avgTdError = recentDeltas.length > 0
      ? parseFloat((recentDeltas.reduce((a, b) => a + Math.abs(b), 0) / recentDeltas.length).toFixed(4))
      : 0;

    const surpriseRate = totalOutcomes > 0
      ? parseFloat((this.surpriseCount / totalOutcomes).toFixed(4))
      : 0;

    return {
      accuracy,
      avgTdError,
      surpriseRate,
      conflictCount: this.conflictCount,
      totalOutcomes,
      correctCount: this.correctCount,
      surpriseCount: this.surpriseCount,
      recentDeltas,
    };
  }

  getPolicy(stateKey: string): PolicyEntry[] {
    const stateMap = this.qTable.get(stateKey);
    if (!stateMap || stateMap.size === 0) {
      return [];
    }

    const entries: PolicyEntry[] = [];
    const qList: number[] = [];
    for (const [actionId, qValue] of stateMap.entries()) {
      entries.push({ actionId, qValue, probability: 0 });
      qList.push(qValue);
    }

    const maxQ = Math.max(...qList);
    const expValues = qList.map(q => Math.exp((q - maxQ) / TAU_BASE));
    const sumExp = expValues.reduce((a, b) => a + b, 0);

    for (let i = 0; i < entries.length; i++) {
      entries[i].probability = parseFloat((expValues[i] / sumExp).toFixed(4));
      entries[i].qValue = parseFloat(entries[i].qValue.toFixed(4));
    }

    entries.sort((a, b) => b.qValue - a.qValue);
    return entries;
  }

  getDecisionHistory(stateKey?: string, limit?: number): TDError[] {
    let filtered = stateKey
      ? this.actionLog.filter(e => e.stateKey === stateKey)
      : this.actionLog;

    const maxLimit = limit || 50;
    return filtered.slice(-maxLimit);
  }

  async persistQTable(): Promise<void> {
    if (!is_database_connected()) return;

    const db = get_database();
    const now = new Date();

    for (const [stateKey, actionMap] of this.qTable.entries()) {
      for (const [actionId, qValue] of actionMap.entries()) {
        await db.collection('action_policies').updateOne(
          { state_key: stateKey, action_id: actionId },
          {
            $set: {
              q_value: parseFloat(qValue.toFixed(4)),
              updated_at: now,
            },
            $setOnInsert: {
              state_key: stateKey,
              action_id: actionId,
              created_at: now,
            },
          },
          { upsert: true }
        );
      }
    }
  }

  async logAction(tdError: TDError): Promise<void> {
    if (!is_database_connected()) return;

    const db = get_database();
    await db.collection('action_logs').insertOne({
      state_key: tdError.stateKey,
      action_id: tdError.actionId,
      reward: tdError.reward,
      q_before: tdError.qBefore,
      q_after: tdError.qAfter,
      delta: tdError.delta,
      next_state_key: tdError.nextStateKey,
      max_q_next: tdError.maxQNext,
      timestamp: tdError.timestamp,
    });
  }
}
