/**
 * Dependency Management Example
 *
 * This example demonstrates how to work with issue dependencies:
 * - Creating blocked/blocks relationships
 * - Understanding dependency resolution
 * - Querying ready vs blocked issues
 * - Detecting blocking chains
 *
 * Run with: deno run -A examples/dependency_management.ts
 */

import { openJsonlStore } from "../src/store_jsonl.ts";
import { createIssue, addLink, setStatus } from "../src/domain.ts";
import { ready, explainBlocked } from "../src/query.ts";

const env = { now: () => new Date().toISOString() };

async function main() {
  console.log("🔗 Trinkets Dependency Management Example\n");

  const tempDir = await Deno.makeTempDir();
  const store = await openJsonlStore({ baseDir: tempDir });

  // Create a dependency chain: UI -> API -> Database
  console.log("📝 Creating feature chain...\n");

  const database = await createIssue(store, env, {
    title: "Setup database schema",
    kind: "feature",
    priority: 3,
  });

  const api = await createIssue(store, env, {
    title: "Create REST API endpoints",
    kind: "feature",
    priority: 3,
  });

  const ui = await createIssue(store, env, {
    title: "Build user interface",
    kind: "feature",
    priority: 2,
  });

  if (!database.ok || !api.ok || !ui.ok) {
    console.error("❌ Failed to create issues");
    return;
  }

  console.log(`✓ Created: ${database.value.title}`);
  console.log(`✓ Created: ${api.value.title}`);
  console.log(`✓ Created: ${ui.value.title}\n`);

  // Create dependencies: UI is blocked by API, API is blocked by Database
  console.log("🔗 Creating dependency chain...\n");

  await addLink(store, env, {
    from: ui.value.id,
    to: api.value.id,
    type: "blocks", // UI is blocked by API
  });

  await addLink(store, env, {
    from: api.value.id,
    to: database.value.id,
    type: "blocks", // API is blocked by Database
  });

  console.log("✓ UI is blocked by API");
  console.log("✓ API is blocked by Database\n");

  // Query ready issues
  console.log("🔍 Checking what's ready to work on...\n");
  const state1 = await store.materialize();

  if (state1.ok) {
    const readyIssues = ready(state1.value);
    console.log(`Ready issues: ${readyIssues.length}`);

    for (const issue of readyIssues) {
      console.log(`  ✓ ${issue.title} (no blockers)`);
    }

    // Check what's blocking UI
    const uiIssue = state1.value.issues.get(ui.value.id);
    if (uiIssue) {
      const explanation = explainBlocked(state1.value, uiIssue);
      if (explanation) {
        console.log(`\n⛔ ${uiIssue.title} is blocked:`);
        console.log(`  ${explanation}`);
      }
    }
    console.log();
  }

  // Complete database feature
  console.log("✅ Completing database setup...\n");
  await setStatus(store, env, database.value.id, "done");

  // Check what's ready now
  const state2 = await store.materialize();
  if (state2.ok) {
    const readyNow = ready(state2.value);
    console.log("📊 After completing database:");
    console.log(`  Ready issues: ${readyNow.length}`);

    for (const issue of readyNow) {
      console.log(`    ✓ ${issue.title}`);
    }
    console.log();
  }

  // Complete API feature
  console.log("✅ Completing API endpoints...\n");
  await setStatus(store, env, api.value.id, "done");

  // Check final state
  const state3 = await store.materialize();
  if (state3.ok) {
    const finalReady = ready(state3.value);
    console.log("📊 After completing API:");
    console.log(`  Ready issues: ${finalReady.length}`);

    for (const issue of finalReady) {
      console.log(`    ✓ ${issue.title} (all blockers resolved!)`);
    }
  }

  // Demonstrate parent-child relationships
  console.log("\n👨‍👩‍👧 Creating epic with subtasks...\n");

  const epic = await createIssue(store, env, {
    title: "User Authentication System",
    kind: "epic",
    priority: 3,
  });

  const subtask1 = await createIssue(store, env, {
    title: "JWT token generation",
    kind: "feature",
  });

  const subtask2 = await createIssue(store, env, {
    title: "Password hashing",
    kind: "feature",
  });

  if (epic.ok && subtask1.ok && subtask2.ok) {
    await addLink(store, env, {
      from: epic.value.id,
      to: subtask1.value.id,
      type: "parent-child",
    });

    await addLink(store, env, {
      from: epic.value.id,
      to: subtask2.value.id,
      type: "parent-child",
    });

    console.log(`✓ Epic: ${epic.value.title}`);
    console.log(`  └─ Subtask: ${subtask1.value.title}`);
    console.log(`  └─ Subtask: ${subtask2.value.title}`);
  }

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
  console.log("\n✨ Example completed!");
}

if (import.meta.main) {
  main().catch(console.error);
}
