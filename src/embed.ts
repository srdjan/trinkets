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

export type EmbedOptions = Readonly<
  { store: StorePort; cache?: CachePort | null; clock?: () => string }
>;

export function makeTrinkets(opts: EmbedOptions) {
  const env: Env = { now: opts.clock ?? (() => new Date().toISOString()) };

  async function getGraph(): Promise<
    Result<GraphState, StoreError | CacheError>
  > {
    if (opts.cache) {
      const cacheResult = await opts.cache.hydrate();
      if (!cacheResult.ok) {
        // Cache error, fall through to materialize
      } else if (cacheResult.value) {
        return ok(cacheResult.value);
      }
    }

    const materializeResult = await opts.store.materialize();
    if (!materializeResult.ok) return materializeResult;

    if (opts.cache) {
      const persistResult = await opts.cache.persist(materializeResult.value);
      // Log cache persist failures but don't fail the request
      if (!persistResult.ok) {
        // Could log here if we had access to logger
      }
    }

    return ok(materializeResult.value);
  }

  async function refresh(): Promise<Result<void, StoreError | CacheError>> {
    if (!opts.cache) return ok(undefined);

    const materializeResult = await opts.store.materialize();
    if (!materializeResult.ok) return materializeResult;

    return await opts.cache.persist(materializeResult.value);
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
    ): Promise<Result<readonly Issue[], StoreError | CacheError>> => {
      const graphResult = await getGraph();
      if (!graphResult.ok) return graphResult;
      return ok(nextWork(graphResult.value, filters, strategy));
    },

    createIssue: async (
      input: {
        title: string;
        body?: string;
        kind?: IssueKind;
        priority?: number;
        labels?: readonly string[];
      },
    ): Promise<Result<Issue, StoreError | CacheError>> => {
      const createResult = await _create(opts.store, env, input);
      if (!createResult.ok) return createResult;

      const refreshResult = await refresh();
      if (!refreshResult.ok) {
        // Cache refresh failed, but creation succeeded
        // Return success but log the cache error
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
          priority: number;
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
