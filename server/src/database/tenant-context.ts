/**
 * Tenant Context — AsyncLocalStorage-based tenant propagation
 *
 * Allows per-tenant database routing without threading tenant_id
 * through every service call. Set the tenant at request entry points
 * (REST middleware, MCP auth), and get_database() automatically returns
 * the correct database for the current async context.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenant_id: string;
  database_name: string;
  plan: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Run a function within a tenant context.
 * All async code inside (including service calls) will see this tenant.
 */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}

/**
 * Get the current tenant context, if any.
 * Returns undefined in single-tenant mode.
 */
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/**
 * Is multi-tenant mode enabled?
 */
export function isMultiTenant(): boolean {
  return process.env.MULTI_TENANT === 'true';
}
