/**
 * Advanced Kanban Board Example
 *
 * This scenario demonstrates how to embed trinkets using a custom store,
 * add caching, listen to the event stream, and sync a Kanban board snapshot
 * to an external system. It covers:
 *   - Creating stories of different kinds & priorities
 *   - Moving cards through open → doing → done
 *   - Managing blocks + parent/child dependencies
 *   - Querying the ready queue & next-task strategy
 *   - Rendering a Kanban view grouped by status
 *   - Streaming events into a projection (event-sourcing pattern)
 *   - Integrating with an external sink (file-backed webhook)
 *
 * Run with: deno run -A examples/kanban_board.ts
 */

import { trinkets } from "../src/index.ts";
import type {
  CacheError,
  CachePort,
  Event,
  GraphState,
  Issue,
  IssueStatus,
  Result,
  StoreError,
  StorePort,
  Trinkets,
} from "../src/index.ts";
import { materializeFromEvents } from "../src/domain_materialize.ts";

const clock = () => new Date().toISOString();

type TrinketsError = StoreError | CacheError;
const { ok } = trinkets.result;

function expectOk<T>(result: Result<T, TrinketsError>, label: string): T {
  if (!result.ok) {
    console.error(`${label} failed`, result.error);
    throw new Error(`${label} failed: ${result.error._type ?? "Unknown"}`);
  }
  return result.value;
}

async function main() {
  console.log("🧱 Trinkets Advanced Kanban Example\n");

  const store = new MemoryEventStore();
  const cache = new MemoryCache();
  const tr = await trinkets.make({ store, cache, clock });

  const projector = new FlowProjection(store);
  const board = new KanbanBoard(tr);
  await board.bootstrap();
  await board.printBoard("Initial board");

  // Show how blockers keep work off the ready queue
  await board.linkDependency("ui", "api");
  await board.linkDependency("qa", "integration");
  await board.printReady("Before resolving blockers");

  // Move stories across states and unblock downstream work
  await board.move("api", "doing");
  await board.move("api", "done");
  await board.printReady("After finishing API");

  await board.move("integration", "doing");
  await board.move("integration", "done");
  await board.printReady("After finishing integration");

  await board.move("ui", "doing");
  await board.move("ui", "done");
  await board.move("qa", "doing");
  await board.move("qa", "done");

  await board.printBoard("Final board");

  // Ask the strategy engine for the next priority story (should be undefined)
  const next = expectOk(
    await tr.nextWork({ priorities: [0, 1] }, "priority-first"),
    "next work",
  );
  console.log(`🎯 Next prioritized story: ${next?.title ?? "all clear"}\n`);

  // Sync board snapshot to an "external" system (temp JSON file)
  const snapshotPath = await Deno.makeTempFile({
    prefix: "kanban",
    suffix: ".json",
  });
  const webhook = new FileWebhook(snapshotPath);
  await board.publishSnapshot(webhook);
  console.log(`📡 Snapshot exported to ${snapshotPath}\n`);

  console.log("📈 Flow metrics:", projector.report());
}

/**
 * KanbanBoard orchestrates higher-level workflows on top of trinkets.make().
 */
class KanbanBoard {
  constructor(private readonly tr: Trinkets) {}

  private readonly stories = new Map<string, Issue>();

  async bootstrap() {
    await this.seedStory("epic", {
      title: "Kanban board MVP",
      kind: "epic",
      priority: 1,
      labels: ["mvp"],
    });
    await this.seedStory("api", {
      title: "API composition layer",
      kind: "feature",
      priority: 0,
      labels: ["backend"],
    }, "epic");
    await this.seedStory("ui", {
      title: "Responsive checkout shell",
      kind: "feature",
      priority: 1,
      labels: ["ux"],
    }, "epic");
    await this.seedStory("integration", {
      title: "Payment service provider integration",
      kind: "feature",
      priority: 0,
      labels: ["backend", "partner"],
    }, "epic");
    await this.seedStory("qa", {
      title: "Regression harness",
      kind: "chore",
      priority: 2,
      labels: ["qa"],
    }, "epic");
  }

  async seedStory(
    key: string,
    input: Parameters<Trinkets["createIssue"]>[0],
    parentKey?: string,
  ) {
    const issue = expectOk(
      await this.tr.createIssue(input),
      `create story ${key}`,
    );
    this.stories.set(key, issue);
    if (parentKey) {
      const parent = this.requireStory(parentKey);
      expectOk(
        await this.tr.addLink(parent.id, issue.id, "parent-child"),
        `link ${parentKey}->${key}`,
      );
    }
    return issue;
  }

  async move(key: string, status: IssueStatus) {
    const issue = this.requireStory(key);
    expectOk(await this.tr.setStatus(issue.id, status), `set status ${key}`);
  }

  async linkDependency(blockedKey: string, blockerKey: string) {
    const blocked = this.requireStory(blockedKey);
    const blocker = this.requireStory(blockerKey);
    expectOk(
      await this.tr.addLink(blocked.id, blocker.id, "blocks"),
      "add dependency",
    );
  }

  async printReady(label: string) {
    const ready = expectOk(await this.tr.ready(), "ready queue");
    console.log(`📬 ${label}: ${ready.length} stories ready`);
    for (const issue of ready) {
      console.log(`  - ${issue.title} [${issue.kind}] P${issue.priority}`);
    }
    console.log();
  }

  async printBoard(label: string) {
    const graph = expectOk(await this.tr.getGraph(), "graph");
    console.log(`🗂️  ${label}`);
    const statuses: IssueStatus[] = ["open", "doing", "done", "canceled"];
    for (const status of statuses) {
      const column = Array.from(graph.issues.values()).filter((issue) =>
        issue.status === status && issue.kind !== "epic"
      );
      console.log(`\n${status.toUpperCase()} (${column.length})`);
      for (const issue of column) {
        const blockers = describeBlockers(graph, issue);
        console.log(
          `  • ${issue.title} [${issue.kind}] P${issue.priority}${blockers}`,
        );
      }
    }
    console.log();
  }

  async publishSnapshot(sink: ExternalSink) {
    const graph = expectOk(await this.tr.getGraph(), "snapshot graph");
    const next = expectOk(
      await this.tr.nextWork(undefined, "priority-first"),
      "snapshot next",
    );
    const snapshot = buildBoardSnapshot(graph, next?.title);
    await sink.publish(snapshot);
  }

  private requireStory(key: string): Issue {
    const issue = this.stories.get(key);
    if (!issue) throw new Error(`Story "${key}" not found`);
    return issue;
  }
}

/**
 * Custom in-memory event store that satisfies StorePort and lets us subscribe to
 * the live event stream (for projections / analytics).
 */
class MemoryEventStore implements StorePort {
  private events: Event[] = [];
  private listeners = new Set<(event: Event) => void>();

  onEvent(listener: (event: Event) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async append(event: Event): Promise<Result<void, StoreError>> {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    return ok(undefined);
  }

  async scan(): Promise<Result<readonly Event[], StoreError>> {
    return ok([...this.events]);
  }

  async materialize(): Promise<Result<GraphState, StoreError>> {
    return ok(materializeFromEvents(this.events));
  }
}

/**
 * Simple in-memory cache port implementation.
 */
class MemoryCache implements CachePort {
  private state: GraphState | null = null;

  async hydrate(): Promise<Result<GraphState | null, CacheError>> {
    return ok(this.state);
  }

  async persist(g: GraphState): Promise<Result<void, CacheError>> {
    this.state = g;
    return ok(undefined);
  }
}

/**
 * Event-sourcing projector that watches events and computes lightweight flow
 * metrics (how many blockers were introduced, how many stories finished, etc.).
 */
class FlowProjection {
  private completed = 0;
  private blockers = 0;
  private totalEvents = 0;

  constructor(store: MemoryEventStore) {
    store.onEvent((event) => this.apply(event));
  }

  private apply(event: Event) {
    this.totalEvents++;
    if (event._type === "LinkAdded" && event.link.type === "blocks") {
      this.blockers++;
    }
    if (event._type === "IssueStatusSet" && event.status === "done") {
      this.completed++;
    }
  }

  report() {
    return {
      eventsAppended: this.totalEvents,
      blockersDefined: this.blockers,
      storiesCompleted: this.completed,
    } as const;
  }
}

/**
 * External sink that pretends to POST to a webhook by materializing JSON to disk.
 */
interface ExternalSink {
  publish(snapshot: KanbanSnapshot): Promise<void>;
}

class FileWebhook implements ExternalSink {
  constructor(private readonly path: string) {}
  async publish(snapshot: KanbanSnapshot): Promise<void> {
    await Deno.writeTextFile(this.path, JSON.stringify(snapshot, null, 2));
  }
}

type KanbanSnapshot = {
  generatedAt: string;
  statuses: Record<
    IssueStatus,
    Array<Pick<Issue, "id" | "title" | "priority" | "kind">>
  >;
  nextSuggested?: string;
};

function buildBoardSnapshot(
  graph: GraphState,
  nextSuggested?: string,
): KanbanSnapshot {
  const snapshot: KanbanSnapshot = {
    generatedAt: new Date().toISOString(),
    statuses: {
      open: [],
      doing: [],
      done: [],
      canceled: [],
    },
    ...(nextSuggested ? { nextSuggested } : {}),
  };
  for (const issue of graph.issues.values()) {
    const column = snapshot.statuses[issue.status];
    if (!column) continue;
    column.push({
      id: issue.id,
      title: issue.title,
      priority: issue.priority,
      kind: issue.kind,
    });
  }
  return snapshot;
}

function describeBlockers(graph: GraphState, issue: Issue): string {
  const incoming = graph.incoming.get(issue.id) ?? [];
  const blockers = incoming
    .filter((link) => link.type === "blocks")
    .map((link) => graph.issues.get(link.from)?.title ?? link.from);
  return blockers.length ? ` ⛔ blocked by ${blockers.join(", ")}` : "";
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    Deno.exit(1);
  });
}
