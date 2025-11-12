
import type { Event, GraphState } from "./adt.ts";
export type StorePort = Readonly<{ append: (e: Event) => Promise<void>; scan: () => Promise<readonly Event[]>; materialize: () => Promise<GraphState>; }>;
export type Env = Readonly<{ now: () => string; }>;
export type CachePort = Readonly<{ hydrate: () => Promise<GraphState | null>; persist: (g: GraphState) => Promise<void>; }>;
