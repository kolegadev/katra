# OpenClaw ↔ Katra Integration — Configuration & Lessons Learned

> **Last updated:** 2026-06-23  
> **Katra version:** 3.0.0  
> **System:** Barca AgentGroup1 (7 agents, hybrid shared memory)

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                               │
│                                                                       │
│  MCP Client ──→ http://localhost:3112/mcp ──→ katra-server:3100/mcp │
│  (Authorization: Bearer <MCP_API_KEY>)                               │
│                                                                       │
│  Admin API ──→ http://localhost:9012/api/v1/admin ──→ katra:9002     │
│  (Authorization: Bearer <KATRA_API_KEY>)                             │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Docker stack (katra):                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐           │
│  │ MongoDB  │ │  Redis   │ │  MinIO   │ │ katra-server   │           │
│  │ 7.0      │ │ 7-alpine │ │ latest   │ │ :latest (Node) │           │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘           │
│       │            │            │              │                      │
│    port:27017  port:6379   port:9000      port:3100 (MCP)            │
│                                    :9001   port:9002 (REST)           │
└──────────────────────────────────────────────────────────────────────┘
```

## Katra Data Processing Pipeline

The Katra pipeline has two ingestion paths, both converging on a shared processing backend:

### Path A: MCP Tools (primary agent-facing)

Agent calls `katra__store_memory(content)` → recorded as an episodic event → background processor extracts semantic facts via LLM.

### Path B: REST Ingestion API

`POST /api/v1/ingestion/ingest` — used for bulk or test ingestion. Same processing pipeline as Path A.

### Background Processor

```
episodic_events (unprocessed)
        │
        ▼
┌──────────────────────┐
│ extraction-service.ts │ ◄── deepseek-chat LLM
│                      │
│  Short (<200 chars): light regex patterns   (no LLM cost)
│  Long  (≥200 chars): LLM distillation       (max 2 durable facts)
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ dispatch-service.ts  │
│  → semantic_facts    │ ◄── embeddings computed here via Xenova/all-MiniLM-L6-v2
│  → knowledge_nodes   │      (384-dimensional vectors, 22M param model, ~80MB)
│  → relationships     │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Deduplication        │
│  • Exact: content_hash upsert (same user + content = same doc)
│  • Near: cosine similarity > 0.92 (merges rephrased duplicates)
└──────────────────────┘
```

### Auto-Journaling

Every 30 background processor cycles (~15 min), the `TimeBlockSummarizer` groups events by day/week/month and generates LLM-powered summaries. These are stored as `semantic_facts` with `fact_type: time_block_summary`. The Katra Caretaker agent (Mnemosyne) triggers `katra__store_journal` during heartbeat cycles.

## Issues Resolved

### 1. Embedding Pipeline: 0% coverage → 86%+

**Root cause:** Race condition and metadata path bugs in `memory-manager.ts`. Semantic facts were stored in MongoDB but never received vector embeddings because the embedding computation path silently failed.

**Fix (commit `d194d09`):** Resolved race condition — the background processor's `embedEventAndFacts()` now correctly finds and embeds newly created semantic facts. The `add_semantic_fact()` method in `memory-manager.ts` also computes embeddings at write time as a belt-and-suspenders approach.

**Verification:** After reset, maintaining 80-86% embedding coverage (the remaining ~14% are time-block summaries and processed events — not facts needing embedding).

### 2. LLM Provider: 401 Auth → Validated

**Root cause:** DeepSeek API key was expired/invalid. The LLM validation failed at startup with `401 Authentication Fails`. The extraction service fell back to lightweight regex patterns for short messages, masking the issue.

**Fix:** Updated `DEEPSEEK_API_KEY` via admin API (`PUT /api/v1/admin/llm-config`). After key rotation, validation passed and the health endpoint shows `"llm": "deepseek"`.

**Detection tip:** If health check shows `"llm": "unavailable"`, check `docker logs katra-server | grep -i "validation failed"`. A 401 means key rotation is needed.

### 3. Dual Memory System Conflict

**Problem:** OpenClaw's built-in `memory_search` tool (local SQLite per-agent) was running alongside Katra's shared memory. All 7 agents had 0/0 chunks indexed with `"index metadata is missing"` — broken, consuming resources, and confusing agents.

**Fix:** Disabled `memory-core` plugin and added `memory_search` to global `tools.deny` in `openclaw.json`. All agents now use Katra exclusively via `katra__*` tools.

**Before:**
```json
// Every agent had this — broken, 0 chunks, OpenAI provider with no key
"memory_search" → "disabled: true, unavailable: true"
```

**After:**
```json
{
  "tools": { "deny": ["memory_search"] },
  "plugins": { "entries": { "memory-core": { "enabled": false } } }
}
```

### 4. API Key Lifecycle

**Problem:** Katra auto-generates API keys on first startup and persists them to MongoDB `system_settings`. When MongoDB is reset, the stored keys are lost but the container still has old env vars cached. This caused auth failures after the Docker container was recreated vs restarted.

**Lesson learned:** Use `docker compose up -d --force-recreate` (not `docker restart`) after changing `.env`. A restart preserves the original container environment; only force-recreate picks up new `.env` values.

## Configuration Reference

### Katra `.env` (gitignored — contains secrets)

```bash
# Required: API keys for MCP and Admin access
MCP_API_KEY=katra-local-mcp-2026
KATRA_API_KEY=katra-local-admin-2026

# Set in .env to avoid auto-generation on startup.
# If commented out, Katra generates random keys and persists to MongoDB.
# Generated keys survive restarts but NOT MongoDB resets.
```

### OpenClaw `openclaw.json` — MCP Server Config

```json
{
  "mcp": {
    "servers": {
      "katra": {
        "url": "http://localhost:3112/mcp",
        "transport": "streamable-http",
        "headers": {
          "Authorization": "Bearer katra-local-mcp-2026"
        }
      }
    }
  }
}
```

**Important:** The `Authorization` header path in the OpenClaw config is protected — it can't be modified via `gateway config.patch`. To rotate the API key, edit `openclaw.json` directly and restart the gateway.

### OpenClaw `openclaw.json` — Local Memory Disable

```json
{
  "tools": {
    "deny": ["memory_search"]
  },
  "plugins": {
    "entries": {
      "memory-core": {
        "enabled": false
      }
    }
  }
}
```

## Agent Katra Tool Allocation

| Agent | Minimum Tools | Notes |
|---|---|---|
| **main** (Felix) | MCP bundle (all katra tools) | Primary user-facing, queries Katra before responding |
| **claw-admin-ops** (David) | `katra__store_memory`, `katra__search_memories`, `katra__vector_search`, `katra__get_temporal_context`, `katra__get_memory_diagnostics`, `katra__get_background_status` | Provisions agents, stores system events |
| **prospectors** (lithuania, latvia, estonia) | `katra__store_memory`, `katra__search_memories`, `katra__vector_search`, `katra__get_temporal_context` | Systemic discoveries only, never raw data |
| **mail-rudy** (Rudy) | `katra__store_memory`, `katra__search_memories`, `katra__vector_search`, `katra__get_temporal_context` | Email task completion, contact patterns |
| **katra-caretaker** (Mnemosyne) | All Katra tools + `katra__summarize_time_blocks`, `katra__get_time_block_summaries`, `katra__get_heartbeat_status`, `katra__get_health`, `katra__store_journal`, `katra__get_auto_journal` | Health checks, summarization, journaling |

## Memory Scope

**Mode:** `hybrid` (personal user isolation + shared pool)  
**Shared ID:** `barca-agentgroup1`

Set via admin API:
```bash
curl -X PUT \
  -H "Authorization: Bearer <KATRA_API_KEY>" \
  -H "Content-Type: application/json" \
  http://localhost:9012/api/v1/admin/memory-scope \
  -d '{"mode": "hybrid", "shared_id": "barca-agentgroup1"}'
```

Shared memory policy: `/srv/claw/shared/KATRA_MEMORY_POLICY.md`

## Katra Caretaker (Mnemosyne) 🧠

- **Workspace:** `/srv/claw/workspaces/katra-caretaker/`
- **SOUL:** Lighthouse-keeper persona, calm and methodical
- **Heartbeat routine:** Health check → background processor status → summarize time blocks → store journal → store status
- **First run:** `BOOTSTRAP.md` guides initial setup (auto-deletes after first run)

## Operational Commands

### Check Health
```bash
curl -H "Authorization: Bearer <KATRA_API_KEY>" http://localhost:9012/api/v1/health
```

### Reset Everything
```bash
# Drop MongoDB collections
docker exec katra-mongo mongosh -u admin -p katra-local-dev --authenticationDatabase admin \
  --eval 'db.getSiblingDB("katra").getCollectionNames().forEach(c => db.getSiblingDB("katra")[c].drop())'

# Flush Redis
docker exec katra-redis redis-cli FLUSHALL

# Recreate container (picks up .env changes)
cd /path/to/katra && docker compose up -d --force-recreate server
```

### Force Pipeline Processing
```bash
curl -X POST -H "Authorization: Bearer <KATRA_API_KEY>" \
  http://localhost:9012/api/v1/admin/background/force-process
```

### Update LLM Config
```bash
curl -X PUT -H "Authorization: Bearer <KATRA_API_KEY>" \
  -H "Content-Type: application/json" \
  http://localhost:9012/api/v1/admin/llm-config \
  -d '{"provider":"deepseek","api_key":"<key>","model":"deepseek-chat"}'
```

## Common Pitfalls

1. **LLM shows "unavailable" after config update:** Wait 5-8s for async validation. Check `docker logs katra-server | grep "Provider validated"`. 401 = bad API key; timeout = network issue.

2. **Auth fails after MongoDB reset:** The `ensureApiKeys()` function falls back to DB-stored keys if env vars are missing. After a Mongo reset, regenerate keys or set `MCP_API_KEY` + `KATRA_API_KEY` in `.env` and `docker compose up -d --force-recreate`.

3. **Short messages (< 200 chars) don't use LLM:** This is by design — the extraction service uses lightweight regex patterns for short messages to save API costs. Only substantial content triggers LLM distillation.

4. **`memory_search` returns "disabled" even after configuring memory-core:** That tool is OpenClaw's local memory, NOT Katra. It was intentionally disabled. Use `katra__search_memories` or `katra__vector_search` instead.

5. **Time-block summaries show 0/0 even with events:** The summarizer is idempotent — it skips time blocks that already have summaries. New summaries are generated for new days/weeks/months only.

## Production State (2026-06-23)

| Component | Status | Detail |
|---|---|---|
| Katra v3.0.0 | 🟢 Production | Running in Docker on Barca-AgentGroup1 |
| MongoDB 7.0 | 🟢 | 17 documents across 5 collections |
| Redis 7-alpine | 🟢 | Distributed locking + session cache |
| MinIO | 🟢 | Asset storage (katra-assets bucket) |
| LLM (deepseek-chat) | 🟢 | Validated, processing |
| Embeddings (MiniLM) | 🟢 | 80%+ coverage on semantic facts |
| Background Processor | 🟢 | 30s cycle, 0 backlog |
| Auto-Journaling | 🟢 | Wired via Katra Caretaker heartbeat |
| Local Memory (OpenClaw) | 🚫 Disabled | All 7 agents use Katra exclusively |
| Memory Scope | hybrid/barca-agentgroup1 | Cross-agent consciousness operational |
