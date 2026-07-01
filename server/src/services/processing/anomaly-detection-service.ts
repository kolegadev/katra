/**
 * Anomaly Detection Service
 *
 * Layer 1 z-score anomaly detection at ingestion. Computes cosine distance
 * from a rolling centroid and flags memories that are statistically distant
 * from their cohort (z >= 3 = quarantined).
 */

import { get_database } from '../../database/connection.js';
import { ObjectId } from 'mongodb';
import type {
  AnomalyClassification,
  AnomalyRecord,
  QuarantinedMemory,
  AnomalyReport,
} from '../../types/memory.js';

const CORROBORATION_THRESHOLD = 3;

export class AnomalyDetectionService {
  private static instance: AnomalyDetectionService;

  private constructor() {}

  static get_instance(): AnomalyDetectionService {
    if (!AnomalyDetectionService.instance) {
      AnomalyDetectionService.instance = new AnomalyDetectionService();
    }
    return AnomalyDetectionService.instance;
  }

  cosineDistance(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 1.0;
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 1.0;
    const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    return 1.0 - Math.max(-1, Math.min(1, similarity));
  }

  async classifyAtIngestion(
    embedding: number[] | undefined,
    memoryType: string,
    userId: string
  ): Promise<{
    zScore: number;
    classification: AnomalyClassification;
    adjustedConfidence: number;
    shouldQuarantine: boolean;
  }> {
    if (!embedding || embedding.length === 0) {
      return {
        zScore: 0,
        classification: 'NORMAL',
        adjustedConfidence: 1.0,
        shouldQuarantine: false,
      };
    }

    const db = get_database();
    const stats = await db.collection('anomaly_stats').findOne({
      user_id: userId,
      memory_type: memoryType,
    });

    if (!stats || stats.sample_count < 5) {
      await this.updateStats(userId, memoryType, embedding, stats || null);
      return {
        zScore: 0,
        classification: 'NORMAL',
        adjustedConfidence: 1.0,
        shouldQuarantine: false,
      };
    }

    const distance = this.cosineDistance(embedding, stats.centroid);
    const sigma = stats.sigma_distance || 0.001;
    const z = (distance - stats.mu_distance) / sigma;

    let classification: AnomalyClassification;
    let adjustedConfidence: number;
    let shouldQuarantine = false;

    if (z < 2) {
      classification = 'NORMAL';
      adjustedConfidence = 1.0;
    } else if (z < 3) {
      classification = 'SUSPECT';
      adjustedConfidence = 0.5;
    } else {
      classification = 'ANOMALOUS';
      adjustedConfidence = 0.0;
      shouldQuarantine = true;
    }

    await this.updateStats(userId, memoryType, embedding, stats);

    return { zScore: z, classification, adjustedConfidence, shouldQuarantine };
  }

  private async updateStats(
    userId: string,
    memoryType: string,
    embedding: number[],
    existing: any
  ): Promise<void> {
    const db = get_database();

    if (!existing) {
      await db.collection('anomaly_stats').insertOne({
        user_id: userId,
        memory_type: memoryType,
        centroid: embedding,
        mu_distance: 0,
        sigma_distance: 0.001,
        sample_count: 1,
        sum_distances: 0,
        sum_squared_distances: 0,
        updated_at: new Date(),
      });
      return;
    }

    const n = existing.sample_count;
    const distance = this.cosineDistance(embedding, existing.centroid);

    const alpha = 1 / (n + 1);
    const newCentroid = existing.centroid.map(
      (c: number, i: number) => c * (1 - alpha) + (embedding[i] || 0) * alpha
    );

    const newN = n + 1;
    const oldMu = existing.mu_distance;
    const delta = distance - oldMu;
    const newMu = oldMu + delta / newN;
    const delta2 = distance - newMu;
    const priorSumSq = (existing.sum_squared_distances || 0) + delta * delta2;
    const newSigma = newN > 1 ? Math.sqrt(priorSumSq / (newN - 1)) : 0.001;

    await db.collection('anomaly_stats').updateOne(
      { user_id: userId, memory_type: memoryType },
      {
        $set: {
          centroid: newCentroid,
          mu_distance: newMu,
          sigma_distance: newSigma || 0.001,
          sample_count: newN,
          sum_distances: (existing.sum_distances || 0) + distance,
          sum_squared_distances: priorSumSq,
          updated_at: new Date(),
        },
      }
    );
  }

  async getQuarantinedMemories(userId: string): Promise<QuarantinedMemory[]> {
    const db = get_database();
    const records = await db.collection('quarantined_memories')
      .find({ user_id: userId })
      .sort({ quarantined_at: -1 })
      .limit(50)
      .toArray();

    return records.map((r: any) => ({
      memory_id: r.memory_id,
      memory_type: r.memory_type,
      z_score: r.z_score,
      content_preview: r.content_preview || '',
      quarantined_at: r.quarantined_at,
      auto_rehabilitate: r.auto_rehabilitate !== false,
    }));
  }

  async getAnomalyReport(userId: string): Promise<AnomalyReport> {
    const db = get_database();

    const [normal, suspect, anomalous, quarantined, recent] = await Promise.all([
      db.collection('anomaly_records').countDocuments({ user_id: userId, classification: 'NORMAL' }),
      db.collection('anomaly_records').countDocuments({ user_id: userId, classification: 'SUSPECT' }),
      db.collection('anomaly_records').countDocuments({ user_id: userId, classification: 'ANOMALOUS' }),
      db.collection('quarantined_memories').countDocuments({ user_id: userId }),
      db.collection('anomaly_records')
        .find({ user_id: userId, classification: { $ne: 'NORMAL' } })
        .sort({ detected_at: -1 })
        .limit(10)
        .toArray(),
    ]);

    return {
      total_ingested: normal + suspect + anomalous,
      normal_count: normal,
      suspect_count: suspect,
      anomalous_count: anomalous,
      quarantine_count: quarantined,
      recent_anomalies: recent.map((r: any) => ({
        memory_id: r.memory_id,
        z_score: r.z_score,
        classification: r.classification as AnomalyClassification,
      })),
    };
  }

  async recordCorroboration(memoryId: string, userId: string): Promise<void> {
    const db = get_database();
    await db.collection('anomaly_records').updateOne(
      { memory_id: memoryId, user_id: userId },
      { $inc: { corroboration_count: 1 }, $set: { last_corroborated_at: new Date() } }
    );
  }

  async rehabilitateMemory(memoryId: string, userId: string): Promise<void> {
    const db = get_database();
    await db.collection('anomaly_records').updateOne(
      { memory_id: memoryId, user_id: userId },
      { $set: { classification: 'NORMAL', auto_rehabilitated: true, rehabilitated_at: new Date() } }
    );
    await db.collection('quarantined_memories').updateOne(
      { memory_id: memoryId, user_id: userId },
      { $set: { auto_rehabilitate: true, rehabilitated: true, rehabilitated_at: new Date() } }
    );
  }

  async shouldAutoRehabilitate(memoryId: string, userId: string): Promise<boolean> {
    const db = get_database();
    const record = await db.collection('quarantined_memories').findOne({
      memory_id: memoryId,
      user_id: userId,
    });

    if (!record) return true;

    const anomalyRecord = await db.collection('anomaly_records').findOne({
      memory_id: memoryId,
      user_id: userId,
    });

    if (anomalyRecord && (anomalyRecord.corroboration_count || 0) >= CORROBORATION_THRESHOLD) {
      return true;
    }

    const ageMs = Date.now() - new Date(record.quarantined_at).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);

    if (ageDays > 30) return true;

    const stats = await db.collection('anomaly_stats').findOne({
      user_id: userId,
      memory_type: record.memory_type,
    });

    if (!stats || stats.sample_count < 10) return false;

    const embeddingDoc = await db.collection(record.memory_type === 'episodic' ? 'episodic_events' : 'semantic_facts').findOne(
      record.memory_type === 'episodic'
        ? { id: memoryId }
        : { _id: this.tryObjectId(memoryId) || memoryId }
    );

    if (!embeddingDoc || !embeddingDoc.embedding) return ageDays > 14;

    const distance = this.cosineDistance(embeddingDoc.embedding, stats.centroid);
    const currentZ = (distance - stats.mu_distance) / (stats.sigma_distance || 0.001);

    return currentZ < 2.5;
  }

  private tryObjectId(id: string): any {
    try {
      return new ObjectId(id);
    } catch {
      return null;
    }
  }
}
