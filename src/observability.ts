/**
 * Observability and telemetry hooks for production monitoring.
 * Consumers can implement these interfaces to plug in their own
 * metrics, logging, and tracing systems.
 */

import type { Event, GraphState } from "./adt.ts";
import type { StoreError } from "./ports.ts";

/**
 * Operation metrics for monitoring performance and health.
 */
export type OperationMetrics = {
  readonly operation: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
};

/**
 * Store operation events for detailed monitoring.
 */
export type StoreOperation =
  | { type: "append"; event: Event }
  | { type: "scan"; eventCount: number }
  | { type: "materialize"; issueCount: number; linkCount: number }
  | { type: "getExistingIds"; idCount: number };

/**
 * Observability hook interface.
 * Implement this to integrate with your monitoring system.
 */
export type ObservabilityHook = {
  /**
   * Called when an operation starts.
   * Returns a function to call when the operation completes.
   */
  readonly onOperationStart?: (
    operation: string,
    metadata?: Record<string, unknown>,
  ) => (success: boolean, error?: string) => void;

  /**
   * Called when an operation completes with metrics.
   */
  readonly onOperationComplete?: (metrics: OperationMetrics) => void;

  /**
   * Called when a store operation occurs.
   */
  readonly onStoreOperation?: (operation: StoreOperation) => void;

  /**
   * Called when an error occurs.
   */
  readonly onError?: (
    operation: string,
    error: StoreError,
    context?: Record<string, unknown>,
  ) => void;

  /**
   * Called when state is materialized.
   */
  readonly onStateChange?: (state: GraphState) => void;
};

/**
 * No-op observability hook (default).
 */
export const noopObservability: ObservabilityHook = {};

/**
 * Console-based observability hook for development.
 */
export function consoleObservability(): ObservabilityHook {
  return {
    onOperationComplete: (metrics: OperationMetrics) => {
      const status = metrics.success ? "✓" : "✗";
      const duration = metrics.durationMs.toFixed(2);
      console.log(
        `${status} ${metrics.operation} (${duration}ms)`,
        metrics.error ? `- ${metrics.error}` : "",
      );
    },
    onError: (operation: string, error: StoreError) => {
      console.error(`Error in ${operation}:`, error);
    },
  };
}

/**
 * Metrics aggregator for collecting operation statistics.
 */
export class MetricsAggregator implements ObservabilityHook {
  private readonly metrics: Map<string, {
    count: number;
    totalDurationMs: number;
    errors: number;
  }> = new Map();

  onOperationComplete = (metrics: OperationMetrics): void => {
    const current = this.metrics.get(metrics.operation) ?? {
      count: 0,
      totalDurationMs: 0,
      errors: 0,
    };

    this.metrics.set(metrics.operation, {
      count: current.count + 1,
      totalDurationMs: current.totalDurationMs + metrics.durationMs,
      errors: current.errors + (metrics.success ? 0 : 1),
    });
  };

  getMetrics(): ReadonlyMap<
    string,
    { count: number; avgDurationMs: number; errorRate: number }
  > {
    const result = new Map<
      string,
      { count: number; avgDurationMs: number; errorRate: number }
    >();

    for (const [operation, stats] of this.metrics) {
      result.set(operation, {
        count: stats.count,
        avgDurationMs: stats.totalDurationMs / stats.count,
        errorRate: stats.errors / stats.count,
      });
    }

    return result;
  }

  reset(): void {
    this.metrics.clear();
  }
}

/**
 * Helper to instrument an async operation with observability.
 */
export async function instrument<T>(
  operation: string,
  fn: () => Promise<T>,
  hook?: ObservabilityHook,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const startTime = performance.now();
  let success = false;
  let error: string | undefined;

  const onComplete = hook?.onOperationStart?.(operation, metadata);

  try {
    const result = await fn();
    success = true;
    return result;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const durationMs = performance.now() - startTime;

    onComplete?.(success, error);

    hook?.onOperationComplete?.({
      operation,
      durationMs,
      success,
      ...(error !== undefined && { error }),
      ...(metadata !== undefined && { metadata }),
    });
  }
}
