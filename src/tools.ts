import { join } from "node:path";
import { dataDir, Diary, exerciseKey } from "./database.ts";
import { exportData, restoreData } from "./import-export.ts";
import { assignment, count, date, datedMeasurement, day, object, positive, string, workout } from "./schema.ts";
import type { Assignment, Day, Measurement, Workout } from "./schema.ts";

type Query = {
  view: "plan" | "workouts" | "exercise" | "metrics";
  day?: Day; exercise?: string; limit?: number; from?: string; to?: string; metric?: string;
};

function readTraining(db: Diary, query: Query) {
  if (query.from && query.to && query.from > query.to) throw new Error("Invalid date range");
  const inRange = (value: string | null) =>
    (!query.from || (value !== null && value >= query.from)) &&
    (!query.to || (value !== null && value <= query.to));
  const { workouts, plan, metrics } = db.snapshot();
  const history = workouts.filter(entry => inRange(entry.date))
    .sort((a, b) => b.date.localeCompare(a.date));
  const performances = (exercise: string) => history.flatMap(entry =>
    entry.exercises.filter(result => result.sets.length && exerciseKey(result.exercise) === exerciseKey(exercise))
      .map(result => ({ workoutId: entry.id, date: entry.date, day: entry.day, ...result })));
  switch (query.view) {
    case "plan": return plan.filter(entry => !query.day || entry.day === query.day)
      .map(entry => ({ ...entry, lastPerformance: performances(entry.exercise)[0] ?? null }));
    case "workouts": return history.filter(entry => !query.day || entry.day === query.day).slice(0, query.limit);
    case "exercise":
      if (!query.exercise) throw new Error("Exercise name is required");
      return performances(query.exercise).slice(0, query.limit);
    case "metrics": return metrics.filter(entry => inRange(entry.date) &&
      (!query.metric || Object.hasOwn(entry.measurements, query.metric)))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, query.limit);
  }
}

const mode = { enum: ["create", "correct"] };
type Mode = "create" | "correct";
const action = (name: string) => ({ const: name });
export function trainingTools(db: Diary) {
  return {
    get_training: {
      description: "Read the plan, workouts, recorded exercise performances, or measurements. Use exercise with limit 1 for the latest performance.",
      inputSchema: object({
        view: { enum: ["plan", "workouts", "exercise", "metrics"] },
        day, exercise: string, limit: positive, from: date, to: date, metric: string,
      }, ["view"]),
      run: (input: Query) => readTraining(db, input),
    },
    get_context: {
      description: "Read the current training context as a plain text string.",
      inputSchema: object({}),
      run: () => db.getContext(),
    },
    set_context: {
      description: "Replace the training context with the supplied plain text string. An empty string clears it.",
      inputSchema: object({ context: { type: "string" } }),
      run: ({ context }: { context: string }) => db.setContext(context),
    },
    save_workout: {
      description: "Create by stable ID or correct by supplying the full workout with that ID. Read the existing workout before correcting it. Supply actual sets separately from prescriptions and documented exercise load.",
      inputSchema: object({ mode, workout }),
      run: (input: { mode: Mode; workout: Workout }) => db.save("workouts", input.workout, input.mode),
    },
    update_plan: {
      description: "Add, remove, move, or modify a plan assignment. Position is zero-based within a day.",
      inputSchema: {
        type: "object",
        anyOf: [
          object({ action: action("add"), entry: assignment, position: count }, ["action", "entry"]),
          object({ action: action("remove"), id: string }),
          object({ action: action("move"), id: string, day, position: count }, ["action", "id", "day"]),
          object({ action: action("modify"), id: string, sets: positive, min: positive, max: positive }, ["action", "id"]),
        ],
      },
      run: (input: Parameters<Diary["updatePlan"]>[0]) => db.updatePlan(input),
    },
    save_metrics: {
      description: "Create or correct a dated measurement by stable ID. Use weight in kg and neck or abdomen in cm.",
      inputSchema: object({ mode, measurement: datedMeasurement }),
      run: (input: { mode: Mode; measurement: Measurement }) => db.save("metrics", input.measurement, input.mode),
    },
    export_data: {
      description: "Create a complete JSON backup in the local backup folder.",
      inputSchema: object({}),
      run: () => exportData(db),
    },
    import_data: {
      description: "Restore a versioned JSON backup from the local backup folder into an empty database.",
      inputSchema: object({ filename: string }),
      run: ({ filename }: { filename: string }) => {
        if (!/^training-export-[\w-]+\.json$/.test(filename)) throw new Error("Expected a generated backup filename");
        return restoreData(db, join(dataDir, "backups", filename));
      },
    },
  };
}
