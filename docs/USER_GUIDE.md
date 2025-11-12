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

## 4. Modular imports & server wiring

Use the subpath exports to keep server bundles lean and compose your own HTTP
surface (the older `startHttp` helper has been removed). Example using the Deno
`serve` API:

```ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { makeTrinkets } from "@trinkets/core/embed";
import { openJsonlStoreWithHeadsV2 } from "@trinkets/core/stores/heads";
import { openKvCache } from "@trinkets/core/cache/kv";

const store = await openJsonlStoreWithHeadsV2({ baseDir: ".trinkets" });
const cache = await openKvCache("trinkets", ".trinkets");
const tr = makeTrinkets({ store, cache });

await tr.init();

await serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/ready") {
    const readyResult = await tr.ready();
    if (!readyResult.ok) {
      return new Response(JSON.stringify({ error: readyResult.error }), { status: 500 });
    }
    return new Response(JSON.stringify(readyResult.value), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("ok");
});
```

## 5. Search & Next Work

- Filters: `label`, `text`, `kinds`, `priorities`
- Strategies: `"priority-first" | "oldest-first" | "shortest-title"`

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
