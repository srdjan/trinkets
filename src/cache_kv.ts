import type { GraphState, IssueId } from "./adt.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";
import type { CacheError } from "./ports.ts";
import { validateGraphState } from "./schemas_runtime.ts";
import * as logger from "./logger.ts";

type CachedData = {
  version: number;
  issues: Array<[IssueId, unknown]>;
  outgoing: Array<[IssueId, unknown]>;
  incoming: Array<[IssueId, unknown]>;
};

const CACHE_VERSION = 1;

export async function openKvCache(name = "trinkets", baseDir?: string) {
  const kv = await Deno.openKv();
  const ns = baseDir ? await hash(baseDir) : "global";

  async function hydrate(): Promise<Result<GraphState | null, CacheError>> {
    try {
      const result = await kv.get(["trinkets", name, ns, "state"]);
      const raw = result.value as CachedData | null;

      if (!raw) {
        logger.debug("No cached state found in KV");
        return ok(null);
      }

      // Validate version
      if (!raw.version || raw.version !== CACHE_VERSION) {
        logger.warn("Cache version mismatch, invalidating", {
          expected: CACHE_VERSION,
          actual: raw.version,
        });
        // Delete invalid cache
        await kv.delete(["trinkets", name, ns, "state"]);
        return ok(null);
      }

      // Validate structure
      const validation = validateGraphState(raw);
      if (!validation.valid) {
        logger.error("Cached state validation failed", {
          errors: validation.errors,
        });
        // Delete corrupted cache
        await kv.delete(["trinkets", name, ns, "state"]);
        return err({
          _type: "ValidationFailed",
          reason: `Invalid cached state: ${
            validation.errors.map((e) => e.reason).join(", ")
          }`,
        });
      }

      logger.debug("Hydrated state from KV cache");
      return ok(validation.state);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error("Failed to hydrate from KV cache", { reason });
      return err({
        _type: "ConnectionError",
        reason: `KV hydrate failed: ${reason}`,
      });
    }
  }

  async function persist(g: GraphState): Promise<Result<void, CacheError>> {
    try {
      const data: CachedData = {
        version: CACHE_VERSION,
        issues: Array.from(g.issues.entries()),
        outgoing: Array.from(g.outgoing.entries()),
        incoming: Array.from(g.incoming.entries()),
      };

      await kv.set(["trinkets", name, ns, "state"], data);
      logger.debug("Persisted state to KV cache");
      return ok(undefined);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error("Failed to persist to KV cache", { reason });
      return err({
        _type: "ConnectionError",
        reason: `KV persist failed: ${reason}`,
      });
    }
  }

  return { hydrate, persist } as const;
}

async function hash(x: string): Promise<string> {
  const bytes = new TextEncoder().encode(x);
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("").slice(0, 16);
}
