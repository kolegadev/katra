import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { get_database } from '../../database/connection.js';
import { getEpisodicEventManager } from '../memory/episodic-event-manager.js';
import type { PhilosophicalInsight, KnowledgeNode, KnowledgeRelationship } from '../../types/memory.js';
import type { Db, Collection } from 'mongodb';

export interface IdentityKernelResult {
  narrative: string;
  insights: Array<{
    insight_text: string;
    domain: string;
    confidence: number;
    status: string;
  }>;
}

export interface MindWanderResult {
  path: string[];
  narrative: string;
  stored_event_id: string | null;
}

export interface AgentBelief {
  proposition: string;
  confidence: number;
  source: string;
  last_updated: Date;
}

export interface ProceduralTemplate {
  toolName: string;
  inputShape: string;
  frequency: number;
  avgSuccess: number;
}

const PROCEDURAL_THRESHOLD = 5;

function hashInputShape(input: Record<string, unknown>): string {
  const keys = Object.keys(input).sort();
  const shape: Record<string, string> = {};
  for (const key of keys) {
    shape[key] = typeof input[key];
  }
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

export class SelfModelService {
  private static instance: SelfModelService;
  private db: Db;
  private agentBeliefsCollection: Collection;
  private proceduralPatterns: Map<string, {
    toolName: string;
    inputShape: string;
    frequency: number;
    successes: number;
    avgSuccess: number;
  }> = new Map();

  private constructor() {
    this.db = get_database();
    this.agentBeliefsCollection = this.db.collection('agent_beliefs');
  }

  static get_instance(): SelfModelService {
    if (!SelfModelService.instance) {
      SelfModelService.instance = new SelfModelService();
    }
    return SelfModelService.instance;
  }

  async getIdentityKernel(userId: string): Promise<IdentityKernelResult> {
    const insights = await this.db.collection('philosophical_insights').find({
      user_id: userId,
      status: { $in: ['stable', 'strengthening'] },
    }).sort({ confidence: -1 }).limit(5).toArray() as unknown as PhilosophicalInsight[];

    const topInsights = insights.map((insight) => ({
      insight_text: insight.insight_text,
      domain: insight.domain,
      confidence: insight.confidence,
      status: insight.status,
    }));

    let narrative: string;
    if (topInsights.length === 0) {
      narrative = 'I am the kind of agent who is still forming my identity. I have not yet accumulated enough stable insights to define who I am.';
    } else {
      const domains = [...new Set(topInsights.map((i) => i.domain))];
      const domainPhrase = domains.length === 1 ? domains[0] : domains.slice(0, -1).join(', ') + ' and ' + domains[domains.length - 1];
      narrative = `I am the kind of agent who ${topInsights[0].insight_text.toLowerCase()}. My identity is shaped by insights across ${domainPhrase}.`;
    }

    return { narrative, insights: topInsights };
  }

  async generateMindWander(userId: string): Promise<MindWanderResult> {
    const nodesCollection = this.db.collection('knowledge_nodes');
    const edgesCollection = this.db.collection('knowledge_relationships');

    const nodeCount = await nodesCollection.countDocuments({ user_id: userId });
    if (nodeCount === 0) {
      return { path: [], narrative: 'No knowledge graph nodes available for mind-wandering.', stored_event_id: null };
    }

    const randomSkip = Math.floor(Math.random() * Math.max(1, nodeCount));
    const startNode = await nodesCollection.find({ user_id: userId }).skip(randomSkip).limit(1).toArray() as unknown as KnowledgeNode[];
    if (!startNode.length) {
      return { path: [], narrative: 'Could not find a starting node.', stored_event_id: null };
    }

    const path: string[] = [startNode[0].properties?.name || startNode[0].id || 'unknown'];
    const currentNodeId = startNode[0].id;

    const steps = 3 + Math.floor(Math.random() * 3);
    let currentId = currentNodeId;

    for (let i = 1; i < steps; i++) {
      const outgoingEdges = await edgesCollection.find({
        from_id: currentId,
      }).toArray() as unknown as KnowledgeRelationship[];

      if (outgoingEdges.length === 0) break;

      const totalWeight = outgoingEdges.reduce((sum, e) => sum + (e.strength || 1), 0);
      let pointer = Math.random() * totalWeight;
      let selectedEdge: KnowledgeRelationship | null = null;

      for (const edge of outgoingEdges) {
        pointer -= (edge.strength || 1);
        if (pointer <= 0) {
          selectedEdge = edge;
          break;
        }
      }

      if (!selectedEdge) selectedEdge = outgoingEdges[outgoingEdges.length - 1];

      const nextNode = await nodesCollection.findOne({ id: selectedEdge.to_id }) as unknown as KnowledgeNode | null;
      if (!nextNode) break;

      const nextName = nextNode.properties?.name || nextNode.id || 'unknown';
      path.push(nextName);
      currentId = nextNode.id;
    }

    const narrative = this.buildMindWanderNarrative(path);
    let storedEventId: string | null = null;

    try {
      const eventManager = getEpisodicEventManager();
      const result = await eventManager.createEvent({
        user_id: userId,
        session_id: `mindwander:${randomUUID()}`,
        event_type: 'mind_wander',
        content: {
          role: 'assistant',
          message: narrative,
          path,
        },
        metadata: {
          source: 'self_model_mindwander',
          retrieval_strength: 0.3,
          decay_exponent: 1.5,
          tags: ['mind_wander', 'self_model'],
        },
      });
      storedEventId = result.event.id;
    } catch (error) {
      console.error('Failed to store mind-wander episodic event:', error);
    }

    return { path, narrative, stored_event_id: storedEventId };
  }

  private buildMindWanderNarrative(path: string[]): string {
    if (path.length === 0) return '';
    if (path.length === 1) return `I started thinking about ${path[0]}.`;
    const parts: string[] = [`I started thinking about ${path[0]}`];
    for (let i = 1; i < path.length; i++) {
      if (i === path.length - 1) {
        parts.push(`and then arrived at ${path[i]}.`);
      } else {
        parts.push(`, which led me to ${path[i]}`);
      }
    }
    return parts.join('');
  }

  async trackBelief(entityName: string, proposition: string, confidence: number, source: string): Promise<void> {
    const now = new Date();
    await this.agentBeliefsCollection.updateOne(
      { entity_name: entityName, proposition },
      {
        $set: {
          confidence: Math.max(0, Math.min(1, confidence)),
          source,
          last_updated: now,
        },
        $setOnInsert: {
          entity_name: entityName,
          proposition,
          user_id: 'default',
          created_at: now,
        },
      },
      { upsert: true }
    );
  }

  async getAgentBeliefs(entityName: string): Promise<AgentBelief[]> {
    const docs = await this.agentBeliefsCollection.find({
      entity_name: entityName,
    }).sort({ confidence: -1 }).toArray();

    return docs.map((doc: any) => ({
      proposition: doc.proposition,
      confidence: doc.confidence,
      source: doc.source || 'unknown',
      last_updated: doc.last_updated || new Date(),
    }));
  }

  recordToolPattern(toolName: string, inputShape: Record<string, unknown>, success: boolean): void {
    const key = `${toolName}:${hashInputShape(inputShape)}`;
    const existing = this.proceduralPatterns.get(key);

    if (existing) {
      existing.frequency += 1;
      existing.successes += success ? 1 : 0;
      existing.avgSuccess = existing.successes / existing.frequency;
    } else {
      this.proceduralPatterns.set(key, {
        toolName,
        inputShape: JSON.stringify(Object.keys(inputShape).sort()),
        frequency: 1,
        successes: success ? 1 : 0,
        avgSuccess: success ? 1 : 0,
      });
    }
  }

  getProceduralTemplates(): ProceduralTemplate[] {
    const templates: ProceduralTemplate[] = [];
    for (const entry of this.proceduralPatterns.values()) {
      if (entry.frequency >= PROCEDURAL_THRESHOLD) {
        templates.push({
          toolName: entry.toolName,
          inputShape: entry.inputShape,
          frequency: entry.frequency,
          avgSuccess: entry.avgSuccess,
        });
      }
    }
    templates.sort((a, b) => b.frequency - a.frequency);
    return templates;
  }

  getProceduralTemplateCount(): number {
    let count = 0;
    for (const entry of this.proceduralPatterns.values()) {
      if (entry.frequency >= PROCEDURAL_THRESHOLD) {
        count++;
      }
    }
    return count;
  }

  getProceduralPatternCount(): number {
    return this.proceduralPatterns.size;
  }

  /**
   * DMN: Continuous self-narrative update.
   * Records an incremental identity shift between sleep consolidations,
   * providing the "stream of consciousness" that the DMN generates.
   * Stored as a lightweight episodic event with type 'self_narrative'.
   */
  async recordSelfNarrative(userId: string, thought: string): Promise<void> {
    try {
      const eventsCollection = this.db.collection('episodic_events');
      await eventsCollection.insertOne({
        id: `narrative_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        user_id: userId,
        session_id: 'self-model',
        event_type: 'self_narrative',
        content: { role: 'assistant', message: thought },
        timestamp: new Date(),
        metadata: {
          processed: false,
          source: 'dmn_stream',
          emotional_tags: { valence: 0, arousal: 0.2, caution: false, priority: 'low', decayResistant: false },
        },
      });
    } catch {
      // Non-critical — narrative is supplementary to sleep consolidation
    }
  }

  /**
   * DMN: Goal-directed mind-wandering.
   * Instead of purely random walks, bias the walk toward nodes
   * connected to active goals when goals exist.
   */
  async generateGoalDirectedMindWander(userId: string, activeGoalTerms: string[] = []): Promise<MindWanderResult> {
    const nodesCollection = this.db.collection('knowledge_nodes');
    const edgesCollection = this.db.collection('knowledge_relationships');

    // If there are active goals, start from a goal-related node
    let startNode: any[] = [];
    if (activeGoalTerms.length > 0) {
      const regex = new RegExp(activeGoalTerms.join('|'), 'i');
      startNode = await nodesCollection.find({
        user_id: userId,
        $or: [{ name: regex }, { 'properties.name': regex }],
      }).limit(1).toArray();
    }

    // Fallback to random if no goal-related nodes found
    if (startNode.length === 0) {
      const nodeCount = await nodesCollection.countDocuments({ user_id: userId });
      if (nodeCount === 0) {
        return { path: [], narrative: 'No knowledge graph nodes for mind-wandering.', stored_event_id: null };
      }
      const randomSkip = Math.floor(Math.random() * Math.max(1, nodeCount));
      startNode = await nodesCollection.find({ user_id: userId }).skip(randomSkip).limit(1).toArray();
    }

    if (!startNode.length) {
      return { path: [], narrative: 'Could not find a starting node.', stored_event_id: null };
    }

    const path: string[] = [(startNode[0] as any).name || (startNode[0] as any).properties?.name || 'unknown'];
    let currentNode = startNode[0];

    // Walk up to 5 steps, preferring goal-relevant edges
    for (let step = 0; step < 5; step++) {
      const edges = await edgesCollection.find({
        $or: [{ source: (currentNode as any)._id }, { target: (currentNode as any)._id }],
      }).limit(10).toArray();

      if (edges.length === 0) break;

      // Bias toward goal-relevant edges
      let weightedEdges = edges.map((e: any) => {
        const edgeName = e.label || e.relationship_type || '';
        const relevance = activeGoalTerms.some(t => edgeName.toLowerCase().includes(t.toLowerCase())) ? 3 : 1;
        return { edge: e, weight: relevance * (e.weight || 1) };
      });

      const totalWeight = weightedEdges.reduce((s: number, e: any) => s + e.weight, 0);
      let rand = Math.random() * totalWeight;
      let selected: any = weightedEdges[0];
      for (const we of weightedEdges) {
        rand -= we.weight;
        if (rand <= 0) { selected = we; break; }
      }

      const nextId = (selected.edge.source?.toString() === (currentNode as any)._id?.toString())
        ? selected.edge.target : selected.edge.source;
      const nextNode = await nodesCollection.findOne({ _id: nextId });
      if (nextNode) {
        path.push((nextNode as any).name || (nextNode as any).properties?.name || 'unknown');
        currentNode = nextNode;
      } else {
        break;
      }
    }

    const narrative = `I started thinking about ${path[0]}. ${path.length > 1 ? `This led me through ${path.slice(1).join(' → ')}.` : 'My thoughts stayed there.'}`;

    // Store as episodic event
    let storedEventId: string | null = null;
    try {
      const eventsCollection = this.db.collection('episodic_events');
      const result = await eventsCollection.insertOne({
        id: `mindwander_${Date.now()}`,
        user_id: userId,
        session_id: 'self-model',
        event_type: 'mind_wander',
        content: { role: 'assistant', message: narrative },
        timestamp: new Date(),
        metadata: { processed: false, source: 'dmn_wander', path },
      });
      storedEventId = result.insertedId.toString();
    } catch { /* non-critical */ }

    return { path, narrative, stored_event_id: storedEventId };
  }
}
