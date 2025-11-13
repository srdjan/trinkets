import { ensureDir } from "jsr:@std/fs@1/ensure-dir";
import { join } from "jsr:@std/path@1";
import type { Event, GraphState, IssueId } from "./adt.ts";
import { applyEvent, materializeFromEvents } from "./domain_materialize.ts";
import { parseEvent } from "./schemas.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";
import type { StoreError, StorePort } from "./ports.ts";
import * as logger from "./logger.ts";

type Meta = {
  version: number;
  issuesOffset: number;
  linksOffset: number;
  heads: Record<IssueId, { issuesOffset: number; linksOffset: number }>;
};
type SerializedState = {
  version: number;
  issues: Array<[IssueId, unknown]>;
  outgoing: Array<[IssueId, unknown]>;
  incoming: Array<[IssueId, unknown]>;
};
export type JsonlHeadsStoreV2Options = Readonly<
  { baseDir: string; validateEvents?: boolean; lockTimeoutMs?: number }
>;

const STATE_VERSION = 1;

export async function openJsonlStoreWithHeadsV2(
  opts: JsonlHeadsStoreV2Options,
): Promise<StorePort> {
  await ensureDir(opts.baseDir);
  const issuesPath = join(opts.baseDir, "issues.jsonl");
  const linksPath = join(opts.baseDir, "links.jsonl");
  const metaPath = join(opts.baseDir, "heads.json");
  const statePath = join(opts.baseDir, "state.json");
  const lockPath = join(opts.baseDir, ".lock");
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
      const lockPromise = fh.lock(true);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Lock timeout")), lockTimeout)
      );
      await Promise.race([lockPromise, timeoutPromise]).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Lock acquisition failed: ${reason}`);
      });

      logger.debug("Acquired exclusive lock for append", { path });

      const data = new TextEncoder().encode(JSON.stringify(e) + "\n");
      await fh.write(data);
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
    const issuesResult = await readAll(issuesPath);
    if (!issuesResult.ok) return issuesResult;
    const linksResult = await readAll(linksPath);
    if (!linksResult.ok) return linksResult;
    return ok([...issuesResult.value, ...linksResult.value]);
  }

  async function materialize(): Promise<Result<GraphState, StoreError>> {
    // Acquire global lock for materialization to prevent race conditions
    let lockFh: Deno.FsFile | null = null;
    try {
      lockFh = await Deno.open(lockPath, {
        create: true,
        write: true,
        read: true,
      });
      const lockPromise = lockFh.lock(false); // Shared lock for reads
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Lock timeout")), lockTimeout)
      );
      await Promise.race([lockPromise, timeoutPromise]).catch(() => {
        throw new Error("Lock timeout on materialize");
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Lock timeout")) {
        logger.error("Lock timeout during materialize", {
          timeoutMs: lockTimeout,
        });
        return err({
          _type: "LockTimeout",
          path: lockPath,
          timeoutMs: lockTimeout,
        });
      }
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn("Failed to acquire lock for materialize, continuing anyway", {
        reason,
      });
      // Continue without lock as fallback
    }

    try {
      const meta = await readMeta(metaPath);
      const cachedStateResult = await readState(statePath);
      let state: GraphState | null = cachedStateResult.ok
        ? cachedStateResult.value
        : null;

      const [iSize, lSize] = await Promise.all([
        safeStat(issuesPath),
        safeStat(linksPath),
      ]);
      const [newIResult, newLResult] = await Promise.all([
        readTail(issuesPath, Math.min(meta.issuesOffset, iSize)),
        readTail(linksPath, Math.min(meta.linksOffset, lSize)),
      ]);

      if (!newIResult.ok) return newIResult;
      if (!newLResult.ok) return newLResult;

      const delta = [...newIResult.value, ...newLResult.value];

      if (!state) {
        logger.info("No cached state found, performing full materialization");
        const scanResult = await scan();
        if (!scanResult.ok) return scanResult;
        state = materializeFromEvents(scanResult.value);

        const writeResult = await atomicWriteState(
          statePath,
          metaPath,
          state,
          iSize,
          lSize,
        );
        if (!writeResult.ok) return writeResult;
        return ok(state);
      }

      if (delta.length === 0) {
        logger.debug("No new events, returning cached state");
        return ok(state);
      }

      logger.info("Applying incremental updates", { deltaSize: delta.length });
      let rebuilt = state;
      for (const ev of delta) rebuilt = applyEvent(rebuilt, ev);

      const writeResult = await atomicWriteState(
        statePath,
        metaPath,
        rebuilt,
        iSize,
        lSize,
      );
      if (!writeResult.ok) return writeResult;
      return ok(rebuilt);
    } finally {
      if (lockFh) {
        try {
          await lockFh.unlock();
          lockFh.close();
        } catch (error) {
          logger.warn("Failed to unlock materialize lock", { error });
        }
      }
    }
  }

  async function getExistingIds(): Promise<
    Result<ReadonlySet<string>, StoreError>
  > {
    // Try to get IDs from cached state first (fast path)
    const cachedStateResult = await readState(statePath);
    if (cachedStateResult.ok && cachedStateResult.value) {
      logger.debug("Getting existing IDs from cached state");
      return ok(new Set(cachedStateResult.value.issues.keys()));
    }

    // Fall back to scanning issue events (slower but still faster than full materialize)
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

async function readAll(p: string): Promise<Result<Event[], StoreError>> {
  try {
    const text = await Deno.readTextFile(p);
    const events: Event[] = [];
    let lineNumber = 0;
    for (const line of text.split("\n")) {
      lineNumber++;
      if (line.trim()) {
        try {
          events.push(JSON.parse(line));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
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
    return ok(events);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      logger.debug("File not found (treating as empty)", { path: p });
      return ok([]);
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

async function readTail(
  p: string,
  offset: number,
): Promise<Result<Event[], StoreError>> {
  try {
    const file = await Deno.open(p, { read: true });
    try {
      await file.seek(offset, Deno.SeekMode.Start);
      const dec = new TextDecoder();
      const buf = new Uint8Array(16 * 1024);
      let data = "";
      const out: Event[] = [];
      let lineNumber = 0;

      while (true) {
        const n = await file.read(buf);
        if (n === null) break;
        data += dec.decode(buf.subarray(0, n));

        let idx;
        while ((idx = data.indexOf("\n")) >= 0) {
          const line = data.slice(0, idx).trim();
          data = data.slice(idx + 1);
          lineNumber++;
          if (line) {
            try {
              out.push(JSON.parse(line));
            } catch (error) {
              const reason = error instanceof Error
                ? error.message
                : String(error);
              logger.error("Failed to parse tail line", {
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
      }

      if (data.trim()) {
        try {
          out.push(JSON.parse(data));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          logger.error("Failed to parse final tail line", { path: p, reason });
          return err({
            _type: "ParseError",
            line: lineNumber + 1,
            content: data,
            reason,
          });
        }
      }

      return ok(out);
    } finally {
      file.close();
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return ok([]);
    }
    const reason = error instanceof Error ? error.message : String(error);
    logger.error("Failed to read tail", { path: p, offset, reason });
    return err({
      _type: "Corruption",
      path: p,
      reason: `Tail read failed: ${reason}`,
    });
  }
}

async function safeStat(p: string): Promise<number> {
  try {
    const s = await Deno.stat(p);
    return s.size ?? 0;
  } catch {
    return 0;
  }
}

async function readMeta(p: string): Promise<Meta> {
  try {
    const text = await Deno.readTextFile(p);
    const data = JSON.parse(text) as Partial<Meta>;

    // Handle legacy meta without version
    if (!data.version) {
      logger.warn("Meta file missing version, treating as version 1", {
        path: p,
      });
      return {
        version: 1,
        issuesOffset: data.issuesOffset ?? 0,
        linksOffset: data.linksOffset ?? 0,
        heads: data.heads ?? {},
      };
    }

    if (data.version !== STATE_VERSION) {
      logger.warn("Meta version mismatch, resetting", {
        expected: STATE_VERSION,
        actual: data.version,
      });
      return {
        version: STATE_VERSION,
        issuesOffset: 0,
        linksOffset: 0,
        heads: {},
      };
    }

    return data as Meta;
  } catch {
    return {
      version: STATE_VERSION,
      issuesOffset: 0,
      linksOffset: 0,
      heads: {},
    };
  }
}

async function readState(
  p: string,
): Promise<Result<GraphState | null, StoreError>> {
  try {
    const text = await Deno.readTextFile(p);
    const raw = JSON.parse(text) as SerializedState;

    if (raw.version !== STATE_VERSION) {
      logger.warn("State version mismatch, invalidating cache", {
        expected: STATE_VERSION,
        actual: raw.version,
        path: p,
      });
      return ok(null);
    }

    const state: GraphState = {
      issues: new Map(raw.issues as any), // eslint-disable-line @typescript-eslint/no-explicit-any
      outgoing: new Map(raw.outgoing as any), // eslint-disable-line @typescript-eslint/no-explicit-any
      incoming: new Map(raw.incoming as any), // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    return ok(state);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return ok(null);
    }
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to read cached state", { path: p, reason });
    return ok(null); // Treat corrupt cache as missing
  }
}

async function atomicWriteState(
  statePath: string,
  metaPath: string,
  state: GraphState,
  issuesOffset: number,
  linksOffset: number,
): Promise<Result<void, StoreError>> {
  const stateData: SerializedState = {
    version: STATE_VERSION,
    issues: Array.from(state.issues.entries()),
    outgoing: Array.from(state.outgoing.entries()),
    incoming: Array.from(state.incoming.entries()),
  };
  const metaData: Meta = {
    version: STATE_VERSION,
    issuesOffset,
    linksOffset,
    heads: indexHeads(state, issuesOffset, linksOffset),
  };

  const stateTmp = `${statePath}.tmp`;
  const metaTmp = `${metaPath}.tmp`;

  try {
    // Write to temp files
    await Deno.writeTextFile(stateTmp, JSON.stringify(stateData));
    await Deno.writeTextFile(metaTmp, JSON.stringify(metaData));

    // Atomic rename
    await Deno.rename(stateTmp, statePath);
    await Deno.rename(metaTmp, metaPath);

    logger.debug("State and meta written atomically");
    return ok(undefined);
  } catch (error) {
    // Cleanup temp files on error
    try {
      await Deno.remove(stateTmp).catch(() => {});
      await Deno.remove(metaTmp).catch(() => {});
    } catch {
      // Ignore cleanup errors - we're already handling the original error
    }

    const reason = error instanceof Error ? error.message : String(error);
    if (
      reason.includes("No space left") || reason.includes("ENOSPC") ||
      reason.includes("disk full")
    ) {
      logger.error("Disk full writing state");
      return err({ _type: "DiskFull", path: statePath });
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      logger.error("Permission denied writing state", { path: statePath });
      return err({
        _type: "PermissionDenied",
        path: statePath,
        operation: "write",
      });
    }
    logger.error("Failed to write state atomically", { reason });
    return err({
      _type: "Corruption",
      path: statePath,
      reason: `Atomic write failed: ${reason}`,
    });
  }
}

function indexHeads(
  g: GraphState,
  issuesOffset: number,
  linksOffset: number,
): Record<string, { issuesOffset: number; linksOffset: number }> {
  const heads: Record<string, { issuesOffset: number; linksOffset: number }> =
    {};
  for (const id of g.issues.keys()) {
    heads[id] = { issuesOffset, linksOffset };
  }
  return heads;
}
