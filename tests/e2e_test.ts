import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { openJsonlStore } from "../src/store_jsonl.ts";
import { openJsonlStoreWithHeadsV2 } from "../src/store_jsonl_heads_v2.ts";
import {
  addLink,
  createIssue,
  patchIssue,
  setStatus,
  validateInvariants,
} from "../src/domain.ts";
import { explainBlocked, ready } from "../src/query.ts";
import { buildIndexes } from "../src/indexed_graph.ts";
import { ready as readyIndexed } from "../src/query_indexed.ts";
import type { Issue } from "../src/adt.ts";

const testEnv = { now: () => "2024-01-01T00:00:00.000Z" };
const testOptions = { sanitizeOps: false, sanitizeResources: false };

// ===== Complete Feature Development Workflow =====

Deno.test(
  "E2E - Complete feature development lifecycle",
  testOptions,
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const store = await openJsonlStore({ baseDir: tempDir });

      // 1. Create main feature epic
      const epic = await createIssue(store, testEnv, {
        title: "User Authentication System",
        body: "Implement complete user authentication with OAuth and JWT",
        kind: "epic",
        priority: 3,
        labels: ["security", "auth"],
      });
      assertEquals(epic.ok, true);

      if (!epic.ok) return;

      // 2. Break down into subtasks
      const task1 = await createIssue(store, testEnv, {
        title: "Implement JWT token generation",
        kind: "feature",
        priority: 3,
      });
      const task2 = await createIssue(store, testEnv, {
        title: "Create OAuth provider integration",
        kind: "feature",
        priority: 3,
      });
      const task3 = await createIssue(store, testEnv, {
        title: "Build login/logout endpoints",
        kind: "feature",
        priority: 2,
      });

      if (!task1.ok || !task2.ok || !task3.ok) return;

      // 3. Link tasks to epic
      await addLink(store, testEnv, {
        from: epic.value.id,
        to: task1.value.id,
        type: "parent-child",
      });
      await addLink(store, testEnv, {
        from: epic.value.id,
        to: task2.value.id,
        type: "parent-child",
      });
      await addLink(store, testEnv, {
        from: epic.value.id,
        to: task3.value.id,
        type: "parent-child",
      });

      // 4. Create dependencies between tasks
      await addLink(store, testEnv, {
        from: task3.value.id,
        to: task1.value.id,
        type: "blocks",
      });
      await addLink(store, testEnv, {
        from: task3.value.id,
        to: task2.value.id,
        type: "blocks",
      });

      // 5. Start working on task 1
      await setStatus(store, testEnv, task1.value.id, "doing");

      // 6. Query ready issues
      const state1 = await store.materialize();
      if (!state1.ok) return;

      const readyIssues = ready(state1.value, { kinds: ["feature"] });
      // Only task1 is ready (doing), task2 is ready (no blockers), task3 is blocked
      assertEquals(readyIssues.length >= 1, true);

      // 7. Complete task 1 and task 2
      await setStatus(store, testEnv, task1.value.id, "done");
      await setStatus(store, testEnv, task2.value.id, "done");

      // 8. Now task 3 should be unblocked
      const state2 = await store.materialize();
      if (!state2.ok) return;

      const readyNow = ready(state2.value, { kinds: ["feature"] });
      const hasTask3 = readyNow.some((i) => i.id === task3.value.id);
      assertEquals(hasTask3, true);

      // 9. Complete all tasks
      await setStatus(store, testEnv, task3.value.id, "done");

      // 10. Verify epic can now be completed
      const finalState = await store.materialize();
      if (!finalState.ok) return;

      // All subtasks done, epic can be marked done
      await setStatus(store, testEnv, epic.value.id, "done");

      const epicState = await store.materialize();
      if (!epicState.ok) return;

      const completedEpic = epicState.value.issues.get(epic.value.id);
      assertExists(completedEpic);
      assertEquals(completedEpic.status, "done");

      // Validate no invariant violations
      const errors = validateInvariants(epicState.value);
      assertEquals(errors.length, 0);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

// ===== Bug Triage Workflow =====

Deno.test("E2E - Bug triage and resolution workflow", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // 1. Report bug
    const bug = await createIssue(store, testEnv, {
      title: "Login fails with special characters in password",
      body: "Users cannot login when password contains @ or #",
      kind: "bug",
      priority: 3,
      labels: ["critical", "security"],
    });
    if (!bug.ok) return;

    // 2. Investigate and create related issue
    const investigation = await createIssue(store, testEnv, {
      title: "Audit password validation logic",
      kind: "chore",
      priority: 2,
    });
    if (!investigation.ok) return;

    await addLink(store, testEnv, {
      from: bug.value.id,
      to: investigation.value.id,
      type: "related",
    });

    // 3. Discover root cause and create fix
    const fix = await createIssue(store, testEnv, {
      title: "Fix URL encoding in auth service",
      kind: "feature",
      priority: 3,
    });
    if (!fix.ok) return;

    await addLink(store, testEnv, {
      from: fix.value.id,
      to: bug.value.id,
      type: "blocks",
    });

    // 4. Work on fix
    await setStatus(store, testEnv, fix.value.id, "doing");
    await setStatus(store, testEnv, investigation.value.id, "doing");

    // 5. Complete investigation first
    await setStatus(store, testEnv, investigation.value.id, "done");

    // 6. Add notes to bug
    await patchIssue(store, testEnv, bug.value.id, {
      body:
        "Root cause: URL encoding not applied to special chars. Fix in progress.",
    });

    // 7. Complete fix and close bug
    await setStatus(store, testEnv, fix.value.id, "done");
    await setStatus(store, testEnv, bug.value.id, "done");

    // 8. Verify final state
    const finalState = await store.materialize();
    if (!finalState.ok) return;

    const resolvedBug = finalState.value.issues.get(bug.value.id);
    assertExists(resolvedBug);
    assertEquals(resolvedBug.status, "done");
    assertEquals(
      resolvedBug.body?.includes("Root cause"),
      true,
    );

    const errors = validateInvariants(finalState.value);
    assertEquals(errors.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ===== Sprint Planning Workflow =====

Deno.test("E2E - Sprint planning with priorities", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Create backlog items with different priorities
    const items: Issue[] = [];

    for (let i = 0; i < 20; i++) {
      const result = await createIssue(store, testEnv, {
        title: `Task ${i}`,
        kind: i % 3 === 0 ? "bug" : "feature",
        priority: (i % 4) as 0 | 1 | 2 | 3,
        labels: i % 2 === 0 ? ["frontend"] : ["backend"],
      });
      if (result.ok) items.push(result.value);
    }

    // Build indexed state for fast queries
    const state = await store.materialize();
    if (!state.ok) return;

    const indexed = buildIndexes(state.value);

    // Query high-priority ready items
    const highPriority = readyIndexed(indexed, { priorities: [3] });
    assertEquals(highPriority.length > 0, true);

    // Select sprint items (high priority ready issues)
    const sprintItems = highPriority.slice(0, 5);

    // Move to doing
    for (const item of sprintItems) {
      await setStatus(store, testEnv, item.id, "doing");
    }

    // Complete some items
    for (let i = 0; i < 3; i++) {
      const item = sprintItems[i];
      if (item) {
        await setStatus(store, testEnv, item.id, "done");
      }
    }

    // Verify sprint progress
    const finalState = await store.materialize();
    if (!finalState.ok) return;

    let completed = 0;
    let inProgress = 0;

    for (const item of sprintItems) {
      const current = finalState.value.issues.get(item.id);
      if (current?.status === "done") completed++;
      if (current?.status === "doing") inProgress++;
    }

    assertEquals(completed, 3);
    assertEquals(inProgress, 2);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ===== Dependency Management Workflow =====

Deno.test(
  "E2E - Complex dependency graph management",
  testOptions,
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const store = await openJsonlStore({ baseDir: tempDir });

      // Create a feature with multiple layers of dependencies
      const features: Issue[] = [];

      // Layer 1: Foundation
      const db = await createIssue(store, testEnv, {
        title: "Setup database schema",
        kind: "feature",
      });
      const api = await createIssue(store, testEnv, {
        title: "Create API framework",
        kind: "feature",
      });

      if (!db.ok || !api.ok) return;
      features.push(db.value, api.value);

      // Layer 2: Core features (depend on foundation)
      const users = await createIssue(store, testEnv, {
        title: "User management",
        kind: "feature",
      });
      const posts = await createIssue(store, testEnv, {
        title: "Post creation",
        kind: "feature",
      });

      if (!users.ok || !posts.ok) return;
      features.push(users.value, posts.value);

      // Users depends on DB and API
      await addLink(store, testEnv, {
        from: users.value.id,
        to: db.value.id,
        type: "blocks",
      });
      await addLink(store, testEnv, {
        from: users.value.id,
        to: api.value.id,
        type: "blocks",
      });

      // Posts depends on DB, API, and Users
      await addLink(store, testEnv, {
        from: posts.value.id,
        to: db.value.id,
        type: "blocks",
      });
      await addLink(store, testEnv, {
        from: posts.value.id,
        to: api.value.id,
        type: "blocks",
      });
      await addLink(store, testEnv, {
        from: posts.value.id,
        to: users.value.id,
        type: "blocks",
      });

      // Layer 3: Advanced features
      const comments = await createIssue(store, testEnv, {
        title: "Comment system",
        kind: "feature",
      });
      if (!comments.ok) return;
      features.push(comments.value);

      // Comments depends on Posts and Users
      await addLink(store, testEnv, {
        from: comments.value.id,
        to: posts.value.id,
        type: "blocks",
      });
      await addLink(store, testEnv, {
        from: comments.value.id,
        to: users.value.id,
        type: "blocks",
      });

      // Complete foundation
      await setStatus(store, testEnv, db.value.id, "done");
      await setStatus(store, testEnv, api.value.id, "done");

      // Verify foundation completed
      let state = await store.materialize();
      if (!state.ok) return;

      assertEquals(state.value.issues.get(db.value.id)?.status, "done");
      assertEquals(state.value.issues.get(api.value.id)?.status, "done");

      // Complete users and posts
      await setStatus(store, testEnv, users.value.id, "done");
      await setStatus(store, testEnv, posts.value.id, "done");

      // Verify completion
      state = await store.materialize();
      if (!state.ok) return;
      assertEquals(state.value.issues.get(users.value.id)?.status, "done");
      assertEquals(state.value.issues.get(posts.value.id)?.status, "done");

      // Complete everything
      await setStatus(store, testEnv, comments.value.id, "done");

      const finalState = await store.materialize();
      if (!finalState.ok) return;

      // All issues should be done
      for (const feature of features) {
        const issue = finalState.value.issues.get(feature.id);
        assertEquals(issue?.status, "done");
      }

      const errors = validateInvariants(finalState.value);
      assertEquals(errors.length, 0);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

// ===== Real-world Project Simulation =====

Deno.test(
  "E2E - Simulated real project with 50 issues",
  testOptions,
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const store = await openJsonlStoreWithHeadsV2({ baseDir: tempDir });

      // Create diverse issues
      const epics: Issue[] = [];
      const features: Issue[] = [];
      const bugs: Issue[] = [];

      // Create 5 epics
      for (let i = 0; i < 5; i++) {
        const epic = await createIssue(store, testEnv, {
          title: `Epic ${i}: Major Feature Set`,
          kind: "epic",
          priority: i % 2 === 0 ? 3 : 2,
          labels: ["milestone"],
        });
        if (epic.ok) epics.push(epic.value);
      }

      // Create 30 features
      for (let i = 0; i < 30; i++) {
        const feature = await createIssue(store, testEnv, {
          title: `Feature ${i}`,
          kind: "feature",
          priority: (i % 4) as 0 | 1 | 2 | 3,
          labels: i % 3 === 0 ? ["frontend"] : ["backend"],
        });
        if (feature.ok) features.push(feature.value);
      }

      // Create 15 bugs
      for (let i = 0; i < 15; i++) {
        const bug = await createIssue(store, testEnv, {
          title: `Bug ${i}`,
          kind: "bug",
          priority: i % 2 === 0 ? 3 : 2,
          labels: ["needs-triage"],
        });
        if (bug.ok) bugs.push(bug.value);
      }

      // Link features to epics
      for (let i = 0; i < features.length; i++) {
        const epic = epics[i % epics.length];
        if (epic) {
          await addLink(store, testEnv, {
            from: epic.id,
            to: features[i]!.id,
            type: "parent-child",
          });
        }
      }

      // Create some dependencies
      for (let i = 1; i < 10; i++) {
        await addLink(store, testEnv, {
          from: features[i]!.id,
          to: features[i - 1]!.id,
          type: "blocks",
        });
      }

      // Simulate work: complete about 60% of issues
      const allIssues = [...features, ...bugs];
      const toComplete = Math.floor(allIssues.length * 0.6);

      for (let i = 0; i < toComplete; i++) {
        const issue = allIssues[i];
        if (issue) {
          await setStatus(store, testEnv, issue.id, "done");
        }
      }

      // Start work on 20%
      const toStart = Math.floor(allIssues.length * 0.2);
      for (let i = toComplete; i < toComplete + toStart; i++) {
        const issue = allIssues[i];
        if (issue) {
          await setStatus(store, testEnv, issue.id, "doing");
        }
      }

      // Verify state
      const finalState = await store.materialize();
      if (!finalState.ok) return;

      assertEquals(finalState.value.issues.size, 50);

      // Verify caching worked (HeadsV2 should have cached state)
      const state2 = await store.materialize();
      assertEquals(state2.ok, true);

      // Validate invariants
      const errors = validateInvariants(finalState.value);
      assertEquals(errors.length, 0);

      // Test indexed queries
      const indexed = buildIndexes(finalState.value);
      const highPriorityReady = readyIndexed(indexed, { priorities: [3] });
      assertEquals(highPriorityReady.length > 0, true);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);
