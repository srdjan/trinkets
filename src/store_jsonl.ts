import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import type { Event, GraphState } from "./adt.ts";
import { materializeFromEvents } from "./domain_materialize.ts";
import { parseEvent } from "./schemas.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";
import type { StoreError } from "./ports.ts";
import * as logger from "./logger.ts";

export type JsonlStoreOptions = Readonly<
  { baseDir: string; validateEvents?: boolean; lockTimeoutMs?: number }
>;

export async function openJsonlStore(opts: JsonlStoreOptions) {
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

  return { append, scan, materialize } as const;
}
