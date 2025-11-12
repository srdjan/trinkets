
# trinkets — a minimal Beads-style library (Deno + JSR)

**trinkets** is a light-functional TypeScript library inspired by Steve Yegge’s Beads.
It gives you an append-only JSONL event log and a tiny graph model for issues + links.

- Append-only events: `IssueCreated`, `IssuePatched`, `IssueStatusSet`, `LinkAdded`, `LinkRemoved`
- Dependency kinds: `blocks`, `parent-child`, `related`, `discovered-from`
- Ready queue + next-work strategies
- Read-only HTTP adapter with HTMX dashboard (includes a *Blocked* SSR page)
- Deno-first, published to JSR (library code)

## Quick start

```bash
deno task tr init
deno task tr create "Do thing A" --priority 0
deno task tr ready
deno task serve   # runs the HTTP adapter example on :8787
```

## Embedding

```ts
import { makeTrinkets, openJsonlStoreWithHeadsV2, openKvCache } from "@trinkets/core";

const baseDir = ".trinkets";
const store = await openJsonlStoreWithHeadsV2({ baseDir, validateEvents: true });
const cache = await openKvCache("trinkets", baseDir);

const tr = makeTrinkets({ store, cache });
await tr.init();

const a = await tr.createIssue({ title: "Ship login", labels: ["p0"], priority: 0 });
const b = await tr.createIssue({ title: "Session handling", priority: 1 });
await tr.addLink(b.id, a.id, "blocks");

console.log(await tr.ready());
```

See the detailed [User Guide](./docs/USER_GUIDE.md).

## CORS & ETag options (HTTP)

```ts
await startHttp({
  baseDir: ".trinkets",
  cache: "kv",
  cors: { origin: ["https://yourapp.example", "http://localhost:5173"] }, // default "*"
  etag: "weak", // or "none"
});
```
