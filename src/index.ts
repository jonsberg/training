import { createInterface } from "node:readline";
import { Diary } from "./database.ts";
import { validate } from "./schema.ts";
import { trainingTools } from "./tools.ts";

const db = new Diary();
const tools = trainingTools(db);
const protocols = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

function request(method: string, params: Record<string, unknown> = {}) {
  switch (method) {
    case "initialize": return {
      protocolVersion: protocols.includes(String(params.protocolVersion)) ? params.protocolVersion : protocols[0],
      capabilities: { tools: {} },
      serverInfo: { name: "training", version: "1.0.0" },
    };
    case "ping": return {};
    case "tools/list": return {
      tools: Object.entries(tools).map(([name, { description, inputSchema }]) => ({ name, description, inputSchema })),
    };
    case "tools/call": {
      const name = String(params.name) as keyof typeof tools;
      if (!Object.hasOwn(tools, name)) throw new Error("Unknown tool");
      const tool = tools[name];
      try {
        const input = params.arguments ?? {};
        validate(tool.inputSchema, input);
        const run = tool.run as (input: unknown) => unknown;
        return { content: [{ type: "text", text: JSON.stringify(run(input)) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: String(error instanceof Error ? error.message : error) }] };
      }
    }
    default: throw Object.assign(new Error("Method not found"), { code: -32601 });
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message: object) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
lines.on("line", line => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    send({ id: message?.id ?? null, error: { code: -32600, message: "Invalid request" } });
    return;
  }
  if (!Object.hasOwn(message, "id")) return;
  try {
    send({ id: message.id, result: request(message.method, message.params) });
  } catch (error) {
    const failure = error as Error & { code?: number };
    send({ id: message.id, error: { code: failure.code ?? -32602, message: failure.message } });
  }
});
lines.on("close", () => db.db.close());
