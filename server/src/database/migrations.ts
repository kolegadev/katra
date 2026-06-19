/**
 * Database Migration Runner
 *
 * Ensures indexes and schema constraints are applied consistently
 * after every successful connection.
 */

import { Db } from 'mongodb';
import { initializeMemorySystemIndexes } from './index-management.js';

export async function runDatabaseMigrations(db: Db): Promise<void> {
  console.log('🗄️ Running database migrations...');

  try {
    await initializeMemorySystemIndexes(db);
    await migrateMemoryScopeDefaults(db);
    console.log('✅ Database migrations completed successfully');
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    // Don't throw — allow the app to start even if index setup fails
  }
}

/**
 * Seed default memory_scope setting if it doesn't exist.
 * Default mode is "personal" (backward-compatible — no behaviour change).
 */
async function migrateMemoryScopeDefaults(db: Db): Promise<void> {
  try {
    const existing = await db.collection('system_settings').findOne({ key: 'memory_scope' });
    if (!existing) {
      await db.collection('system_settings').insertOne({
        key: 'memory_scope',
        mode: 'personal',
        shared_id: null,
        hybrid_visible_user_ids: [],
        updated_at: new Date(),
      });
      console.log('  ✅ Seeded default memory_scope setting (mode: personal)');
    }
  } catch (error) {
    console.error('  ⚠️ Failed to seed memory_scope default:', error);
  }
}
