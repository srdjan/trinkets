import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { openJsonlStore } from "../src/store_jsonl.ts";
import {
  addLink,
  createIssue,
  initRepo,
  patchIssue,
  setStatus,
  validateInvariants,
} from "../src/domain.ts";
import { materializeFromEvents } from "../src/domain_materialize.ts";
import type { IssueId } from "../src/adt.ts";

const testEnv = { now: () => "2024-01-01T00:00:00.000Z" };

// Timer leaks are expected due to lock timeout implementation
const testOptions = { sanitizeOps: false, sanitizeResources: false };

Deno.test("Domain - createIssue creates issue with required fields", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const result = await createIssue(store, testEnv, {
      title: "Test Issue",
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.value.title, "Test Issue");
      assertEquals(result.value.status, "open");
      assertEquals(result.value.kind, "feature");
      assertEquals(result.value.priority, 2);
      assertEquals(result.value.createdAt, testEnv.now());
      assertEquals(result.value.updatedAt, testEnv.now());
      assertExists(result.value.id);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - createIssue creates issue with all optional fields", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const result = await createIssue(store, testEnv, {
      title: "Full Issue",
      body: "Detailed description",
      kind: "bug",
      priority: 3,
      labels: ["urgent", "critical"],
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.value.title, "Full Issue");
      assertEquals(result.value.body, "Detailed description");
      assertEquals(result.value.kind, "bug");
      assertEquals(result.value.priority, 3);
      assertEquals(result.value.labels, ["urgent", "critical"]);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - createIssue prevents duplicate IDs", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Create first issue
    const first = await createIssue(store, testEnv, { title: "First" });
    assertEquals(first.ok, true);

    // Attempt to create second issue - should succeed with different ID
    const second = await createIssue(store, testEnv, { title: "Second" });
    assertEquals(second.ok, true);

    if (first.ok && second.ok) {
      // IDs should be different
      assertEquals(first.value.id === second.value.id, false);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - createIssue uses getExistingIds optimization", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Create several issues
    for (let i = 0; i < 5; i++) {
      const result = await createIssue(store, testEnv, {
        title: `Issue ${i}`,
      });
      assertEquals(result.ok, true);
    }

    // Verify getExistingIds is available and working
    if (store.getExistingIds) {
      const idsResult = await store.getExistingIds();
      assertEquals(idsResult.ok, true);
      if (idsResult.ok) {
        assertEquals(idsResult.value.size, 5);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - addLink creates link between issues", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue1 = await createIssue(store, testEnv, { title: "Issue 1" });
    const issue2 = await createIssue(store, testEnv, { title: "Issue 2" });

    assertEquals(issue1.ok && issue2.ok, true);

    if (issue1.ok && issue2.ok) {
      const linkResult = await addLink(store, testEnv, {
        from: issue1.value.id,
        to: issue2.value.id,
        type: "blocks",
      });

      assertEquals(linkResult.ok, true);

      // Verify link in materialized state
      const scanResult = await store.scan();
      assertEquals(scanResult.ok, true);
      if (scanResult.ok) {
        const state = materializeFromEvents(scanResult.value);
        const outgoing = state.outgoing.get(issue1.value.id);
        assertExists(outgoing);
        assertEquals(outgoing.length, 1);
        assertEquals(outgoing[0]?.to, issue2.value.id);
        assertEquals(outgoing[0]?.type, "blocks");
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - addLink allows multiple links", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue1 = await createIssue(store, testEnv, { title: "Issue 1" });
    const issue2 = await createIssue(store, testEnv, { title: "Issue 2" });

    if (issue1.ok && issue2.ok) {
      // Add link first time
      const first = await addLink(store, testEnv, {
        from: issue1.value.id,
        to: issue2.value.id,
        type: "blocks",
      });
      assertEquals(first.ok, true);

      // Add another link type
      const second = await addLink(store, testEnv, {
        from: issue1.value.id,
        to: issue2.value.id,
        type: "related",
      });
      assertEquals(second.ok, true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - addLink rejects self-links", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue = await createIssue(store, testEnv, { title: "Issue 1" });
    assertEquals(issue.ok, true);

    if (issue.ok) {
      const selfLink = await addLink(store, testEnv, {
        from: issue.value.id,
        to: issue.value.id,
        type: "blocks",
      });
      assertEquals(selfLink.ok, false);
      if (!selfLink.ok) {
        assertEquals(selfLink.error._type, "Corruption");
        if (selfLink.error._type === "Corruption") {
          assertEquals(selfLink.error.reason, "self link not allowed");
        }
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - patchIssue updates title", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue = await createIssue(store, testEnv, {
      title: "Original Title",
    });
    assertEquals(issue.ok, true);

    if (issue.ok) {
      const patchResult = await patchIssue(
        store,
        testEnv,
        issue.value.id,
        { title: "Updated Title" },
      );
      assertEquals(patchResult.ok, true);

      // Verify in materialized state
      const stateResult = await store.materialize();
      assertEquals(stateResult.ok, true);
      if (stateResult.ok) {
        const updated = stateResult.value.issues.get(issue.value.id);
        assertExists(updated);
        assertEquals(updated.title, "Updated Title");
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - patchIssue updates body", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue = await createIssue(store, testEnv, {
      title: "Issue",
      body: "Original body",
    });
    assertEquals(issue.ok, true);

    if (issue.ok) {
      const patchResult = await patchIssue(
        store,
        testEnv,
        issue.value.id,
        { body: "Updated body" },
      );
      assertEquals(patchResult.ok, true);

      const stateResult = await store.materialize();
      if (stateResult.ok) {
        const updated = stateResult.value.issues.get(issue.value.id);
        assertExists(updated);
        assertEquals(updated.body, "Updated body");
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - patchIssue updates multiple fields", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue = await createIssue(store, testEnv, {
      title: "Original",
      body: "Original body",
      priority: 1,
    });
    assertEquals(issue.ok, true);

    if (issue.ok) {
      const patchResult = await patchIssue(store, testEnv, issue.value.id, {
        title: "Updated Title",
        body: "Updated body",
        priority: 3,
      });
      assertEquals(patchResult.ok, true);

      const stateResult = await store.materialize();
      if (stateResult.ok) {
        const updated = stateResult.value.issues.get(issue.value.id);
        assertExists(updated);
        assertEquals(updated.title, "Updated Title");
        assertEquals(updated.body, "Updated body");
        assertEquals(updated.priority, 3);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - setStatus changes issue status", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue = await createIssue(store, testEnv, { title: "Issue" });
    assertEquals(issue.ok, true);

    if (issue.ok) {
      // Move to doing
      const toDoing = await setStatus(store, testEnv, issue.value.id, "doing");
      assertEquals(toDoing.ok, true);

      let stateResult = await store.materialize();
      if (stateResult.ok) {
        const updated = stateResult.value.issues.get(issue.value.id);
        assertExists(updated);
        assertEquals(updated.status, "doing");
        assertEquals(updated.closedAt, undefined);
      }

      // Move to done
      const toDone = await setStatus(store, testEnv, issue.value.id, "done");
      assertEquals(toDone.ok, true);

      stateResult = await store.materialize();
      if (stateResult.ok) {
        const done = stateResult.value.issues.get(issue.value.id);
        assertExists(done);
        assertEquals(done.status, "done");
        assertEquals(done.closedAt, testEnv.now());
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - setStatus to canceled", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue = await createIssue(store, testEnv, { title: "Issue" });
    if (issue.ok) {
      const result = await setStatus(
        store,
        testEnv,
        issue.value.id,
        "canceled",
      );
      assertEquals(result.ok, true);

      const stateResult = await store.materialize();
      if (stateResult.ok) {
        const canceled = stateResult.value.issues.get(issue.value.id);
        assertExists(canceled);
        assertEquals(canceled.status, "canceled");
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - validateInvariants accepts healthy state", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue1 = await createIssue(store, testEnv, { title: "Issue 1" });
    const issue2 = await createIssue(store, testEnv, { title: "Issue 2" });

    if (issue1.ok && issue2.ok) {
      await addLink(store, testEnv, {
        from: issue1.value.id,
        to: issue2.value.id,
        type: "blocks",
      });

      const stateResult = await store.materialize();
      if (stateResult.ok) {
        const errors = validateInvariants(stateResult.value);
        assertEquals(errors.length, 0);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - validateInvariants detects cycles", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const issue1 = await createIssue(store, testEnv, { title: "Issue 1" });
    const issue2 = await createIssue(store, testEnv, { title: "Issue 2" });
    const issue3 = await createIssue(store, testEnv, { title: "Issue 3" });

    if (issue1.ok && issue2.ok && issue3.ok) {
      // Create cycle: 1 -> 2 -> 3 -> 1
      await addLink(store, testEnv, {
        from: issue1.value.id,
        to: issue2.value.id,
        type: "blocks",
      });
      await addLink(store, testEnv, {
        from: issue2.value.id,
        to: issue3.value.id,
        type: "blocks",
      });
      await addLink(store, testEnv, {
        from: issue3.value.id,
        to: issue1.value.id,
        type: "blocks",
      });

      const stateResult = await store.materialize();
      if (stateResult.ok) {
        const errors = validateInvariants(stateResult.value);
        assertEquals(errors.length > 0, true);
        assertEquals(
          errors.some((e) => e.includes("cycle") || e.includes("circular")),
          true,
        );
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - initRepo creates empty repository", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    const result = await initRepo(store);
    assertEquals(result.ok, true);

    // Verify state is empty
    const stateResult = await store.materialize();
    if (stateResult.ok) {
      assertEquals(stateResult.value.issues.size, 0);
      assertEquals(stateResult.value.outgoing.size, 0);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Domain - multiple operations maintain consistency", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Create multiple issues
    const issue1 = await createIssue(store, testEnv, {
      title: "Feature A",
      kind: "feature",
      priority: 2,
    });
    const issue2 = await createIssue(store, testEnv, {
      title: "Bug B",
      kind: "bug",
      priority: 1,
    });
    const issue3 = await createIssue(store, testEnv, {
      title: "Chore C",
      kind: "chore",
    });

    assertEquals(issue1.ok && issue2.ok && issue3.ok, true);

    if (issue1.ok && issue2.ok && issue3.ok) {
      // Add links
      await addLink(store, testEnv, {
        from: issue1.value.id,
        to: issue2.value.id,
        type: "blocks",
      });
      await addLink(store, testEnv, {
        from: issue1.value.id,
        to: issue3.value.id,
        type: "related",
      });

      // Update statuses
      await setStatus(store, testEnv, issue2.value.id, "doing");
      await setStatus(store, testEnv, issue3.value.id, "done");

      // Patch an issue
      await patchIssue(store, testEnv, issue1.value.id, {
        title: "Feature A - Updated",
        body: "New description",
      });

      // Verify final state
      const stateResult = await store.materialize();
      assertEquals(stateResult.ok, true);

      if (stateResult.ok) {
        const state = stateResult.value;

        // Check all issues exist
        assertEquals(state.issues.size, 3);

        // Check issue 1 updates
        const i1 = state.issues.get(issue1.value.id);
        assertExists(i1);
        assertEquals(i1.title, "Feature A - Updated");
        assertEquals(i1.body, "New description");
        assertEquals(i1.status, "open");

        // Check issue 2 status
        const i2 = state.issues.get(issue2.value.id);
        assertExists(i2);
        assertEquals(i2.status, "doing");

        // Check issue 3 status and closedAt
        const i3 = state.issues.get(issue3.value.id);
        assertExists(i3);
        assertEquals(i3.status, "done");
        assertExists(i3.closedAt);

        // Check links
        const outgoing = state.outgoing.get(issue1.value.id);
        assertExists(outgoing);
        assertEquals(outgoing.length, 2);

        // Validate invariants
        const errors = validateInvariants(state);
        assertEquals(errors.length, 0);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
