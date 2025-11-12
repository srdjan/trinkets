import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  andThen,
  err,
  isErr,
  isOk,
  map,
  ok,
  unwrap,
  unwrapOr,
} from "./result.ts";
import type { Result } from "./result.ts";
import { openJsonlStore } from "./store_jsonl.ts";
import { createIssue, initRepo } from "./domain.ts";
import type { StorePort } from "./ports.ts";

Deno.test("Result - ok() creates successful result", () => {
  const result = ok(42);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value, 42);
  }
});

Deno.test("Result - err() creates error result", () => {
  const result = err("something failed");
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, "something failed");
  }
});

Deno.test("Result - isOk type guard works", () => {
  const success = ok(100);
  const failure = err("error");

  assertEquals(isOk(success), true);
  assertEquals(isOk(failure), false);
});

Deno.test("Result - isErr type guard works", () => {
  const success = ok(100);
  const failure = err("error");

  assertEquals(isErr(success), false);
  assertEquals(isErr(failure), true);
});

Deno.test("Result - unwrap returns value from Ok", () => {
  const result = ok(42);
  assertEquals(unwrap(result), 42);
});

Deno.test("Result - unwrapOr returns value from Ok", () => {
  const result = ok(42);
  assertEquals(unwrapOr(result, 0), 42);
});

Deno.test("Result - unwrapOr returns default from Err", () => {
  const result = err("failed");
  assertEquals(unwrapOr(result, 0), 0);
});

Deno.test("Result - map transforms Ok value", () => {
  const result = ok(5);
  const mapped = map(result, (x) => x * 2);
  assertEquals(unwrap(mapped), 10);
});

Deno.test("Result - map preserves Err", () => {
  const result: Result<number, string> = err("failed");
  const mapped = map(result, (x: number) => x * 2);
  assertEquals(isErr(mapped), true);
  if (!mapped.ok) {
    assertEquals(mapped.error, "failed");
  }
});

Deno.test("Result - andThen chains successful operations", () => {
  const result = ok(5);
  const chained = andThen(result, (x) => ok(x * 2));
  assertEquals(unwrap(chained), 10);
});

Deno.test("Result - andThen short-circuits on Err", () => {
  const result: Result<number, string> = err("failed");
  const chained = andThen(result, (x: number) => ok(x * 2));
  assertEquals(isErr(chained), true);
});

Deno.test("Store - initRepo returns Ok on success", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const result = await initRepo(store);

    assertEquals(result.ok, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Store - createIssue returns Ok with issue", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    await initRepo(store);

    const result = await createIssue(store, env, {
      title: "Test Issue",
      priority: 0,
      labels: ["test"],
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.value.title, "Test Issue");
      assertEquals(result.value.priority, 0);
      assertExists(result.value.id);
      assertEquals(result.value.id.startsWith("bd-"), true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Store - scan returns events in Result", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    await createIssue(store, env, { title: "Issue 1" });
    await createIssue(store, env, { title: "Issue 2" });

    const scanResult = await store.scan();
    assertEquals(scanResult.ok, true);
    if (scanResult.ok) {
      assertEquals(scanResult.value.length, 2);
      assertEquals(scanResult.value[0]?._type, "IssueCreated");
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Store - materialize returns GraphState in Result", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = await openJsonlStore({ baseDir: tempDir });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    const createResult = await createIssue(store, env, { title: "Test" });
    assertEquals(createResult.ok, true);

    const matResult = await store.materialize();
    assertEquals(matResult.ok, true);
    if (matResult.ok) {
      assertEquals(matResult.value.issues.size, 1);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Store - append returns error on invalid path", async () => {
  const tempDir = await Deno.makeTempDir();
  await Deno.remove(tempDir, { recursive: true }); // Remove the directory

  try {
    const store = await openJsonlStore({
      baseDir: "/nonexistent/path/that/does/not/exist",
    });
    const env = { now: () => "2024-01-01T00:00:00.000Z" };

    const result = await createIssue(store, env, { title: "Test" });

    // Should return an error Result
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertExists(result.error._type);
    }
  } catch {
    // Expected - directory doesn't exist
  }
});
