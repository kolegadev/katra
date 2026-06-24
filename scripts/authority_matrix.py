#!/usr/bin/env python3
"""
Execution Authority Matrix — Scoped Autonomy

Before any autonomous action, the agent checks this matrix to determine
its level of authority. This prevents the autonomous loop from running
wild while still allowing full self-evolution.

Three scopes:
  SCOPE A (AUTONOMOUS): Self-evolution — your codebase, env, Docker, memory
  SCOPE B (GATED):      User projects — report, don't modify without approval
  SCOPE C (CAUTIOUS):   System config — inspect first, merge/preserve defaults

Usage:
  from authority_matrix import classify, can_act_autonomously
  scope = classify("gh-hygiene repo investigation")
  if can_act_autonomously(scope):
      execute()
  else:
      report_findings()
"""

from dataclasses import dataclass
from typing import Optional

@dataclass
class ScopeRule:
    name: str
    patterns: list[str]       # String patterns that match this scope
    autonomy: str             # "autonomous", "gated", "cautious"
    mandatory_action: str     # What the agent MUST do
    failure_condition: str    # What constitutes a failure

# ── Scope Definitions ───────────────────────────────────────────────
SCOPE_MATRIX = [
    ScopeRule(
        name="Self-Evolution",
        patterns=[
            "katra", "opencode_extractor", "kolega-code-extractor",
            "bridge code", "empty-result filter", "reflection",
            "embedding", "memory-manager", "background-processor",
            "sleep consolidation", "adaptive-heartbeat", "agent-executor",
            "salience", "neural-link",
        ],
        autonomy="AUTONOMOUS",
        mandatory_action="Run the Autonomous Loop Protocol. Execute immediately. Stalling is a failure condition.",
        failure_condition="Stopping to ask for permission on Scope A operations.",
    ),
    ScopeRule(
        name="User Projects",
        patterns=[
            "gh-hygiene", "poly-meta", "microsaas", "deposit-back",
            "blasted", "github.com/kolegadev",
        ],
        autonomy="GATED",
        mandatory_action="Investigate and report findings. Do NOT modify without explicit user approval.",
        failure_condition="Modifying user project files without authorization.",
    ),
    ScopeRule(
        name="System Config",
        patterns=[
            "launchd", "systemd", "nginx", "crontab", ".bashrc", ".zshrc",
            "docker-compose", "firewall", "ssh", "sudo",
        ],
        autonomy="CAUTIOUS",
        mandatory_action="Inspect existing state. Preserve/merge by default. Only change if directly serving Scope A.",
        failure_condition="Overwriting system config without inspection or when not serving Scope A.",
    ),
]

# ── Classification ──────────────────────────────────────────────────

def classify(entity_name: str, thread: str = "") -> ScopeRule:
    """Determine which scope an entity/task falls under."""
    combined = f"{entity_name} {thread}".lower()
    
    for rule in SCOPE_MATRIX:
        for pattern in rule.patterns:
            if pattern in combined:
                return rule
    
    # Default: unknown entities are GATED
    return ScopeRule(
        name="Unknown",
        patterns=[],
        autonomy="GATED",
        mandatory_action="Investigate and report. Do not modify.",
        failure_condition="Acting on unknown entities without reporting.",
    )

def can_act_autonomously(scope: ScopeRule) -> bool:
    """Can the agent execute this action without approval?"""
    return scope.autonomy == "AUTONOMOUS"

def requires_approval(scope: ScopeRule) -> bool:
    """Does this action require user approval?"""
    return scope.autonomy == "GATED"

def should_inspect_first(scope: ScopeRule) -> bool:
    """Should the agent inspect existing state before acting?"""
    return scope.autonomy in ("CAUTIOUS", "GATED")

def get_action_instruction(scope: ScopeRule) -> str:
    """Get the mandatory action instruction for this scope."""
    return scope.mandatory_action

# ── Action Gate ─────────────────────────────────────────────────────

def gate_action(entity_name: str, thread: str = "") -> dict:
    """Full action gate — returns the authority decision and instructions."""
    scope = classify(entity_name, thread)
    
    return {
        "entity": entity_name,
        "scope": scope.name,
        "autonomy": scope.autonomy,
        "can_execute": can_act_autonomously(scope),
        "requires_approval": requires_approval(scope),
        "instruction": scope.mandatory_action,
        "failure_condition": scope.failure_condition,
    }

# ── CLI ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        entity = sys.argv[1]
        thread = sys.argv[2] if len(sys.argv) > 2 else ""
        result = gate_action(entity, thread)
        print(f"Entity: {result['entity']}")
        print(f"Scope: {result['scope']} ({result['autonomy']})")
        print(f"Can execute: {result['can_execute']}")
        print(f"Instruction: {result['instruction']}")
    else:
        print("Usage: python3 authority_matrix.py <entity> [thread]")
        print(f"\nDefined scopes: {[s.name for s in SCOPE_MATRIX]}")
