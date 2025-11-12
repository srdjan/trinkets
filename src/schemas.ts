import {
  array,
  literal,
  number,
  object,
  optional,
  parse,
  string,
  union,
} from "npm:valibot@0.31.0";
import type { Event } from "./adt.ts";
export const IssueSchema = object({
  id: string(),
  title: string(),
  body: optional(string()),
  kind: union([
    literal("feature"),
    literal("bug"),
    literal("chore"),
    literal("note"),
    literal("epic"),
  ]),
  priority: number(),
  status: union([
    literal("open"),
    literal("doing"),
    literal("done"),
    literal("canceled"),
  ]),
  labels: array(string()),
  createdAt: string(),
  updatedAt: string(),
  closedAt: optional(string()),
});
export const LinkSchema = object({
  from: string(),
  to: string(),
  type: union([
    literal("blocks"),
    literal("parent-child"),
    literal("related"),
    literal("discovered-from"),
  ]),
  createdAt: string(),
});
const IssueCreated = object({
  _type: literal("IssueCreated"),
  issue: IssueSchema,
});
const IssuePatched = object({
  _type: literal("IssuePatched"),
  id: string(),
  patch: object({
    title: optional(string()),
    body: optional(string()),
    priority: optional(number()),
    labels: optional(array(string())),
    kind: optional(
      union([
        literal("feature"),
        literal("bug"),
        literal("chore"),
        literal("note"),
        literal("epic"),
      ]),
    ),
  }),
  updatedAt: string(),
});
const IssueStatusSet = object({
  _type: literal("IssueStatusSet"),
  id: string(),
  status: union([
    literal("open"),
    literal("doing"),
    literal("done"),
    literal("canceled"),
  ]),
  at: string(),
});
const LinkAdded = object({ _type: literal("LinkAdded"), link: LinkSchema });
const LinkRemoved = object({
  _type: literal("LinkRemoved"),
  from: string(),
  to: string(),
  type: union([
    literal("blocks"),
    literal("parent-child"),
    literal("related"),
    literal("discovered-from"),
  ]),
  at: string(),
});
export const EventSchema = union([
  IssueCreated,
  IssuePatched,
  IssueStatusSet,
  LinkAdded,
  LinkRemoved,
]);
export function parseEvent(e: unknown): Event {
  return parse(EventSchema, e) as unknown as Event;
}
