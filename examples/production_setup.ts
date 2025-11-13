/**
 * Production Setup Example
 *
 * This example demonstrates production-grade features:
 * - Retry with exponential backoff
 * - Circuit breaker pattern
 * - Observability hooks
 * - Caching with KV store
 * - Error handling best practices
 *
 * Run with: deno run -A --unstable-kv examples/production_setup.ts
 */

import { openJsonlStoreWithHeadsV2 } from "../src/store_jsonl_heads_v2.ts";
import { createIssue, setStatus } from "../src/domain.ts";
import { ready } from "../src/query.ts";
import { retryable, CircuitBreaker } from "../src/retry.ts";
import {
  consoleObservability,
  instrument,
  MetricsAggregator,
} from "../src/observability.ts";
import { openKvCache } from "../src/cache_kv.ts";

const env = { now: () => new Date().toISOString() };

async function main() {
  console.log("🏭 Trinkets Production Setup Example\n");

  const tempDir = await Deno.makeTempDir();

  // 1. Setup production store with caching
  console.log("⚙️  Setting up production store with KV cache...\n");

  const cache = await openKvCache({
    path: `${tempDir}/cache.db`,
    namespace: "trinkets-prod",
  });

  const store = await openJsonlStoreWithHeadsV2({
    baseDir: tempDir,
    cache,
    version: "v1.0", // Version for cache invalidation
  });

  console.log("✓ Store initialized with caching enabled\n");

  // 2. Setup observability
  console.log("📊 Setting up observability...\n");

  const metrics = new MetricsAggregator();

  // Create instrumented version of createIssue
  const createIssueWithMetrics = async (
    title: string,
    kind: "bug" | "feature" | "chore" | "epic",
  ) => {
    return await instrument(
      `create-${kind}`,
      () => createIssue(store, env, { title, kind }),
      metrics,
    );
  };

  // 3. Create issues with metrics
  console.log("📝 Creating issues (with observability)...\n");

  const bug = await createIssueWithMetrics(
    "Critical production bug",
    "bug",
  );
  const feature = await createIssueWithMetrics(
    "New feature request",
    "feature",
  );
  const chore = await createIssueWithMetrics(
    "Update documentation",
    "chore",
  );

  if (!bug.ok || !feature.ok || !chore.ok) {
    console.error("❌ Failed to create issues");
    return;
  }

  console.log("✓ Created 3 issues with metrics tracking\n");

  // 4. View metrics
  console.log("📈 Operation metrics:");
  const stats = metrics.getMetrics();

  for (const [operation, opStats] of stats) {
    console.log(`  ${operation}:`);
    console.log(`    Total calls: ${opStats.count}`);
    console.log(`    Avg duration: ${opStats.avgDuration.toFixed(2)}ms`);
    console.log(`    Error rate: ${(opStats.errorRate * 100).toFixed(1)}%`);
  }
  console.log();

  // 5. Setup circuit breaker for resilience
  console.log("🔌 Demonstrating circuit breaker...\n");

  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 5000,
  });

  // Simulate an operation that might fail
  const unreliableOperation = async (shouldFail: boolean) => {
    if (shouldFail) {
      return {
        ok: false,
        error: {
          _type: "Corruption" as const,
          path: "/test",
          reason: "Simulated failure",
        },
      };
    }
    return { ok: true as const, value: "success" };
  };

  // Test circuit breaker
  console.log("Testing circuit breaker with failures...");

  for (let i = 0; i < 5; i++) {
    const result = await breaker.execute(() => unreliableOperation(i < 3));

    if (result.ok) {
      console.log(`  Attempt ${i + 1}: ✓ Success`);
    } else {
      console.log(`  Attempt ${i + 1}: ✗ Failed`);
    }
  }

  console.log(`Circuit breaker state: ${breaker.getState()}\n`);

  // 6. Setup retry with exponential backoff
  console.log("🔄 Demonstrating retry with exponential backoff...\n");

  let attemptCount = 0;
  const unreliableWithRetry = retryable(
    async () => {
      attemptCount++;
      console.log(`  Retry attempt ${attemptCount}...`);

      // Succeed on 3rd attempt
      if (attemptCount < 3) {
        return {
          ok: false,
          error: {
            _type: "LockTimeout" as const,
            path: "/test",
            timeoutMs: 100,
          },
        };
      }

      return { ok: true as const, value: "success after retries" };
    },
    {
      maxAttempts: 5,
      initialDelayMs: 100,
      jitter: true,
    },
  );

  const retryResult = await unreliableWithRetry();
  if (retryResult.ok) {
    console.log(`✓ Operation succeeded after ${attemptCount} attempts\n`);
  }

  // 7. Demonstrate cache effectiveness
  console.log("💾 Testing cache performance...\n");

  console.log("First materialize (cache miss):");
  const start1 = Date.now();
  const state1 = await store.materialize();
  const duration1 = Date.now() - start1;
  console.log(`  Duration: ${duration1}ms\n`);

  console.log("Second materialize (cache hit):");
  const start2 = Date.now();
  const state2 = await store.materialize();
  const duration2 = Date.now() - start2;
  console.log(`  Duration: ${duration2}ms`);
  console.log(
    `  Speedup: ${(duration1 / Math.max(duration2, 1)).toFixed(1)}x\n`,
  );

  // 8. Console observability for debugging
  console.log("🐛 Using console observability for debugging...\n");

  const debugObs = consoleObservability();

  await instrument(
    "debug-operation",
    async () => {
      if (!bug.ok) return;
      await setStatus(store, env, bug.value.id, "doing");
      return "completed";
    },
    debugObs,
  );

  // 9. Error handling patterns
  console.log("\n🚨 Error handling patterns...\n");

  // Attempt to create issue with invalid data
  const invalidIssue = await createIssue(store, env, {
    title: "", // Empty title should fail validation
    kind: "bug",
  });

  if (!invalidIssue.ok) {
    console.log("✓ Gracefully handled invalid input");
    console.log(`  Error: ${invalidIssue.error._type}\n`);
  }

  // 10. Final statistics
  console.log("📊 Final Statistics:\n");

  if (state1.ok) {
    const readyIssues = ready(state1.value);
    console.log(`Total issues: ${state1.value.issues.size}`);
    console.log(`Ready to work on: ${readyIssues.length}`);
    console.log(`Links: ${state1.value.links.size}`);
  }

  console.log("\n✅ Production features demonstrated:");
  console.log("  ✓ KV caching for performance");
  console.log("  ✓ Metrics aggregation");
  console.log("  ✓ Circuit breaker resilience");
  console.log("  ✓ Retry with exponential backoff");
  console.log("  ✓ Console observability");
  console.log("  ✓ Type-safe error handling");

  // Cleanup
  cache.close();
  await Deno.remove(tempDir, { recursive: true });
  console.log("\n✨ Example completed!");
}

if (import.meta.main) {
  main().catch(console.error);
}
