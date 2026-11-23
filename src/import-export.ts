import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir, Diary } from "./database.ts";
import { validate, workout, measurement } from "./schema.ts";
import type { Day, Measurement, Workout } from "./schema.ts";

export function exportData(db: Diary, path?: string) {
  const destination = path ?? join(dataDir, "backups", `training-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const content = JSON.stringify(db.snapshot(), null, 2) + "\n";
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, { flag: "wx", mode: 0o600 });
  return { path: destination };
}

export function restoreData(db: Diary, path: string, replace = false) {
  db.restore(JSON.parse(readFileSync(path, "utf8")), replace);
  return { restored: true };
}

type Legacy = {
  schema_version: number;
  zwischenstaende: unknown[];
  trainingseinheiten: {
    id: string; datum: string; bezeichnung: string; dauer_min: number | null;
    distanz_km: number | null; notiz: string | null;
    uebungen: {
      name: string; dokumentierte_last_kg: number | null; notiz: string | null;
      satzvorgabe: { anzahl: number | null; wiederholungen_min: number | null; wiederholungen_max: number | null } | null;
      saetze: { last_kg: number | null; wiederholungen: number | null }[];
    }[];
  }[];
  messungen: {
    datum: string | null; gewicht_kg: number | null; bauchumfang_cm: number | null;
    halsumfang_cm?: number | null; messstelle: string | null; notiz: string | null;
  }[];
};

export function importLegacy(db: Diary, path: string) {
  const source: Legacy = JSON.parse(readFileSync(path, "utf8"));
  if (source?.schema_version !== 2 || source.zwischenstaende?.length !== 0 ||
      !Array.isArray(source.trainingseinheiten) || !Array.isArray(source.messungen)) {
    throw new Error("Expected the version 2 legacy diary with no interim snapshots");
  }
  const workouts: Workout[] = source.trainingseinheiten.map(entry => ({
    id: entry.id, date: entry.datum, day: entry.bezeichnung.replace(/^Tag /, "") as Day,
    minutes: entry.dauer_min, distanceKm: entry.distanz_km, note: entry.notiz,
    exercises: entry.uebungen.map(exercise => ({
      exercise: exercise.name, kg: exercise.dokumentierte_last_kg, note: exercise.notiz,
      prescription: exercise.satzvorgabe && {
        sets: exercise.satzvorgabe.anzahl, min: exercise.satzvorgabe.wiederholungen_min,
        max: exercise.satzvorgabe.wiederholungen_max,
      },
      sets: exercise.saetze.map(set => ({ kg: set.last_kg, reps: set.wiederholungen })),
    })),
  }));
  const metrics: Measurement[] = source.messungen.map((entry, index) => ({
    id: `legacy-measurement-${index + 1}`, date: entry.datum,
    location: entry.messstelle, note: entry.notiz,
    measurements: Object.fromEntries(Object.entries({
      weight: entry.gewicht_kg, abdomen: entry.bauchumfang_cm, neck: entry.halsumfang_cm,
    }).filter((item): item is [string, number] => item[1] != null)),
  }));
  for (const entry of workouts) validate(workout, entry);
  for (const entry of metrics) validate(measurement, entry);
  db.transaction(() => {
    const insert = (table: "workouts" | "metrics", entries: { id: string }[]) => {
      const statement = db.db.prepare(`INSERT INTO ${table} VALUES (?, ?) ON CONFLICT(id) DO NOTHING`);
      for (const entry of entries) statement.run(entry.id, JSON.stringify(entry));
    };
    insert("workouts", workouts);
    insert("metrics", metrics);
  });
  return {
    workouts: workouts.length, exercises: workouts.flatMap(entry => entry.exercises).length,
    sets: workouts.flatMap(entry => entry.exercises).flatMap(entry => entry.sets).length,
    measurements: metrics.length,
  };
}
