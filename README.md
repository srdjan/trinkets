# trinkets — a minimal Beads-style library (Deno + JSR)

[![JSR](https://jsr.io/badges/@trinkets/core)](https://jsr.io/@trinkets/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**trinkets** is a light-functional TypeScript library inspired by Steve Yegge's
Beads. It gives you an append-only JSONL event log and a tiny graph model for
issues + links.

- Append-only events: `IssueCreated`, `IssuePatched`, `IssueStatusSet`,
  `LinkAdded`, `LinkRemoved`
- Dependency kinds: `blocks`, `parent-child`, `related`, `discovered-from`
- Ready queue + next-work strategies
- Deno-first, published to JSR (library code)

## Installation

Install from JSR:

```bash
# For Deno
deno add @trinkets/core

# For Node.js (with JSR support)
npx jsr add @trinkets/core
```

Or use direct JSR imports in Deno:

```typescript
import { createIssue } from "jsr:@trinkets/core/domain";
import { openJsonlStore } from "jsr:@trinkets/core/stores/jsonl";
```

## Quick start

```bash
deno task tr init
deno task tr create "Do thing A" --priority 0
deno task tr ready
```

## Modular imports

Use the new subpath exports to pull in only the slices you need in a server-side
bundle:

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

## Which Store Should I Use?

trinkets provides two store implementations with different performance
characteristics:

### JSONL Store (`@trinkets/core/stores/jsonl`)

**When to use:**

- Small datasets (< 1,000 issues)
- Command-line tools and scripts
- Maximum portability and simplicity
- Debugging and data inspection

**Performance:** O(N) full replay on every read

```typescript
import { openJsonlStore } from "@trinkets/core/stores/jsonl";
const store = await openJsonlStore({ baseDir: ".trinkets" });
```

### Heads V2 Store (`@trinkets/core/stores/heads`)

**When to use:**

- Production applications
- Web servers and APIs
- Large datasets (1,000+ issues)
- Real-time dashboards

**Performance:** Incremental replay with byte offset tracking and state
snapshots

```typescript
import { openJsonlStoreWithHeadsV2 } from "@trinkets/core/stores/heads";
const store = await openJsonlStoreWithHeadsV2({ baseDir: ".trinkets" });
```

**Recommendation:** Use Heads V2 for production applications. It provides the
same append-only guarantees as JSONL but with significantly better read
performance.

## Performance Comparison

| Operation                       | JSONL Store | Heads V2 Store | Speedup |
| ------------------------------- | ----------- | -------------- | ------- |
| Initial materialize (1K issues) | ~50ms       | ~50ms          | 1x      |
| Subsequent materialize (cached) | ~50ms       | <1ms           | 50x+    |
| Append event                    | ~5ms        | ~5ms           | 1x      |
| Full scan                       | O(N)        | O(new events)  | 10-100x |

**Key optimizations in Heads V2:**

- Byte offset tracking eliminates full file reads
- State snapshots enable instant materialization
- Version-aware cache invalidation
- Atomic writes with temp file + rename

## Examples

Check out the [`examples/`](./examples/) directory for practical usage:

- [**basic_usage.ts**](./examples/basic_usage.ts) - Creating issues, updating
  status, basic queries
- [**dependency_management.ts**](./examples/dependency_management.ts) - Working
  with blocked/blocks relationships
- [**query_patterns.ts**](./examples/query_patterns.ts) - Filtering by status,
  kind, priority, labels
- [**production_setup.ts**](./examples/production_setup.ts) - Retry, circuit
  breaker, observability, caching
- [**backup_restore.ts**](./examples/backup_restore.ts) - Data integrity
  verification and disaster recovery

Run any example:

```bash
deno run -A examples/basic_usage.ts
```

## API Reference

Full API documentation is available on JSR:

**📚 [View API Documentation on JSR](https://jsr.io/@trinkets/core/doc)**

Key modules:

- [`domain`](https://jsr.io/@trinkets/core/doc/domain) - Core operations
  (createIssue, addLink, setStatus)
- [`query`](https://jsr.io/@trinkets/core/doc/query) - Finding ready and blocked
  issues
- [`search`](https://jsr.io/@trinkets/core/doc/search) - Filtering and work
  strategies
- [`embed`](https://jsr.io/@trinkets/core/doc/embed) - High-level embedding API
- [`result`](https://jsr.io/@trinkets/core/doc/result) - Result type for error
  handling
- [`ports`](https://jsr.io/@trinkets/core/doc/ports) - Port interfaces
  (StorePort, CachePort)

## Troubleshooting

### Permission Denied Errors

trinkets requires file system access. Run with appropriate permissions:

```bash
deno run -A your-script.ts  # All permissions
# Or specific permissions:
deno run --allow-read --allow-write --allow-env your-script.ts
```

### KV Cache Errors

The KV cache requires the unstable KV flag:

```bash
deno run -A --unstable-kv your-script.ts
```

### Lock Timeout Errors

If you see `LockTimeout` errors:

- Multiple processes are accessing the same store directory
- Use the retry utilities: `withRetry()` or `retryable()` from
  `@trinkets/core/retry`
- Increase timeout: `openJsonlStore({ baseDir, lockTimeoutMs: 5000 })`

### Parse Errors

If events.jsonl is corrupted:

- Use integrity verification: `verifyIntegrity()` from
  `@trinkets/core/integrity`
- Repair corrupted data: `repairEvents()`
- Restore from backup: `importFromFile()`

See [USER_GUIDE.md](./USER_GUIDE.md) for more details.

## Documentation

- [**USER_GUIDE.md**](./USER_GUIDE.md) - Comprehensive usage guide
- [**CLAUDE.md**](./CLAUDE.md) - Architecture and design decisions
- [**Examples**](./examples/) - Practical code examples

## License

MIT License - see [LICENSE](./LICENSE) file for details.

Copyright (c) 2025 Srdjan Strbanovic
