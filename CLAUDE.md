# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

**trinkets** is a light-functional TypeScript library for Deno that implements a
Beads-style event-sourced issue tracker with a dependency graph. Published to
JSR as `@trinkets/core`.

## Runtime Expectations

- Target Deno v2.5.6+ so `Deno.serve`, `Response.json`, and Deno KV are
  available without std imports or unstable flags.
- Prefer built-in APIs (`Deno.serve`, `crypto.subtle`, `structuredClone`) in new
  examples and documentation updates.
- When you absolutely must support older toolchains, gate the behavior or note
  the requirement explicitly in docs/tests.

## Development Commands

```bash
# Testing
deno task test              # Run all tests with fail-fast (-A permissions)

# Code quality
deno task fmt               # Format code
deno task lint              # Lint code

# CLI usage
deno task tr <command>      # Run the CLI (see cli/tr.ts)
deno task tr init           # Initialize repository
deno task tr create "Title" --priority 0
deno task tr ready          # Show ready issues

# Publishing
deno task publish           # Publish to JSR

# Git merge setup
deno task init-merge        # Configure git for JSONL merge strategy
```

## Architecture

### Event Sourcing Foundation

The system is built on an append-only event log with five event types:

- `IssueCreated` — new issue with all initial fields
- `IssuePatched` — partial updates (title, body, priority, labels, kind)
- `IssueStatusSet` — status transitions (open → doing → done/canceled)
- `LinkAdded` — create dependency (blocks, parent-child, related,
  discovered-from)
- `LinkRemoved` — remove dependency

Events are materialized into `GraphState` containing:

- `issues: Map<IssueId, Issue>` — all issues indexed by ID
- `outgoing: Map<IssueId, Link[]>` — dependency edges from each issue
- `incoming: Map<IssueId, Link[]>` — reverse dependency index

### Ports Pattern (Dependency Injection)

The codebase uses a ports-and-adapters architecture defined in
[src/ports.ts](src/ports.ts):

- **StorePort** — event persistence with three operations:
  - `append(e: Event)` — add event to log
  - `scan()` — read all events
  - `materialize()` — replay events into GraphState

- **CachePort** — optional GraphState caching:
  - `hydrate()` — load cached state
  - `persist(g)` — save state snapshot

- **Env** — time provider for deterministic testing:
  - `now()` — returns ISO timestamp string

Domain functions in [src/domain.ts](src/domain.ts) accept these ports, enabling
testability and adapter swapping.

### Store Implementations

Two append-only store implementations:

1. **Basic JSONL** ([src/store_jsonl.ts](src/store_jsonl.ts))
   - Separate files: `issues.jsonl`, `links.jsonl`
   - Full replay on every read
   - Simple, portable, good for small datasets

2. **Heads V2** ([src/store_jsonl_heads_v2.ts](src/store_jsonl_heads_v2.ts))
   - Adds `heads.json` (byte offsets) and `state.json` (snapshot)
   - Incremental replay: tails only new bytes since last read
   - Significantly faster for services and dashboards
   - **Preferred for production use**

### Cache Implementations

Two caching adapters (optional optimization):

- **KV Cache** ([src/cache_kv.ts](src/cache_kv.ts)) — Deno.Kv-based, namespaced
  by baseDir hash
- **SQLite Cache** ([src/cache_sqlite.ts](src/cache_sqlite.ts)) — placeholder
  implementation

### Domain Logic

Pure functions in [src/domain.ts](src/domain.ts):

- `createIssue()` — generates deterministic `bd-*` IDs, validates priority (0-3)
- `addLink()` — prevents self-links, appends LinkAdded event
- `setStatus()` — transitions issue status
- `patchIssue()` — partial updates
- `validateInvariants()` — checks for cycles in `blocks` graph and ensures done
  parents have done children

### Queries and Search

- [src/query.ts](src/query.ts) — `ready()` finds issues with no open blockers,
  `explainBlocked()` shows why an issue is blocked
- [src/search.ts](src/search.ts) — `filterIssues()` with
  text/label/kind/priority filters, `nextWork()` with strategies
  (`priority-first`, `oldest-first`, `shortest-title`)

### Embedding API

[src/embed.ts](src/embed.ts) backs the public `trinkets.make()` entry point:

```ts
import { trinkets } from "@trinkets/core";

const sdk = await trinkets.make({ store, cache });
const issue = await sdk.createIssue({ title: "...", priority: 0 });
const readyList = await sdk.ready();
```

The wrapper automatically refreshes cache after mutations when a CachePort is
provided.

## TypeScript Configuration

Strict mode enabled in [deno.json](deno.json):

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "lib": ["ES2022"]
}
```

Always handle potential `undefined` when accessing arrays/maps, and distinguish
`{ foo?: string }` from `{ foo: string | undefined }`.

## Testing

Tests use Deno's built-in test runner:

```bash
deno test -A --fail-fast
```

When writing tests, follow these patterns:

- Use the Env port to inject deterministic timestamps
- Use in-memory store implementations for fast tests
- Test domain invariants (no cycles, parent/child status consistency)

## Key Data Structures

From [src/adt.ts](src/adt.ts):

- **IssueId** — `bd-${string}` format (generated by [src/id.ts](src/id.ts))
- **IssueKind** — `feature | bug | chore | note | epic`
- **IssueStatus** — `open | doing | done | canceled`
- **DepType** — `blocks | parent-child | related | discovered-from`
- **Priority** — `0 | 1 | 2 | 3` (0 highest, 3 lowest)

## Git Integration

Run `deno task init-merge` to configure custom JSONL merge strategy for
conflict-free append-only logs. This creates `.gitattributes` and
`.gitconfig.merge-jsonl` that can be included in `.git/config`.

## Production Notes

- Keep `.trinkets/` at repository root and commit JSONL files for audit trail
- Use Heads V2 store with KV cache for services
- Expose read-only HTTP for dashboards; mutate via CLI or embedding API
- Enable `validateEvents: true` on store creation to enforce valibot schemas
- Consider log rotation (daily JSONL files) for high-volume deployments
