import type { Event, GraphState } from "./adt.ts";
export function materializeFromEvents(events: readonly Event[]): GraphState {
  let g: GraphState = {
    issues: new Map(),
    outgoing: new Map(),
    incoming: new Map(),
  };
  for (const e of events) g = applyEvent(g, e);
  return g;
}
export function applyEvent(g: GraphState, e: Event): GraphState {
  const issues = new Map(g.issues),
    outgoing = new Map(g.outgoing),
    incoming = new Map(g.incoming);
  switch (e._type) {
    case "IssueCreated":
      issues.set(e.issue.id, e.issue);
      break;
    case "IssuePatched": {
      const cur = issues.get(e.id);
      if (cur) issues.set(e.id, { ...cur, ...e.patch, updatedAt: e.updatedAt });
      break;
    }
    case "IssueStatusSet": {
      const cur = issues.get(e.id);
      if (cur) {
        issues.set(e.id, {
          ...cur,
          status: e.status,
          updatedAt: e.at,
          closedAt: e.status === "done" ? e.at : cur.closedAt,
        });
      }
      break;
    }
    case "LinkAdded": {
      const l = e.link;
      const out = outgoing.get(l.from) ?? [], inc = incoming.get(l.to) ?? [];
      if (!out.some((x) => x.to === l.to && x.type === l.type)) {
        outgoing.set(l.from, [...out, l]);
      }
      if (!inc.some((x) => x.from === l.from && x.type === l.type)) {
        incoming.set(l.to, [...inc, l]);
      }
      break;
    }
    case "LinkRemoved": {
      outgoing.set(
        e.from,
        (outgoing.get(e.from) ?? []).filter((x) =>
          !(x.to === e.to && x.type === e.type)
        ),
      );
      incoming.set(
        e.to,
        (incoming.get(e.to) ?? []).filter((x) =>
          !(x.from === e.from && x.type === e.type)
        ),
      );
      break;
    }
  }
  return { issues, outgoing, incoming };
}
