/**
 * @module query/indexed
 *
 * Optimized query functions using indexed graph state.
 *
 * Provides O(1) filtered queries (ready, byStatus, byPriority, byLabel)
 * using pre-computed indexes for dramatic performance improvements.
 *
 * @example
 * ```ts
 * import { ready, byPriority } from "@trinkets/core/query/indexed";
 * import { buildIndexes } from "@trinkets/core/indexed";
 *
 * const indexed = buildIndexes(graph);
 * const readyIssues = ready(indexed, { priorities: [0, 1] });
 * const highPri = byPriority(indexed, 0);
 * ```
 */

import type { Issue, IssueId, IssueStatus } from "./adt.ts";
import type { IndexedGraphState } from "./indexed_graph.ts";

/**
 * Optimized ready() function that uses pre-computed indexes.
 * Performance: O(1) to O(K) where K is the number of matching issues,
 * compared to O(N) for the original implementation.
 */
export function ready(
  g: IndexedGraphState,
  opts?: {
    kinds?: readonly string[];
    priorities?: readonly number[];
    label?: string;
  },
): readonly Issue[] {
  // Start with pre-computed ready issues (already filtered by status and blockers)
  let candidateIds: ReadonlySet<IssueId> = g.indexes.readyIssues;

  // Apply priority filter using index (O(1) lookup instead of O(N) iteration)
  if (opts?.priorities && opts.priorities.length > 0) {
    const priorityFiltered = new Set<IssueId>();
    for (const priority of opts.priorities) {
      const idsWithPriority = g.indexes.byPriority.get(priority);
      if (idsWithPriority) {
        for (const id of idsWithPriority) {
          if (candidateIds.has(id)) {
            priorityFiltered.add(id);
          }
        }
      }
    }
    candidateIds = priorityFiltered;
  }

  // Apply label filter using index (O(1) lookup instead of O(N) iteration)
  if (opts?.label) {
    const labelFiltered = new Set<IssueId>();
    const idsWithLabel = g.indexes.byLabel.get(opts.label);
    if (idsWithLabel) {
      for (const id of idsWithLabel) {
        if (candidateIds.has(id)) {
          labelFiltered.add(id);
        }
      }
    }
    candidateIds = labelFiltered;
  }

  // Collect matching issues
  const res: Issue[] = [];
  for (const id of candidateIds) {
    const issue = g.issues.get(id);
    if (!issue) continue;

    // Kind filter (no index for this, but we've already filtered most issues)
    if (opts?.kinds && !opts.kinds.includes(issue.kind)) continue;

    res.push(issue);
  }

  // Sort by priority, then creation time
  return res.sort((a, b) =>
    a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)
  );
}

/**
 * Get all issues with a specific status.
 * Performance: O(K) where K is the number of issues with that status.
 */
export function byStatus(
  g: IndexedGraphState,
  status: IssueStatus,
): readonly Issue[] {
  const ids = g.indexes.byStatus.get(status);
  if (!ids) return [];

  const res: Issue[] = [];
  for (const id of ids) {
    const issue = g.issues.get(id);
    if (issue) res.push(issue);
  }
  return res;
}

/**
 * Get all issues with a specific priority.
 * Performance: O(K) where K is the number of issues with that priority.
 */
export function byPriority(
  g: IndexedGraphState,
  priority: number,
): readonly Issue[] {
  const ids = g.indexes.byPriority.get(priority);
  if (!ids) return [];

  const res: Issue[] = [];
  for (const id of ids) {
    const issue = g.issues.get(id);
    if (issue) res.push(issue);
  }
  return res;
}

/**
 * Get all issues with a specific label.
 * Performance: O(K) where K is the number of issues with that label.
 */
export function byLabel(
  g: IndexedGraphState,
  label: string,
): readonly Issue[] {
  const ids = g.indexes.byLabel.get(label);
  if (!ids) return [];

  const res: Issue[] = [];
  for (const id of ids) {
    const issue = g.issues.get(id);
    if (issue) res.push(issue);
  }
  return res;
}
