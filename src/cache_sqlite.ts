import type { GraphState } from "./adt.ts";
import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import type { CacheError, CachePort } from "./ports.ts";

// NOTE: This is a placeholder in-memory cache, not actual SQLite
export function openSqliteCache(_path = ".trinkets/cache.db"): CachePort {
  let state: GraphState | null = null;

  async function hydrate(): Promise<Result<GraphState | null, CacheError>> {
    return ok(state);
  }

  async function persist(g: GraphState): Promise<Result<void, CacheError>> {
    state = g;
    return ok(undefined);
  }

  return { hydrate, persist } as const;
}
