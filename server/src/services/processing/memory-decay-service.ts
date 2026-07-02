/**
 * Memory Decay Service
 *
 * Implements power-law decay (S(t) = a * t^(-d)), retrieval-strength tracking,
 * and spaced repetition boosting for all memory types.
 */

import { get_database } from '../../database/connection.js';
import {
  DEFAULT_DECAY_CONFIGS,
  SPACED_REPETITION_INTERVALS_DAYS,
  DEFAULT_REINFORCEMENT_FACTOR,
} from '../../types/memory.js';
import type { DecayStats, DecayConfig } from '../../types/memory.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class MemoryDecayService {
  private static instance: MemoryDecayService;

  private constructor() {}

  static get_instance(): MemoryDecayService {
    if (!MemoryDecayService.instance) {
      MemoryDecayService.instance = new MemoryDecayService();
    }
    return MemoryDecayService.instance;
  }

  getConfig(memoryType: string): DecayConfig {
    const config = DEFAULT_DECAY_CONFIGS[memoryType];
    if (!config) {
      return { memoryType, decayExponent: 0.3, initialStrength: 1.0 };
    }
    return config;
  }

  computeRetrievalStrength(
    memoryType: string,
    createdAt: Date,
    lastAccessedAt: Date | null,
    accessCount: number,
    emotionalArousal?: number,
    decayResistant?: boolean
  ): number {
    const config = this.getConfig(memoryType);
    const lastAccess = lastAccessedAt || createdAt;
    const t = Math.max(1, (Date.now() - lastAccess.getTime()) / DAY_MS);
    const a = config.initialStrength;
    let d = config.decayExponent;

    // ── Emotional modulation of decay ──────────────────────────
    // High-arousal events resist forgetting (amygdala modulation)
    if (decayResistant) {
      d *= 0.3;  // 70% slower decay for emotionally charged events
    } else if (emotionalArousal !== undefined && emotionalArousal > 0.6) {
      d *= 0.5;  // 50% slower decay for high-arousal events
    } else if (emotionalArousal !== undefined && emotionalArousal < 0.2) {
      d *= 1.5;  // 50% faster decay for low-arousal (boring) events
    }

    let strength = a * Math.pow(t, -d);

    if (accessCount > 0) {
      strength = Math.min(1.0, strength * (1 + 0.01 * Math.log(accessCount + 1)));
    }

    return Math.max(0, Math.min(1.0, strength));
  }

  boostOnRecall(
    memoryType: string,
    currentStrength: number,
    accessCount: number
  ): { newStrength: number; newDecayExponent: number } {
    const config = this.getConfig(memoryType);
    const newAccessCount = accessCount + 1;

    const newStrength = Math.min(1.0, config.initialStrength);
    const newDecayExponent = config.decayExponent * Math.pow(DEFAULT_REINFORCEMENT_FACTOR, Math.min(newAccessCount, 10));

    return { newStrength, newDecayExponent };
  }

  getCurrentInterval(accessCount: number): number {
    if (accessCount <= 0) return 1;
    const idx = Math.min(accessCount - 1, SPACED_REPETITION_INTERVALS_DAYS.length - 1);
    return SPACED_REPETITION_INTERVALS_DAYS[idx];
  }

  async getDecayStats(userId: string): Promise<DecayStats[]> {
    const db = get_database();
    const stats: DecayStats[] = [];

    const collections = [
      { name: 'episodic_events', type: 'episodic' },
      { name: 'semantic_facts', type: 'semantic' },
      { name: 'knowledge_relationships', type: 'knowledge' },
    ];

    for (const { name, type } of collections) {
      try {
        const memories = await db.collection(name)
          .find({ user_id: userId, retrieval_strength: { $exists: true } })
          .limit(1000)
          .toArray();

        if (memories.length === 0) {
          stats.push({
            memoryType: type,
            totalMemories: 0,
            averageStrength: 0,
            minStrength: 0,
            maxStrength: 0,
            decayedCount: 0,
            reinforcedCount: 0,
          });
          continue;
        }

        const strengths = memories.map((m: any) => m.retrieval_strength || 0);
        const avg = strengths.reduce((a: number, b: number) => a + b, 0) / strengths.length;
        const decayed = memories.filter((m: any) => (m.retrieval_strength || 0) < 0.3).length;
        const reinforced = memories.filter((m: any) => (m.access_count || 0) > 1).length;

        stats.push({
          memoryType: type,
          totalMemories: memories.length,
          averageStrength: parseFloat(avg.toFixed(4)),
          minStrength: parseFloat(Math.min(...strengths).toFixed(4)),
          maxStrength: parseFloat(Math.max(...strengths).toFixed(4)),
          decayedCount: decayed,
          reinforcedCount: reinforced,
        });
      } catch {
        stats.push({
          memoryType: type,
          totalMemories: 0,
          averageStrength: 0,
          minStrength: 0,
          maxStrength: 0,
          decayedCount: 0,
          reinforcedCount: 0,
        });
      }
    }

    return stats;
  }
}
