/**
 * Intermediate Workflow Example
 *
 * This "Intermediate" scenario builds on the basic embed by layering in:
 *   - Dependency graphs (blocks + parent/child)
 *   - Filtering and search using the ready queue & getGraph()
 *   - A ready queue "dispatcher" that always yields the next safe task
 *
 * Run with: deno run -A examples/intermediate_dependencies.ts
 */

import { makeTrinkets } from "../src/embed.ts";
import { openJsonlStoreWithHeadsV2 } from "../src/store_jsonl_heads_v2.ts";
import { openKvCache } from "../src/cache_kv.ts";
import type { CacheError, StoreError } from "../src/ports.ts";
import type { Result } from "../src/result.ts";
import type { Issue } from "../src/adt.ts";

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
  console.log("🧩 Trinkets Intermediate Workflow Example\n");
  const baseDir = await Deno.makeTempDir({ prefix: "tr-intermediate" });

  const store = await openJsonlStoreWithHeadsV2({
    baseDir,
    validateEvents: true,
    lockTimeoutMs: 2000,
  });
  const cache = await openKvCache("intermediate", baseDir);
  const tr = makeTrinkets({ store, cache, clock });

  expectOk(await tr.init(), "init store");

  const stories = await seedStories(tr);
  await declareDependencies(tr, stories);
  await showReady("Initial", tr);

  // Once "Design API" wraps up we unblock the rest of the chain
  expectOk(
    await tr.setStatus(stories.api.id, "done"),
    "complete design api",
  );

  await showReady("After finishing API design", tr);

  // Ask the ready queue for the next UX-friendly task
  const nextUi = expectOk(
    await tr.nextWork({ label: "ux" }, "priority-first"),
    "next UI work",
  );
  console.log(`🎨 Next UI-ready story: ${nextUi?.title ?? "none"}\n`);

  await printSwimLanes(tr);

  await Deno.remove(baseDir, { recursive: true });
}

type StoryHandles = {
  [key: string]: Issue;
  api: Issue;
  ui: Issue;
  qa: Issue;
  epic: Issue;
  integration: Issue;
};

async function seedStories(tr: ReturnType<typeof makeTrinkets>): Promise<StoryHandles> {
  const epic = expectOk(
    await tr.createIssue({
      title: "Mobile checkout epic",
      kind: "epic",
      priority: 1,
      labels: ["commerce"],
    }),
    "create epic",
  );

  const api = expectOk(
    await tr.createIssue({
      title: "Design payment orchestration API",
      kind: "feature",
      priority: 0,
      labels: ["backend"],
    }),
    "create api",
  );

  const ui = expectOk(
    await tr.createIssue({
      title: "Implement responsive checkout UI",
      kind: "feature",
      priority: 1,
      labels: ["ux"],
    }),
    "create ui",
  );

  const qa = expectOk(
    await tr.createIssue({
      title: "Regression suite for checkout",
      kind: "chore",
      priority: 2,
      labels: ["qa"],
    }),
    "create qa",
  );

  const integration = expectOk(
    await tr.createIssue({
      title: "External PSP integration",
      kind: "feature",
      priority: 0,
      labels: ["backend", "partner"],
    }),
    "create integration",
  );

  expectOk(await tr.setStatus(api.id, "doing"), "start api work");

  return { api, ui, qa, epic, integration };
}

async function declareDependencies(
  tr: ReturnType<typeof makeTrinkets>,
  stories: StoryHandles,
) {
  expectOk(
    await tr.addLink(stories.ui.id, stories.api.id, "blocks"),
    "link ui blocked by api",
  );
  expectOk(
    await tr.addLink(stories.qa.id, stories.integration.id, "blocks"),
    "link qa blocked by integration",
  );
  expectOk(
    await tr.addLink(stories.epic.id, stories.api.id, "parent-child"),
    "link epic->api",
  );
  expectOk(
    await tr.addLink(stories.epic.id, stories.ui.id, "parent-child"),
    "link epic->ui",
  );
  expectOk(
    await tr.addLink(stories.epic.id, stories.qa.id, "parent-child"),
    "link epic->qa",
  );
}

async function showReady(label: string, tr: ReturnType<typeof makeTrinkets>) {
  const ready = expectOk(await tr.ready(), "ready queue");
  console.log(`📮 ${label}: ${ready.length} ready stories`);
  for (const story of ready) {
    console.log(
      `  - ${story.title} [${story.kind}] (priority ${story.priority}) labels=${story.labels.join(", ")}`,
    );
  }
  console.log();
}

async function printSwimLanes(tr: ReturnType<typeof makeTrinkets>) {
  const graph = expectOk(await tr.getGraph(), "materialize graph");
  const statuses = ["open", "doing", "done", "canceled"] as const;
  console.log("🛝 Swim Lanes:");
  for (const status of statuses) {
    const stories = Array.from(graph.issues.values()).filter((issue) =>
      issue.status === status
    );
    console.log(`\n${status.toUpperCase()} (${stories.length})`);
    for (const story of stories) {
      const blockedBy = graph.incoming.get(story.id) ?? [];
      const blockers = blockedBy
        .filter((link) => link.type === "blocks")
        .map((link) => graph.issues.get(link.from)?.title ?? link.from);
      const blockerSummary = blockers.length
        ? ` ⛔ blocked by ${blockers.join(", ")}`
        : "";
      console.log(
        `  • ${story.title} [${story.kind}] P${story.priority}${blockerSummary}`,
      );
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
