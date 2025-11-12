import type { Env, StoreError, StorePort } from "./ports.ts";
import type {
  DepType,
  GraphState,
  Issue,
  IssueId,
  IssueKind,
  IssueStatus,
} from "./adt.ts";
import { materializeFromEvents } from "./domain_materialize.ts";
import { newIssueId } from "./id.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";

export async function initRepo(
  store: StorePort,
): Promise<Result<void, StoreError>> {
  const scanResult = await store.scan();
  if (!scanResult.ok) return scanResult;
  return ok(undefined);
}

export async function createIssue(
  store: StorePort,
  env: Env,
  input: {
    title: string;
    body?: string;
    kind?: IssueKind;
    priority?: number;
    labels?: readonly string[];
  },
): Promise<Result<Issue, StoreError>> {
  // Performance optimization: use getExistingIds if available (much faster)
  let existing: Set<string>;
  if (store.getExistingIds) {
    const idsResult = await store.getExistingIds();
    if (!idsResult.ok) return idsResult;
    existing = new Set(idsResult.value);
  } else {
    // Fallback to full scan + materialize
    const scanResult = await store.scan();
    if (!scanResult.ok) return scanResult;
    const g = materializeFromEvents(scanResult.value);
    existing = new Set(g.issues.keys());
  }

  const now = env.now();
  const id = await newIssueId(
    `${input.title}|${now}|${Math.random()}`,
    existing,
  ) as IssueId;

  const issue: Issue = {
    id,
    title: input.title,
    ...(input.body !== undefined && { body: input.body }),
    kind: input.kind ?? "feature",
    priority: Math.max(0, Math.min(3, Math.floor(input.priority ?? 2))) as
      | 0
      | 1
      | 2
      | 3,
    status: "open",
    labels: [...(input.labels ?? [])],
    createdAt: now,
    updatedAt: now,
  };

  const appendResult = await store.append({ _type: "IssueCreated", issue });
  if (!appendResult.ok) return appendResult;

  return ok(issue);
}

export async function addLink(
  store: StorePort,
  env: Env,
  input: { from: IssueId; to: IssueId; type: DepType },
): Promise<Result<void, StoreError>> {
  if (input.from === input.to) {
    return err({
      _type: "Corruption",
      path: "<domain>",
      reason: "self link not allowed",
    });
  }

  return await store.append({
    _type: "LinkAdded",
    link: { ...input, createdAt: env.now() },
  });
}

export async function setStatus(
  store: StorePort,
  env: Env,
  id: IssueId,
  status: IssueStatus,
): Promise<Result<void, StoreError>> {
  return await store.append({
    _type: "IssueStatusSet",
    id,
    status,
    at: env.now(),
  });
}

export async function patchIssue(
  store: StorePort,
  env: Env,
  id: IssueId,
  patch: Partial<
    Pick<Issue, "title" | "body" | "priority" | "labels" | "kind">
  >,
): Promise<Result<void, StoreError>> {
  return await store.append({
    _type: "IssuePatched",
    id,
    patch,
    updatedAt: env.now(),
  });
}
export function validateInvariants(g: GraphState): readonly string[] {
  const errors: string[] = [];
  const visiting = new Set<IssueId>();
  const visited = new Set<IssueId>();

  function dfs(id: IssueId): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const l of g.outgoing.get(id) ?? []) {
      if (l.type === "blocks" && dfs(l.to)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of g.issues.keys()) {
    if (dfs(id)) {
      errors.push(`cycle detected via ${id}`);
      break;
    }
  }

  for (const [id, issue] of g.issues) {
    if (issue.status === "done") {
      const children = (g.outgoing.get(id) ?? [])
        .filter((l) => l.type === "parent-child")
        .map((l) => l.to);
      if (
        children.some((cid) => {
          const c = g.issues.get(cid);
          return c && c.status !== "done" && c.status !== "canceled";
        })
      ) {
        errors.push(`parent ${id} done but has open children`);
      }
    }
  }

  return errors;
}
