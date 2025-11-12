
import type { GraphState } from "./adt.ts";
export async function openSqliteCache(_path = ".trinkets/cache.db") {
  let state: GraphState | null = null;
  async function hydrate(): Promise<GraphState | null> { return state; }
  async function persist(g: GraphState): Promise<void> { state = g; }
  return { hydrate, persist } as const;
}
