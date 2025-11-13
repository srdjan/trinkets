/**
 * Data integrity verification and repair utilities.
 * Use these tools to detect corruption, validate data consistency,
 * and repair common issues in production.
 */

import type { Event, IssueId } from "./adt.ts";
import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { materializeFromEvents } from "./domain_materialize.ts";
import { validateInvariants } from "./domain.ts";
import { validateIssueId } from "./schemas_runtime.ts";

export type IntegrityIssue =
  | { type: "DuplicateIssueId"; issueId: IssueId; eventIndexes: number[] }
  | { type: "InvalidIssueId"; issueId: string; eventIndex: number }
  | { type: "MissingIssue"; issueId: IssueId; eventIndex: number }
  | { type: "SelfLink"; issueId: IssueId; eventIndex: number }
  | { type: "OrphanedLink"; linkIndex: number; from: IssueId; to: IssueId }
  | { type: "InvariantViolation"; reason: string };

export type IntegrityReport = {
  readonly healthy: boolean;
  readonly issues: readonly IntegrityIssue[];
  readonly stats: {
    readonly totalEvents: number;
    readonly issueEvents: number;
    readonly linkEvents: number;
    readonly totalIssues: number;
    readonly totalLinks: number;
  };
};

/**
 * Verify the integrity of an event log.
 * Returns a detailed report of any issues found.
 */
export function verifyIntegrity(
  events: readonly Event[],
): Result<IntegrityReport, never> {
  const issues: IntegrityIssue[] = [];
  const issueCreationIndexes = new Map<IssueId, number[]>();
  let issueEventCount = 0;
  let linkEventCount = 0;

  // First pass: check event-level integrity
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;

    if (event._type === "IssueCreated") {
      issueEventCount++;
      const id = event.issue.id;

      // Check for valid IssueId format
      if (!validateIssueId(id)) {
        issues.push({
          type: "InvalidIssueId",
          issueId: id,
          eventIndex: i,
        });
      }

      // Track creation events for duplicate detection
      const indexes = issueCreationIndexes.get(id) ?? [];
      indexes.push(i);
      issueCreationIndexes.set(id, indexes);
    } else if (event._type.startsWith("Issue")) {
      issueEventCount++;
    } else {
      linkEventCount++;
    }

    // Check for self-links
    if (event._type === "LinkAdded" && event.link.from === event.link.to) {
      issues.push({
        type: "SelfLink",
        issueId: event.link.from,
        eventIndex: i,
      });
    }
  }

  // Check for duplicate issue IDs
  for (const [issueId, indexes] of issueCreationIndexes) {
    if (indexes.length > 1) {
      issues.push({
        type: "DuplicateIssueId",
        issueId,
        eventIndexes: indexes,
      });
    }
  }

  // Second pass: materialize and check referential integrity
  const state = materializeFromEvents(events);
  const validIssueIds = new Set(state.issues.keys());

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;

    // Check that issue operations reference existing issues
    if (
      event._type === "IssuePatched" ||
      event._type === "IssueStatusSet"
    ) {
      if (!validIssueIds.has(event.id)) {
        issues.push({
          type: "MissingIssue",
          issueId: event.id,
          eventIndex: i,
        });
      }
    }

    // Check that links reference existing issues
    if (event._type === "LinkAdded") {
      if (!validIssueIds.has(event.link.from)) {
        issues.push({
          type: "OrphanedLink",
          linkIndex: i,
          from: event.link.from,
          to: event.link.to,
        });
      }
      if (!validIssueIds.has(event.link.to)) {
        issues.push({
          type: "OrphanedLink",
          linkIndex: i,
          from: event.link.from,
          to: event.link.to,
        });
      }
    }
  }

  // Check domain invariants
  const invariantErrors = validateInvariants(state);
  for (const reason of invariantErrors) {
    issues.push({
      type: "InvariantViolation",
      reason,
    });
  }

  const totalLinks = Array.from(state.outgoing.values()).reduce(
    (sum, links) => sum + links.length,
    0,
  );

  return ok({
    healthy: issues.length === 0,
    issues,
    stats: {
      totalEvents: events.length,
      issueEvents: issueEventCount,
      linkEvents: linkEventCount,
      totalIssues: state.issues.size,
      totalLinks,
    },
  });
}

/**
 * Repair common integrity issues by filtering out problematic events.
 * Returns a cleaned event log with issues removed.
 * WARNING: This is a destructive operation - backup your data first!
 */
export function repairEvents(
  events: readonly Event[],
): Result<
  { events: readonly Event[]; removed: number; issues: readonly string[] },
  never
> {
  const report = verifyIntegrity(events);
  if (!report.ok) return report;

  if (report.value.healthy) {
    return ok({ events, removed: 0, issues: [] });
  }

  const removeIndexes = new Set<number>();
  const removeIssueIds = new Set<IssueId>();
  const issuesFixed: string[] = [];

  // Mark problematic events for removal
  for (const issue of report.value.issues) {
    switch (issue.type) {
      case "DuplicateIssueId":
        // Keep first creation, remove duplicates
        for (let i = 1; i < issue.eventIndexes.length; i++) {
          removeIndexes.add(issue.eventIndexes[i]!);
        }
        issuesFixed.push(
          `Removed ${
            issue.eventIndexes.length - 1
          } duplicate creation events for ${issue.issueId}`,
        );
        break;

      case "InvalidIssueId":
        removeIndexes.add(issue.eventIndex);
        removeIssueIds.add(issue.issueId as IssueId);
        issuesFixed.push(
          `Removed event with invalid IssueId: ${issue.issueId}`,
        );
        break;

      case "SelfLink":
        removeIndexes.add(issue.eventIndex);
        issuesFixed.push(`Removed self-link for ${issue.issueId}`);
        break;

      case "MissingIssue":
        removeIndexes.add(issue.eventIndex);
        issuesFixed.push(
          `Removed operation referencing non-existent issue: ${issue.issueId}`,
        );
        break;

      case "OrphanedLink":
        removeIndexes.add(issue.linkIndex);
        issuesFixed.push(
          `Removed orphaned link from ${issue.from} to ${issue.to}`,
        );
        break;

      case "InvariantViolation":
        // Invariant violations are logged but not automatically fixed
        issuesFixed.push(`Warning: Invariant violation - ${issue.reason}`);
        break;
    }
  }

  // Also remove all events referencing removed issue IDs
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (
      event._type === "IssuePatched" ||
      event._type === "IssueStatusSet"
    ) {
      if (removeIssueIds.has(event.id)) {
        removeIndexes.add(i);
      }
    }
    if (event._type === "LinkAdded" || event._type === "LinkRemoved") {
      if (
        removeIssueIds.has(
          event._type === "LinkAdded" ? event.link.from : event.from,
        ) ||
        removeIssueIds.has(
          event._type === "LinkAdded" ? event.link.to : event.to,
        )
      ) {
        removeIndexes.add(i);
      }
    }
  }

  const cleanedEvents = events.filter((_, i) => !removeIndexes.has(i));

  return ok({
    events: cleanedEvents,
    removed: removeIndexes.size,
    issues: issuesFixed,
  });
}

/**
 * Format an integrity report as human-readable text.
 */
export function formatIntegrityReport(report: IntegrityReport): string {
  const lines: string[] = [];

  lines.push("=== Data Integrity Report ===");
  lines.push(`Status: ${report.healthy ? "✓ HEALTHY" : "✗ ISSUES FOUND"}`);
  lines.push("");
  lines.push("Statistics:");
  lines.push(`  Total Events: ${report.stats.totalEvents}`);
  lines.push(`  Issue Events: ${report.stats.issueEvents}`);
  lines.push(`  Link Events: ${report.stats.linkEvents}`);
  lines.push(`  Total Issues: ${report.stats.totalIssues}`);
  lines.push(`  Total Links: ${report.stats.totalLinks}`);
  lines.push("");

  if (report.issues.length > 0) {
    lines.push(`Found ${report.issues.length} integrity issues:`);
    lines.push("");

    for (const issue of report.issues) {
      switch (issue.type) {
        case "DuplicateIssueId":
          lines.push(
            `  ✗ Duplicate Issue ID: ${issue.issueId} (events: ${
              issue.eventIndexes.join(", ")
            })`,
          );
          break;
        case "InvalidIssueId":
          lines.push(
            `  ✗ Invalid Issue ID: "${issue.issueId}" at event ${issue.eventIndex}`,
          );
          break;
        case "MissingIssue":
          lines.push(
            `  ✗ Missing Issue: ${issue.issueId} referenced at event ${issue.eventIndex}`,
          );
          break;
        case "SelfLink":
          lines.push(
            `  ✗ Self-Link: ${issue.issueId} at event ${issue.eventIndex}`,
          );
          break;
        case "OrphanedLink":
          lines.push(
            `  ✗ Orphaned Link: ${issue.from} -> ${issue.to} at event ${issue.linkIndex}`,
          );
          break;
        case "InvariantViolation":
          lines.push(`  ✗ Invariant Violation: ${issue.reason}`);
          break;
      }
    }
  } else {
    lines.push("No integrity issues found.");
  }

  return lines.join("\n");
}
