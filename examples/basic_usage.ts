/**
 * Basic Usage Example
 *
 * This example demonstrates the fundamental operations of trinkets:
 * - Opening a store
 * - Creating issues
 * - Updating issue status
 * - Querying issues
 *
 * Run with: deno run -A examples/basic_usage.ts
 */

import { openJsonlStore } from "../src/store_jsonl.ts";
import { createIssue, setStatus } from "../src/domain.ts";
import { ready } from "../src/query.ts";

// Environment for providing timestamps (injectable dependency)
const env = { now: () => new Date().toISOString() };

async function main() {
  console.log("🎯 Trinkets Basic Usage Example\n");

  // 1. Open a store in a temporary directory
  const tempDir = await Deno.makeTempDir();
  console.log(`📁 Store location: ${tempDir}\n`);

  const store = await openJsonlStore({ baseDir: tempDir });

  // 2. Create some issues
  console.log("📝 Creating issues...");

  const bug = await createIssue(store, env, {
    title: "Fix login button not responding",
    kind: "bug",
    priority: 3,
    labels: ["frontend", "urgent"],
  });

  const feature = await createIssue(store, env, {
    title: "Add dark mode support",
    kind: "feature",
    priority: 2,
    labels: ["frontend", "enhancement"],
  });

  const chore = await createIssue(store, env, {
    title: "Update dependencies",
    kind: "chore",
    priority: 1,
  });

  // 3. Check results using Result type pattern
  if (!bug.ok || !feature.ok || !chore.ok) {
    console.error("❌ Failed to create issues");
    return;
  }

  console.log(`✓ Created bug: ${bug.value.id}`);
  console.log(`✓ Created feature: ${feature.value.id}`);
  console.log(`✓ Created chore: ${chore.value.id}\n`);

  // 4. Update status of bug to "doing"
  console.log("🔄 Updating status...");
  const statusResult = await setStatus(store, env, bug.value.id, "doing");

  if (statusResult.ok) {
    console.log(`✓ Bug ${bug.value.id} is now in progress\n`);
  }

  // 5. Query ready issues (issues that can be worked on)
  console.log("🔍 Finding ready issues...");
  const state = await store.materialize();

  if (state.ok) {
    const readyIssues = ready(state.value);
    console.log(`Found ${readyIssues.length} ready issues:`);

    for (const issue of readyIssues) {
      console.log(
        `  - [${issue.kind}] ${issue.title} (status: ${issue.status})`,
      );
    }
    console.log();
  }

  // 6. Complete the bug
  console.log("✅ Completing bug...");
  await setStatus(store, env, bug.value.id, "done");
  console.log(`✓ Bug ${bug.value.id} marked as done\n`);

  // 7. Show final state
  const finalState = await store.materialize();
  if (finalState.ok) {
    console.log("📊 Final issue count by status:");
    const statusCounts = new Map<string, number>();

    for (const issue of finalState.value.issues.values()) {
      statusCounts.set(issue.status, (statusCounts.get(issue.status) || 0) + 1);
    }

    for (const [status, count] of statusCounts) {
      console.log(`  ${status}: ${count}`);
    }
  }

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
  console.log("\n✨ Example completed!");
}

// Run if executed directly
if (import.meta.main) {
  main().catch(console.error);
}
