
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import type { Event, GraphState } from "./adt.ts";
import { materializeFromEvents } from "./domain_materialize.ts";
import { parseEvent } from "./schemas.ts";

export type JsonlStoreOptions = Readonly<{ baseDir: string; validateEvents?: boolean; }>;

export async function openJsonlStore(opts: JsonlStoreOptions) {
  await ensureDir(opts.baseDir);
  const issuesPath = join(opts.baseDir, "issues.jsonl");
  const linksPath = join(opts.baseDir, "links.jsonl");
  const _validate = !!opts.validateEvents;

  async function append(e: Event): Promise<void> {
    if (_validate) parseEvent(e);
    const path = e._type.startsWith("Issue") ? issuesPath : linksPath;
    const fh = await Deno.open(path, { create: true, append: true, write: true });
    try { await fh.write(new TextEncoder().encode(JSON.stringify(e) + "\n")); } finally { fh.close(); }
  }
  async function scan(): Promise<readonly Event[]> {
    const out: Event[] = [];
    for (const p of [issuesPath, linksPath]) { try { const text = await Deno.readTextFile(p); for (const line of text.split("\n")) if (line.trim()) out.push(JSON.parse(line)); } catch {} }
    return out;
  }
  async function materialize(): Promise<GraphState> { return materializeFromEvents(await scan()); }
  return { append, scan, materialize } as const;
}
