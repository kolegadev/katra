# Katra — Cognitive Memory for AI Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Give your AI agent **persistent memory**. Katra is a self-contained memory appliance —
drop it on any machine with Docker, point your agent at it via MCP, and get
episodic recall, semantic search, knowledge graphs, and temporal analysis.

Any MCP-compatible agent works: OpenClaw, Claude Code, OpenCode, Codex CLI, or
anything that speaks the Model Context Protocol.

## Quick Start

```bash
git clone https://github.com/kolegadev/katra.git
cd katra
cp .env.example .env
# Edit .env — set your API keys
docker-compose up -d --build
```

That's it. Katra is running:

| Service | URL | Purpose |
|---------|-----|---------|
| **MCP endpoint** | `http://localhost:3112/mcp` | Point your agent here |
| **Admin API** | `http://localhost:9012/api/v1/` | REST API, dashboard |
| **Dashboard** | `http://localhost:9012/dashboard/` | Web UI for stats + settings |
| **Health** | `http://localhost:3112/health` | Service health check |

Verify:
```bash
curl http://localhost:3112/health
# {"status":"ok","services":{"mongodb":"connected","redis":"connected"}}
```

## Connect Your Agent

Add Katra to your agent's MCP config:

```json
{
  "mcp": {
    "servers": {
      "katra": {
        "url": "http://localhost:3112/mcp",
        "transport": "sse",
        "headers": {
          "Authorization": "Bearer YOUR_MCP_API_KEY",
          "Accept": "application/json, text/event-stream"
        }
      }
    }
  }
}
```

Your agent now has **27 MCP tools** — store memories, search by keyword or semantic
similarity, recall by time range, explore a knowledge graph, detect patterns, and more.

### Platform-Specific Guides

| Platform | Config File | Notes |
|----------|-------------|-------|
| **OpenClaw** | `~/.openclaw/openclaw.json` | Native MCP support |
| **Claude Code** | `~/.claude/mcp.json` | Use `"type": "http"` |
| **OpenCode** | OpenCode config | Use `"type": "remote"` |
| **Codex CLI** | `~/.codex/config.yaml` | Via webhook hooks |
| **Any MCP client** | — | Standard MCP over SSE |

> **Docker SSE tip:** If your agent runs inside Docker, use the Katra container's
> direct IP instead of `localhost`:
> ```bash
> docker inspect katra-server --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
> ```

## Identity Modes

Katra supports three memory sharing modes between agents:

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Personal** (default) | Each agent's memories are isolated by `user_id` | Single agent, private memory |
| **Shared** | All agents with the same `shared_id` see everything | Multiple agents, communal consciousness |
| **Hybrid** | Personal + shared + visible other agents | Team of agents with private + shared memory |

**Configure via dashboard:** Open `http://localhost:9012/dashboard/` → Settings → Memory Scope

**Configure via MCP:**
```bash
# Switch to shared mode
curl -X POST http://localhost:3112/mcp \
  -H "Authorization: Bearer YOUR_MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"set_memory_scope","arguments":{"mode":"shared","shared_id":"my-team"}}}'
```

**Configure via admin API:**
```bash
curl -X PUT http://localhost:9012/api/v1/admin/memory-scope \
  -H "Authorization: Bearer YOUR_KATRA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"hybrid","shared_id":"my-team","hybrid_visible_user_ids":["agent-a","agent-b"]}'
```

## Auto-Collection (Solomem)

Katra captures memories in real-time when your agent calls `store_memory` via MCP.
For **passive background collection** from conversation logs, deploy the
[Solomem](https://github.com/kolegadev/solomem) watcher:

```bash
# Install the watcher
mkdir -p ~/.solomem
git clone https://github.com/kolegadev/solomem.git /tmp/solomem
cp /tmp/solomem/memory_watcher.py ~/.solomem/
cp /tmp/solomem/opencode_extractor.py ~/.solomem/

# Create config
cat > ~/.solomem/watcher-config.json << 'EOF'
{
  "mcp_url": "http://localhost:3112/mcp",
  "api_key": "YOUR_MCP_API_KEY",
  "user_id": "my-agent",
  "platforms": [
    {
      "name": "openclaw",
      "session_dir": "~/.openclaw/agents",
      "glob": "**/sessions/*.jsonl",
      "exclude": ["trajectory"]
    }
  ]
}
EOF

# Backfill existing history
python3 ~/.solomem/memory_watcher.py --once --config ~/.solomem/watcher-config.json

# Install as systemd service for continuous collection
cp /tmp/solomem/memory-watcher.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now memory-watcher
```

Supports OpenClaw, Claude Code, OpenCode, Codex CLI, Hermes, KiloClaw, KimiClaw.
Each platform can have its own `user_id` for identity mode isolation.

## Features

- **Episodic Memory** — Every conversation message stored with dedup and cascade detection
- **Semantic Memory** — Distilled facts with confidence scores and vector embeddings
- **Knowledge Graph** — Auto-extracted entities and relationships
- **Working Memory** — Redis-backed short-term session state (<5ms access)
- **Temporal Recall** — Query by time range, detect recurring patterns
- **Vector Search** — Semantic similarity search (local embeddings, no API key needed)
- **11-Collection Search** — Comprehensive search across all memory stores, not just 1-2
- **Background Processing** — Auto-extracts facts, builds graph, generates summaries
- **27 MCP Tools** — Store, search, recall, explore — all via standardized protocol
- **Identity Modes** — Personal, shared, or hybrid memory across multiple agents
- **Dashboard** — Web UI for stats, memory scope, and system health
- **Portable Data** — Single `DATA_DIR` env var controls where all data lives
- **Local-First** — Runs on a Raspberry Pi with zero external API costs

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Katra Docker Appliance                 │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ MongoDB  │  │  Redis   │  │  MinIO   │  │  Katra  │ │
│  │ (memory) │  │ (cache)  │  │ (assets) │  │ (server)│ │
│  └──────────┘  └──────────┘  └──────────┘  └────┬────┘ │
│                                                 │       │
│  Internal Docker network (katra-net)    MCP :3112     │
│                                  Admin API :9012       │
└─────────────────────────────────────────────────────────┘
                    │                    │
         ┌──────────┘                    └──────────┐
         ▼                                          ▼
   Your Agent (MCP)                          Dashboard (web)
   OpenClaw / Claude /                       http://localhost:9012/dashboard/
   OpenCode / Codex / etc.
```

**Resource usage:** ~384MB RAM total (MongoDB 254MB, Katra 52MB, MinIO 73MB, Redis 5MB).
Runs comfortably on a Raspberry Pi 5 with 16GB RAM.

## Data Portability

All persistent data lives under one directory, controlled by `DATA_DIR` in `.env`:

```bash
# Default: ./data/ (relative to docker-compose.yml)
DATA_DIR=./data

# USB stick (LUKS-encrypted, mounted at /mnt/usb-secrets)
DATA_DIR=/mnt/usb-secrets/katra

# External drive
DATA_DIR=/media/external/katra
```

To move Katra to a new machine: copy the `DATA_DIR` directory, copy `.env`, run `docker-compose up -d`.

## What's Inside

```
katra/
├── server/                  TypeScript server (esbuild, Docker)
│   ├── src/
│   │   ├── mcp-server.ts    27 MCP tools (store, search, recall, graph, scope)
│   │   ├── services/        26 core memory services
│   │   ├── routes/          REST API + admin + ingestion + health
│   │   └── database/        MongoDB, Redis, indexes, migrations
│   └── esbuild.config.mjs   Pi-compatible build
├── dashboard/               Web dashboard (vanilla HTML/CSS/JS)
├── docker-compose.yml       MongoDB + Redis + MinIO + Katra
├── Dockerfile               Multi-stage (builds TS inside image)
├── .env.example             All config options documented
├── SKILL.md                 Multi-platform deployment guide
└── docs/                    Full documentation
```

## MCP Tools (27)

### Storage
| Tool | Description |
|------|-------------|
| `store_memory` | Store a fact, preference, insight, or event |
| `store_journal` | Save a reflective journal entry |
| `working_memory` | Read/store/delete short-term session memory |
| `create_mission` | Create a goal with task breakdown |
| `update_mission_task` | Update task status (pending/in_progress/completed/blocked) |

### Recall
| Tool | Description |
|------|-------------|
| `search_memories` | Full-text + vector search across 11 collections |
| `vector_search` | Semantic similarity search |
| `temporal_recall` | Query events by time range |
| `temporal_search` | Search events by keyword with time context |
| `get_conversation_history` | Retrieve a specific session's messages |
| `get_temporal_context` | Current context: recent events + working memory + facts |
| `get_journal` | Read manual + auto journal entries |
| `get_auto_journal` | AI-distilled insights from conversations |
| `list_missions` | List active goals and progress |
| `get_mission` | Get full mission details with task tree |

### Analysis
| Tool | Description |
|------|-------------|
| `detect_patterns` | Recurring topics, session rhythm, dormant subjects |
| `get_time_block_summaries` | AI summaries by day/week/month |
| `summarize_time_blocks` | Generate new time-block summaries |
| `explore_graph` | Explore knowledge graph entities and relationships |

### Memory Scope
| Tool | Description |
|------|-------------|
| `get_memory_scope` | Get current mode (personal/shared/hybrid) |
| `set_memory_scope` | Set mode, shared_id, visible users |

### System
| Tool | Description |
|------|-------------|
| `get_memory_diagnostics` | Document counts, embedding coverage, index health |
| `get_background_status` | Background processor queue and timing |
| `get_health` | MongoDB, Redis, LLM, embedding status |
| `get_heartbeat_status` | Heartbeat scheduler state |
| `get_transaction_log` | Audit trail of agent actions |
| `list_assets` | Files stored in MinIO |

## Configuration

All configuration is via `.env` (see `.env.example` for full docs):

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | Where all persistent data lives |
| `HOST_MCP_PORT` | `3112` | Host port for MCP endpoint |
| `HOST_API_PORT` | `9012` | Host port for admin API + dashboard |
| `MCP_API_KEY` | *(set in .env)* | Key your agent sends for MCP auth |
| `KATRA_API_KEY` | *(set in .env)* | Key for admin REST API |
| `LLM_PROVIDER` | `local` | `local`, `openai`, `anthropic`, or `ollama` |
| `EMBEDDING_PROVIDER` | `local` | `local` or `openai` |
| `MULTI_TENANT` | `false` | Enable SaaS multi-tenant mode |

## Deployment

### Local Docker (default)

```bash
docker-compose up -d --build
```

### USB Storage

```bash
# In .env:
DATA_DIR=/mnt/usb-secrets/katra

docker-compose up -d
```

### Cloud (Terraform)

AWS Terraform module included in `terraform/aws/` — provisions VPC, ECS Fargate,
DocumentDB, ElastiCache Redis, S3, and ALB. See [Deployment Guide](docs/DEPLOYMENT.md).

### Kubernetes (Helm)

Helm chart included in `helm/katra/` — supports Bitnami MongoDB + Redis subcharts,
ingress with path routing, HPA, and PDB. See [Deployment Guide](docs/DEPLOYMENT.md).

## How It Compares

| Feature | Katra | Mem0 | Zep | Pinecone |
|---------|-------|------|-----|----------|
| MCP-native | ✅ | ❌ | ❌ | ❌ |
| Multi-layered memory | ✅ 5 layers | ❌ flat | Partial | ❌ vector only |
| Local-first (zero cost) | ✅ Pi-compatible | ❌ | ❌ | ❌ |
| Background processing | ✅ auto-extract | ❌ | Partial | ❌ |
| Multi-platform watcher | ✅ 7+ platforms | ❌ | ❌ | ❌ |
| Identity modes | ✅ personal/shared/hybrid | ❌ | ❌ | ❌ |
| Dashboard | ✅ built-in | ❌ | ❌ | ❌ |
| License | MIT | Apache 2.0 | MIT | Proprietary |

## Documentation

- [Quick Start Guide](docs/QUICKSTART.md) — 5-minute setup
- [Architecture](docs/ARCHITECTURE.md) — How it works under the hood
- [MCP Tools Reference](docs/MCP-TOOLS.md) — All 27 tools with examples
- [REST API Reference](docs/API-REFERENCE.md) — HTTP endpoints
- [Configuration Guide](docs/CONFIGURATION.md) — All environment variables
- [Deployment Guide](docs/DEPLOYMENT.md) — Docker, cloud, K8s
- [Migration Guide](docs/MIGRATION.md) — Migrate from cognitive-memory-chat
- [Multi-Platform Setup](SKILL.md) — Platform-specific agent configuration

## License

MIT — see [LICENSE](LICENSE).
