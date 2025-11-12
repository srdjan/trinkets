
import type { GraphState, Issue } from "./adt.ts";
import { ready as baseReady } from "./query.ts";
export type SearchFilter = Readonly<{ label?: string; text?: string; kinds?: readonly string[]; priorities?: readonly number[]; }>;
export function filterIssues(g: GraphState, f: SearchFilter): readonly Issue[] {
  const t = f.text?.toLowerCase(); const res: Issue[] = [];
  for (const i of g.issues.values()) {
    if (f.label && !i.labels.includes(f.label)) continue;
    if (f.kinds && !f.kinds.includes(i.kind)) continue;
    if (f.priorities && !f.priorities.includes(i.priority)) continue;
    if (t && !((i.title || "").toLowerCase().includes(t) || (i.body || "").toLowerCase().includes(t))) continue;
    res.push(i);
  } return res;
}
export type NextStrategy = "priority-first" | "oldest-first" | "shortest-title";
export function ready(g: GraphState, f?: SearchFilter): readonly Issue[] {
  const r = baseReady(g); if (!f) return r; const set = new Set(r.map(i => i.id)); return filterIssues(g, f).filter(i => set.has(i.id));
}
export function nextWork(g: GraphState, f?: SearchFilter, s: NextStrategy = "priority-first"): Issue | undefined {
  const r = ready(g, f); if (r.length === 0) return undefined;
  switch (s) { case "priority-first": return [...r].sort((a,b)=>a.priority-b.priority||a.createdAt.localeCompare(b.createdAt))[0];
    case "oldest-first": return [...r].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
    case "shortest-title": return [...r].sort((a,b)=>(a.title.length-b.title.length)||(a.priority-b.priority))[0];
    default: return r[0]; }
}
