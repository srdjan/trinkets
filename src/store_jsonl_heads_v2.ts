
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import type { Event, GraphState, IssueId } from "./adt.ts";
import { materializeFromEvents, applyEvent } from "./domain_materialize.ts";
import { parseEvent } from "./schemas.ts";

type Meta = { issuesOffset: number; linksOffset: number; heads: Record<IssueId, { issuesOffset: number; linksOffset: number }>; };
export type JsonlHeadsStoreV2Options = Readonly<{ baseDir: string; validateEvents?: boolean; }>;

export async function openJsonlStoreWithHeadsV2(opts: JsonlHeadsStoreV2Options) {
  await ensureDir(opts.baseDir);
  const issuesPath = join(opts.baseDir, "issues.jsonl");
  const linksPath = join(opts.baseDir, "links.jsonl");
  const metaPath = join(opts.baseDir, "heads.json");
  const statePath = join(opts.baseDir, "state.json");
  const _validate = !!opts.validateEvents;

  async function append(e: Event): Promise<void> {
    if (_validate) parseEvent(e);
    const path = e._type.startsWith("Issue") ? issuesPath : linksPath;
    const fh = await Deno.open(path, { create: true, append: true, write: true });
    try { await fh.write(new TextEncoder().encode(JSON.stringify(e) + "\n")); } finally { fh.close(); }
  }
  async function scan(): Promise<readonly Event[]> { return [...await readAll(issuesPath), ...await readAll(linksPath)]; }
  async function materialize(): Promise<GraphState> {
    const meta = await readJson<Meta>(metaPath).catch(() => null) ?? { issuesOffset: 0, linksOffset: 0, heads: {} as Meta["heads"] };
    const cachedRaw = await readJson<any>(statePath).catch(() => null);
    let state: GraphState | null = cachedRaw ? revive(cachedRaw) : null;
    const [iSize, lSize] = await Promise.all([safeStat(issuesPath), safeStat(linksPath)]);
    const [newI, newL] = await Promise.all([readTail(issuesPath, Math.min(meta.issuesOffset, iSize)), readTail(linksPath, Math.min(meta.linksOffset, lSize))]);
    const delta = [...newI, ...newL];
    if (!state) {
      const all = await scan();
      state = materializeFromEvents(all);
      await Deno.writeTextFile(statePath, JSON.stringify(ser(state)));
      await Deno.writeTextFile(metaPath, JSON.stringify({ issuesOffset: iSize, linksOffset: lSize, heads: indexHeads(state, iSize, lSize) }));
      return state;
    }
    if (delta.length === 0) return state;
    let rebuilt = state; for (const ev of delta) rebuilt = applyEvent(rebuilt, ev);
    await Deno.writeTextFile(statePath, JSON.stringify(ser(rebuilt)));
    await Deno.writeTextFile(metaPath, JSON.stringify({ issuesOffset: iSize, linksOffset: lSize, heads: indexHeads(rebuilt, iSize, lSize) }));
    return rebuilt;
  }
  return { append, scan, materialize } as const;
}
async function readAll(p: string): Promise<Event[]> { try { return (await Deno.readTextFile(p)).split("\n").filter(Boolean).map(JSON.parse); } catch { return []; } }
async function readTail(p: string, offset: number): Promise<Event[]> {
  try {
    const file = await Deno.open(p, { read: true });
    try {
      await file.seek(offset, Deno.SeekMode.Start);
      const dec = new TextDecoder(); const buf = new Uint8Array(16*1024);
      let data = ""; const out: Event[] = [];
      while (true) { const n = await file.read(buf); if (n === null) break; data += dec.decode(buf.subarray(0, n)); let idx;
        while ((idx = data.indexOf("\n")) >= 0) { const line = data.slice(0, idx).trim(); data = data.slice(idx+1); if (line) out.push(JSON.parse(line)); } }
      if (data.trim()) out.push(JSON.parse(data)); return out;
    } finally { file.close(); }
  } catch { return []; }
}
async function safeStat(p: string): Promise<number> { try { const s = await Deno.stat(p); return s.size ?? 0; } catch { return 0; } }
async function readJson<T>(p: string): Promise<T> { const t = await Deno.readTextFile(p); return JSON.parse(t); }
function ser(g: GraphState) { return { issues: Array.from(g.issues.entries()), outgoing: Array.from(g.outgoing.entries()), incoming: Array.from(g.incoming.entries()) }; }
function revive(raw: any): GraphState { return { issues: new Map(raw.issues), outgoing: new Map(raw.outgoing), incoming: new Map(raw.incoming) }; }
function indexHeads(g: GraphState, issuesOffset: number, linksOffset: number) { const heads: Record<string, {issuesOffset:number;linksOffset:number}> = {}; for (const id of g.issues.keys()) heads[id] = { issuesOffset, linksOffset }; return heads; }
