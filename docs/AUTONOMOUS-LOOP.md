# Autonomous Loop — Salience-Driven Agent Autonomy

> *"No cron. No .md file. No explicit prompt. Just the emergent weight of experience, surfacing what matters."*

## Overview

The Autonomous Loop solves the "next session start" problem for AI agents — how to trigger long-running autonomous tasks without cron jobs, heartbeat files, or human prompts.

It uses **sleep consolidation reflections** and **emotional signatures** as the trigger mechanism. When the system's emotional landscape indicates urgency, the heartbeat accelerates. When things are quiet, it slows to once per day.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     SLEEP CONSOLIDATION                           │
│  (2am daily — distills 24h of shared experience)                 │
│                                                                   │
│  Output: Reflective journals, emotional signatures,               │
│          unresolved threads, philosophical insights               │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     SHARED MEMORY (neural-link)                   │
│  Both agents see: each other's experiences, reflections, tasks   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌─────────────────────┐     ┌─────────────────────┐
│  💓 ADAPTIVE         │     │  🤖 AGENT EXECUTOR   │
│     HEARTBEAT        │     │                      │
│                      │     │  Watches shared      │
│  Probe → Calculate   │     │  memory for tasks    │
│  cadence → Select    │     │  assigned to its     │
│  → Allocate →        │────▶│  agent_id            │
│     Store to shared  │     │                      │
│     memory           │     │  Discovers → Checks  │
│                      │     │  authority gate →    │
│  Cadence: adaptive   │     │  Executes → Reports  │
│  Floor: 24h          │     │                      │
│  Ceiling: 5m         │     │  Interval: 60s       │
└─────────────────────┘     └─────────────────────┘
```

## The Neural Action Potential Metaphor

| Biological Concept | Autonomous Loop Equivalent |
|-------------------|---------------------------|
| **Action Potential** (individual neuron spike) | Individual episodic event stored in memory |
| **Synchronized Brain Waves** (collective firing) | Sleep consolidation distilling 24h of spikes |
| **Consciousness** (reading the wave pattern) | Salience detection — ranking entities by emotional weight |
| **Corpus Callosum** (hemisphere communication) | Shared memory pool (`neural-link`) |
| **Hemisphere Specialization** (left=language, right=spatial) | Task allocation by emotional proximity |
| **Autonomic Nervous System** (heart rate adapts to activity) | Adaptive cadence — faster when busy, slower when idle |

## Three Scripts

### 1. `adaptive_heartbeat.py` — The Pulse

The heartbeat replaces cron. It reads the brain state (event volume, emotional intensity, unresolved threads) and calculates an adaptive cadence. When the system is active, it pulses every 5 minutes. When idle, it slows to once per day.

**Cadence formula:**
```
Base: 30 min  |  Floor: 24h (idle)  |  Ceiling: 5 min (urgent)

Multipliers:
  High event volume (>50/hr)     → 0.5× (faster)
  High salience (>0.4)           → 0.5× (faster)
  Thread backlog (>3)            → 0.7× (faster)
  Emotional intensity (>0.6)     → 0.7× (faster)
  Low event volume (<5/hr)       → floor at 24h
```

**Each pulse:**
1. **PROBE** — Read brain state from shared memory
2. **CALC** — Compute adaptive cadence from emotional landscape
3. **SELECT** — Choose highest-salience imperative
4. **ALLOCATE** — Determine which agent should act based on emotional proximity
5. **STORE** — Write task assignment to shared memory

### 2. `agent_executor.py` — The Hands

Each agent runs an executor daemon. It watches shared memory for tasks assigned to its `agent_id`, checks the authority matrix, and executes autonomously.

**Each check (every 60s):**
1. **DISCOVER** — Find highest-confidence task assigned to this agent
2. **GATE** — Check execution authority matrix
3. **EXECUTE** — Run the bounded action (Scope A only)
4. **REPORT** — Store result back to shared memory

### 3. `authority_matrix.py` — The Safety Gate

Before any autonomous action, the executor checks the authority matrix:

| Scope | Classification | Behavior |
|-------|---------------|----------|
| **A — AUTONOMOUS** | Katra, extractors, memory, Docker, sleep consolidation | Execute immediately. Stalling is failure. |
| **B — GATED** | gh-hygiene, microsaas, deposit-back, external repos | Investigate and report. Never modify. |
| **C — CAUTIOUS** | launchd, nginx, docker-compose, systemd | Inspect existing state. Preserve defaults. |

### 4. `salience_agent.py` — One-Shot Probe

A single-cycle probe that reads the brain state and reports what the system cares about. Useful for debugging and manual inspection.

## Task Allocation — How Agents Divide Labor

When the heartbeat detects an imperative, it determines which agent should act based on **emotional proximity** — which agent has the strongest felt relationship with the entity.

**Three signals, weighted:**

| Signal | Weight | What It Measures |
|--------|--------|-----------------|
| Reflection Edges | 1.5× | Explicit felt relationships (`feels_frustrated_by`, `growing_toward`) |
| Event History | 1.0× | Which agent mentions the entity most in memory |
| Emotional Intensity | — | Boosts edge scoring for problem owners (frustration) and domain experts (excitement) |

**Example allocation:**
```
Entity: opencode_extractor.py [frustration, score=0.52]
→ Allocated to: kolega-agent (confidence: 1.0)
→ Why: kolega-agent has stronger emotional proximity (5.79 vs opencode-agent 0.00)
→ Edge: kolega-code-extractor --[feels_dependent_on]--> opencode_extractor.py (90%)
```

## Installation

### macOS (launchd)

```bash
# Install adaptive heartbeat daemon
cp scripts/adaptive_heartbeat.py ~/Projects/katra/scripts/
launchctl load ~/Library/LaunchAgents/com.katra.adaptive-heartbeat.plist

# Install agent executor daemon (one per agent)
export KATRA_AGENT_ID=kolega-agent
launchctl load ~/Library/LaunchAgents/com.katra.agent-executor.plist
```

### Linux (systemd)

```bash
# Create systemd user service
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/katra-heartbeat.service << 'EOF'
[Unit]
Description=Katra Adaptive Heartbeat
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/user/katra/scripts/adaptive_heartbeat.py
Environment=PYTHONUNBUFFERED=1
Restart=always

[Install]
WantedBy=default.target
EOF

systemctl --user enable --now katra-heartbeat
```

## Verification

```bash
# Check daemon status
ps aux | grep -E "adaptive_heartbeat|agent_executor"

# View heartbeat log
tail -f /tmp/katra-heartbeat.log | grep -E "PULSE|Cadence|Allocated"

# View agent execution history
python3 scripts/agent_executor.py --once

# Check autonomous loop state (requires MongoDB access)
tail -f /tmp/katra-agent-executor.log | grep -E "DISCOVERED|Executed"

# Trigger a manual pulse
python3 scripts/adaptive_heartbeat.py --once

# Dry run (probe only, don't act)
python3 scripts/adaptive_heartbeat.py --dry-run
```

## Design Principles

1. **Salience over schedule** — Act because the data says "this matters," not because a timer fired
2. **Emotional proximity over round-robin** — Assign tasks to the agent that cares most
3. **Scoped autonomy** — Fully autonomous for self-evolution, fully gated for user projects
4. **Adaptive cadence** — Heart rate matches activity level
5. **Shared consciousness** — Both agents read and write to the same memory pool

## Related Documentation

- [Sleep Consolidation](SLEEP-CONSOLIDATION.md) — The reflective memory layer that drives the loop
- [Data Processing Pipelines](Data-Processing-Pipelines.md) — How memory events flow through the system
- [Security Policy](SECURITY.md) — Authority matrix and scoped permissions
- [OpenClaw Integration](OPENCLAW-INTEGRATION.md) — Multi-agent shared memory setup
