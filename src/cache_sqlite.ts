/**
 * SQLite Cache Implementation (PLACEHOLDER)
 *
 * ⚠️  WARNING: This is currently a placeholder in-memory implementation.
 *
 * Status: EXPERIMENTAL / NOT PRODUCTION-READY
 *
 * This module exports a CachePort implementation that will eventually use
 * SQLite for persistent caching, but currently only provides an in-memory
 * cache that does not persist across restarts.
 *
 * DO NOT USE IN PRODUCTION. For production use cases, use:
 * - openKvCache from "./cache_kv.ts" (Deno KV - production-ready)
 *
 * Planned features:
 * - Persistent SQLite storage
 * - Multi-version cache support
 * - Compressed state serialization
 * - Transaction support
 *
 * Target release: v0.2.0 or later
 *
 * @module
 */

import type { GraphState } from "./adt.ts";
import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import type { CacheError, CachePort } from "./ports.ts";

/**
 * Opens an in-memory cache (PLACEHOLDER for future SQLite implementation).
 *
 * ⚠️  This is NOT a persistent cache. State is lost on process restart.
 *
 * @param _path - Path parameter (currently ignored, reserved for future use)
 * @returns CachePort implementation with in-memory storage
 */
export function openSqliteCache(_path = ".trinkets/cache.db"): CachePort {
  let state: GraphState | null = null;

  function hydrate(): Promise<Result<GraphState | null, CacheError>> {
    return Promise.resolve(ok(state));
  }

  function persist(g: GraphState): Promise<Result<void, CacheError>> {
    state = g;
    return Promise.resolve(ok(undefined));
  }

  return { hydrate, persist } as const;
}
