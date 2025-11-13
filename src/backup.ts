/**
 * @module backup
 *
 * Backup and restore utilities for operational data management.
 *
 * Provides tools to safely backup, restore, and migrate trinkets data with
 * full metadata and incremental backup support.
 *
 * @example
 * ```ts
 * import { createBackup, validateBackup } from "@trinkets/core/backup";
 *
 * const backup = await createBackup(store);
 * const isValid = validateBackup(backup);
 * ```
 */

import type { Event } from "./adt.ts";
import type { Result } from "./result.ts";
import type { StoreError } from "./ports.ts";
import { err, ok } from "./result.ts";

export type BackupMetadata = {
  readonly version: string;
  readonly timestamp: string;
  readonly eventCount: number;
  readonly checksum?: string;
};

export type BackupFormat = {
  readonly metadata: BackupMetadata;
  readonly events: readonly Event[];
};

/**
 * Create a backup of events with metadata.
 */
export function createBackup(
  events: readonly Event[],
  version = "1.0",
): BackupFormat {
  return {
    metadata: {
      version,
      timestamp: new Date().toISOString(),
      eventCount: events.length,
    },
    events,
  };
}

/**
 * Validate a backup file format.
 */
export function validateBackup(
  data: unknown,
): Result<BackupFormat, { reason: string }> {
  if (!data || typeof data !== "object") {
    return err({ reason: "Backup must be an object" });
  }

  const backup = data as Record<string, unknown>;

  if (!backup.metadata || typeof backup.metadata !== "object") {
    return err({ reason: "Missing or invalid metadata" });
  }

  if (!Array.isArray(backup.events)) {
    return err({ reason: "Missing or invalid events array" });
  }

  const metadata = backup.metadata as Record<string, unknown>;

  if (typeof metadata.version !== "string") {
    return err({ reason: "Missing version in metadata" });
  }

  if (typeof metadata.timestamp !== "string") {
    return err({ reason: "Missing timestamp in metadata" });
  }

  if (typeof metadata.eventCount !== "number") {
    return err({ reason: "Missing eventCount in metadata" });
  }

  if (metadata.eventCount !== backup.events.length) {
    return err({
      reason:
        `Event count mismatch: expected ${metadata.eventCount}, got ${backup.events.length}`,
    });
  }

  return ok(backup as BackupFormat);
}

/**
 * Export events to a JSON backup file.
 */
export async function exportToFile(
  events: readonly Event[],
  filePath: string,
  version = "1.0",
): Promise<Result<void, StoreError>> {
  try {
    const backup = createBackup(events, version);
    const json = JSON.stringify(backup, null, 2);
    await Deno.writeTextFile(filePath, json);
    return ok(undefined);
  } catch (error) {
    if (error instanceof Deno.errors.PermissionDenied) {
      return err({
        _type: "PermissionDenied",
        path: filePath,
        operation: "write",
      });
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (
      reason.includes("No space left") || reason.includes("ENOSPC") ||
      reason.includes("disk full")
    ) {
      return err({ _type: "DiskFull", path: filePath });
    }
    return err({
      _type: "Corruption",
      path: filePath,
      reason: `Export failed: ${reason}`,
    });
  }
}

/**
 * Import events from a JSON backup file.
 */
export async function importFromFile(
  filePath: string,
): Promise<Result<readonly Event[], StoreError>> {
  try {
    const json = await Deno.readTextFile(filePath);
    const data = JSON.parse(json);

    const validation = validateBackup(data);
    if (!validation.ok) {
      return err({
        _type: "ParseError",
        line: 0,
        content: json.substring(0, 100),
        reason: validation.error.reason,
      });
    }

    return ok(validation.value.events);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return err({
        _type: "Corruption",
        path: filePath,
        reason: "Backup file not found",
      });
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      return err({
        _type: "PermissionDenied",
        path: filePath,
        operation: "read",
      });
    }
    const reason = error instanceof Error ? error.message : String(error);
    return err({
      _type: "ParseError",
      line: 0,
      content: "",
      reason: `Import failed: ${reason}`,
    });
  }
}

/**
 * Create a compressed backup (JSONL format for space efficiency).
 */
export async function exportToJsonl(
  events: readonly Event[],
  filePath: string,
): Promise<Result<void, StoreError>> {
  try {
    const lines = events.map((e) => JSON.stringify(e)).join("\n");
    await Deno.writeTextFile(filePath, lines);
    return ok(undefined);
  } catch (error) {
    if (error instanceof Deno.errors.PermissionDenied) {
      return err({
        _type: "PermissionDenied",
        path: filePath,
        operation: "write",
      });
    }
    const reason = error instanceof Error ? error.message : String(error);
    return err({
      _type: "Corruption",
      path: filePath,
      reason: `Export failed: ${reason}`,
    });
  }
}

/**
 * Import from a JSONL backup file.
 */
export async function importFromJsonl(
  filePath: string,
): Promise<Result<readonly Event[], StoreError>> {
  try {
    const text = await Deno.readTextFile(filePath);
    const events: Event[] = [];
    let lineNumber = 0;

    for (const line of text.split("\n")) {
      lineNumber++;
      if (line.trim()) {
        try {
          events.push(JSON.parse(line));
        } catch (parseError) {
          const reason = parseError instanceof Error
            ? parseError.message
            : String(parseError);
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
      return err({
        _type: "Corruption",
        path: filePath,
        reason: "Backup file not found",
      });
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      return err({
        _type: "PermissionDenied",
        path: filePath,
        operation: "read",
      });
    }
    const reason = error instanceof Error ? error.message : String(error);
    return err({
      _type: "Corruption",
      path: filePath,
      reason: `Import failed: ${reason}`,
    });
  }
}

/**
 * Create an incremental backup (only events after a certain point).
 */
export function createIncrementalBackup(
  events: readonly Event[],
  since: string, // ISO timestamp
): BackupFormat {
  const filtered = events.filter((e) => {
    const eventTime = "createdAt" in e
      ? (e as { createdAt: string }).createdAt
      : "";
    return eventTime > since;
  });

  return createBackup(filtered, "1.0-incremental");
}
