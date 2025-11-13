/**
 * @module domain
 *
 * Core domain logic for event-sourced issue tracking.
 *
 * This module provides pure functions for creating and manipulating issues,
 * links, and the issue graph. All functions are deterministic and side-effect
 * free, accepting ports for I/O operations.
 *
 * @example
 * ```ts
 * import { createIssue, addLink, setStatus } from "@trinkets/core/domain";
 *
 * const result = await createIssue(store, env, {
 *   title: "Fix bug",
 *   priority: 0
 * });
 * ```
 */

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

/**
 * Initializes a new trinkets repository by verifying store accessibility.
 * @param store The store port to initialize
 * @returns Result indicating success or store error
 */
export async function initRepo(
  store: StorePort,
): Promise<Result<void, StoreError>> {
  const scanResult = await store.scan();
  if (!scanResult.ok) return scanResult;
  return ok(undefined);
}

/**
 * Creates a new issue with a deterministic ID and appends an IssueCreated event.
 *
 * @param store The store port for event persistence
 * @param env Environment for timestamp generation
 * @param input Issue creation parameters
 * @param input.title The issue title (required)
 * @param input.body Optional issue description
 * @param input.kind Issue type (defaults to "feature")
 * @param input.priority Priority 0-3, where 0 is highest (defaults to 2)
 * @param input.labels Optional array of label strings
 * @returns Result containing the created Issue or a StoreError
 */
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

/**
 * Creates a dependency link between two issues. Prevents self-links.
 *
 * @param store The store port for event persistence
 * @param env Environment for timestamp generation
 * @param input Link parameters
 * @param input.from The source issue ID
 * @param input.to The target issue ID
 * @param input.type Link type (blocks, parent-child, related, discovered-from)
 * @returns Result indicating success or error (including self-link validation error)
 */
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

/**
 * Updates an issue's status and appends an IssueStatusSet event.
 *
 * @param store The store port for event persistence
 * @param env Environment for timestamp generation
 * @param id The issue ID to update
 * @param status The new status (open, doing, done, canceled)
 * @returns Result indicating success or store error
 */
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

/**
 * Partially updates an issue's fields and appends an IssuePatched event.
 *
 * @param store The store port for event persistence
 * @param env Environment for timestamp generation
 * @param id The issue ID to update
 * @param patch Partial update object (title, body, priority, labels, kind)
 * @returns Result indicating success or store error
 */
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

/**
 * Validates graph invariants including cycle detection and parent/child consistency.
 *
 * Checks for:
 * - Cycles in "blocks" dependency chains
 * - Done parents with open children
 *
 * @param g The graph state to validate
 * @returns Array of error messages (empty if valid)
 */
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
