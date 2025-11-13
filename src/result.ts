/**
 * @module result
 *
 * Result type for railway-oriented error handling.
 *
 * Provides a type-safe Result<T, E> discriminated union and utility functions
 * for functional error handling without exceptions.
 *
 * @example
 * ```ts
 * import { ok, err, andThen, type Result } from "@trinkets/core/result";
 *
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return err("Division by zero");
 *   return ok(a / b);
 * }
 *
 * const result = andThen(divide(10, 2), (n) => ok(n * 2));
 * ```
 */

/** Successful result containing a value. */
export type Ok<T> = Readonly<{ ok: true; value: T }>;

/** Error result containing an error. */
export type Err<E> = Readonly<{ ok: false; error: E }>;

/** Discriminated union representing either success (Ok) or failure (Err). */
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * Creates a successful Result.
 * @param value The success value
 * @returns An Ok result
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Creates an error Result.
 * @param error The error value
 * @returns An Err result
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Type guard to check if a Result is Ok.
 * @param result The result to check
 * @returns True if result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Type guard to check if a Result is Err.
 * @param result The result to check
 * @returns True if result is Err
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Extracts the value from an Ok result, or throws if Err.
 * @param result The result to unwrap
 * @returns The success value
 * @throws Error if result is Err
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`Unwrap called on Err: ${JSON.stringify(result.error)}`);
}

/**
 * Returns the success value or a default value if Err.
 * @param result The result to unwrap
 * @param defaultValue The default value to return on Err
 * @returns The success value or default
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Returns the success value or computes one from the error.
 * @param result The result to unwrap
 * @param fn Function to compute value from error
 * @returns The success value or computed value
 */
export function unwrapOrElse<T, E>(
  result: Result<T, E>,
  fn: (error: E) => T,
): T {
  return result.ok ? result.value : fn(result.error);
}

/**
 * Maps a Result's success value to a new value.
 * @param result The result to map
 * @param fn Function to transform the value
 * @returns A new Result with transformed value
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Maps a Result's error to a new error.
 * @param result The result to map
 * @param fn Function to transform the error
 * @returns A new Result with transformed error
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/**
 * Chains a Result with another Result-returning function.
 * @param result The result to chain
 * @param fn Function that returns a new Result
 * @returns The chained Result
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}
