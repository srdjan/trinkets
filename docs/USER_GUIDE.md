# Trinkets — User Guide (App Embedder)

This guide walks you through embedding the library, choosing a store, using
caching, exposing a read-only HTTP, enabling strict validation, and viewing
blocked reasons.

## 1. Stores

| Store                       | File(s)                                  | Pros                                          | Cons                       | When to use          |
| --------------------------- | ---------------------------------------- | --------------------------------------------- | -------------------------- | -------------------- |
| `openJsonlStore`            | `.trinkets/issues.jsonl` + `links.jsonl` | Simple, portable                              | Full replay on read        | Small repos, scripts |
| `openJsonlStoreWithHeadsV2` | adds `heads.json`, `state.json`          | Incremental replay using byte offsets; faster | Slightly more moving parts | Services, dashboards |

### Incremental materialization

Heads V2 tails only new bytes and applies them via `applyEvent(state, e)`. It
persists a `state.json` snapshot and byte offsets in `heads.json`.

## 2. Cache

- **KV**: `openKvCache("trinkets", baseDir)` — namespaced by baseDir hash
- **SQLite**: placeholder in this skeleton (swap in your driver)

## 3. Embedding API

```ts
const tr = makeTrinkets({ store, cache });
await tr.init();
await tr.createIssue({ title: "A", priority: 0, labels: ["p0"] });
await tr.addLink("bd-...", "bd-...", "blocks");
const candidates = await tr.ready();
const next = await tr.nextWork({ label: "p0" }, "priority-first");
```

## 4. Search & Next Work

- Filters: `label`, `text`, `kinds`, `priorities`
- Strategies: `"priority-first" | "oldest-first" | "shortest-title"`

## 5. HTTP adapter

```ts
import { startHttp } from "@trinkets/core";
await startHttp({
  baseDir: ".trinkets",
  cache: "kv",
  validateEvents: true,
  cors: { origin: "*" },
  etag: "weak",
});
// Visit http://localhost:8787/ for HTMX view
// JSON: /ready, /search, /issue/:id, /next, /graph/summary
// SSR fragment: /blocked (used by dashboard)
```

- Configurable **CORS** origins: `string | "*" | string[]`
- **ETag** policy: `"weak"` (default) or `"none"`

## 6. Git-friendly JSONL

```bash
deno task init-merge
# Adds .gitattributes + .gitconfig.merge-jsonl
# Then in .git/config: 
# [include]
#   path = .gitconfig.merge-jsonl
```

## 7. Strict schemas (valibot)

Enable structural validation on append:

```ts
const store = await openJsonlStoreWithHeadsV2({
  baseDir: ".trinkets",
  validateEvents: true,
});
```

## 8. Blocked reasons (SSR)

The dashboard includes a server-rendered `/blocked` fragment that lists items
blocked by `blocks` links, with blocker IDs in-line.

## 9. Production notes

- Keep `.trinkets/` at repo root and commit JSONL logs
- Prefer Heads V2 and KV cache for services
- Consider rotating logs (daily JSONL files) behind a composite store as volume
  grows
- Expose read-only HTTP in dashboards; mutate via CLI/agents
