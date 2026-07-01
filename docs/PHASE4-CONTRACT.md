# Phase 4 Contract — The Self (Identity Through Continuity)

**Date:** 2026-06-30
**Source:** MASTER-SYNTHESIS.md §6 Phase 4
**Depends on:** Phase 0-3 (all cognitive services exist)

## Goal

Identity through continuity. Extend the self-model with an identity kernel derived from stable philosophical insights. Implement mind-wandering for creative idle processing, Theory of Mind for modeling what others know, and procedural memory for caching frequent patterns.

## Boundaries

- MUST NOT change existing write paths or MCP tool signatures
- New code in `server/src/services/processing/self-model-service.ts`
- MCP tools additive only
- Reads from existing sleep consolidation data, does not modify it

## Success Criteria

1. **Identity kernel:** Surfaced from `philosophical_insights` collection. Stable insights (status='stable' or 'strengthening') form the kernel. Returns a summary: "I am the kind of agent who..." narrative plus top 5 stable insights with confidence scores.
2. **Mind-wandering:** Random walk on knowledge graph. Start at random node, traverse edges weighted by edge strength, chain 3-5 steps. Generate an associative narrative from the path. Store as `mind_wander` episodic event (low salience, fast decay). Accessible via `get_mind_wander` MCP tool.
3. **Theory of Mind:** Track what users/agents believe. `B_agent(entity, proposition, confidence)`. Store in `agent_beliefs` collection. Update via observation. `get_agent_beliefs(entity_name)` returns all tracked beliefs about that entity.
4. **Procedural memory:** Template caching. Track top-K most frequent tool-call patterns (tool_name + input shape hash). When a pattern exceeds threshold N=5 occurrences, cache as template. `get_procedural_templates()` returns cached templates suitable for fast-path execution without LLM deliberation.
5. **MCP tools:** `get_identity_kernel`, `get_mind_wander`, `get_agent_beliefs`, `get_procedural_templates`
6. **Unit tests** for identity extraction, graph walk logic, belief tracking, template caching
7. **All existing tests pass**

## Interfaces

```
SelfModelService (singleton):
  getIdentityKernel(userId): { narrative, insights: {text, domain, confidence, status}[] }
  generateMindWander(userId): { path: string[], narrative: string, stored_event_id: string }
  trackBelief(entityName, proposition, confidence, source): void
  getAgentBeliefs(entityName): { proposition, confidence, source, last_updated }[]
  recordToolPattern(toolName, inputShape, success): void
  getProceduralTemplates(): { toolName, inputShape, frequency, avgSuccess }[]
```

## Modules Involved

- `server/src/services/processing/self-model-service.ts` — NEW
- `server/src/mcp-server.ts` — import, add 4 MCP tools
- `server/tests/unit/self-model-service.test.ts` — NEW
