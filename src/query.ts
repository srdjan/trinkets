import type { GraphState, Issue, IssueId } from "./adt.ts";
import { validateIssueId } from "./schemas_runtime.ts";

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

export function explainBlocked(g: GraphState, id: string): readonly string[] {
  // Validate id format before using it
  if (!validateIssueId(id)) {
    return [];
  }
  return (g.incoming.get(id as IssueId) ?? []).filter((l) =>
    l.type === "blocks"
  ).map((l) => l.from);
}
