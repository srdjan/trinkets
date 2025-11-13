/**
 * @module @trinkets/core
 *
 * Trinkets - A light-functional event-sourced issue tracker with dependency graphs.
 *
 * This module provides the main entry point for the Trinkets library, exposing:
 * - `trinkets.make()` - High-level SDK with smart defaults
 * - `trinkets.domain` - Pure domain functions for event sourcing
 * - `trinkets.query` - Graph queries (ready issues, blocking explanations)
 * - `trinkets.store` - Pluggable persistence adapters (JSONL, HeadsV2)
 * - `trinkets.cache` - Optional caching layers (KV, SQLite)
 * - `trinkets.infra` - Production utilities (retry, observability, backup)
 *
 * All types are re-exported for convenience.
 *
 * @see {@link https://jsr.io/@trinkets/core} for full documentation
 */

import { makeTrinkets } from "./embed.ts";
import type { EmbedOptions, Trinkets } from "./embed.ts";
import { openJsonlStore } from "./store_jsonl.ts";
import { openJsonlStoreWithHeadsV2 } from "./store_jsonl_heads_v2.ts";
import { openKvCache } from "./cache_kv.ts";
import { openSqliteCache } from "./cache_sqlite.ts";
import {
  addLink,
  createIssue,
  initRepo,
  patchIssue,
  setStatus,
  validateInvariants,
} from "./domain.ts";
import { explainBlocked, ready } from "./query.ts";
import { filterIssues, nextWork } from "./search.ts";
import { buildIndexes, indexIssueCreated } from "./indexed_graph.ts";
import {
  byLabel,
  byPriority,
  byStatus,
  ready as readyIndexed,
} from "./query_indexed.ts";
import {
  CircuitBreaker,
  retryable,
  withRetry,
  withRetryBatch,
} from "./retry.ts";
import {
  consoleObservability,
  instrument,
  MetricsAggregator,
  noopObservability,
} from "./observability.ts";
import {
  createBackup,
  createIncrementalBackup,
  exportToFile,
  exportToJsonl,
  importFromFile,
  importFromJsonl,
  validateBackup,
} from "./backup.ts";
import {
  formatIntegrityReport,
  repairEvents,
  verifyIntegrity,
} from "./integrity.ts";
import { newIssueId } from "./id.ts";
import { validateGraphState, validateIssueId } from "./schemas_runtime.ts";
import type {
  DepType,
  Event,
  GraphState,
  Issue,
  IssueId,
  IssueKind,
  IssueStatus,
  Link,
} from "./adt.ts";
import type { CachePort, Env, StorePort } from "./ports.ts";
import type {
  CacheError,
  ConnectionError,
  CorruptionError,
  DiskFullError,
  LockTimeoutError,
  ParseError,
  PermissionDeniedError,
  SerializationError,
  StoreError,
  ValidationFailedError,
} from "./ports.ts";
import type { IndexedGraphState } from "./indexed_graph.ts";
import type {
  ObservabilityHook,
  OperationMetrics,
  StoreOperation,
} from "./observability.ts";
import type { CircuitBreakerOptions, RetryOptions } from "./retry.ts";
import type { IntegrityIssue, IntegrityReport } from "./integrity.ts";
import type { BackupFormat, BackupMetadata } from "./backup.ts";
import {
  andThen,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrap,
  unwrapOr,
  unwrapOrElse,
} from "./result.ts";
import type { Err, Ok, Result } from "./result.ts";

/**
 * Configuration options for creating a Trinkets instance.
 */
export type TrinketsMakeOptions = Readonly<{
  /** Custom store implementation (defaults to HeadsV2 JSONL store) */
  store?: StorePort;
  /** Cache implementation or null to disable caching (defaults to KV cache) */
  cache?: CachePort | null;
  /** Directory for issue storage (defaults to ".trinkets") */
  baseDir?: string;
  /** Cache namespace identifier (defaults to "trinkets") */
  cacheName?: string;
  /** Enable event validation with valibot schemas (defaults to true) */
  validateEvents?: boolean;
  /** Custom clock function for deterministic timestamps */
  clock?: () => string;
  /** Automatically initialize repository if not exists (defaults to true) */
  autoInit?: boolean;
}>;

/**
 * Creates a Trinkets SDK instance with smart defaults.
 *
 * @example
 * ```ts
 * // Use defaults (HeadsV2 store + KV cache)
 * const sdk = await trinkets.make();
 *
 * // Custom configuration
 * const sdk = await trinkets.make({
 *   baseDir: "./my-issues",
 *   validateEvents: true,
 *   autoInit: false
 * });
 *
 * // Create an issue
 * const result = await sdk.createIssue({
 *   title: "Fix authentication bug",
 *   priority: 0
 * });
 * ```
 *
 * @param opts - Configuration options
 * @returns Promise resolving to Trinkets SDK instance
 * @throws {StoreError} When autoInit is true and initialization fails
 */
async function make(opts: TrinketsMakeOptions = {}): Promise<Trinkets> {
  const baseDir = opts.baseDir ?? ".trinkets";
  const validateEvents = opts.validateEvents ?? true;
  const cacheName = opts.cacheName ?? "trinkets";

  const store = opts.store ??
    await openJsonlStoreWithHeadsV2({
      baseDir,
      validateEvents,
    });

  const resolvedCache: CachePort | null | undefined = opts.cache === undefined
    ? await openKvCache(cacheName, baseDir)
    : opts.cache;

  const embedOptions: EmbedOptions = {
    store,
    ...(resolvedCache !== undefined ? { cache: resolvedCache } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}),
  };

  const instance = makeTrinkets(embedOptions);

  if (opts.autoInit ?? true) {
    const initResult = await instance.init();
    if (!initResult.ok) {
      throw initResult.error;
    }
  }

  return instance;
}

/**
 * The main Trinkets namespace providing access to all library functionality.
 *
 * @remarks
 * Trinkets is an event-sourced issue tracker with dependency graphs, built on
 * Light Functional Programming principles. All operations return Result types
 * for predictable error handling.
 *
 * @example
 * ```ts
 * import { trinkets } from "@trinkets/core";
 *
 * // Create SDK instance
 * const sdk = await trinkets.make();
 *
 * // Create and link issues
 * const bug = await sdk.createIssue({ title: "Fix bug", priority: 0 });
 * const feature = await sdk.createIssue({ title: "Add feature", priority: 1 });
 *
 * if (bug.ok && feature.ok) {
 *   await sdk.addLink(feature.value.id, bug.value.id, "blocks");
 * }
 *
 * // Query ready work
 * const readyResult = await sdk.ready();
 * if (readyResult.ok) {
 *   console.log("Ready issues:", readyResult.value);
 * }
 * ```
 */
export const trinkets = {
  make,
  embed: makeTrinkets,
  store: {
    jsonl: openJsonlStore,
    heads: openJsonlStoreWithHeadsV2,
  },
  cache: {
    kv: openKvCache,
    sqlite: openSqliteCache,
  },
  domain: {
    init: initRepo,
    createIssue,
    patchIssue,
    setStatus,
    addLink,
    validateInvariants,
  },
  query: {
    ready,
    explainBlocked,
  },
  search: {
    nextWork,
    filterIssues,
  },
  indexed: {
    build: buildIndexes,
    indexIssueCreated,
    ready: readyIndexed,
    byLabel,
    byPriority,
    byStatus,
  },
  ids: {
    newIssueId,
  },
  validate: {
    graph: validateGraphState,
    issueId: validateIssueId,
  },
  result: {
    ok,
    err,
    andThen,
    isOk,
    isErr,
    map,
    mapErr,
    unwrap,
    unwrapOr,
    unwrapOrElse,
  },
  infra: {
    retry: {
      retryable,
      withRetry,
      withRetryBatch,
      CircuitBreaker,
    },
    observability: {
      instrument,
      console: consoleObservability,
      metrics: MetricsAggregator,
      noop: noopObservability,
    },
    backup: {
      create: createBackup,
      incremental: createIncrementalBackup,
      exportToFile,
      exportToJsonl,
      importFromFile,
      importFromJsonl,
      validate: validateBackup,
    },
    integrity: {
      verify: verifyIntegrity,
      repair: repairEvents,
      formatReport: formatIntegrityReport,
    },
  },
} as const;

export type {
  BackupFormat,
  BackupMetadata,
  CacheError,
  CachePort,
  CircuitBreakerOptions,
  ConnectionError,
  CorruptionError,
  DepType,
  DiskFullError,
  EmbedOptions,
  Env,
  Err,
  Event,
  GraphState,
  IndexedGraphState,
  IntegrityIssue,
  IntegrityReport,
  Issue,
  IssueId,
  IssueKind,
  IssueStatus,
  Link,
  LockTimeoutError,
  ObservabilityHook,
  Ok,
  OperationMetrics,
  ParseError,
  PermissionDeniedError,
  Result,
  RetryOptions,
  SerializationError,
  StoreError,
  StoreOperation,
  StorePort,
  Trinkets,
  ValidationFailedError,
};
