/**
 * @module query
 *
 * Graph query operations for finding ready work and analyzing dependencies.
 *
 * Provides functions to query the issue graph for ready issues (those with
 * no open blockers) and explain why an issue is blocked.
 *
 * @example
 * ```ts
 * import { ready, explainBlocked } from "@trinkets/core/query";
 *
 * const readyIssues = ready(graph, { priorities: [0, 1] });
 * const blocking = explainBlocked(graph, issueId);
 * ```
 */

import type { GraphState, Issue, IssueId } from "./adt.ts";
import { validateIssueId } from "./schemas_runtime.ts";

/**
 * Finds all issues that are ready to work on (no open blockers).
 *
 * An issue is ready if it's open/doing and has no blocking issues that are
 * also open/doing. Results are sorted by priority (ascending) then creation time.
 *
 * @param g The graph state to query
 * @param opts Optional filters
 * @param opts.kinds Filter by issue kinds
 * @param opts.priorities Filter by priorities (0-3)
 * @param opts.label Filter by a specific label
 * @returns Array of ready issues, sorted by priority then creation time
 */
export function ready(
  g: GraphState,
  opts?: {
    kinds?: readonly string[];
    priorities?: readonly number[];
    label?: string;
  },
): readonly Issue[] {
  const res: Issue[] = [];
  for (const issue of g.issues.values()) {
    if (!(issue.status === "open" || issue.status === "doing")) continue;
    if (opts?.kinds && !opts.kinds.includes(issue.kind)) continue;
    if (opts?.priorities && !opts.priorities.includes(issue.priority)) continue;
    if (opts?.label && !issue.labels.includes(opts.label)) continue;
    const blockers = (g.incoming.get(issue.id) ?? []).filter((l) =>
      l.type === "blocks"
    );
    const hasOpenBlocker = blockers.some((l) => {
      const up = g.issues.get(l.from);
      return up && up.status !== "done" && up.status !== "canceled";
    });
    if (!hasOpenBlocker) res.push(issue);
  }
  return res.sort((a, b) =>
    a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)
  );
}

/**
 * Returns the IDs of all issues blocking the specified issue.
 *
 * @param g The graph state to query
 * @param id The issue ID to check for blockers
 * @returns Array of issue IDs that block the given issue (empty if none or invalid ID)
 */
export function explainBlocked(g: GraphState, id: string): readonly string[] {
  // Validate id format before using it
  if (!validateIssueId(id)) {
    return [];
  }
  return (g.incoming.get(id as IssueId) ?? []).filter((l) =>
    l.type === "blocks"
  ).map((l) => l.from);
}
