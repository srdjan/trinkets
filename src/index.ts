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
import {
  buildIndexes,
  indexIssueCreated,
} from "./indexed_graph.ts";
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
import {
  validateGraphState,
  validateIssueId,
} from "./schemas_runtime.ts";
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

export type TrinketsMakeOptions = Readonly<{
  store?: StorePort;
  cache?: CachePort | null;
  baseDir?: string;
  cacheName?: string;
  validateEvents?: boolean;
  clock?: () => string;
  autoInit?: boolean;
}>;

async function make(opts: TrinketsMakeOptions = {}): Promise<Trinkets> {
  const baseDir = opts.baseDir ?? ".trinkets";
  const validateEvents = opts.validateEvents ?? true;
  const cacheName = opts.cacheName ?? "trinkets";

  const store =
    opts.store ??
    await openJsonlStoreWithHeadsV2({
      baseDir,
      validateEvents,
    });

  const resolvedCache: CachePort | null | undefined =
    opts.cache === undefined
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
  Event,
  DiskFullError,
  EmbedOptions,
  Env,
  Err,
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
