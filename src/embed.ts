
import type { Env } from "./ports.ts";
import type { CachePort, StorePort } from "./ports.ts";
import type { GraphState, IssueId, IssueKind, IssueStatus, DepType } from "./adt.ts";
import { initRepo, createIssue as _create, patchIssue as _patch, setStatus as _status, addLink as _link } from "./domain.ts";
import { ready } from "./query.ts";
import { nextWork } from "./search.ts";

export type EmbedOptions = Readonly<{ store: StorePort; cache?: CachePort | null; clock?: () => string; }>;
export function makeTrinkets(opts: EmbedOptions) {
  const env: Env = { now: opts.clock ?? (() => new Date().toISOString()) };
  async function getGraph(): Promise<GraphState> {
    if (opts.cache) { const c = await opts.cache.hydrate(); if (c) return c; }
    const g = await opts.store.materialize(); if (opts.cache) await opts.cache.persist(g); return g;
  }
  async function refresh() { if (!opts.cache) return; const g = await opts.store.materialize(); await opts.cache.persist(g); }
  return {
    init: () => initRepo(opts.store),
    getGraph,
    ready: async () => ready(await getGraph()),
    nextWork: async (filters?: Parameters<typeof nextWork>[1], strategy?: Parameters<typeof nextWork>[2]) => nextWork(await getGraph(), filters, strategy),
    createIssue: async (input: { title: string; body?: string; kind?: IssueKind; priority?: number; labels?: readonly string[]; }) => { const out = await _create(opts.store, env, input); await refresh(); return out; },
    patchIssue: async (id: IssueId, patch: Partial<{ title: string; body: string; kind: IssueKind; priority: number; labels: readonly string[] }>) => { await _patch(opts.store, env, id, patch); await refresh(); },
    setStatus: async (id: IssueId, status: IssueStatus) => { await _status(opts.store, env, id, status); await refresh(); },
    addLink: async (from: IssueId, to: IssueId, type: DepType) => { await _link(opts.store, env, { from, to, type }); await refresh(); },
  };
}
