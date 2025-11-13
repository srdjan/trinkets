# Library-Focused Examples

These runnable scripts demonstrate how to embed trinkets as a Beads-style event
log instead of relying on the `tr` CLI. Every example uses the `trinkets.make()`
API and can be executed with Deno v2.5.6+.

> Run any scenario with: `deno run -A examples/<file>.ts` (or `deno task demo`
> for the basic walkthrough)

## Basic — `basic_embed.ts`

- Initialize a JSONL store and hydrate `trinkets.make()`
- Create issues, move them through `open → doing → done`
- Ask the ready queue and `nextWork()` strategy for the next story
- Render a simple board grouped by status

## Intermediate — `intermediate_dependencies.ts`

- Use the Heads V2 store + KV cache for faster reads
- Model `blocks` and `parent-child` dependencies
- Filter the ready queue by labels/priority and inspect blockers
- Print swim lanes showing which stories are queued, in-flight, or blocked

## Advanced — `kanban_board.ts`

- Provide a custom in-memory `StorePort` + cache implementation
- Build a Kanban helper that manages priorities, blockers, and workflow moves
- Listen to the live event stream to power an event-sourced projection
- Export the board snapshot (with `nextWork()` suggestion) to an external sink

Pick the example that matches your integration depth, then adapt it directly
within your application or agent runtime.
