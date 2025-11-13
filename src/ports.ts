/**
 * @module ports
 *
 * Port interfaces for dependency injection and adapter implementations.
 *
 * Defines the core ports (StorePort, CachePort, Env) that enable testing
 * and pluggable infrastructure. Also exports all error types used throughout
 * the library.
 *
 * @example
 * ```ts
 * import type { StorePort, CachePort } from "@trinkets/core/ports";
 *
 * // Implement custom store
 * const myStore: StorePort = {
 *   append: async (e) => { ... },
 *   scan: async () => { ... },
 *   materialize: async () => { ... }
 * };
 * ```
 */

import type { Event, GraphState } from "./adt.ts";
import type { Result } from "./result.ts";

/** Error indicating disk full when writing events. */
export type DiskFullError = Readonly<{ _type: "DiskFull"; path: string }>;

/** Error indicating lack of file system permissions. */
export type PermissionDeniedError = Readonly<
  { _type: "PermissionDenied"; path: string; operation: string }
>;

/** Error parsing event from JSONL. */
export type ParseError = Readonly<
  { _type: "ParseError"; line: number; content: string; reason: string }
>;

/** Error acquiring file lock within timeout. */
export type LockTimeoutError = Readonly<
  { _type: "LockTimeout"; path: string; timeoutMs: number }
>;

/** Error indicating data corruption or validation failure. */
export type CorruptionError = Readonly<
  { _type: "Corruption"; path: string; reason: string }
>;

/** Discriminated union of all possible store errors. */
export type StoreError =
  | DiskFullError
  | PermissionDeniedError
  | ParseError
  | LockTimeoutError
  | CorruptionError;

/** Error validating cached graph state. */
export type ValidationFailedError = Readonly<
  { _type: "ValidationFailed"; reason: string }
>;

/** Error serializing/deserializing graph state. */
export type SerializationError = Readonly<
  { _type: "SerializationError"; reason: string }
>;

/** Error connecting to cache backend. */
export type ConnectionError = Readonly<
  { _type: "ConnectionError"; reason: string }
>;

/** Discriminated union of all possible cache errors. */
export type CacheError =
  | ValidationFailedError
  | SerializationError
  | ConnectionError;

/**
 * Port for event storage and retrieval.
 *
 * Implementations must provide append-only semantics and event replay.
 */
export type StorePort = Readonly<{
  /** Appends an event to the store. */
  append: (e: Event) => Promise<Result<void, StoreError>>;
  /** Scans all events from the store. */
  scan: () => Promise<Result<readonly Event[], StoreError>>;
  /** Materializes the current graph state from events. */
  materialize: () => Promise<Result<GraphState, StoreError>>;
  /** Optional: Get existing issue IDs without full materialization (performance optimization). */
  getExistingIds?: () => Promise<Result<ReadonlySet<string>, StoreError>>;
}>;

/** Environment port providing timestamp generation. */
export type Env = Readonly<{ now: () => string }>;

/**
 * Port for caching materialized graph state.
 *
 * Implementations should handle version validation to prevent stale cache hits.
 */
export type CachePort = Readonly<{
  /** Loads cached graph state (returns null if no cache or invalid). */
  hydrate: () => Promise<Result<GraphState | null, CacheError>>;
  /** Persists graph state to cache. */
  persist: (g: GraphState) => Promise<Result<void, CacheError>>;
}>;
