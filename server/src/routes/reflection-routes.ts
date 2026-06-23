/**
 * Reflection Routes — REST API for sleep consolidation reflections
 */

import { Hono } from 'hono';
import { ReflectionStore } from '../services/reflection-store.js';
import { SleepConsolidationService } from '../services/sleep-consolidation-service.js';

export const create_reflection_routes = (): Hono => {
  const router = new Hono();
  const store = ReflectionStore.get_instance();

  /**
   * GET /api/v1/reflection/journal
   * Get reflective journal entries. Query: period_type, limit, user_id
   */
  router.get('/journal', async (c) => {
    try {
      const userId = c.req.query('user_id') || 'default';
      const periodType = c.req.query('period_type');
      const limit = parseInt(c.req.query('limit') || '10');
      const from = c.req.query('from') ? new Date(c.req.query('from')!) : undefined;
      const to = c.req.query('to') ? new Date(c.req.query('to')!) : undefined;

      const journals = await store.getJournals(userId, { periodType, limit, from, to });
      return c.json({ success: true, count: journals.length, journals });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  /**
   * GET /api/v1/reflection/journal/latest
   * Get the most recent journal entry.
   */
  router.get('/journal/latest', async (c) => {
    try {
      const userId = c.req.query('user_id') || 'default';
      const periodType = c.req.query('period_type') || 'daily';
      const journal = await store.getLatestJournal(userId, periodType);
      return c.json({ success: true, journal });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  /**
   * GET /api/v1/reflection/emotional-context/:entity
   * Get emotional/reflective context for an entity.
   */
  router.get('/emotional-context/:entity', async (c) => {
    try {
      const entityName = c.req.param('entity');
      const userId = c.req.query('user_id') || 'default';
      const context = await store.getEmotionalContext(userId, entityName);
      return c.json({ success: true, ...context });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  /**
   * GET /api/v1/reflection/insights
   * Query philosophical insights.
   */
  router.get('/insights', async (c) => {
    try {
      const userId = c.req.query('user_id') || 'default';
      const domain = c.req.query('domain');
      const status = c.req.query('status');
      const limit = parseInt(c.req.query('limit') || '10');

      const insights = await store.getInsights(userId, { domain, status, limit });
      return c.json({ success: true, count: insights.length, insights });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  /**
   * GET /api/v1/reflection/unresolved
   * Get currently unresolved threads.
   */
  router.get('/unresolved', async (c) => {
    try {
      const userId = c.req.query('user_id') || 'default';
      const threads = await store.getUnresolvedThreads(userId);
      return c.json({ success: true, count: threads.length, threads });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  /**
   * GET /api/v1/reflection/arc/:entity
   * Trace emotional trajectory for an entity over time.
   */
  router.get('/arc/:entity', async (c) => {
    try {
      const entityName = c.req.param('entity');
      const userId = c.req.query('user_id') || 'default';
      const limit = parseInt(c.req.query('limit') || '10');

      const arc = await store.getReflectionArc(userId, entityName, limit);
      return c.json({ success: true, entity: entityName, points: arc.length, arc });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  /**
   * GET /api/v1/reflection/nodes
   * Get all reflection nodes (entities with emotional signatures).
   */
  router.get('/nodes', async (c) => {
    try {
      const userId = c.req.query('user_id') || 'default';
      const nodes = await store.getAllReflectionNodes(userId);
      return c.json({ success: true, count: nodes.length, nodes });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  return router;
};
