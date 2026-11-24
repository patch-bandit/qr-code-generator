// Writes schema/bandit-codes.schema.json from the zod schema (the single source of truth).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { configSchema } from "../src/core/schema";

export function buildJsonSchema(): string {
  const schema = z.toJSONSchema(configSchema, { io: "input", unrepresentable: "any" });
  return JSON.stringify({ title: "Bandit Codes config", ...schema }, null, 2) + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bandit-codes.schema.json"), buildJsonSchema());
  console.log("wrote schema/bandit-codes.schema.json");
}
