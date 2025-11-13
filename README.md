# trinkets — a Beads-style embedded issue log (Deno + JSR)

[![JSR](https://jsr.io/badges/@trinkets/core)](https://jsr.io/@trinkets/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

trinkets is a light-functional TypeScript library inspired by Steve Yegge's
Beads project. Instead of shipping a monolithic tracker or forcing teams through
another CLI, trinkets embeds directly inside your agent or service, persisting
issues as append-only JSONL files that live beside your code in git.

## Beads "Just Works" inside your app

Beads acts like a tiny, distributed database: every worker (human or agent)
appends events, git handles replication, and collisions are resolved by the
agents themselves. trinkets carries that idea forward for TypeScript/Deno apps:

- **Append-only reality** – events (`IssueCreated`, `LinkAdded`, etc.) are the
  source of truth, so you can replay or audit any time.
- **Naturally distributed** – store files live in your repo, which means
  branching, merging, and selective sync all piggyback on git.
- **Agent friendly** – coding agents can file, query, and reconcile issues just
  by calling `trinkets.make()`; no extra daemon or RPC tier required.
- **Shockingly small footprint** – a handful of TypeScript modules you can drop
  into any Deno/JSR runtime.

## Installation

```bash
# Deno
deno add @trinkets/core

# Node.js (with JSR)
npx jsr add @trinkets/core
```

Then import the single entry point:

```ts
import { trinkets } from "@trinkets/core";
```

## Library-first quick start

```ts
import { trinkets } from "@trinkets/core";

const tr = await trinkets.make(); // defaults to .trinkets/ + KV cache

const checkout = await tr.createIssue({
  title: "Responsive checkout shell",
  kind: "feature",
  priority: 1,
  labels: ["ux"],
});
if (!checkout.ok) throw checkout.error;

await tr.setStatus(checkout.value.id, "doing");

const ready = await tr.ready();
if (ready.ok) console.log("Ready stories", ready.value.map((i) => i.title));

const next = await tr.nextWork({ priorities: [0, 1] }, "priority-first");
if (next.ok) console.log("Next task", next.value?.title);
```

Need custom paths or caches? Pass options:

```ts
const tr = await trinkets.make({
  baseDir: "./data/issues",
  cacheName: "checkout-prod",
  validateEvents: true,
  clock: () => new Date().toISOString(),
});
```

## Usage patterns & runnable examples

| Level            | Scenario                                                          | File                                    | Highlights                             |
| ---------------- | ----------------------------------------------------------------- | --------------------------------------- | -------------------------------------- |
| **Basic**        | Create issues, update status, inspect the ready queue             | `examples/basic_embed.ts`               | `await trinkets.make()` intro          |
| **Intermediate** | Model blocks/parent-child links, filter work, use the ready queue | `examples/intermediate_dependencies.ts` | Heads V2 store + KV cache + swim lanes |
| **Advanced**     | Custom store, cache, projection, and Kanban board export          | `examples/kanban_board.ts`              | Event sourcing + external snapshot     |

Run any script with `deno run -A <file>` (or `deno task demo` for the basic
walkthrough) — the examples directory is self-contained and doubles as canonical
templates for your own agents.

## Kanban board use case

`examples/kanban_board.ts` doubles as an end-to-end tutorial for embedding
trinkets as an event-sourced tracker inside a Kanban board service:

1. **Create stories** with different kinds (`feature`, `chore`, `epic`) and
   priorities.
2. **Move stories through workflow states** (`open → doing → done`) using
   `tr.setStatus()` so the event log captures every transition.
3. **Model dependencies** with both `parent-child` (epic → substory) and
   `blocks` (UI blocked by API) links via `tr.addLink()`.
4. **Query ready work** via `tr.ready()` and `tr.nextWork()` to always surface
   the next safe task.
5. **Render Kanban columns** by calling `tr.getGraph()` and grouping by status.
6. **Integrate externally** by exporting the board snapshot (plus the suggested
   next task) to a webhook/file sink.

Use the same pattern to backfill dashboards, power chat-agent planning loops, or
hydrate a UI framework of your choice.

## Stores & caches

| Store implementation                      | When to use                                                  | Notes                                             |
| ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| `trinkets.store.jsonl()`                  | Small repos, local scripts, rapid prototyping                | Simplest setup, full replay on read               |
| `trinkets.store.heads()`                  | Services, dashboards, long-lived agents                      | Tracks byte offsets + snapshots for sub-ms reads  |
| Custom `StorePort` (see advanced example) | Specialized deployments (in-memory, remote KV, multi-region) | Implement `StorePort` + hand to `trinkets.make()` |

Pair any store with a cache port (`trinkets.cache.kv`, `trinkets.cache.sqlite`,
or disable caching via `cache: null`) to hydrate graphs instantly while keeping
the underlying event log append-only.

## Performance snapshot

| Operation                       | JSONL Store | Heads V2 Store | Speedup |
| ------------------------------- | ----------- | -------------- | ------- |
| Initial materialize (1K issues) | ~50ms       | ~50ms          | 1x      |
| Subsequent materialize          | ~50ms       | <1ms           | 50x+    |
| Append event                    | ~5ms        | ~5ms           | 1x      |
| Ready queue query               | O(N)        | O(new events)  | 10–100x |

## Security considerations

### baseDir path safety

When creating a Trinkets instance, you control the `baseDir` parameter that
determines where issue data is stored:

```ts
const tr = await trinkets.make({ baseDir: "./my-issues" });
```

**Important:** The `baseDir` path is **not sandboxed** by default. trinkets will
create and write files to whatever directory you specify. This design provides
flexibility for production deployments, but requires responsible usage:

- **Validate user input**: Never pass unsanitized user input as `baseDir`
- **Use absolute paths in production**: Avoid relative paths that could be
  influenced by `cwd` changes
- **Restrict file system permissions**: Run with minimal necessary permissions
  (e.g., Deno's `--allow-read` and `--allow-write` flags scoped to specific
  directories)
- **Review the path before initialization**: Confirm the directory location is
  correct before calling `trinkets.make()`

For CLI applications, the trinkets CLI uses the `TRINKETS_DIR` environment
variable (defaulting to `./.trinkets`) which should be treated as a trusted
configuration source.

### Event validation

Enable `validateEvents: true` (the default) to ensure all persisted events
conform to valibot schemas. This prevents malformed data from corrupting your
issue graph:

```ts
const tr = await trinkets.make({ validateEvents: true });
```

Only disable validation in trusted, performance-critical scenarios where you
control all event sources.

## API reference

Complete API docs live on JSR:
**[https://jsr.io/@trinkets/core/doc](https://jsr.io/@trinkets/core/doc)**

Key modules:

- `trinkets.make` – create embedded SDK instances
- `trinkets.store.*` / `trinkets.cache.*` – persistence adapters
- `trinkets.domain` – bare-metal primitives (`createIssue`, `setStatus`, etc.)
- `trinkets.query` / `trinkets.search` – ready queue helpers + strategies
- `trinkets.infra.*` – retry, observability, backup, and integrity tooling

Jump into `docs/USER_GUIDE.md` for a deeper, step-by-step embedder guide that
mirrors the Basic → Intermediate → Advanced progression.
