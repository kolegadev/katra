/**
 * Core memory system type definitions
 */

// Episodic Memory Types
export interface EpisodicEvent {
  id?: string;
  session_id: string;
  user_id: string;
  event_type: string;
  content: Record<string, any>;
  metadata?: Record<string, any>;
  correlation_id?: string;
  timestamp: Date;
  embedding?: number[];
  embedding_model?: string;
  embedding_version?: number;
}

export interface SessionStats {
  session_id: string;
  event_count: number;
  first_event: Date;
  last_event: Date;
  unique_event_types: string[];
}

// Knowledge Graph Types
export interface KnowledgeNode {
  id: string;
  user_id: string;
  session_id?: string;
  type: string;
  properties: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface KnowledgeRelationship {
  from_id: string;
  to_id: string;
  relationship_type: string;
  properties?: Record<string, any>;
  strength?: number;
  created_at: Date;
}

// Working Memory Types
export interface WorkingMemorySession {
  session_id: string;
  user_id: string;
  state: Record<string, any>;
  last_accessed: Date;
  expires_at?: Date;
}

export interface SemanticFact {
  id?: string;
  user_id: string;
  content: string;
  source: string;
  confidence: number;
  metadata?: Record<string, any>;
  created_at: Date;
  embedding?: number[];
  embedding_model?: string;
  embedding_version?: number;
}

// Asset Storage Types
export interface AssetMetadata {
  id: string;
  user_id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  size: number;
  hash: string;
  metadata?: Record<string, any>;
  version?: number;
  created_at: Date;
  updated_at: Date;
}

// System Health Types
export interface MemorySystemHealth {
  episodic_memory: {
    status: 'healthy' | 'degraded' | 'unavailable';
    mongodb_connected: boolean;
    total_events: number;
  };
  knowledge_graph: {
    status: 'healthy' | 'degraded' | 'unavailable';
    mongodb_connected: boolean;
    total_nodes: number;
    total_relationships: number;
  };
  working_memory: {
    status: 'healthy' | 'degraded' | 'unavailable';
    redis_connected: boolean;
    active_sessions: number;
  };
  asset_storage: {
    status: 'healthy' | 'degraded' | 'unavailable';
    s3_connected: boolean;
    total_assets: number;
  };
}

// ── Sleep Consolidation / Reflection Types ──────────────────────────

export type ReflectionPeriodType = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type ReflectionEdgeType =
  | 'feels_excited_about'
  | 'feels_frustrated_by'
  | 'feels_curious_about'
  | 'feels_confident_in'
  | 'feels_anxious_about'
  | 'feels_grateful_for'
  | 'feels_conflicted_between'
  | 'growing_toward'
  | 'distancing_from'
  | 'protective_of'
  | 'inspired_by'
  | 'drained_by'
  | 'resonates_with'
  | 'tension_between'
  | 'harmony_between';

export interface ReflectiveJournal {
  _id?: any;
  user_id: string;
  shared_id?: string;
  period_type: ReflectionPeriodType;
  period_start: Date;
  period_end: Date;
  narrative: string;
  emotional_arc: {
    dominant_emotion: string;
    intensity: number;
    trajectory: 'rising' | 'falling' | 'stable' | 'oscillating' | 'transformative';
    secondary_emotions: Array<{ emotion: string; intensity: number }>;
  };
  philosophical_insight?: string;
  identity_delta?: string;
  unresolved_threads: string[];
  source_events: string[];
  source_sessions: string[];
  created_at: Date;
}

export interface ReflectionNode {
  _id?: any;
  user_id: string;
  entity_name: string;
  entity_type: string;
  emotional_signature: {
    primary_emotion: string;
    intensity: number;
    valence: number;
    stability: 'volatile' | 'steady' | 'growing' | 'fading';
  };
  reflection_context: string;
  first_observed: Date;
  last_updated: Date;
  observation_count: number;
  created_at: Date;
}

export interface ReflectionEdge {
  _id?: any;
  user_id: string;
  source_entity: string;
  target_entity: string;
  edge_type: ReflectionEdgeType;
  intensity: number;
  valence: number;
  narrative: string;
  first_observed: Date;
  last_updated: Date;
  source_journal_id: any;
  created_at: Date;
}

export interface PhilosophicalInsight {
  _id?: any;
  user_id: string;
  insight_text: string;
  domain: string;
  confidence: number;
  evidence_count: number;
  first_observed: Date;
  last_reinforced: Date;
  source_journal_ids: any[];
  contradictory_evidence?: string[];
  status: 'emerging' | 'strengthening' | 'stable' | 'challenged';
  created_at: Date;
}

export interface GatheredData {
  period_start: Date;
  period_end: Date;
  event_count: number;
  session_count: number;
  conversation_summaries: string;
  semantic_facts: string;
  active_entities: string;
  prior_journal_narrative: string | null;
  unresolved_threads: string[];
}

export interface ReflectionLLMOutput {
  emotional_arc: {
    dominant_emotion: string;
    intensity: number;
    trajectory: 'rising' | 'falling' | 'stable' | 'oscillating' | 'transformative';
    secondary_emotions: Array<{ emotion: string; intensity: number }>;
  };
  entity_reflections: Array<{
    entity_name: string;
    entity_type: string;
    emotional_signature: {
      primary_emotion: string;
      intensity: number;
      valence: number;
      stability: 'volatile' | 'steady' | 'growing' | 'fading';
    };
    reflection: string;
  }>;
  relationships: Array<{
    source_entity: string;
    target_entity: string;
    edge_type: string;
    intensity: number;
    valence: number;
    narrative: string;
  }>;
  philosophical_insight: {
    insight_text: string;
    domain: string;
  } | null;
  identity_delta: string | null;
  unresolved_threads: string[];
  narrative: string;
}

export interface ConsolidationResult {
  success: boolean;
  period_type: string;
  period_start: Date;
  period_end: Date;
  journal_id?: string;
  nodes_upserted: number;
  edges_upserted: number;
  insights_upserted: number;
  narrative_preview?: string;
  error?: string;
}
