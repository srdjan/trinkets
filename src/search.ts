/**
 * @module search
 *
 * Advanced search and filtering for issues with multiple strategies.
 *
 * Provides text search, label filtering, and configurable work selection
 * strategies (priority-first, oldest-first, shortest-title).
 *
 * @example
 * ```ts
 * import { filterIssues, nextWork } from "@trinkets/core/search";
 *
 * const filtered = filterIssues(graph, { label: "bug", text: "auth" });
 * const next = nextWork(graph, { priorities: [0] }, "priority-first");
 * ```
 */

import type { GraphState, Issue } from "./adt.ts";
import { ready as baseReady } from "./query.ts";
/** Filter criteria for issue search. */
export type SearchFilter = Readonly<
  {
    /** Filter by a specific label */
    label?: string;
    /** Text search in title and body (case-insensitive) */
    text?: string;
    /** Filter by issue kinds */
    kinds?: readonly string[];
    /** Filter by priorities (0-3) */
    priorities?: readonly number[];
  }
>;

/**
 * Filters issues by label, text, kind, and priority.
 *
 * Text search is case-insensitive and matches against both title and body.
 *
 * @param g The graph state to query
 * @param f The search filter criteria
 * @returns Array of issues matching all specified filters
 */
export function filterIssues(g: GraphState, f: SearchFilter): readonly Issue[] {
  const t = f.text?.toLowerCase();
  const res: Issue[] = [];
  for (const i of g.issues.values()) {
    if (f.label && !i.labels.includes(f.label)) continue;
    if (f.kinds && !f.kinds.includes(i.kind)) continue;
    if (f.priorities && !f.priorities.includes(i.priority)) continue;
    if (
      t &&
      !((i.title || "").toLowerCase().includes(t) ||
        (i.body || "").toLowerCase().includes(t))
    ) continue;
    res.push(i);
  }
  return res;
}
/** Strategy for selecting the next work item. */
export type NextStrategy = "priority-first" | "oldest-first" | "shortest-title";

/**
 * Finds ready issues (no blockers) matching the search filter.
 *
 * @param g The graph state to query
 * @param f Optional search filter
 * @returns Array of ready issues matching the filter
 */
export function ready(g: GraphState, f?: SearchFilter): readonly Issue[] {
  const r = baseReady(g);
  if (!f) return r;
  const set = new Set(r.map((i) => i.id));
  return filterIssues(g, f).filter((i) => set.has(i.id));
}

/**
 * Selects the next issue to work on using a specific strategy.
 *
 * @param g The graph state to query
 * @param f Optional search filter to narrow results
 * @param s Selection strategy (defaults to "priority-first")
 * @returns The next issue to work on, or undefined if none ready
 */
export function nextWork(
  g: GraphState,
  f?: SearchFilter,
  s: NextStrategy = "priority-first",
): Issue | undefined {
  const r = ready(g, f);
  if (r.length === 0) return undefined;
  switch (s) {
    case "priority-first":
      return [...r].sort((a, b) =>
        a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)
      )[0];
    case "oldest-first":
      return [...r].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    case "shortest-title":
      return [...r].sort((a, b) =>
        (a.title.length - b.title.length) || (a.priority - b.priority)
      )[0];
    default:
      return r[0];
  }
}
