
#!/usr/bin/env -S deno run -A
import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import { openJsonlStoreWithHeadsV2, initRepo, createIssue, patchIssue, setStatus, addLink } from "../src/index.ts";
import { ready } from "../src/query.ts";

const args = parse(Deno.args, { alias: { p: "priority", k: "kind" }, boolean: ["json", "validate", "no-validate"] });
const cmd = (args._[0] ?? "help").toString();
const baseDir = Deno.env.get("TRINKETS_DIR") ?? ".trinkets";

// Default validation ON for mutations; allow opt-out with --no-validate
const isMutation = ["init", "create", "update", "status", "dep"].includes(cmd);
const _validate = isMutation ? !(args["no-validate"] === true) : !!args.validate;

const store = await openJsonlStoreWithHeadsV2({ baseDir, validateEvents: _validate });
const env = { now: () => new Date().toISOString() };
const out = (x: unknown) => console.log(args.json ? JSON.stringify(x, null, 2) : typeof x === "string" ? x : JSON.stringify(x, null, 2));

switch (cmd) {
  case "init": await initRepo(store); out({ ok: true, baseDir, validate: _validate }); break;
  case "create": {
    const title = args._[1]?.toString(); if (!title) throw new Error("title required");
    const labels = ([] as string[]).concat(args.label ? (Array.isArray(args.label) ? args.label : [args.label]) : []);
    const issue = await createIssue(store, env, { title, body: args.body, kind: (args.kind ?? "feature") as any, priority: args.priority?Number(args.priority):2, labels });
    out(issue); break;
  }
  case "update": {
    const id = args._[1]?.toString(); if (!id) throw new Error("id required");
    const labels = ([] as string[]).concat(args.label ? (Array.isArray(args.label) ? args.label : [args.label]) : []);
    await patchIssue(store, env, id as any, { body: args.body, kind: args.kind as any, priority: args.priority?Number(args.priority):undefined, labels: labels.length?labels:undefined });
    out({ ok: true }); break;
  }
  case "status": {
    const id = args._[1]?.toString(); const status = args._[2]?.toString();
    if (!id || !status) throw new Error("usage: status <id> <open|doing|done|canceled>");
    await setStatus(store, env, id as any, status as any); out({ ok: true }); break;
  }
  case "dep": {
    const sub = args._[1]?.toString(); if (sub !== "add") throw new Error("usage: dep add <from> <to> --type <...>");
    const from = args._[2]?.toString(); const to = args._[3]?.toString(); const type = args.type?.toString();
    if (!from || !to || !type) throw new Error("usage: dep add <from> <to> --type <blocks|parent-child|related|discovered-from>");
    await addLink(store, env, { from: from as any, to: to as any, type: type as any }); out({ ok: true }); break;
  }
  case "ready": {
    const g = await store.materialize(); out(ready(g).map(x => ({ id: x.id, title: x.title, priority: x.priority }))); break;
  }
  default:
    console.log(`trinkets CLI
Usage:
  deno task tr <command> [args] [--validate] [--no-validate]

Commands:
  init
  create <title> [--priority N] [--kind K] [--label L --label L2 ...] [--body TEXT]
  update <id> [--priority N] [--kind K] [--label L...] [--body TEXT]
  status <id> <open|doing|done|canceled>
  dep add <from> <to> --type <blocks|parent-child|related|discovered-from>
  ready [--json]

Notes:
  - Mutations default to strict validation; opt-out with --no-validate
`);
}
