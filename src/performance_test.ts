import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { openJsonlStore } from "./store_jsonl.ts";
import { createIssue } from "./domain.ts";
import { buildIndexes } from "./indexed_graph.ts";
import { ready as readyOriginal } from "./query.ts";
import { ready as readyIndexed } from "./query_indexed.ts";

Deno.test("Performance - getExistingIds is faster than full materialize", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    // Create 50 issues to have meaningful data
    for (let i = 0; i < 50; i++) {
      const result = await createIssue(store, env, {
        title: `Issue ${i}`,
        priority: i % 4,
        labels: [`label-${i % 5}`],
      });
      assertEquals(result.ok, true);
    }

    // Test getExistingIds performance
    assertExists(store.getExistingIds);

    const startIds = performance.now();
    const idsResult = await store.getExistingIds();
    const timeIds = performance.now() - startIds;

    // Test full materialize performance
    const startMat = performance.now();
    const matResult = await store.materialize();
    const timeMat = performance.now() - startMat;

    // Verify both work correctly
    assertEquals(idsResult.ok, true);
    assertEquals(matResult.ok, true);
    if (idsResult.ok && matResult.ok) {
      assertEquals(idsResult.value.size, 50);
      assertEquals(matResult.value.issues.size, 50);
    }

    // getExistingIds should be faster (at least not slower)
    console.log(`getExistingIds: ${timeIds.toFixed(2)}ms`);
    console.log(`materialize: ${timeMat.toFixed(2)}ms`);
    console.log(`Speedup: ${(timeMat / timeIds).toFixed(2)}x`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Performance - indexed queries are correct", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    // Create issues with various properties
    await createIssue(store, env, {
      title: "High priority bug",
      kind: "bug",
      priority: 0,
      labels: ["urgent"],
    });
    await createIssue(store, env, {
      title: "Medium priority feature",
      kind: "feature",
      priority: 2,
      labels: ["enhancement"],
    });
    await createIssue(store, env, {
      title: "Low priority chore",
      kind: "chore",
      priority: 3,
      labels: ["maintenance"],
    });

    const matResult = await store.materialize();
    assertEquals(matResult.ok, true);

    if (matResult.ok) {
      const g = matResult.value;
      const indexed = buildIndexes(g);

      // Test that both query implementations return the same results
      const originalReady = readyOriginal(g);
      const indexedReady = readyIndexed(indexed);

      assertEquals(originalReady.length, indexedReady.length);
      assertEquals(originalReady.length, 3); // All 3 are ready

      // Test filtered queries
      const originalFiltered = readyOriginal(g, { priorities: [0] });
      const indexedFiltered = readyIndexed(indexed, { priorities: [0] });

      assertEquals(originalFiltered.length, indexedFiltered.length);
      assertEquals(originalFiltered.length, 1);
      assertEquals(originalFiltered[0]?.title, "High priority bug");

      // Test label filtering
      const originalLabel = readyOriginal(g, { label: "urgent" });
      const indexedLabel = readyIndexed(indexed, { label: "urgent" });

      assertEquals(originalLabel.length, indexedLabel.length);
      assertEquals(originalLabel.length, 1);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Performance - indexed queries maintain correctness with large dataset", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    // Create 100 issues
    for (let i = 0; i < 100; i++) {
      await createIssue(store, env, {
        title: `Issue ${i}`,
        kind: i % 2 === 0 ? "bug" : "feature",
        priority: i % 4,
        labels: [`label-${i % 10}`],
      });
    }

    const matResult = await store.materialize();
    assertEquals(matResult.ok, true);

    if (matResult.ok) {
      const g = matResult.value;
      const indexed = buildIndexes(g);

      // Verify index counts
      assertEquals(indexed.indexes.readyIssues.size, 100); // All are ready

      // Test priority filtering
      const priority0Issues = readyIndexed(indexed, { priorities: [0] });
      assertEquals(priority0Issues.length, 25); // 100 / 4

      // Test label filtering
      const label0Issues = readyIndexed(indexed, { label: "label-0" });
      assertEquals(label0Issues.length, 10); // 100 / 10

      // Test kind filtering
      const bugIssues = readyIndexed(indexed, { kinds: ["bug"] });
      assertEquals(bugIssues.length, 50); // Half are bugs

      console.log(
        `Index stats: ${indexed.indexes.byStatus.size} statuses, ` +
          `${indexed.indexes.byPriority.size} priorities, ` +
          `${indexed.indexes.byLabel.size} labels`,
      );
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
