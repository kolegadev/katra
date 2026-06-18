# Katra — Cognitive Memory as a Service for AI Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Katra is open-source **memory infrastructure for AI agents**. It provides persistent, multi-layered memory — episodic events, semantic facts, knowledge graphs, working memory, and temporal recall — accessible through the Model Context Protocol (MCP) and a REST API.

Any MCP-compatible agent (OpenClaw, Claude Desktop, Cursor, custom apps) can connect and immediately gain long-term memory.

## Quick Start

```bash
git clone https://github.com/kolegadev/katra.git
cd katra
cp .env.example .env
# Edit .env — set your LLM provider and API key
docker compose up -d
```

Your Katra server is now running:
- **MCP endpoint:** `http://localhost:3100/mcp`
- **REST API:** `http://localhost:9002/api/v1`
- **Dashboard:** `http://localhost:9003`

## Connect Your Agent

### OpenClaw / any MCP client
```json
{
  "mcp": {
    "servers": {
      "katra": {
        "url": "http://localhost:3100/mcp",
        "transport": "streamable-http",
        "headers": {
          "Authorization": "Bearer your-api-key"
        }
      }
    }
  }
}
```

### Python SDK
```python
from katra import KatraClient

katra = KatraClient(api_key="your-api-key")

# Store a memory
katra.store(content="User prefers dark mode", type="preference")

# Search
results = katra.search("user preferences")

# Semantic search
results = katra.vector_search("UI themes the user likes")
```

## Features

- **Episodic Memory** — Every conversation message, tool call, system event stored with dedup and cascade detection
- **Semantic Memory** — Distilled facts with confidence scores and vector embeddings
- **Knowledge Graph** — Auto-extracted entities and relationships from conversations
- **Working Memory** — Redis-backed short-term session state (<5ms access)
- **Temporal Recall** — Query by time range, detect recurring patterns
- **Vector Search** — Semantic similarity search (local embeddings or OpenAI)
- **Background Processing** — Automatically extracts facts, builds graph, generates summaries
- **25+ MCP Tools** — Store, search, recall, explore — all via standardized protocol
- **Local-First** — Runs on a Raspberry Pi with zero external API costs

## Documentation

- [Architecture & Implementation Plan](docs/ARCHITECTURE.md)
- [Quick Start Guide](docs/QUICKSTART.md) _(coming soon)_
- [MCP Tool Reference](docs/MCP_TOOLS.md) _(coming soon)_
- [Deployment Guide](docs/DEPLOYMENT.md) _(coming soon)_
- [API Reference](docs/API_REFERENCE.md) _(coming soon)_

## Deployment Tiers

| Tier | Target | Infrastructure |
|---|---|---|
| **Local Docker** | Developers, hobbyists | `docker compose up` — MongoDB, Redis, MinIO |
| **Cloud** | Teams, production | AWS/Azure/GCP Terraform modules, managed services |
| **Hosted SaaS** | No-infrastructure users | `api.katra.ai` — multi-tenant, billed per usage |

## License

MIT — see [LICENSE](LICENSE).
