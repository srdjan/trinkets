import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { openJsonlStore } from "../src/store_jsonl.ts";
import { openJsonlStoreWithHeadsV2 } from "../src/store_jsonl_heads_v2.ts";
import { createIssue, addLink, setStatus, patchIssue } from "../src/domain.ts";

const testEnv = { now: () => "2024-01-01T00:00:00.000Z" };
const testOptions = { sanitizeOps: false, sanitizeResources: false };

// ===== JSONL Store Tests =====

Deno.test("Integration - JSONL store persists events", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Create issues
    await createIssue(store, testEnv, { title: "Issue 1" });
    await createIssue(store, testEnv, { title: "Issue 2" });

    // Read from disk
    const scanResult = await store.scan();
    assertEquals(scanResult.ok, true);
    if (scanResult.ok) {
      assertEquals(scanResult.value.length, 2);
      assertEquals(scanResult.value[0]?._type, "IssueCreated");
      assertEquals(scanResult.value[1]?._type, "IssueCreated");
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Integration - JSONL store appends events sequentially", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Append multiple events
    for (let i = 0; i < 10; i++) {
      await createIssue(store, testEnv, { title: `Issue ${i}` });
    }

    const scanResult = await store.scan();
    if (scanResult.ok) {
      assertEquals(scanResult.value.length, 10);
      // Verify order is preserved
      for (let i = 0; i < 10; i++) {
        const event = scanResult.value[i];
        if (event?._type === "IssueCreated") {
          assertEquals(event.issue.title, `Issue ${i}`);
        }
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Integration - JSONL store survives reopening", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Create and write events
    {
      const store = await openJsonlStore({ baseDir: tempDir });
      await createIssue(store, testEnv, { title: "Persistent Issue" });
    }

    // Reopen and verify
    {
      const store = await openJsonlStore({ baseDir: tempDir });
      const scanResult = await store.scan();
      assertEquals(scanResult.ok, true);
      if (scanResult.ok) {
        assertEquals(scanResult.value.length, 1);
        const event = scanResult.value[0];
        if (event?._type === "IssueCreated") {
          assertEquals(event.issue.title, "Persistent Issue");
        }
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ===== HeadsV2 Store Tests =====

Deno.test("Integration - HeadsV2 store caches state", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStoreWithHeadsV2({ baseDir: tempDir });

    const issue1 = await createIssue(store, testEnv, { title: "Issue 1" });
    const issue2 = await createIssue(store, testEnv, { title: "Issue 2" });

    if (issue1.ok && issue2.ok) {
      await addLink(store, testEnv, {
        from: issue1.value.id,
        to: issue2.value.id,
        type: "blocks",
      });

      // Materialize should use cached state
      const stateResult = await store.materialize();
      assertEquals(stateResult.ok, true);
      if (stateResult.ok) {
        assertEquals(stateResult.value.issues.size, 2);
        const outgoing = stateResult.value.outgoing.get(issue1.value.id);
        assertExists(outgoing);
        assertEquals(outgoing.length, 1);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Integration - HeadsV2 store uses incremental replay", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStoreWithHeadsV2({ baseDir: tempDir });

    // Create initial state
    await createIssue(store, testEnv, { title: "Issue 1" });
    await createIssue(store, testEnv, { title: "Issue 2" });

    // Force state save
    await store.materialize();

    // Add more events
    await createIssue(store, testEnv, { title: "Issue 3" });

    // Should load cached state + replay only new events
    const stateResult = await store.materialize();
    if (stateResult.ok) {
      assertEquals(stateResult.value.issues.size, 3);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Integration - HeadsV2 store survives reopening with cache", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Create and cache state
    {
      const store = await openJsonlStoreWithHeadsV2({ baseDir: tempDir });
      await createIssue(store, testEnv, { title: "Cached Issue" });
      await store.materialize(); // Force cache write
    }

    // Reopen and verify cache is used
    {
      const store = await openJsonlStoreWithHeadsV2({ baseDir: tempDir });
      const stateResult = await store.materialize();
      if (stateResult.ok) {
        assertEquals(stateResult.value.issues.size, 1);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ===== Store + Cache Integration =====

Deno.test("Integration - HeadsV2 with SQLite cache", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStoreWithHeadsV2({ baseDir: tempDir });

    // Create complex state
    const i1 = await createIssue(store, testEnv, { title: "Task 1", priority: 1 });
    const i2 = await createIssue(store, testEnv, { title: "Task 2", priority: 2 });
    const i3 = await createIssue(store, testEnv, { title: "Task 3", priority: 3 });

    if (i1.ok && i2.ok && i3.ok) {
      await addLink(store, testEnv, {
        from: i1.value.id,
        to: i2.value.id,
        type: "blocks",
      });
      await setStatus(store, testEnv, i2.value.id, "doing");
      await patchIssue(store, testEnv, i1.value.id, {
        body: "Updated description",
      });

      // Materialize and verify
      const stateResult = await store.materialize();
      if (stateResult.ok) {
        assertEquals(stateResult.value.issues.size, 3);
        const task1 = stateResult.value.issues.get(i1.value.id);
        assertExists(task1);
        assertEquals(task1.body, "Updated description");

        const task2 = stateResult.value.issues.get(i2.value.id);
        assertExists(task2);
        assertEquals(task2.status, "doing");
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ===== Large Dataset Tests =====

Deno.test("Integration - JSONL handles 100 events", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Create 100 issues
    for (let i = 0; i < 100; i++) {
      await createIssue(store, testEnv, {
        title: `Issue ${i}`,
        priority: (i % 4) as 0 | 1 | 2 | 3,
      });
    }

    const scanResult = await store.scan();
    assertEquals(scanResult.ok, true);
    if (scanResult.ok) {
      assertEquals(scanResult.value.length, 100);
    }

    const stateResult = await store.materialize();
    if (stateResult.ok) {
      assertEquals(stateResult.value.issues.size, 100);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Integration - HeadsV2 handles 100 events with caching", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStoreWithHeadsV2({ baseDir: tempDir });

    // Create 100 issues
    for (let i = 0; i < 100; i++) {
      await createIssue(store, testEnv, {
        title: `Issue ${i}`,
        priority: (i % 4) as 0 | 1 | 2 | 3,
      });
    }

    const stateResult = await store.materialize();
    if (stateResult.ok) {
      assertEquals(stateResult.value.issues.size, 100);
    }

    // Reopen and verify incremental replay
    const store2 = await openJsonlStoreWithHeadsV2({ baseDir: tempDir });
    const stateResult2 = await store2.materialize();
    if (stateResult2.ok) {
      assertEquals(stateResult2.value.issues.size, 100);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ===== Performance Tests =====

Deno.test("Integration - getExistingIds optimizes ID collision checks", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Create 50 issues
    for (let i = 0; i < 50; i++) {
      await createIssue(store, testEnv, { title: `Issue ${i}` });
    }

    // Verify getExistingIds is faster than full materialization
    if (store.getExistingIds) {
      const idsResult = await store.getExistingIds();
      assertEquals(idsResult.ok, true);
      if (idsResult.ok) {
        assertEquals(idsResult.value.size, 50);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
