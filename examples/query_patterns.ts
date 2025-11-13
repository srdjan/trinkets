/**
 * Query Patterns Example
 *
 * This example demonstrates different ways to query issues:
 * - Basic queries on materialized state
 * - Indexed queries for better performance
 * - Filtering by status, kind, priority, labels
 * - Finding ready vs blocked issues
 *
 * Run with: deno run -A examples/query_patterns.ts
 */

import { openJsonlStore } from "../src/store_jsonl.ts";
import { createIssue, addLink, setStatus } from "../src/domain.ts";
import { ready as readyBasic } from "../src/query.ts";
import { buildIndexes } from "../src/indexed_graph.ts";
import { ready as readyIndexed } from "../src/query_indexed.ts";

const env = { now: () => new Date().toISOString() };

async function main() {
  console.log("🔍 Trinkets Query Patterns Example\n");

  const tempDir = await Deno.makeTempDir();
  const store = await openJsonlStore({ baseDir: tempDir });

  // Create diverse set of issues
  console.log("📝 Creating 20 diverse issues...\n");

  const issues = [];
  for (let i = 0; i < 20; i++) {
    const kind = i % 3 === 0 ? "bug" : i % 3 === 1 ? "feature" : "chore";
    const priority = (i % 4) as 0 | 1 | 2 | 3;
    const labels = i % 2 === 0 ? ["frontend"] : ["backend"];

    const result = await createIssue(store, env, {
      title: `${kind.toUpperCase()} ${i}: Sample issue`,
      kind,
      priority,
      labels,
    });

    if (result.ok) {
      issues.push(result.value);
      // Mark some as doing, some as done
      if (i % 5 === 0) {
        await setStatus(store, env, result.value.id, "doing");
      } else if (i % 7 === 0) {
        await setStatus(store, env, result.value.id, "done");
      }
    }
  }

  // Add some dependencies to create blocked issues
  if (issues[0] && issues[1]) {
    await addLink(store, env, {
      from: issues[1].id,
      to: issues[0].id,
      type: "blocks",
    });
  }

  console.log(`✓ Created ${issues.length} issues with varied properties\n`);

  // 1. Basic queries on materialized state
  console.log("📊 BASIC QUERIES\n");

  const state = await store.materialize();
  if (!state.ok) return;

  // Find all bugs
  const bugs = Array.from(state.value.issues.values()).filter(
    (i) => i.kind === "bug",
  );
  console.log(`Bugs: ${bugs.length}`);

  // Find high-priority issues (priority 3)
  const highPriority = Array.from(state.value.issues.values()).filter(
    (i) => i.priority === 3,
  );
  console.log(`High priority (3): ${highPriority.length}`);

  // Find frontend issues
  const frontend = Array.from(state.value.issues.values()).filter(
    (i) => i.labels.includes("frontend"),
  );
  console.log(`Frontend: ${frontend.length}`);

  // Find ready issues
  const readyTodo = readyBasic(state.value, { statuses: ["todo"] });
  console.log(`Ready (todo): ${readyTodo.length}`);

  // Find ready issues that are bugs
  const readyBugs = readyBasic(state.value, { kinds: ["bug"] });
  console.log(`Ready bugs: ${readyBugs.length}\n`);

  // 2. Indexed queries (faster for large datasets)
  console.log("⚡ INDEXED QUERIES (optimized)\n");

  const indexed = buildIndexes(state.value);

  // Find ready high-priority issues
  const readyHighPriority = readyIndexed(indexed, { priorities: [3] });
  console.log(`Ready high-priority: ${readyHighPriority.length}`);

  // Find ready frontend features
  const readyFrontendFeatures = readyIndexed(indexed, {
    kinds: ["feature"],
    labels: ["frontend"],
  });
  console.log(`Ready frontend features: ${readyFrontendFeatures.length}`);

  // Find ready bugs or chores
  const readyBugsOrChores = readyIndexed(indexed, {
    kinds: ["bug", "chore"],
  });
  console.log(`Ready bugs or chores: ${readyBugsOrChores.length}`);

  // Find ready issues with specific statuses
  const readyTodoIndexed = readyIndexed(indexed, {
    statuses: ["todo"],
  });
  console.log(`Ready todo (indexed): ${readyTodoIndexed.length}\n`);

  // 3. Complex filtering
  console.log("🎯 COMPLEX FILTERING\n");

  // High-priority frontend bugs that are ready
  const criticalFrontendBugs = readyIndexed(indexed, {
    kinds: ["bug"],
    priorities: [3],
    labels: ["frontend"],
  });

  console.log(`Critical frontend bugs: ${criticalFrontendBugs.length}`);
  for (const issue of criticalFrontendBugs) {
    console.log(`  - ${issue.title} [P${issue.priority}]`);
  }
  console.log();

  // 4. Manual filtering for custom logic
  console.log("🔧 CUSTOM FILTERING\n");

  // Find issues created in the last hour (all of them in this example)
  const recentIssues = Array.from(state.value.issues.values()).filter((i) => {
    const createdAt = new Date(i.createdAt);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return createdAt > oneHourAgo;
  });
  console.log(`Recent issues (last hour): ${recentIssues.length}`);

  // Find issues with labels
  const labeled = Array.from(state.value.issues.values()).filter(
    (i) => i.labels.length > 0,
  );
  console.log(`Issues with labels: ${labeled.length}`);

  // Find issues by status distribution
  const statusDistribution = new Map<string, number>();
  for (const issue of state.value.issues.values()) {
    statusDistribution.set(
      issue.status,
      (statusDistribution.get(issue.status) || 0) + 1,
    );
  }

  console.log("\nStatus distribution:");
  for (const [status, count] of statusDistribution) {
    console.log(`  ${status}: ${count}`);
  }

  // 5. Link queries
  console.log("\n🔗 LINK QUERIES\n");

  const blockedIssues = Array.from(state.value.issues.values()).filter((i) => {
    const blockingLinks = state.value.links.get(i.id);
    if (!blockingLinks) return false;

    return blockingLinks.some((link) => {
      if (link.type !== "blocks") return false;
      const blocker = state.value.issues.get(link.targetId);
      return blocker && blocker.status !== "done";
    });
  });

  console.log(`Blocked issues: ${blockedIssues.length}`);
  for (const issue of blockedIssues) {
    console.log(`  ⛔ ${issue.title}`);
  }

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
  console.log("\n✨ Example completed!");
}

if (import.meta.main) {
  main().catch(console.error);
}
