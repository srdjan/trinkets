/**
 * Basic Embed Example
 *
 * This "Basic" scenario shows how to embed trinkets directly into an
 * application using the makeTrinkets() API. You will:
 *   1. Initialize the event log
 *   2. Create a few stories (issues)
 *   3. Move work across workflow states
 *   4. Ask the ready queue for the next task
 *
 * Run with: deno run -A examples/basic_embed.ts
 */

import { makeTrinkets } from "../src/embed.ts";
import { openJsonlStore } from "../src/store_jsonl.ts";
import type { CacheError, StoreError } from "../src/ports.ts";
import type { Result } from "../src/result.ts";
import type { Issue, IssueStatus } from "../src/adt.ts";

const clock = () => new Date().toISOString();
type TrinketsError = StoreError | CacheError;

function expectOk<T>(result: Result<T, TrinketsError>, label: string): T {
  if (!result.ok) {
    console.error(`${label} failed`, result.error);
    throw new Error(`${label} failed: ${result.error._type ?? "Unknown"}`);
  }
  return result.value;
}

async function main() {
  console.log("🚀 Trinkets Basic Embed Example\n");

  const baseDir = await Deno.makeTempDir({ prefix: "tr-basic" });
  const store = await openJsonlStore({ baseDir, validateEvents: true });
  const tr = makeTrinkets({ store, clock });

  expectOk(await tr.init(), "init repository");

  // Create a trio of stories with different priorities and kinds
  const checkout = expectOk(
    await tr.createIssue({
      title: "Implement checkout button",
      kind: "feature",
      priority: 1,
      labels: ["ui", "commerce"],
    }),
    "create checkout",
  );

  const taxes = expectOk(
    await tr.createIssue({
      title: "Apply tax rules for EU customers",
      kind: "chore",
      priority: 2,
      labels: ["backend"],
    }),
    "create taxes",
  );

  const bugfix = expectOk(
    await tr.createIssue({
      title: "Fix double-charging regression",
      kind: "bug",
      priority: 0,
      labels: ["p0"],
    }),
    "create bug",
  );

  console.log("✅ Created", checkout.id, taxes.id, bugfix.id, "\n");

  // Ready queue shows open work with no blockers
  await printReady(tr, "Fresh queue");

  // Move the bug into progress, then mark done
  expectOk(await tr.setStatus(bugfix.id, "doing"), "start bugfix");
  expectOk(await tr.setStatus(bugfix.id, "done"), "finish bugfix");
  console.log(`🐛 ${bugfix.title} resolved\n`);

  // Ask makeTrinkets for the next story using built-in strategies
  const next = expectOk(
    await tr.nextWork({ priorities: [0, 1] }, "priority-first"),
    "next work",
  );
  console.log("🎯 Suggested next task:", next?.title ?? "None", "\n");

  // Update status and inspect final board columns
  if (next) {
    expectOk(await tr.setStatus(next.id, "doing"), "start next task");
  }

  await printBoard(tr);

  await Deno.remove(baseDir, { recursive: true });
}

async function printReady(tr: ReturnType<typeof makeTrinkets>, label: string) {
  const ready = expectOk(await tr.ready(), "ready queue");
  console.log(`📬 ${label}: ${ready.length} stories ready for pickup`);
  for (const issue of ready) {
    console.log(`  - [${issue.kind}] ${issue.title} (priority ${issue.priority})`);
  }
  console.log();
}

async function printBoard(tr: ReturnType<typeof makeTrinkets>) {
  const graph = expectOk(await tr.getGraph(), "load graph");
  const columns: Record<IssueStatus, Issue[]> = {
    open: [],
    doing: [],
    done: [],
    canceled: [],
  };

  for (const issue of graph.issues.values()) {
    columns[issue.status]?.push(issue);
  }

  console.log("🗂️  Board Snapshot:");
  const statuses: IssueStatus[] = ["open", "doing", "done", "canceled"];
  for (const status of statuses) {
    const stories = columns[status];
    console.log(`\n${status.toUpperCase()} (${stories.length})`);
    for (const story of stories) {
      console.log(`  • ${story.title} [${story.kind}] P${story.priority}`);
    }
  }
  console.log();
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    Deno.exit(1);
  });
}
