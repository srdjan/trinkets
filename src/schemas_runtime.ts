import type { GraphState, Issue, IssueId, Link } from "./adt.ts";

export type ValidationError = Readonly<{ field: string; reason: string }>;

export function validateIssueId(id: unknown): id is IssueId {
  return typeof id === "string" && id.startsWith("bd-") && id.length > 3;
}

export function validateGraphState(
  data: unknown,
): { valid: true; state: GraphState } | {
  valid: false;
  errors: readonly ValidationError[];
} {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== "object") {
    return {
      valid: false,
      errors: [{ field: "root", reason: "Must be an object" }],
    };
  }

  const d = data as Record<string, unknown>;

  // Check for version field
  if (!("version" in d)) {
    errors.push({ field: "version", reason: "Missing version field" });
  } else if (typeof d.version !== "number") {
    errors.push({ field: "version", reason: "Version must be a number" });
  } else if (d.version !== 1) {
    errors.push({
      field: "version",
      reason: `Unsupported version: ${d.version}, expected: 1`,
    });
  }

  // Check issues
  if (!("issues" in d)) {
    errors.push({ field: "issues", reason: "Missing issues field" });
  } else if (!Array.isArray(d.issues)) {
    errors.push({ field: "issues", reason: "Issues must be an array" });
  } else {
    for (let i = 0; i < d.issues.length; i++) {
      const entry = d.issues[i];
      if (!Array.isArray(entry) || entry.length !== 2) {
        errors.push({
          field: `issues[${i}]`,
          reason: "Entry must be [id, issue] tuple",
        });
        continue;
      }
      const [id, issue] = entry;
      if (!validateIssueId(id)) {
        errors.push({
          field: `issues[${i}][0]`,
          reason: "Invalid IssueId format",
        });
      }
      if (!issue || typeof issue !== "object") {
        errors.push({
          field: `issues[${i}][1]`,
          reason: "Issue must be an object",
        });
      }
    }
  }

  // Check outgoing
  if (!("outgoing" in d)) {
    errors.push({ field: "outgoing", reason: "Missing outgoing field" });
  } else if (!Array.isArray(d.outgoing)) {
    errors.push({ field: "outgoing", reason: "Outgoing must be an array" });
  }

  // Check incoming
  if (!("incoming" in d)) {
    errors.push({ field: "incoming", reason: "Missing incoming field" });
  } else if (!Array.isArray(d.incoming)) {
    errors.push({ field: "incoming", reason: "Incoming must be an array" });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Reconstruct the GraphState from validated data
  const issuesArray = d.issues as Array<[IssueId, unknown]>;
  const outgoingArray = d.outgoing as Array<[IssueId, unknown]>;
  const incomingArray = d.incoming as Array<[IssueId, unknown]>;

  const state: GraphState = {
    issues: new Map(issuesArray as Array<[IssueId, Issue]>),
    outgoing: new Map(outgoingArray as Array<[IssueId, readonly Link[]]>),
    incoming: new Map(incomingArray as Array<[IssueId, readonly Link[]]>),
  };

  return { valid: true, state };
}
