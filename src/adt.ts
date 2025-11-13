/** Branded string type for issue IDs (format: `bd-*`). */
export type IssueId = `bd-${string}`;

/** Issue classification types. */
export type IssueKind = "feature" | "bug" | "chore" | "note" | "epic";

/** Issue workflow states. */
export type IssueStatus = "open" | "doing" | "done" | "canceled";

/**
 * An issue in the tracker with all metadata.
 *
 * Issues are immutable - use events to modify them.
 */
export type Issue = Readonly<{
  /** Unique issue identifier. */
  id: IssueId;
  /** Issue title. */
  title: string;
  /** Optional detailed description. */
  body?: string;
  /** Issue classification. */
  kind: IssueKind;
  /** Priority level (0 = highest, 3 = lowest). */
  priority: 0 | 1 | 2 | 3;
  /** Current workflow status. */
  status: IssueStatus;
  /** Array of label strings. */
  labels: readonly string[];
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** ISO timestamp when closed (done/canceled). */
  closedAt?: string;
}>;

/** Dependency link types between issues. */
export type DepType = "blocks" | "parent-child" | "related" | "discovered-from";

/**
 * A directed dependency link between two issues.
 */
export type Link = Readonly<
  {
    /** Source issue ID. */
    from: IssueId;
    /** Target issue ID. */
    to: IssueId;
    /** Link relationship type. */
    type: DepType;
    /** ISO timestamp of link creation. */
    createdAt: string;
  }
>;

/** Event: New issue created. */
export type IssueCreated = Readonly<{ _type: "IssueCreated"; issue: Issue }>;

/** Event: Issue fields partially updated. */
export type IssuePatched = Readonly<
  {
    _type: "IssuePatched";
    id: IssueId;
    patch: Partial<
      Pick<Issue, "title" | "body" | "priority" | "labels" | "kind">
    >;
    updatedAt: string;
  }
>;

/** Event: Issue status changed. */
export type IssueStatusSet = Readonly<
  { _type: "IssueStatusSet"; id: IssueId; status: IssueStatus; at: string }
>;

/** Event: Dependency link added. */
export type LinkAdded = Readonly<{ _type: "LinkAdded"; link: Link }>;

/** Event: Dependency link removed. */
export type LinkRemoved = Readonly<
  {
    _type: "LinkRemoved";
    from: IssueId;
    to: IssueId;
    type: DepType;
    at: string;
  }
>;

/** Discriminated union of all event types. */
export type Event =
  | IssueCreated
  | IssuePatched
  | IssueStatusSet
  | LinkAdded
  | LinkRemoved;

/**
 * Materialized graph state with indexed dependency links.
 *
 * The graph maintains bidirectional link indexes for efficient queries.
 */
export type GraphState = Readonly<
  {
    /** All issues indexed by ID. */
    issues: ReadonlyMap<IssueId, Issue>;
    /** Links originating from each issue. */
    outgoing: ReadonlyMap<IssueId, readonly Link[]>;
    /** Links pointing to each issue. */
    incoming: ReadonlyMap<IssueId, readonly Link[]>;
  }
>;
