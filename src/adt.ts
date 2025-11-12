export type IssueId = `bd-${string}`;
export type IssueKind = "feature" | "bug" | "chore" | "note" | "epic";
export type IssueStatus = "open" | "doing" | "done" | "canceled";
export type Issue = Readonly<{
  id: IssueId;
  title: string;
  body?: string;
  kind: IssueKind;
  priority: 0 | 1 | 2 | 3;
  status: IssueStatus;
  labels: readonly string[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}>;
export type DepType = "blocks" | "parent-child" | "related" | "discovered-from";
export type Link = Readonly<
  { from: IssueId; to: IssueId; type: DepType; createdAt: string }
>;
export type IssueCreated = Readonly<{ _type: "IssueCreated"; issue: Issue }>;
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
export type IssueStatusSet = Readonly<
  { _type: "IssueStatusSet"; id: IssueId; status: IssueStatus; at: string }
>;
export type LinkAdded = Readonly<{ _type: "LinkAdded"; link: Link }>;
export type LinkRemoved = Readonly<
  {
    _type: "LinkRemoved";
    from: IssueId;
    to: IssueId;
    type: DepType;
    at: string;
  }
>;
export type Event =
  | IssueCreated
  | IssuePatched
  | IssueStatusSet
  | LinkAdded
  | LinkRemoved;
export type GraphState = Readonly<
  {
    issues: ReadonlyMap<IssueId, Issue>;
    outgoing: ReadonlyMap<IssueId, readonly Link[]>;
    incoming: ReadonlyMap<IssueId, readonly Link[]>;
  }
>;
