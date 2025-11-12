// Core types
export type {
  DepType,
  GraphState,
  Issue,
  IssueId,
  IssueKind,
  IssueStatus,
  Link,
} from "./adt.ts";

// Port types
export type { CachePort, Env, StorePort } from "./ports.ts";

// Error types
export type {
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

// Result type
export type { Err, Ok, Result } from "./result.ts";
export {
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

// Domain functions
export {
  addLink,
  createIssue,
  initRepo,
  patchIssue,
  setStatus,
  validateInvariants,
} from "./domain.ts";

// Query functions
export { explainBlocked, ready } from "./query.ts";
export { filterIssues, nextWork, ready as readyFiltered } from "./search.ts";

// Performance optimizations
export type { IndexedGraphState } from "./indexed_graph.ts";
export { buildIndexes, indexIssueCreated } from "./indexed_graph.ts";
export {
  byLabel,
  byPriority,
  byStatus,
  ready as readyIndexed,
} from "./query_indexed.ts";

// Store implementations
export { openJsonlStore } from "./store_jsonl.ts";
export { openJsonlStoreWithHeadsV2 } from "./store_jsonl_heads_v2.ts";

// Cache implementations
export { openKvCache } from "./cache_kv.ts";
export { openSqliteCache } from "./cache_sqlite.ts";

// Embedding API
export { makeTrinkets } from "./embed.ts";
export type { EmbedOptions } from "./embed.ts";

// Utilities
export { newIssueId } from "./id.ts";
export { validateGraphState, validateIssueId } from "./schemas_runtime.ts";
