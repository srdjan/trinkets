import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { openJsonlStore } from "../src/store_jsonl.ts";
import { createIssue } from "../src/domain.ts";

const testEnv = { now: () => "2024-01-01T00:00:00.000Z" };
const testOptions = { sanitizeOps: false, sanitizeResources: false };

// ===== Concurrent Writes Test =====

Deno.test("Concurrency - Parallel issue creation", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Create 10 issues in parallel
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        createIssue(store, testEnv, {
          title: `Concurrent Issue ${i}`,
          priority: (i % 4) as 0 | 1 | 2 | 3,
        }),
      );
    }

    const results = await Promise.all(promises);

    // All should succeed
    for (const result of results) {
      assertEquals(result.ok, true);
    }

    // Verify all events were persisted
    const scanResult = await store.scan();
    assertEquals(scanResult.ok, true);
    if (scanResult.ok) {
      assertEquals(scanResult.value.length, 10);
    }

    // Verify all issues are in materialized state
    const stateResult = await store.materialize();
    if (stateResult.ok) {
      assertEquals(stateResult.value.issues.size, 10);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "Concurrency - Multiple stores same directory",
  testOptions,
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      // Open multiple store instances to same directory
      const store1 = await openJsonlStore({ baseDir: tempDir });
      const store2 = await openJsonlStore({ baseDir: tempDir });
      const store3 = await openJsonlStore({ baseDir: tempDir });

      // Write from all stores concurrently
      const promises = [
        createIssue(store1, testEnv, { title: "Store 1 Issue" }),
        createIssue(store2, testEnv, { title: "Store 2 Issue" }),
        createIssue(store3, testEnv, { title: "Store 3 Issue" }),
      ];

      const results = await Promise.all(promises);

      // All should succeed due to file locking
      for (const result of results) {
        assertEquals(result.ok, true);
      }

      // Verify all events are persisted
      const scanResult = await store1.scan();
      if (scanResult.ok) {
        assertEquals(scanResult.value.length, 3);
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test("Concurrency - Rapid sequential writes", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });

    // Write 50 issues as fast as possible
    for (let i = 0; i < 50; i++) {
      const result = await createIssue(store, testEnv, {
        title: `Rapid Issue ${i}`,
      });
      assertEquals(result.ok, true);
    }

    // Verify all persisted
    const scanResult = await store.scan();
    if (scanResult.ok) {
      assertEquals(scanResult.value.length, 50);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "Concurrency - Mixed read and write operations",
  testOptions,
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const store = await openJsonlStore({ baseDir: tempDir });

      // Create initial data
      for (let i = 0; i < 5; i++) {
        await createIssue(store, testEnv, { title: `Initial ${i}` });
      }

      // Mix reads and writes
      const operations = [];

      // Add 10 concurrent operations (5 writes, 5 reads)
      for (let i = 0; i < 5; i++) {
        operations.push(
          createIssue(store, testEnv, { title: `Concurrent ${i}` }),
        );
        operations.push(store.scan());
      }

      const results = await Promise.all(operations);

      // All operations should succeed
      for (const result of results) {
        assertEquals(result.ok, true);
      }

      // Final verification
      const finalScan = await store.scan();
      if (finalScan.ok) {
        assertEquals(finalScan.value.length, 10); // 5 initial + 5 concurrent
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);
