import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { openJsonlStore } from "../src/store_jsonl.ts";
import { createIssue } from "../src/domain.ts";
import { ok } from "../src/result.ts";
import { CircuitBreaker, retryable, withRetry } from "../src/retry.ts";
import {
  consoleObservability,
  instrument,
  MetricsAggregator,
} from "../src/observability.ts";
import {
  formatIntegrityReport,
  repairEvents,
  verifyIntegrity,
} from "../src/integrity.ts";
import {
  createBackup,
  exportToFile,
  importFromFile,
  validateBackup,
} from "../src/backup.ts";

const testOptions = { sanitizeOps: false, sanitizeResources: false };

Deno.test("Retry - withRetry retries on lock timeout", testOptions, async () => {
  let attempts = 0;

  const operation = async () => {
    attempts++;
    if (attempts < 3) {
      return {
        ok: false,
        error: {
          _type: "LockTimeout",
          path: "/test",
          timeoutMs: 100,
        },
      } as const;
    }
    return ok("success");
  };

  const result = await withRetry(operation, {
    maxAttempts: 5,
    initialDelayMs: 10,
    jitter: false,
  });

  assertEquals(result.ok, true);
  assertEquals(attempts, 3);
});

Deno.test("Retry - retryable wrapper works correctly", testOptions, async () => {
  let calls = 0;

  const unreliableOp = async (value: number) => {
    calls++;
    if (calls < 2) {
      return {
        ok: false,
        error: { _type: "LockTimeout", path: "/test", timeoutMs: 100 },
      } as const;
    }
    return ok(value * 2);
  };

  const reliableOp = retryable(unreliableOp, {
    maxAttempts: 3,
    initialDelayMs: 10,
  });

  const result = await reliableOp(5);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value, 10);
  }
});

Deno.test("CircuitBreaker - opens after threshold failures", testOptions, async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 3 });

  const failingOp = () =>
    Promise.resolve(
      {
        ok: false,
        error: { _type: "Corruption", path: "/test", reason: "error" },
      } as const,
    );

  // First 3 failures should work
  for (let i = 0; i < 3; i++) {
    const result = await breaker.execute(failingOp);
    assertEquals(result.ok, false);
  }

  assertEquals(breaker.getState(), "open");

  // 4th call should be rejected immediately
  const rejected = await breaker.execute(failingOp);
  assertEquals(rejected.ok, false);
  if (!rejected.ok) {
    assertEquals(rejected.error._type, "Corruption");
    if (rejected.error._type === "Corruption") {
      assertEquals(rejected.error.reason.includes("Circuit breaker"), true);
    }
  }
});

Deno.test("Observability - MetricsAggregator collects stats", testOptions, async () => {
  const metrics = new MetricsAggregator();

  await instrument(
    "test-op",
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "success";
    },
    metrics,
  );

  await instrument(
    "test-op",
    async () => {
      throw new Error("failure");
    },
    metrics,
  ).catch(() => {}); // Ignore error

  const stats = metrics.getMetrics();
  const testOpStats = stats.get("test-op");

  assertExists(testOpStats);
  assertEquals(testOpStats.count, 2);
  assertEquals(testOpStats.errorRate, 0.5);
});

Deno.test("Integrity - verifyIntegrity detects duplicate IDs", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    await createIssue(store, env, { title: "Issue 1" });

    const scanResult = await store.scan();
    assertEquals(scanResult.ok, true);

    if (scanResult.ok) {
      // Duplicate the first event to create an integrity issue
      const duplicated = [...scanResult.value, scanResult.value[0]!];

      const report = verifyIntegrity(duplicated);
      assertEquals(report.ok, true);

      if (report.ok) {
        assertEquals(report.value.healthy, false);
        assertEquals(report.value.issues.length > 0, true);

        const hasDuplicate = report.value.issues.some((issue) =>
          issue.type === "DuplicateIssueId"
        );
        assertEquals(hasDuplicate, true);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Integrity - repairEvents removes duplicates", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    await createIssue(store, env, { title: "Issue 1" });

    const scanResult = await store.scan();
    assertEquals(scanResult.ok, true);

    if (scanResult.ok) {
      // Create corrupted data with duplicate
      const corrupted = [...scanResult.value, scanResult.value[0]!];

      const repairResult = repairEvents(corrupted);
      assertEquals(repairResult.ok, true);

      if (repairResult.ok) {
        assertEquals(repairResult.value.removed, 1);
        assertEquals(repairResult.value.events.length, 1);
        assertEquals(repairResult.value.issues.length > 0, true);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Integrity - formatIntegrityReport produces readable output", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    await createIssue(store, env, { title: "Test" });

    const scanResult = await store.scan();
    assertEquals(scanResult.ok, true);

    if (scanResult.ok) {
      const report = verifyIntegrity(scanResult.value);
      assertEquals(report.ok, true);

      if (report.ok) {
        const formatted = formatIntegrityReport(report.value);
        assertEquals(formatted.includes("Data Integrity Report"), true);
        assertEquals(formatted.includes("HEALTHY"), true);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Backup - createBackup includes metadata", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    await createIssue(store, env, { title: "Issue 1" });
    await createIssue(store, env, { title: "Issue 2" });

    const scanResult = await store.scan();
    assertEquals(scanResult.ok, true);

    if (scanResult.ok) {
      const backup = createBackup(scanResult.value, "1.0");

      assertEquals(backup.metadata.version, "1.0");
      assertEquals(backup.metadata.eventCount, 2);
      assertEquals(backup.events.length, 2);
      assertExists(backup.metadata.timestamp);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Backup - validateBackup detects invalid format", () => {
  const invalidBackup = { wrong: "format" };

  const result = validateBackup(invalidBackup);
  assertEquals(result.ok, false);
});

Deno.test("Backup - export and import roundtrip works", testOptions, async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    // Create test data
    await createIssue(store, env, { title: "Issue 1" });
    await createIssue(store, env, { title: "Issue 2" });

    const scanResult = await store.scan();
    assertEquals(scanResult.ok, true);

    if (scanResult.ok) {
      const backupPath = `${tempDir}/backup.json`;

      // Export
      const exportResult = await exportToFile(
        scanResult.value,
        backupPath,
        "1.0",
      );
      assertEquals(exportResult.ok, true);

      // Import
      const importResult = await importFromFile(backupPath);
      assertEquals(importResult.ok, true);

      if (importResult.ok) {
        assertEquals(importResult.value.length, 2);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
