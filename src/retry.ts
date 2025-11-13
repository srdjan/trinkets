/**
 * @module retry
 *
 * Retry utilities for handling transient errors in production.
 *
 * Provides exponential backoff, jitter, circuit breaker pattern, and
 * configurable retry strategies for resilient operations.
 *
 * @example
 * ```ts
 * import { withRetry, CircuitBreaker } from "@trinkets/core/retry";
 *
 * const result = await withRetry(
 *   () => store.materialize(),
 *   { maxAttempts: 3, initialDelayMs: 100 }
 * );
 * ```
 */

import type { Result } from "./result.ts";
import type { StoreError } from "./ports.ts";

export type RetryOptions = {
  /** Maximum number of retry attempts (default: 3) */
  readonly maxAttempts?: number;
  /** Initial delay in milliseconds (default: 100) */
  readonly initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 5000) */
  readonly maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  readonly backoffMultiplier?: number;
  /** Whether to add jitter to delays (default: true) */
  readonly jitter?: boolean;
  /** Function to determine if an error is retryable */
  readonly isRetryable?: (error: StoreError) => boolean;
  /** Callback for retry attempts */
  readonly onRetry?: (
    attempt: number,
    error: StoreError,
    delayMs: number,
  ) => void;
};

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitter: true,
  isRetryable: defaultIsRetryable,
  onRetry: () => {},
};

/**
 * Default retry strategy: retry on lock timeouts and transient errors,
 * but not on corruption or permission issues.
 */
function defaultIsRetryable(error: StoreError): boolean {
  switch (error._type) {
    case "LockTimeout":
      return true; // Lock timeouts are transient
    case "ParseError":
    case "Corruption":
      return false; // Data corruption is not recoverable by retry
    case "PermissionDenied":
      return false; // Permission errors won't fix themselves
    case "DiskFull":
      return false; // Disk full won't fix itself immediately
    default:
      return false;
  }
}

/**
 * Calculate delay with exponential backoff and optional jitter.
 */
function calculateDelay(
  attempt: number,
  options: Required<RetryOptions>,
): number {
  const baseDelay = options.initialDelayMs *
    Math.pow(options.backoffMultiplier, attempt);
  const cappedDelay = Math.min(baseDelay, options.maxDelayMs);

  if (options.jitter) {
    // Add ±25% jitter to prevent thundering herd
    const jitterRange = cappedDelay * 0.25;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.max(0, cappedDelay + jitter);
  }

  return cappedDelay;
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an operation with exponential backoff.
 * Returns the result of the operation or the last error if all retries fail.
 */
export async function withRetry<T>(
  operation: () => Promise<Result<T, StoreError>>,
  options?: RetryOptions,
): Promise<Result<T, StoreError>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: StoreError | null = null;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    const result = await operation();

    if (result.ok) {
      return result;
    }

    lastError = result.error;

    // Check if error is retryable
    if (!opts.isRetryable(result.error)) {
      return result; // Return immediately for non-retryable errors
    }

    // Don't delay after the last attempt
    if (attempt < opts.maxAttempts - 1) {
      const delayMs = calculateDelay(attempt, opts);
      opts.onRetry(attempt + 1, result.error, delayMs);
      await sleep(delayMs);
    }
  }

  // All retries exhausted - return the last error
  // This shouldn't happen due to loop logic, but TypeScript needs it
  return { ok: false, error: lastError! };
}

/**
 * Retry a batch of operations in parallel with individual retry logic.
 * Returns results for all operations, with retries applied per-operation.
 */
export function withRetryBatch<T>(
  operations: ReadonlyArray<() => Promise<Result<T, StoreError>>>,
  options?: RetryOptions,
): Promise<ReadonlyArray<Result<T, StoreError>>> {
  return Promise.all(
    operations.map((op) => withRetry(op, options)),
  );
}

/**
 * Create a retrying version of a store operation.
 * Useful for wrapping store methods with automatic retry logic.
 */
export function retryable<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<Result<T, StoreError>>,
  options?: RetryOptions,
): (...args: Args) => Promise<Result<T, StoreError>> {
  return (...args: Args) => withRetry(() => fn(...args), options);
}

/**
 * Circuit breaker state.
 */
type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker options.
 */
export type CircuitBreakerOptions = {
  /** Number of failures before opening circuit (default: 5) */
  readonly failureThreshold?: number;
  /** Time to wait before trying again after opening (default: 30000ms) */
  readonly resetTimeoutMs?: number;
  /** Number of successful requests needed to close circuit (default: 2) */
  readonly successThreshold?: number;
};

/**
 * Circuit breaker pattern for preventing cascading failures.
 * Stops calling a failing operation after too many failures,
 * giving the system time to recover.
 */
export class CircuitBreaker<T> {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options?: CircuitBreakerOptions) {
    this.options = {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      successThreshold: 2,
      ...options,
    };
  }

  async execute(
    operation: () => Promise<Result<T, StoreError>>,
  ): Promise<Result<T, StoreError>> {
    // Check if circuit should transition from open to half-open
    if (
      this.state === "open" &&
      Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs
    ) {
      this.state = "half-open";
      this.successes = 0;
    }

    // Reject immediately if circuit is open
    if (this.state === "open") {
      return {
        ok: false,
        error: {
          _type: "Corruption",
          path: "<circuit-breaker>",
          reason: "Circuit breaker is open - too many failures",
        },
      };
    }

    // Try the operation
    const result = await operation();

    if (result.ok) {
      this.onSuccess();
    } else {
      this.onFailure();
    }

    return result;
  }

  private onSuccess(): void {
    this.failures = 0;

    if (this.state === "half-open") {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.state = "closed";
        this.successes = 0;
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.failureThreshold) {
      this.state = "open";
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
  }
}
