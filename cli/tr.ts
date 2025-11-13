
#!/usr/bin/env -S deno run -A
import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import { trinkets } from "../src/index.ts";
import type { IssueId, IssueKind, IssueStatus, DepType } from "../src/index.ts";

const args = parse(Deno.args, { alias: { p: "priority", k: "kind" }, boolean: ["json", "validate", "no-validate"] });
const cmd = (args._[0] ?? "help").toString();
const baseDir = Deno.env.get("TRINKETS_DIR") ?? ".trinkets";

// Default validation ON for mutations; allow opt-out with --no-validate
const isMutation = ["init", "create", "update", "status", "dep"].includes(cmd);
const _validate = isMutation ? !(args["no-validate"] === true) : !!args.validate;

const store = await trinkets.store.heads({ baseDir, validateEvents: _validate });
const env = { now: () => new Date().toISOString() };
const out = (x: unknown) => console.log(args.json ? JSON.stringify(x, null, 2) : typeof x === "string" ? x : JSON.stringify(x, null, 2));
const domain = trinkets.domain;
const validateId = trinkets.validate.issueId;

function exitWithError(error: unknown): never {
  console.error(JSON.stringify({ error }, null, 2));
  Deno.exit(1);
}

function validateKind(kind: unknown): kind is IssueKind {
  return typeof kind === "string" && ["feature", "bug", "chore", "note", "epic"].includes(kind);
}

function validateStatus(status: unknown): status is IssueStatus {
  return typeof status === "string" && ["open", "doing", "done", "canceled"].includes(status);
}

function validateDepType(type: unknown): type is DepType {
  return typeof type === "string" && ["blocks", "parent-child", "related", "discovered-from"].includes(type);
}

switch (cmd) {
  case "init": {
    const result = await domain.init(store);
    if (!result.ok) exitWithError(result.error);
    out({ ok: true, baseDir, validate: _validate });
    break;
  }
  case "create": {
    const title = args._[1]?.toString();
    if (!title) exitWithError("title required");

    const kind = args.kind ?? "feature";
    if (!validateKind(kind)) exitWithError(`Invalid kind: ${kind}`);

    const labels = ([] as string[]).concat(args.label ? (Array.isArray(args.label) ? args.label : [args.label]) : []);
    const priority = args.priority ? Number(args.priority) : 2;

    const result = await domain.createIssue(store, env, { title, body: args.body, kind, priority, labels });
    if (!result.ok) exitWithError(result.error);

    out(result.value);
    break;
  }
  case "update": {
    const id = args._[1]?.toString();
    if (!id) exitWithError("id required");
    if (!validateId(id)) exitWithError(`Invalid issue ID: ${id}`);

    const labels = ([] as string[]).concat(args.label ? (Array.isArray(args.label) ? args.label : [args.label]) : []);

    const kind = args.kind;
    if (kind && !validateKind(kind)) exitWithError(`Invalid kind: ${kind}`);

    const result = await domain.patchIssue(store, env, id as IssueId, {
      body: args.body,
      kind: kind as IssueKind | undefined,
      priority: args.priority ? Number(args.priority) : undefined,
      labels: labels.length ? labels : undefined,
    });

    if (!result.ok) exitWithError(result.error);
    out({ ok: true });
    break;
  }
  case "status": {
    const id = args._[1]?.toString();
    const status = args._[2]?.toString();

    if (!id || !status) exitWithError("usage: status <id> <open|doing|done|canceled>");
    if (!validateId(id)) exitWithError(`Invalid issue ID: ${id}`);
    if (!validateStatus(status)) exitWithError(`Invalid status: ${status}`);

    const result = await domain.setStatus(store, env, id as IssueId, status);
    if (!result.ok) exitWithError(result.error);

    out({ ok: true });
    break;
  }
  case "dep": {
    const sub = args._[1]?.toString();
    if (sub !== "add") exitWithError("usage: dep add <from> <to> --type <...>");

    const from = args._[2]?.toString();
    const to = args._[3]?.toString();
    const type = args.type?.toString();

    if (!from || !to || !type) {
      exitWithError("usage: dep add <from> <to> --type <blocks|parent-child|related|discovered-from>");
    }

    if (!validateId(from)) exitWithError(`Invalid from issue ID: ${from}`);
    if (!validateId(to)) exitWithError(`Invalid to issue ID: ${to}`);
    if (!validateDepType(type)) exitWithError(`Invalid dependency type: ${type}`);

    const result = await domain.addLink(store, env, { from: from as IssueId, to: to as IssueId, type });
    if (!result.ok) exitWithError(result.error);

    out({ ok: true });
    break;
  }
  case "ready": {
    const result = await store.materialize();
    if (!result.ok) exitWithError(result.error);

    const readyIssues = trinkets.query.ready(result.value);
    out(readyIssues.map(x => ({ id: x.id, title: x.title, priority: x.priority })));
    break;
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
