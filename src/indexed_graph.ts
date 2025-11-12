import type { GraphState, Issue, IssueId, IssueStatus } from "./adt.ts";

/**
 * IndexedGraphState extends GraphState with pre-computed indexes for common queries.
 * This dramatically improves query performance from O(N) to O(1) for filtered searches.
 */
export type IndexedGraphState = GraphState & {
  readonly indexes: {
    // Issues grouped by status for fast filtering
    readonly byStatus: ReadonlyMap<IssueStatus, ReadonlySet<IssueId>>;
    // Issues grouped by priority (0-3) for fast filtering
    readonly byPriority: ReadonlyMap<number, ReadonlySet<IssueId>>;
    // Issues grouped by label for fast label searches
    readonly byLabel: ReadonlyMap<string, ReadonlySet<IssueId>>;
    // Pre-computed ready issues (open/doing with no open blockers)
    // This eliminates the need to check blockers on every query
    readonly readyIssues: ReadonlySet<IssueId>;
  };
};

/**
 * Builds indexes from a GraphState.
 * This function is called after materialization to compute all indexes.
 */
export function buildIndexes(g: GraphState): IndexedGraphState {
  const byStatus = new Map<IssueStatus, Set<IssueId>>();
  const byPriority = new Map<number, Set<IssueId>>();
  const byLabel = new Map<string, Set<IssueId>>();
  const readyIssuesSet = new Set<IssueId>();

  // Build indexes by iterating through all issues once
  for (const [id, issue] of g.issues) {
    // Index by status
    if (!byStatus.has(issue.status)) {
      byStatus.set(issue.status, new Set());
    }
    byStatus.get(issue.status)!.add(id);

    // Index by priority
    if (!byPriority.has(issue.priority)) {
      byPriority.set(issue.priority, new Set());
    }
    byPriority.get(issue.priority)!.add(id);

    // Index by label
    for (const label of issue.labels) {
      if (!byLabel.has(label)) {
        byLabel.set(label, new Set());
      }
      byLabel.get(label)!.add(id);
    }

    // Check if issue is ready (open/doing with no open blockers)
    if (issue.status === "open" || issue.status === "doing") {
      const blockers = (g.incoming.get(id) ?? []).filter((l) =>
        l.type === "blocks"
      );
      const hasOpenBlocker = blockers.some((l) => {
        const blocker = g.issues.get(l.from);
        return blocker && blocker.status !== "done" &&
          blocker.status !== "canceled";
      });
      if (!hasOpenBlocker) {
        readyIssuesSet.add(id);
      }
    }
  }

  return {
    ...g,
    indexes: {
      byStatus,
      byPriority,
      byLabel,
      readyIssues: readyIssuesSet,
    },
  };
}

/**
 * Incrementally updates indexes when an issue is created.
 * This is more efficient than rebuilding all indexes.
 */
export function indexIssueCreated(
  indexed: IndexedGraphState,
  issue: Issue,
): IndexedGraphState {
  const byStatus = new Map(indexed.indexes.byStatus);
  const byPriority = new Map(indexed.indexes.byPriority);
  const byLabel = new Map(indexed.indexes.byLabel);
  const readyIssues = new Set(indexed.indexes.readyIssues);

  // Update status index
  if (!byStatus.has(issue.status)) {
    byStatus.set(issue.status, new Set());
  }
  const statusSet = new Set(byStatus.get(issue.status)!);
  statusSet.add(issue.id);
  byStatus.set(issue.status, statusSet);

  // Update priority index
  if (!byPriority.has(issue.priority)) {
    byPriority.set(issue.priority, new Set());
  }
  const prioritySet = new Set(byPriority.get(issue.priority)!);
  prioritySet.add(issue.id);
  byPriority.set(issue.priority, prioritySet);

  // Update label indexes
  for (const label of issue.labels) {
    if (!byLabel.has(label)) {
      byLabel.set(label, new Set());
    }
    const labelSet = new Set(byLabel.get(label)!);
    labelSet.add(issue.id);
    byLabel.set(label, labelSet);
  }

  // Update ready issues if applicable
  if (issue.status === "open" || issue.status === "doing") {
    const blockers = (indexed.incoming.get(issue.id) ?? []).filter((l) =>
      l.type === "blocks"
    );
    const hasOpenBlocker = blockers.some((l) => {
      const blocker = indexed.issues.get(l.from);
      return blocker && blocker.status !== "done" &&
        blocker.status !== "canceled";
    });
    if (!hasOpenBlocker) {
      readyIssues.add(issue.id);
    }
  }

  return {
    ...indexed,
    indexes: {
      byStatus,
      byPriority,
      byLabel,
      readyIssues,
    },
  };
}
