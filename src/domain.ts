
import type { Env, StorePort } from "./ports.ts";
import type { DepType, Issue, IssueId, IssueKind, IssueStatus, GraphState } from "./adt.ts";
import { materializeFromEvents } from "./domain_materialize.ts";
import { newIssueId } from "./id.ts";

export async function initRepo(_store: StorePort): Promise<void> { await _store.scan(); }

export async function createIssue(store: StorePort, env: Env, input: { title: string; body?: string; kind?: IssueKind; priority?: number; labels?: readonly string[]; }) {
  const g = materializeFromEvents(await store.scan());
  const existing = new Set(g.issues.keys());
  const now = env.now();
  const id = await newIssueId(`${input.title}|${now}|${Math.random()}`, existing) as IssueId;
  const issue: Issue = { id, title: input.title, body: input.body, kind: (input.kind ?? "feature"), priority: (Math.max(0, Math.min(3, Math.floor(input.priority ?? 2))) as 0|1|2|3), status: "open", labels: [...(input.labels ?? [])], createdAt: now, updatedAt: now };
  await store.append({ _type: "IssueCreated", issue });
  return issue;
}
export async function addLink(store: StorePort, env: Env, input: { from: IssueId; to: IssueId; type: DepType; }) {
  if (input.from === input.to) throw new Error("self link not allowed");
  await store.append({ _type: "LinkAdded", link: { ...input, createdAt: env.now() } });
}
export async function setStatus(store: StorePort, env: Env, id: IssueId, status: IssueStatus) {
  await store.append({ _type: "IssueStatusSet", id, status, at: env.now() });
}
export async function patchIssue(store: StorePort, env: Env, id: IssueId, patch: Partial<Pick<Issue,"title"|"body"|"priority"|"labels"|"kind">>) {
  await store.append({ _type: "IssuePatched", id, patch, updatedAt: env.now() });
}
export function validateInvariants(g: GraphState): readonly string[] {
  const errors: string[] = []; const visiting = new Set<string>(), visited = new Set<string>();
  function dfs(id: string): boolean { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id);
    for (const l of g.outgoing.get(id as any) ?? []) { if (l.type === "blocks" && dfs(l.to)) return true; } visiting.delete(id); visited.add(id); return false; }
  for (const id of g.issues.keys()) { if (dfs(id)) { errors.push(`cycle detected via ${id}`); break; } }
  for (const [id, issue] of g.issues) { if (issue.status === "done") { const children = (g.outgoing.get(id) ?? []).filter(l => l.type === "parent-child").map(l => l.to);
      if (children.some(cid => { const c = g.issues.get(cid); return c && c.status !== "done" && c.status !== "canceled"; })) { errors.push(`parent ${id} done but has open children`); } } }
  return errors;
}
