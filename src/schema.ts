export type Day = "A" | "B" | "C";
export type SetResult = { kg: number | null; reps: number | null };
export type Prescription = { sets: number | null; min: number | null; max: number | null };
export type Result = {
  exercise: string;
  prescription?: Prescription | null;
  kg?: number | null;
  sets: SetResult[];
  note?: string | null;
};
export type Workout = {
  id: string; date: string; day: Day; exercises: Result[];
  minutes?: number | null; distanceKm?: number | null; note?: string | null;
};
export type Assignment = {
  id: string; day: Day; exercise: string; sets: number; min: number; max: number;
};
export type Measurement = {
  id: string; date: string | null; measurements: Record<string, number>;
  location?: string | null; note?: string | null;
};

type Schema = Record<string, unknown>;
export const string = { type: "string", minLength: 1 };
export const date = { ...string, format: "date" };
export const day = { enum: ["A", "B", "C"] };
export const count = { type: "integer", minimum: 0 };
export const number = { type: "number", minimum: 0 };
export const positive = { type: "integer", minimum: 1 };
const nullable = (schema: Schema) => ({ anyOf: [schema, { type: "null" }] });
export const array = (items: Schema) => ({ type: "array", items });
export const object = (properties: Record<string, Schema>, required = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false });
const prescription = object({ sets: nullable(count), min: nullable(count), max: nullable(count) });
const result = object({
  exercise: string, prescription: nullable(prescription), kg: nullable(number),
  sets: array(object({ kg: nullable(number), reps: nullable(count) })),
  note: nullable(string),
}, ["exercise", "sets"]);
export const workout = object({
  id: string, date, day, exercises: array(result),
  minutes: nullable(number), distanceKm: nullable(number), note: nullable(string),
}, ["id", "date", "day", "exercises"]);
export const assignment = object({ id: string, day, exercise: string, sets: positive, min: positive, max: positive });
const metricFields = {
  id: string, date: nullable(date),
  measurements: { type: "object", minProperties: 1, additionalProperties: number },
  location: nullable(string), note: nullable(string),
};
export const measurement = object(metricFields, ["id", "date", "measurements"]);
export const datedMeasurement = object({ ...metricFields, date }, ["id", "date", "measurements"]);
const backupFields = { workouts: array(workout), plan: array(assignment), metrics: array(measurement) };
export const backup = {
  anyOf: [
    object({ version: { const: 1 }, ...backupFields }),
    object({ version: { const: 2 }, ...backupFields, context: { type: "string" } }),
  ],
};

export function validate(schema: Schema, value: unknown, path = "input"): void {
  const fail = () => { throw new Error(`Invalid value at ${path}`); };
  if (Array.isArray(schema.anyOf)) {
    for (const option of schema.anyOf) {
      try { validate(option, value, path); return; } catch { /* Try the next allowed shape. */ }
    }
    fail();
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail();
  if ("const" in schema && value !== schema.const) fail();
  if (schema.type === "null" && value !== null) fail();
  if (schema.type === "boolean" && typeof value !== "boolean") fail();
  if (schema.type === "string") {
    if (typeof value !== "string" || (schema.minLength && value.length < Number(schema.minLength))) return fail();
    if (schema.format === "date") {
      const parsed = new Date(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+parsed) ||
          parsed.toISOString().slice(0, 10) !== value) fail();
    }
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) ||
        (schema.type === "integer" && !Number.isInteger(value)) ||
        value < Number(schema.minimum ?? -Infinity)) fail();
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return fail();
    value.forEach((item, index) => validate(schema.items as Schema, item, `${path}[${index}]`));
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    const entries = Object.entries(value);
    if (entries.length < Number(schema.minProperties ?? 0)) fail();
    for (const key of (schema.required ?? []) as string[]) {
      if (!Object.hasOwn(value, key)) throw new Error(`Missing ${path}.${key}`);
    }
    for (const [key, item] of entries) {
      const child = Object.hasOwn(properties, key) ? properties[key] : schema.additionalProperties;
      if (!child || typeof child !== "object") throw new Error(`Unknown field ${path}.${key}`);
      validate(child as Schema, item, `${path}.${key}`);
    }
  }
}
