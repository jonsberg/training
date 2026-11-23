import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Diary } from "../src/database.ts";
import { exportData, restoreData } from "../src/import-export.ts";

test("backup round trip preserves records and rejects nonempty restore", () => {
  const directory = mkdtempSync(join(tmpdir(), "training-diary-"));
  const original = new Diary(":memory:");
  const restored = new Diary(":memory:");
  try {
    original.save("workouts", {
      id: "session", day: "A", date: "2026-11-23",
      exercises: [{ exercise: "Latziehen", kg: 68, sets: [{ kg: null, reps: 10 }] }],
    }, "create");
    original.updatePlan({ action: "add", entry: { id: "plan-1", day: "C", exercise: "Latziehen", sets: 3, min: 8, max: 12 } });
    original.updatePlan({ action: "add", entry: { id: "plan-2", day: "C", exercise: "Rudern", sets: 3, min: 8, max: 12 }, position: 0 });
    original.save("metrics", { id: "legacy", date: null, measurements: { weight: 77.4 } }, "create");
    original.setContext("Goal: gain strength");
    const { path } = exportData(original, join(directory, "export.json"));
    restoreData(restored, path);
    assert.deepEqual(restored.snapshot(), original.snapshot());
    const legacy = { ...original.snapshot(), version: 1 };
    delete (legacy as Partial<typeof legacy>).context;
    const older = new Diary(":memory:");
    try {
      older.restore(legacy);
      assert.equal(older.getContext(), "");
      assert.equal(older.snapshot().version, 2);
    } finally {
      older.db.close();
    }
    assert.throws(() => restoreData(restored, path), /contains data/);
    const broken = JSON.parse(readFileSync(path, "utf8"));
    broken.metrics.push(broken.metrics[0]);
    assert.throws(() => restored.restore(broken, true));
    assert.deepEqual(restored.snapshot(), original.snapshot());
  } finally {
    original.db.close();
    restored.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stdio client can call tools and moving a plan entry preserves history", () => {
  const workout = {
    id: "session", day: "A", date: "2026-11-23",
    exercises: [{ exercise: "Latziehen", sets: [{ kg: 68, reps: 10 }] }],
  };
  const call = (name: string, args: object) => ["tools/call", { name, arguments: args }];
  const requests = [
    ["initialize", { protocolVersion: "2025-11-25" }],
    ["tools/list"],
    call("get_context", {}),
    call("set_context", { context: "Goal: recomposition" }),
    call("get_context", {}),
    call("set_context", { context: "" }),
    call("get_context", {}),
    call("save_workout", { mode: "create", workout }),
    call("save_workout", { mode: "create", workout }),
    call("save_workout", { mode: "create", workout: { ...workout, id: "session-2" } }),
    call("save_workout", { mode: "correct", workout: { ...workout, note: "Corrected" } }),
    call("update_plan", { action: "add", entry: { id: "plan", day: "C", exercise: "Latziehen", sets: 3, min: 8, max: 12 } }),
    call("update_plan", { action: "move", id: "plan", day: "B" }),
    call("get_training", { view: "plan", day: "B" }),
    call("get_training", { view: "workouts" }),
    call("save_metrics", { mode: "create", measurement: { id: "metric", date: workout.date, measurements: { neck: 38 } } }),
    call("get_training", { view: "metrics", metric: "neck" }),
    call("save_metrics", { mode: "create", measurement: { id: "bad", date: "2026-02-30", measurements: { neck: 38 } } }),
  ];
  const child = spawnSync(process.execPath, ["src/index.ts"], {
    input: requests.map(([method, params], id) => JSON.stringify({ jsonrpc: "2.0", id, method, params })).join("\n"),
    encoding: "utf8",
    env: { ...process.env, TRAINING_DB: ":memory:" },
  });
  assert.equal(child.status, 0, child.stderr);
  const responses = child.stdout.trim().split("\n").map(line => JSON.parse(line).result);
  assert.equal(responses[0].protocolVersion, "2025-11-25");
  assert.equal(responses[0].serverInfo.name, "training");
  assert.equal(responses[1].tools.length, 8);
  assert.ok(responses.slice(2, 17).every(result => !result.isError));
  const content = (index: number) => JSON.parse(responses[index].content[0].text);
  assert.equal(content(2), "");
  assert.equal(content(4), "Goal: recomposition");
  assert.equal(content(6), "");
  assert.equal(content(13)[0].lastPerformance.day, "A");
  assert.equal(content(14).length, 2);
  assert.deepEqual(content(14)[0], { ...workout, note: "Corrected" });
  assert.equal(content(16)[0].measurements.neck, 38);
  assert.equal(responses[17].isError, true);
});

test("context seeds once in an existing database and MCP edits survive restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "training-context-"));
  const path = join(directory, "training.db");
  try {
    const first = new Diary(path);
    const initial = readFileSync("init/context.md", "utf8");
    assert.equal(first.getContext(), initial);
    first.setContext("Updated through MCP");
    first.db.close();
    const reopened = new Diary(path);
    assert.equal(reopened.getContext(), "Updated through MCP");
    reopened.setContext("");
    reopened.db.close();
    const cleared = new Diary(path);
    assert.equal(cleared.getContext(), "");
    cleared.db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("startup seeds a fresh volume once and rolls back an invalid seed", () => {
  const directory = mkdtempSync(join(tmpdir(), "training-seed-"));
  const path = join(directory, "training.db");
  const seed = join(directory, "seed.json");
  const run = () => spawnSync(process.execPath, ["src/cli.ts", "export", "-"], {
    encoding: "utf8",
    env: { ...process.env, TRAINING_DB: path, TRAINING_SEED: seed },
  });
  const original = new Diary(":memory:");
  try {
    exportData(original, seed);
    const initial = run();
    assert.equal(initial.status, 0, initial.stderr);
    assert.deepEqual(JSON.parse(initial.stdout), original.snapshot());

    rmSync(seed);
    original.save("metrics", { id: "new", date: "2026-11-23", measurements: { weight: 77 } }, "create");
    exportData(original, seed);
    assert.deepEqual(JSON.parse(run().stdout).metrics, []);

    rmSync(path);
    const snapshot = original.snapshot();
    snapshot.metrics.push(snapshot.metrics[0]);
    writeFileSync(seed, JSON.stringify(snapshot));
    assert.notEqual(run().status, 0);
    writeFileSync(seed, JSON.stringify(original.snapshot()));
    const retried = run();
    assert.equal(retried.status, 0, retried.stderr);
    assert.deepEqual(JSON.parse(retried.stdout), original.snapshot());
  } finally {
    original.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
