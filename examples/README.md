# Trinkets Examples

This directory contains practical examples demonstrating how to use trinkets for issue tracking and project management. Examples are tested on Deno v2.5.6+.

## Running Examples

All examples can be run directly with Deno:

```bash
deno run -A examples/<example_name>.ts
```

> KV is stable in Deno v2.5.6. Only add `--unstable-kv` if you are stuck on
> an older (1.x) toolchain.

## Available Examples

### 1. Basic Usage (`basic_usage.ts`)

**What you'll learn:**
- Opening a store
- Creating issues with different properties
- Updating issue status
- Querying ready issues
- Working with the Result type pattern

**Best for:** Getting started with trinkets

```bash
deno run -A examples/basic_usage.ts
```

### 2. Dependency Management (`dependency_management.ts`)

**What you'll learn:**
- Creating blocked/blocks relationships
- Understanding dependency chains
- Using parent-child hierarchies
- Querying blocked vs ready issues
- Explaining why issues are blocked

**Best for:** Managing complex project dependencies

```bash
deno run -A examples/dependency_management.ts
```

### 3. Query Patterns (`query_patterns.ts`)

**What you'll learn:**
- Basic queries on materialized state
- Indexed queries for performance
- Filtering by status, kind, priority, labels
- Complex multi-criteria filtering
- Custom filtering logic

**Best for:** Finding and filtering issues efficiently

```bash
deno run -A examples/query_patterns.ts
```

### 4. Production Setup (`production_setup.ts`)

**What you'll learn:**
- Using KV cache for performance
- Retry with exponential backoff
- Circuit breaker pattern
- Observability and metrics
- Production error handling

**Best for:** Building production-ready applications

```bash
deno run -A examples/production_setup.ts
```

### 5. Backup & Restore (`backup_restore.ts`)

**What you'll learn:**
- Creating versioned backups
- JSON and JSONL export formats
- Validating backup integrity
- Restoring from backups
- Detecting and repairing corruption
- Disaster recovery workflows

**Best for:** Data safety and disaster recovery

```bash
deno run -A examples/backup_restore.ts
```

## Example Progression

We recommend exploring the examples in this order:

1. **basic_usage.ts** - Learn the fundamentals
2. **dependency_management.ts** - Understand relationships
3. **query_patterns.ts** - Master data retrieval
4. **production_setup.ts** - Add resilience features
5. **backup_restore.ts** - Ensure data safety

## Common Patterns

### Creating Issues

```typescript
import { openJsonlStore } from "../src/store_jsonl.ts";
import { createIssue } from "../src/domain.ts";

const store = await openJsonlStore({ baseDir: "./data" });
const env = { now: () => new Date().toISOString() };

const result = await createIssue(store, env, {
  title: "Fix login bug",
  kind: "bug",
  priority: 3,
  labels: ["security"],
});

if (result.ok) {
  console.log(`Created: ${result.value.id}`);
}
```

### Finding Ready Issues

```typescript
import { ready } from "../src/query.ts";

const state = await store.materialize();
if (state.ok) {
  const readyIssues = ready(state.value, {
    kinds: ["bug", "feature"],
    priorities: [3],
  });
  console.log(`Ready: ${readyIssues.length}`);
}
```

### Using Indexed Queries

```typescript
import { buildIndexes } from "../src/indexed_graph.ts";
import { ready } from "../src/query_indexed.ts";

const state = await store.materialize();
if (state.ok) {
  const indexed = buildIndexes(state.value);
  const highPriority = ready(indexed, { priorities: [3] });
}
```

## Next Steps

- Read the [main README](../README.md) for comprehensive documentation
- Check [USER_GUIDE.md](../USER_GUIDE.md) for detailed usage patterns
- Explore [CLAUDE.md](../CLAUDE.md) for architecture details
- Review the [src/](../src/) directory for API reference

## Troubleshooting

**Permission errors:** Make sure to run with `-A` flag or specify needed permissions

**KV errors:** Make sure you're running Deno v2.5.6+ so Deno KV works without
extra flags; only add `--unstable-kv` if you cannot upgrade yet.

**Import errors:** Run examples from the repository root directory

## Contributing

Found an issue or have an example idea? Open an issue or PR on the repository!
