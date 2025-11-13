/**
 * @module stores/jsonl
 *
 * Basic JSONL store implementation with full event replay.
 *
 * Stores events in separate JSONL files (issues.jsonl, links.jsonl) with
 * exclusive file locking. Performs full replay on every read. Best for
 * small repos and rapid prototyping.
 *
 * @example
 * ```ts
 * import { openJsonlStore } from "@trinkets/core/stores/jsonl";
 *
 * const store = await openJsonlStore({
 *   baseDir: "./.trinkets",
 *   validateEvents: true
 * });
 * ```
 */

import { ensureDir } from "@std/fs/ensure-dir";
import { join } from "@std/path";
import type { Event, GraphState } from "./adt.ts";
import { materializeFromEvents } from "./domain_materialize.ts";
import { parseEvent } from "./schemas.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";
import type { StoreError, StorePort } from "./ports.ts";
import * as logger from "./logger.ts";

/**
 * Configuration options for the basic JSONL store.
 */
export type JsonlStoreOptions = Readonly<
  {
    /** Directory for storing JSONL files. */
    baseDir: string;
    /** Enable valibot schema validation on append (defaults to false). */
    validateEvents?: boolean;
    /** File lock timeout in milliseconds (defaults to 5000). */
    lockTimeoutMs?: number;
  }
>;

/**
 * Opens a basic JSONL store with full event replay.
 *
 * Creates two files: issues.jsonl and links.jsonl. Uses exclusive file
 * locks for concurrent access safety. Best for small repositories.
 *
 * @param opts Store configuration
 * @returns Promise resolving to StorePort implementation
 */
export async function openJsonlStore(
  opts: JsonlStoreOptions,
): Promise<StorePort> {
  await ensureDir(opts.baseDir);
  const issuesPath = join(opts.baseDir, "issues.jsonl");
  const linksPath = join(opts.baseDir, "links.jsonl");
  const _validate = !!opts.validateEvents;
  const lockTimeout = opts.lockTimeoutMs ?? 5000;

  async function append(e: Event): Promise<Result<void, StoreError>> {
    if (_validate) {
      try {
        parseEvent(e);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error("Event validation failed", { event: e, reason });
        return err({
          _type: "ParseError",
          line: 0,
          content: JSON.stringify(e),
          reason,
        });
      }
    }

    const path = e._type.startsWith("Issue") ? issuesPath : linksPath;
    let fh: Deno.FsFile | null = null;

    try {
      fh = await Deno.open(path, { create: true, append: true, write: true });
    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        logger.error("Permission denied opening file for append", {
          path,
          error,
        });
        return err({ _type: "PermissionDenied", path, operation: "append" });
      }
      const reason = error instanceof Error ? error.message : String(error);
      logger.error("Failed to open file for append", { path, reason });
      return err({
        _type: "Corruption",
        path,
        reason: `Failed to open: ${reason}`,
      });
    }

    try {
      // Acquire exclusive lock with timeout
      const lockPromise = fh.lock(true);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Lock timeout")), lockTimeout)
      );

      await Promise.race([lockPromise, timeoutPromise]).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Lock acquisition failed: ${reason}`);
      });

      logger.debug("Acquired exclusive lock for append", { path });

      // Write the event
      const data = new TextEncoder().encode(JSON.stringify(e) + "\n");
      await fh.write(data);

      // Sync to disk
      await fh.sync();

      logger.debug("Event appended successfully", { path, eventType: e._type });
      return ok(undefined);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Lock")) {
        logger.error("Lock timeout during append", {
          path,
          timeoutMs: lockTimeout,
        });
        return err({ _type: "LockTimeout", path, timeoutMs: lockTimeout });
      }
      const reason = error instanceof Error ? error.message : String(error);
      if (
        reason.includes("No space left") || reason.includes("ENOSPC") ||
        reason.includes("disk full")
      ) {
        logger.error("Disk full during append", { path });
        return err({ _type: "DiskFull", path });
      }
      logger.error("Failed to write event", { path, reason });
      return err({
        _type: "Corruption",
        path,
        reason: `Write failed: ${reason}`,
      });
    } finally {
      try {
        await fh.unlock();
        fh.close();
      } catch (error) {
        logger.warn("Failed to unlock/close file handle", { path, error });
      }
    }
  }

  async function scan(): Promise<Result<readonly Event[], StoreError>> {
    const out: Event[] = [];
    for (const p of [issuesPath, linksPath]) {
      try {
        const text = await Deno.readTextFile(p);
        let lineNumber = 0;
        for (const line of text.split("\n")) {
          lineNumber++;
          if (line.trim()) {
            try {
              out.push(JSON.parse(line));
            } catch (error) {
              const reason = error instanceof Error
                ? error.message
                : String(error);
              logger.error("Failed to parse event line", {
                path: p,
                line: lineNumber,
                reason,
              });
              return err({
                _type: "ParseError",
                line: lineNumber,
                content: line,
                reason,
              });
            }
          }
        }
      } catch (error) {
        // File not existing is okay (empty log)
        if (error instanceof Deno.errors.NotFound) {
          logger.debug("JSONL file not found (treating as empty)", { path: p });
          continue;
        }
        if (error instanceof Deno.errors.PermissionDenied) {
          logger.error("Permission denied reading file", { path: p });
          return err({ _type: "PermissionDenied", path: p, operation: "read" });
        }
        const reason = error instanceof Error ? error.message : String(error);
        logger.error("Failed to read file", { path: p, reason });
        return err({
          _type: "Corruption",
          path: p,
          reason: `Read failed: ${reason}`,
        });
      }
    }
    return ok(out);
  }

  async function materialize(): Promise<Result<GraphState, StoreError>> {
    const scanResult = await scan();
    if (!scanResult.ok) return scanResult;
    return ok(materializeFromEvents(scanResult.value));
  }

  async function getExistingIds(): Promise<
    Result<ReadonlySet<string>, StoreError>
  > {
    const ids = new Set<string>();

    try {
      const text = await Deno.readTextFile(issuesPath);
      let lineNumber = 0;
      for (const line of text.split("\n")) {
        lineNumber++;
        if (line.trim()) {
          try {
            const event = JSON.parse(line);
            if (event._type === "IssueCreated" && event.issue?.id) {
              ids.add(event.issue.id);
            }
          } catch (error) {
            const reason = error instanceof Error
              ? error.message
              : String(error);
            logger.error("Failed to parse event line for ID extraction", {
              path: issuesPath,
              line: lineNumber,
              reason,
            });
            return err({
              _type: "ParseError",
              line: lineNumber,
              content: line,
              reason,
            });
          }
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.debug("Issues file not found (no IDs yet)", {
          path: issuesPath,
        });
        return ok(ids);
      }
      if (error instanceof Deno.errors.PermissionDenied) {
        logger.error("Permission denied reading issues file", {
          path: issuesPath,
        });
        return err({
          _type: "PermissionDenied",
          path: issuesPath,
          operation: "read",
        });
      }
      const reason = error instanceof Error ? error.message : String(error);
      logger.error("Failed to read issues file for ID extraction", {
        path: issuesPath,
        reason,
      });
      return err({
        _type: "Corruption",
        path: issuesPath,
        reason: `Read failed: ${reason}`,
      });
    }

    return ok(ids);
  }

  return { append, scan, materialize, getExistingIds } as const;
}
