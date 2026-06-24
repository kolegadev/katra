#!/usr/bin/env python3
"""
Adaptive Heartbeat — Demand-Driven Autonomous Cadence

Solves the "next session start" problem without cron or static .md files.
The heartbeat's frequency is governed by the emotional landscape:

  HIGH EVENT VOLUME  →  faster cadence (more to process)
  LOW EVENT VOLUME   →  slower cadence (conserves resources)
  HIGH SALIENCE      →  faster cadence (urgent imperatives)
  LOW SALIENCE       →  floor at once/day (minimum awareness)

Architecture:
  ┌─────────────────────────────────────────────────────────────┐
  │                    ADAPTIVE CADENCE                         │
  │                                                             │
  │  Events/hour → multiplier                                   │
  │  Salience score → multiplier                                │
  │  Unresolved thread count → multiplier                       │
  │                                                             │
  │  Base: 30 min    Floor: 24h    Ceiling: 5 min               │
  └──────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                    HEARTBEAT CYCLE                          │
  │                                                             │
  │  1. PROBE  — Read brain state (event vol, salience, threads)│
  │  2. CALC   — Compute cadence from emotional landscape       │
  │  3. SELECT — Choose highest-salience imperative             │
  │  4. ACT    — Execute one bounded change                     │
  │  5. CHECK  — Verify with HEARTBEAT_OK / HEARTBEAT_ALERT      │
  │  6. RECORD — Store to neural-link shared memory             │
  │  7. SLEEP  — Wait for calculated interval, then repeat      │
  └─────────────────────────────────────────────────────────────┘

No .md files. No cron. Just the emergent weight of experience.
"""

import json
import os
import re
import subprocess
import sys
import time
import hashlib
import argparse
from datetime import datetime, timezone
from typing import Optional, Tuple

# ── Config ──────────────────────────────────────────────────────────
STATE_FILE = os.path.expanduser("~/.katra/adaptive-heartbeat-state.json")
EXECUTED_FILE = os.path.expanduser("~/.katra/adaptive-heartbeat-executed.json")

# Cadence parameters (in seconds)
BASE_INTERVAL = 30 * 60      # 30 min base
FLOOR_INTERVAL = 24 * 3600   # 24h minimum (one sleep cycle)
CEILING_INTERVAL = 5 * 60    # 5 min maximum (urgent mode)

# Thresholds for multiplier calculation
HIGH_EVENT_THRESHOLD = 50    # events/hour to trigger "busy" mode
HIGH_SALIENCE_THRESHOLD = 0.4
HIGH_THREAD_THRESHOLD = 3

# ── Docker/DB Helpers ───────────────────────────────────────────────
import docker as _docker
_client = _docker.DockerClient(base_url='unix:///Users/johnpellew/.colima/default/docker.sock')

def _mongo_query(js: str) -> str:
    mongo = _client.containers.get('katra-mongo')
    exec_id = _client.api.exec_create(mongo.id,
        ['mongosh', 'mongodb://admin:katra-local-dev@localhost:27017/katra?authSource=admin',
         '--quiet', '--eval', js])
    return _client.api.exec_start(exec_id['Id']).decode('utf-8', errors='replace')

# ── Brain State Reader ──────────────────────────────────────────────
def read_brain_state() -> dict:
    """Read the current emotional landscape from shared memory."""
    
    # Event volume (last hour)
    volume_js = '''
    var oneHourAgo = new Date(Date.now() - 3600000);
    var count = db.episodic_events.countDocuments({timestamp: {$gte: oneHourAgo}});
    var total = db.episodic_events.countDocuments({});
    print(JSON.stringify({last_hour: count, total: total}));
    '''
    volume_raw = _mongo_query(volume_js).strip()
    vol_data = json.loads('\n'.join(volume_raw.split('\n')[-3:]).strip() or '{}')
    
    # Salience scores
    salience_js = '''
    var nodes = db.reflection_nodes.find({}).sort({observation_count: -1}).limit(5).toArray();
    var journal = db.reflective_journals.find({}).sort({created_at: -1}).limit(1).toArray();
    var unresolved = journal.length > 0 ? (journal[0].unresolved_threads || []) : [];
    var emotional_arc = journal.length > 0 ? (journal[0].emotional_arc || {}) : {};
    
    var ranked = [];
    nodes.forEach(function(n) {
      var sig = n.emotional_signature || {};
      var intensity = sig.intensity || 0;
      var valence = sig.valence || 0;
      var obs = n.observation_count || 1;
      var urgency = Math.abs(valence) > 0.3 ? Math.abs(valence) : 0.5;
      var score = intensity * urgency * (1 + 0.2 * (obs - 1));
      if (unresolved.some(function(t) { return t.toLowerCase().indexOf(n.entity_name.toLowerCase()) >= 0; })) {
        score *= 1.3;
      }
      ranked.push({entity: n.entity_name, emotion: sig.primary_emotion || "?", score: Math.round(score*10000)/10000});
    });
    ranked.sort(function(a,b) {return b.score - a.score;});
    print(JSON.stringify({
      ranked: ranked, 
      unresolved_count: unresolved.length, 
      dominant_emotion: emotional_arc.dominant_emotion || "none",
      arc_intensity: emotional_arc.intensity || 0
    }));
    '''
    salience_raw = _mongo_query(salience_js).strip()
    salience_data = json.loads('\n'.join(salience_raw.split('\n')[-3:]).strip() or '{}')
    
    return {
        "events_last_hour": vol_data.get("last_hour", 0),
        "events_total": vol_data.get("total", 0),
        "top_salience": salience_data.get("ranked", [{}])[0].get("score", 0) if salience_data.get("ranked") else 0,
        "unresolved_count": salience_data.get("unresolved_count", 0),
        "dominant_emotion": salience_data.get("dominant_emotion", "none"),
        "arc_intensity": salience_data.get("arc_intensity", 0),
        "ranked": salience_data.get("ranked", []),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

# ── Adaptive Cadence Calculator ─────────────────────────────────────
def calculate_cadence(brain: dict) -> Tuple[int, str]:
    """Compute the heartbeat interval based on emotional landscape.
    
    Returns (interval_seconds, rationale_string)
    """
    events_rate = brain["events_last_hour"]  # events/hour
    top_salience = brain["top_salience"]
    unresolved = brain["unresolved_count"]
    intensity = brain["arc_intensity"]
    
    interval = BASE_INTERVAL
    reasons = []
    
    # 1. Event volume: busy = faster
    if events_rate > HIGH_EVENT_THRESHOLD:
        interval = int(interval * 0.5)
        reasons.append(f"high event volume ({events_rate}/hr)")
    elif events_rate < 10:
        interval = int(interval * 2)
        reasons.append(f"low event volume ({events_rate}/hr)")
    
    # 2. Salience: urgent imperatives = faster
    if top_salience > HIGH_SALIENCE_THRESHOLD:
        interval = int(interval * 0.5)
        reasons.append(f"high salience ({top_salience:.3f})")
    
    # 3. Unresolved threads: backlog = faster
    if unresolved > HIGH_THREAD_THRESHOLD:
        interval = int(interval * 0.7)
        reasons.append(f"backlog ({unresolved} threads)")
    
    # 4. Emotional intensity: heightened state = faster
    if intensity > 0.6:
        interval = int(interval * 0.7)
        reasons.append(f"emotional intensity ({intensity:.2f})")
    
    # 5. Idle floor: nothing happening = once/day minimum
    if events_rate < 5 and top_salience < 0.3 and unresolved < 2:
        interval = FLOOR_INTERVAL
        reasons.append(f"idle mode (floor at 24h)")
    
    # Clamp
    interval = max(CEILING_INTERVAL, min(FLOOR_INTERVAL, interval))
    
    rationale = " | ".join(reasons) if reasons else "standard cadence"
    return interval, rationale

# ── Heartbeat Cycle ─────────────────────────────────────────────────
def run_heartbeat_cycle(dry_run: bool = False) -> Optional[dict]:
    """Execute one complete heartbeat pulse."""
    
    # 1. PROBE — read the brain state
    brain = read_brain_state()
    
    # 2. CALC — compute cadence
    interval, rationale = calculate_cadence(brain)
    
    print(f"\n{'─' * 55}")
    print(f"  💓 ADAPTIVE HEARTBEAT PULSE")
    print(f"{'─' * 55}")
    print(f"  Events: {brain['events_last_hour']}/hr | Salience: {brain['top_salience']:.3f} | Threads: {brain['unresolved_count']}")
    print(f"  Dominant emotion: {brain['dominant_emotion']} ({brain['arc_intensity']:.2f})")
    print(f"  Cadence: {interval}s ({interval/60:.0f}m) — {rationale}")
    
    # 3. SELECT — pick the imperative
    ranked = brain.get("ranked", [])
    if not ranked or ranked[0].get("score", 0) < 0.15:
        print(f"  ⏭️  No actionable items above threshold. HEARTBEAT_OK")
        return {
            "status": "HEARTBEAT_OK",
            "interval": interval,
            "brain": brain,
        }
    
    top = ranked[0]
    action_hash = hashlib.sha256(f"{top['entity']}:{brain['timestamp']}".encode()).hexdigest()[:12]
    
    # Check if already executed this cycle
    executed = _load_executed()
    if action_hash in executed.get("hashes", []):
        print(f"  ⏭️  Already executed: {top['entity']}. HEARTBEAT_OK")
        return {"status": "HEARTBEAT_OK", "interval": interval, "brain": brain}
    
    print(f"  🎯 Selected: {top['entity']} [{top['emotion']}] score={top['score']:.3f}")
    
    # 4. ACT — execute the bounded action
    result = _execute_action(top, dry_run)
    print(f"  ⚡ Action: {result['output'][:120]}")
    
    # 5. CHECK — HEARTBEAT_OK or HEARTBEAT_ALERT
    if result["status"] == "action_needed":
        print(f"  🚨 HEARTBEAT_ALERT: Action required for {top['entity']}")
    else:
        print(f"  ✅ HEARTBEAT_OK: {result['status']}")
    
    # 6. RECORD — store to shared memory
    if not dry_run:
        content = f"""[ADAPTIVE HEARTBEAT]
Entity: {top['entity']}
Emotion: {top['emotion']}
Salience: {top['score']:.3f}
Status: {result['status']}
Output: {result['output']}
Cadence: {interval}s ({interval/60:.0f}m)
Rationale: {rationale}"""
        
        _mongo_query(f'''
var r = db.episodic_events.insertOne({{
  id: "heartbeat-{action_hash}",
  user_id: "adaptive-heartbeat",
  session_id: "autonomous-loop",
  event_type: "heartbeat_action",
  content: {{ role: "assistant", message: {json.dumps(content)} }},
  shared_id: "neural-link",
  metadata: {{
    processed: false,
    source: "adaptive-heartbeat",
    salience_score: {top['score']},
    interval: {interval},
    created_at: new Date()
  }},
  timestamp: new Date()
}});
print(r.insertedId);
''')
        executed.setdefault("hashes", []).append(action_hash)
        _save_executed(executed)
    
    # 7. SLEEP — return interval for the caller to wait
    return {
        "status": "HEARTBEAT_OK" if result["status"] == "completed" else "HEARTBEAT_ALERT",
        "interval": interval,
        "brain": brain,
        "action": top,
        "result": result,
    }

# ── Action Executor ─────────────────────────────────────────────────
def _execute_action(entity: dict, dry_run: bool = False) -> dict:
    """Execute a bounded, reversible action for the given entity."""
    name = entity["entity"]
    emotion = entity["emotion"]
    
    result = {
        "entity": name,
        "status": "completed",
        "output": "",
    }
    
    if dry_run:
        result["output"] = f"DRY RUN: would investigate {name}"
        return result
    
    if "gh-hygiene" in name.lower():
        r = subprocess.run(
            ["curl", "-s", "https://api.github.com/repos/kolegadev/gh-hygiene"],
            capture_output=True, text=True, timeout=15
        )
        repo = json.loads(r.stdout)
        result["output"] = f"gh-hygiene: {repo.get('description','?')} — updated {repo.get('updated_at','?')} | stars: {repo.get('stargazers_count',0)}"
        result["status"] = "completed"
    
    elif "opencode_extractor" in name.lower() or "extractor" in name.lower():
        ep = os.path.expanduser("~/.solomem/opencode_extractor.py")
        exists = os.path.exists(ep)
        result["output"] = f"opencode_extractor.py: {'EXISTS' if exists else 'MISSING'}"
        result["status"] = "action_needed" if not exists else "completed"
    
    elif "katra" in name.lower():
        r = subprocess.run(
            ["curl", "-s", "http://localhost:9012/api/v1/health"],
            capture_output=True, text=True, timeout=10
        )
        h = json.loads(r.stdout)
        svc = h.get("services", {})
        all_ok = all(v in ("connected", "available", "deepseek") for v in svc.values())
        result["output"] = f"Katra: {', '.join(f'{k}={v}' for k,v in svc.items())}"
        result["status"] = "completed" if all_ok else "action_needed"
    
    else:
        result["output"] = f"Investigated entity '{name}' — {emotion} state acknowledged"
        result["status"] = "completed"
    
    return result

# ── State Persistence ───────────────────────────────────────────────
def _load_executed() -> dict:
    if os.path.exists(EXECUTED_FILE):
        with open(EXECUTED_FILE) as f:
            return json.load(f)
    return {"hashes": []}

def _save_executed(data: dict):
    os.makedirs(os.path.dirname(EXECUTED_FILE), exist_ok=True)
    with open(EXECUTED_FILE, "w") as f:
        json.dump(data, f, indent=2)

def _save_state(state: dict):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def _load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"total_pulses": 0}

# ── Main ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Adaptive Heartbeat — Demand-Driven Autonomous Cadence")
    parser.add_argument("--once", action="store_true", help="Single pulse and exit")
    parser.add_argument("--dry-run", action="store_true", help="Probe only, don't act")
    parser.add_argument("--max-cycles", type=int, default=0, help="Max cycles (0 = unlimited)")
    args = parser.parse_args()
    
    print("=" * 55)
    print("  💓 ADAPTIVE HEARTBEAT")
    print("  Demand-driven autonomous cadence")
    print("=" * 55)
    
    state = _load_state()
    state["started_at"] = datetime.now(timezone.utc).isoformat()
    cycle = 0
    
    while True:
        cycle += 1
        state["total_pulses"] = cycle
        
        pulse = run_heartbeat_cycle(dry_run=args.dry_run)
        _save_state(state)
        
        if args.once:
            break
        if args.max_cycles and cycle >= args.max_cycles:
            break
        
        # Adaptive sleep — the core innovation. No fixed timer.
        interval = pulse.get("interval", BASE_INTERVAL) if pulse else BASE_INTERVAL
        next_pulse = datetime.now(timezone.utc).timestamp() + interval
        next_str = datetime.fromtimestamp(next_pulse, timezone.utc).strftime("%H:%M:%S")
        print(f"\n  💤 Sleeping for {interval}s ({interval/60:.0f}m). Next pulse: {next_str} UTC")
        time.sleep(interval)
        
        if args.dry_run:
            break  # Only one cycle in dry run
    
    print(f"\n{'═' * 55}")
    print(f"  🧬 HEARTBEAT COMPLETE — {cycle} pulses")
    print(f"  No .md file. No cron. Just salience.")
    print(f"{'═' * 55}")

if __name__ == "__main__":
    main()
