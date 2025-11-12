
import type { GraphState } from "./adt.ts";
export async function openKvCache(name = "trinkets", baseDir?: string) {
  const kv = await Deno.openKv();
  const ns = baseDir ? await hash(baseDir) : "global";
  async function hydrate(): Promise<GraphState | null> {
    const raw = (await kv.get(["trinkets", name, ns, "state"])).value as any | null;
    if (!raw) return null;
    return { issues: new Map(raw.issues), outgoing: new Map(raw.outgoing), incoming: new Map(raw.incoming) };
  }
  async function persist(g: GraphState): Promise<void> {
    const data = { issues: Array.from(g.issues.entries()), outgoing: Array.from(g.outgoing.entries()), incoming: Array.from(g.incoming.entries()) };
    await kv.set(["trinkets", name, ns, "state"], data);
  }
  return { hydrate, persist } as const;
}
async function hash(x: string): Promise<string> {
  const bytes = new TextEncoder().encode(x);
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,"0")).join("").slice(0,16);
}
