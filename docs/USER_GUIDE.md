# Trinkets Embedder Guide (Beads Edition)

This guide is for developers embedding trinkets as a Beads-style event log
inside their own applications or coding agents. All snippets target Deno v2.5.6+
(where KV is stable) and assume you want programmatic control instead of
invoking the `tr` CLI.

## Mental model

1. **Event sourced:** Every change appends an event (`IssueCreated`,
   `LinkAdded`, etc.) to JSONL files inside your repo.
2. **Graph-first:** `trinkets.make()` keeps a hydrated graph in memory (and
   optionally cache) so you can query ready work instantly.
3. **Drop-in:** Stores and caches are simple ports. Swap in JSONL, Heads V2, or
   a custom implementation without changing the rest of your code.

---

## Basic — embed the core API

Goal: create issues, update status, and ask for the next task using the highest
level abstraction.

```ts
import { trinkets } from "@trinkets/core";

const tr = await trinkets.make({
  baseDir: ".trinkets",
  clock: () => new Date().toISOString(),
});

const auth = await tr.createIssue({
  title: "Implement auth redirect",
  kind: "feature",
  priority: 1,
  labels: ["frontend"],
});
if (!auth.ok) throw auth.error;

await tr.setStatus(auth.value.id, "doing");

const ready = await tr.ready();
if (ready.ok) {
  console.log("Ready stories", ready.value.map((i) => i.title));
}

const next = await tr.nextWork(
  { label: "frontend", priorities: [0, 1] },
  "priority-first",
);
if (next.ok) console.log("Next focus", next.value?.title);
```

`trinkets.make()` initializes the underlying store the first time you call it,
so the returned SDK is ready for commands immediately.

Key takeaways:

- The ready queue always respects blockers and status (`open` stories only).
- `nextWork(filters, strategy)` lets you plug in different heuristics without
  re-implementing search logic.
- JSONL is perfect for prototyping; you can commit the `.trinkets/` directory to
  git for full history.

---

## Intermediate — dependencies, filtering, and the ready queue

Goal: capture `blocks` + `parent-child` relationships, materialize graphs via
Heads V2 + KV cache, and route work from the ready queue into workers.

```ts
import { trinkets } from "@trinkets/core";

const baseDir = ".trinkets";
const store = await trinkets.store.heads({ baseDir, validateEvents: true });
const cache = await trinkets.cache.kv("checkout-squad", baseDir);
const tr = await trinkets.make({ store, cache });

const api = await tr.createIssue({
  title: "Design payment API",
  kind: "feature",
  priority: 0,
});
const ui = await tr.createIssue({
  title: "Responsive checkout UI",
  kind: "feature",
  priority: 1,
  labels: ["ux"],
});
const qa = await tr.createIssue({
  title: "Checkout regression suite",
  kind: "chore",
  priority: 2,
  labels: ["qa"],
});

await tr.addLink(ui.value.id, api.value.id, "blocks"); // UI waits on API
await tr.addLink(api.value.id, qa.value.id, "parent-child"); // QA rolls up to API epic

const ready = await tr.ready();
// Only API should be ready because UI is blocked.

const nextUx = await tr.nextWork({ label: "ux" }, "priority-first");
// null until API finishes.

await tr.setStatus(api.value.id, "done");
const readyAfter = await tr.ready();
// UI now appears because its blocker is finished.
```

Patterns unlocked:

- **Dependency reasoning:** With `graph.incoming`, you can explain blockers to
  users or agents (`graph.incoming.get(issue.id)` lists the `Link`s).
- **Filtering:** Apply labels/priorities when calling `nextWork()` to feed
  specialized workers (e.g., `label: "ux"`).
- **Ready queue dispatch:** Poll `tr.ready()` or `tr.nextWork()` inside an agent
  loop to continuously pull the next unblocked story.

---

## Advanced — Kanban board + custom infrastructure

Goal: treat trinkets as the event-sourced core of a Kanban application. The
advanced example (`examples/kanban_board.ts`) demonstrates the following:

### 1. Custom store implementation

```ts
class MemoryEventStore implements StorePort {
  private events: Event[] = [];
  private listeners = new Set<(event: Event) => void>();

  onEvent(listener: (event: Event) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async append(event: Event) {
    this.events.push(event);
    this.listeners.forEach((fn) => fn(event));
    return ok(undefined);
  }

  async scan() {
    return ok([...this.events]);
  }

  async materialize() {
    return ok(materializeFromEvents(this.events));
  }
}
```

Any data source (KV, Dynamo, HTTP API, in-memory) can plug in as long as it
implements `append`, `scan`, and `materialize`.

### 2. Caching strategy

Pair the store with either the built-in KV/SQLite cache or roll your own:

```ts
class MemoryCache implements CachePort {
  private snapshot: GraphState | null = null;
  async hydrate() {
    return ok(this.snapshot);
  }
  async persist(g: GraphState) {
    this.snapshot = g;
    return ok(undefined);
  }
}
```

### 3. Event-sourcing patterns

Because the custom store exposes `onEvent`, you can run projections in-process:

```ts
class FlowProjection {
  private completed = 0;
  constructor(store: MemoryEventStore) {
    store.onEvent((event) => {
      if (event._type === "IssueStatusSet" && event.status === "done") {
        this.completed++;
      }
    });
  }

  report() {
    return { storiesCompleted: this.completed };
  }
}
```

Use projections for analytics, webhooks, or to keep a read model like a Kanban
board synchronized.

### 4. Integration with external systems

The Kanban example exports its board snapshot (plus the `nextWork()` suggestion)
to a webhook/file sink:

```ts
const graph = await tr.getGraph();
const next = await tr.nextWork(undefined, "priority-first");
const snapshot = buildBoardSnapshot(graph.value, next.value?.title);
await webhook.publish(snapshot);
```

Swap the file-backed sink with your actual transport (HTTP POST, S3 object,
message bus, etc.).

### 5. Concrete Kanban walkthrough

The advanced script guides you through the end-to-end use case:

1. **Create stories** for API, UI, integrations, QA, and an umbrella epic.
2. **Move stories** across `open → doing → done` via `tr.setStatus()` to keep an
   auditable event log.
3. **Manage dependencies** using `blocks` links (`ui` blocked by `api`) and
   `parent-child` links (epic → story).
4. **Query ready work** with `tr.ready()` and `tr.nextWork()` to populate the
   ready column or drive automation.
5. **Display Kanban columns** by grouping `tr.getGraph()` results by status and
   printing blockers inline.
6. **Publish snapshots** externally so other systems (dashboards, notebooks,
   agents) can stay in sync.

---

## Scenario matrix

| Stage        | File                                    | Purpose                             |
| ------------ | --------------------------------------- | ----------------------------------- |
| Basic        | `examples/basic_embed.ts`               | Minimal embed + ready queue         |
| Intermediate | `examples/intermediate_dependencies.ts` | Dependencies + filtering            |
| Advanced     | `examples/kanban_board.ts`              | Custom store, caching, webhook sync |

Use these scripts as starting points or copy/paste snippets directly into your
agent/worker environment.

Quick smoke test: `deno task demo` runs the basic embed example end-to-end.

## Next steps

- Wire the library into your own agents or services using the pattern that fits
  their complexity.
- Keep `.trinkets/` (or your custom store files) under version control so every
  event is reviewable.
- Explore the API docs on JSR for deeper dives into `search`, `query`, and
  performance helpers like `indexed_graph`.
