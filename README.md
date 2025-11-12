# trinkets — a minimal Beads-style library (Deno + JSR)

**trinkets** is a light-functional TypeScript library inspired by Steve Yegge’s
Beads. It gives you an append-only JSONL event log and a tiny graph model for
issues + links.

- Append-only events: `IssueCreated`, `IssuePatched`, `IssueStatusSet`,
  `LinkAdded`, `LinkRemoved`
- Dependency kinds: `blocks`, `parent-child`, `related`, `discovered-from`
- Ready queue + next-work strategies
- Deno-first, published to JSR (library code)

## Quick start

```bash
deno task tr init
deno task tr create "Do thing A" --priority 0
deno task tr ready
```

## Modular imports

Use the new subpath exports to pull in only the slices you need in a
server-side bundle:

```ts
import { createIssue } from "@trinkets/core/domain";
import { openJsonlStoreWithHeadsV2 } from "@trinkets/core/stores/heads";
import { openKvCache } from "@trinkets/core/cache/kv";
import { makeTrinkets } from "@trinkets/core/embed";
```

The classic `@trinkets/core` barrel still works, but subpath imports keep Deno
servers from loading optional utilities (retry/circuit-breaker, backup tools,
etc.) when they are not needed.

## Embedding

```ts
import { makeTrinkets } from "@trinkets/core/embed";
import { openJsonlStoreWithHeadsV2 } from "@trinkets/core/stores/heads";
import { openKvCache } from "@trinkets/core/cache/kv";

const baseDir = ".trinkets";
const store = await openJsonlStoreWithHeadsV2({
  baseDir,
  validateEvents: true,
});
const cache = await openKvCache("trinkets", baseDir);

const tr = makeTrinkets({ store, cache });
await tr.init();

const a = await tr.createIssue({
  title: "Ship login",
  labels: ["p0"],
  priority: 0,
});
const b = await tr.createIssue({ title: "Session handling", priority: 1 });
await tr.addLink(b.id, a.id, "blocks");

console.log(await tr.ready());
```

See the detailed [User Guide](./docs/USER_GUIDE.md).
