import type { Event, GraphState } from "./adt.ts";
import type { Result } from "./result.ts";

export type DiskFullError = Readonly<{ _type: "DiskFull"; path: string }>;
export type PermissionDeniedError = Readonly<
  { _type: "PermissionDenied"; path: string; operation: string }
>;
export type ParseError = Readonly<
  { _type: "ParseError"; line: number; content: string; reason: string }
>;
export type LockTimeoutError = Readonly<
  { _type: "LockTimeout"; path: string; timeoutMs: number }
>;
export type CorruptionError = Readonly<
  { _type: "Corruption"; path: string; reason: string }
>;
export type StoreError =
  | DiskFullError
  | PermissionDeniedError
  | ParseError
  | LockTimeoutError
  | CorruptionError;

export type ValidationFailedError = Readonly<
  { _type: "ValidationFailed"; reason: string }
>;
export type SerializationError = Readonly<
  { _type: "SerializationError"; reason: string }
>;
export type ConnectionError = Readonly<
  { _type: "ConnectionError"; reason: string }
>;
export type CacheError =
  | ValidationFailedError
  | SerializationError
  | ConnectionError;

export type StorePort = Readonly<{
  append: (e: Event) => Promise<Result<void, StoreError>>;
  scan: () => Promise<Result<readonly Event[], StoreError>>;
  materialize: () => Promise<Result<GraphState, StoreError>>;
}>;

export type Env = Readonly<{ now: () => string }>;

export type CachePort = Readonly<{
  hydrate: () => Promise<Result<GraphState | null, CacheError>>;
  persist: (g: GraphState) => Promise<Result<void, CacheError>>;
}>;
