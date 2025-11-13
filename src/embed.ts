/**
 * @module embed
 *
 * High-level embedded SDK for trinkets with automatic caching.
 *
 * Provides a convenient API wrapper around domain functions with automatic
 * graph state caching and cache refresh after mutations.
 *
 * @example
 * ```ts
 * import { makeTrinkets } from "@trinkets/core/embed";
 *
 * const sdk = makeTrinkets({ store, cache });
 * await sdk.createIssue({ title: "Task", priority: 0 });
 * const ready = await sdk.ready();
 * ```
 */

import type {
  CacheError,
  CachePort,
  Env,
  StoreError,
  StorePort,
} from "./ports.ts";
import type {
  DepType,
  GraphState,
  Issue,
  IssueId,
  IssueKind,
  IssueStatus,
} from "./adt.ts";
import {
  addLink as _link,
  createIssue as _create,
  initRepo,
  patchIssue as _patch,
  setStatus as _status,
} from "./domain.ts";
import { ready } from "./query.ts";
import { nextWork } from "./search.ts";
import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { warn } from "./logger.ts";

export type EmbedOptions = Readonly<
  { store: StorePort; cache?: CachePort | null; clock?: () => string }
>;

export type Trinkets = Readonly<{
  init: () => Promise<Result<void, StoreError>>;
  getGraph: () => Promise<Result<GraphState, StoreError | CacheError>>;
  ready: () => Promise<Result<readonly Issue[], StoreError | CacheError>>;
  nextWork: (
    filters?: Parameters<typeof nextWork>[1],
    strategy?: Parameters<typeof nextWork>[2],
  ) => Promise<Result<Issue | undefined, StoreError | CacheError>>;
  createIssue: (input: {
    title: string;
    body?: string;
    kind?: IssueKind;
    priority?: 0 | 1 | 2 | 3;
    labels?: readonly string[];
  }) => Promise<Result<Issue, StoreError | CacheError>>;
  patchIssue: (
    id: IssueId,
    patch: Partial<{
      title: string;
      body: string;
      kind: IssueKind;
      priority: 0 | 1 | 2 | 3;
      labels: readonly string[];
    }>,
  ) => Promise<Result<void, StoreError | CacheError>>;
  setStatus: (
    id: IssueId,
    status: IssueStatus,
  ) => Promise<Result<void, StoreError | CacheError>>;
  addLink: (
    from: IssueId,
    to: IssueId,
    type: DepType,
  ) => Promise<Result<void, StoreError | CacheError>>;
}>;

export function makeTrinkets(opts: EmbedOptions): Trinkets {
  const env: Env = { now: opts.clock ?? (() => new Date().toISOString()) };
  let inMemoryGraph: GraphState | null = null;
  let inflightMaterialize:
    | Promise<Result<GraphState, StoreError | CacheError>>
    | null = null;

  async function hydrateFromCache(): Promise<GraphState | null> {
    if (!opts.cache) return null;
    const cacheResult = await opts.cache.hydrate();
    if (!cacheResult.ok) {
      return null;
    }
    return cacheResult.value ?? null;
  }

  async function persistToCache(g: GraphState): Promise<void> {
    if (!opts.cache) return;
    const persistResult = await opts.cache.persist(g);
    if (!persistResult.ok) {
      // Best-effort cache; ignore failures so domain operations still succeed
    }
  }

  async function materializeFresh(): Promise<
    Result<GraphState, StoreError | CacheError>
  > {
    const materializeResult = await opts.store.materialize();
    if (!materializeResult.ok) return materializeResult;
    inMemoryGraph = materializeResult.value;
    await persistToCache(materializeResult.value);
    return ok(materializeResult.value);
  }

  async function getGraph(): Promise<
    Result<GraphState, StoreError | CacheError>
  > {
    if (inMemoryGraph) return ok(inMemoryGraph);
    if (inflightMaterialize) return inflightMaterialize;

    inflightMaterialize = (async () => {
      const cached = await hydrateFromCache();
      if (cached) {
        inMemoryGraph = cached;
        return ok(cached);
      }
      const fresh = await materializeFresh();
      return fresh;
    })();

    const result = await inflightMaterialize;
    inflightMaterialize = null;
    return result;
  }

  async function refresh(): Promise<Result<void, StoreError | CacheError>> {
    const refreshed = await materializeFresh();
    if (!refreshed.ok) return refreshed;
    return ok(undefined);
  }

  return {
    init: () => initRepo(opts.store),
    getGraph,

    ready: async (): Promise<
      Result<readonly Issue[], StoreError | CacheError>
    > => {
      const graphResult = await getGraph();
      if (!graphResult.ok) return graphResult;
      return ok(ready(graphResult.value));
    },

    nextWork: async (
      filters?: Parameters<typeof nextWork>[1],
      strategy?: Parameters<typeof nextWork>[2],
    ): Promise<Result<Issue | undefined, StoreError | CacheError>> => {
      const graphResult = await getGraph();
      if (!graphResult.ok) return graphResult;
      return ok(nextWork(graphResult.value, filters, strategy));
    },

    createIssue: async (
      input: {
        title: string;
        body?: string;
        kind?: IssueKind;
        priority?: 0 | 1 | 2 | 3;
        labels?: readonly string[];
      },
    ): Promise<Result<Issue, StoreError | CacheError>> => {
      const createResult = await _create(opts.store, env, input);
      if (!createResult.ok) return createResult;

      const refreshResult = await refresh();
      if (!refreshResult.ok) {
        // Cache refresh failed, but creation succeeded
        // Return success but log the cache error
        warn("Cache refresh failed after createIssue", {
          error: refreshResult.error,
        });
      }

      return ok(createResult.value);
    },

    patchIssue: async (
      id: IssueId,
      patch: Partial<
        {
          title: string;
          body: string;
          kind: IssueKind;
          priority: 0 | 1 | 2 | 3;
          labels: readonly string[];
        }
      >,
    ): Promise<Result<void, StoreError | CacheError>> => {
      const patchResult = await _patch(opts.store, env, id, patch);
      if (!patchResult.ok) return patchResult;

      return await refresh();
    },

    setStatus: async (
      id: IssueId,
      status: IssueStatus,
    ): Promise<Result<void, StoreError | CacheError>> => {
      const statusResult = await _status(opts.store, env, id, status);
      if (!statusResult.ok) return statusResult;

      return await refresh();
    },

    addLink: async (
      from: IssueId,
      to: IssueId,
      type: DepType,
    ): Promise<Result<void, StoreError | CacheError>> => {
      const linkResult = await _link(opts.store, env, { from, to, type });
      if (!linkResult.ok) return linkResult;

      return await refresh();
    },
  };
}
