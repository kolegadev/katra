# Phase 0 Contract — Foundation: Memory Decay + Anomaly Detection

**Date:** 2026-06-30
**Source:** MASTER-SYNTHESIS.md §6 — Implementation Roadmap
**Status:** In Progress

## Goal

Stabilize the memory foundation before expanding cognition. Implement soft memory decay (power-law), retrieval-strength tracking, spaced repetition boosting, and Layer 1 z-score anomaly detection at ingestion. No behavioral change to existing flows — these are passive enhancements.

## Boundaries

- MUST NOT change existing memory write paths (events are still stored append-only)
- MUST NOT delete or hard-delete any memory (soft decay only)
- MUST NOT alter existing MCP tool signatures (additive only)
- MUST NOT touch sleep consolidation or reflection pipelines
- New services must be TypeScript files in `server/src/services/processing/`

## Success Criteria

1. **Power-law decay:** `S(t) = a * t^(-d)` computed for all memory types. Configurable decay exponents per type (episodic: d=0.5, semantic: d=0.15, emotional: d=0.3, knowledge: d=0.1, insights: d=0.05).
2. **Retrieval-strength field:** Added to EpisodicEvent, SemanticFact, KnowledgeRelationship, and PhilosophicalInsight. Computed as `strength = initial_strength * t^(-d)` where `t` is time since last access.
3. **Spaced repetition:** On successful retrieval, reset strength to initial and slightly reduce decay exponent. Intervals: 1d → 3d → 7d → 21d → 90d.
4. **Anomaly detection:** z-score = (distance - μ_historical) / σ_historical. z < 2: NORMAL, 2 ≤ z < 3: SUSPECT (confidence ×0.5), z ≥ 3: ANOMALOUS (quarantined).
5. **MCP tools exposed:** `get_memory_decay_stats`, `get_anomaly_report`, `get_quarantined_memories`
6. **All existing tests pass** — no regressions.
7. **New unit tests** for decay service and anomaly detection service.

## Interfaces

### MemoryDecayService
```
computeRetrievalStrength(memoryType, createdAt, lastAccessedAt, accessCount): number
boostOnRecall(memoryType, currentStrength, accessCount): { newStrength, newDecayExponent }
getDecayStats(userId): DecayStats
```

### AnomalyDetectionService
```
classifyAtIngestion(embedding, memoryType, userId): { zScore, classification, adjustedConfidence }
getQuarantinedMemories(userId): QuarantinedMemory[]
getAnomalyReport(userId): AnomalyReport
shouldAutoRehabilitate(memoryId, userId): boolean
```

## Modules Involved

- `server/src/types/memory.ts` — type extensions
- `server/src/services/processing/memory-decay-service.ts` — NEW
- `server/src/services/processing/anomaly-detection-service.ts` — NEW
- `server/src/services/memory/episodic-event-manager.ts` — wire anomaly detection
- `server/src/services/memory/memory-manager.ts` — add retrieval-strength
- `server/src/mcp-server.ts` — register new MCP tools
