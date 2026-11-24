// Mutation proofs: break one thing in a throwaway copy of the code and show the
// tests notice. Usage: npm run mutation-proof
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, ".mutation");
const vitest = join(root, "node_modules", "vitest", "vitest.mjs");

const mutations = [
  {
    name: "decode check always says it scans",
    file: "src/core/verify.ts",
    find: "const hit = decodePixels(px);",
    replace: "const hit: string | null = payload;",
  },
  {
    name: "vCard and calendar escaping removed",
    file: "src/core/payload.ts",
    find: "export function escapeText(s: string): string {",
    replace: "export function escapeText(s: string): string {\n  return s;\n}\nfunction unusedEscapeText(s: string): string {",
  },
  {
    name: "Wi-Fi escaping removed",
    file: "src/core/payload.ts",
    find: "export function escapeWifi(s: string): string {",
    replace: "export function escapeWifi(s: string): string {\n  return s;\n}\nfunction unusedEscapeWifi(s: string): string {",
  },
  {
    name: "campaign tags drop the #fragment",
    file: "src/core/tracking.ts",
    find: 'const fragment = hash === -1 ? "" : url.slice(hash);',
    replace: 'const fragment = "";',
  },
  {
    name: "campaign tags overwrite a utm key already in the address",
    file: "src/core/tracking.ts",
    find: "if (present.has(name)) kept.push(name);",
    replace: "if (false) kept.push(name);",
  },
];

function runTests(dir) {
  const r = spawnSync(process.execPath, [vitest, "run"], { cwd: dir, encoding: "utf8" });
  const out = r.stdout + r.stderr;
  const names = [...out.matchAll(/^ FAIL  (.+)$/gm)].map((x) => x[1].replace(/^tests\/\S+ > /, ""));
  return { status: r.status, failed: names.length, names: [...new Set(names)], out };
}

function copyTo(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const p of ["src", "app", "tests", "scripts", "examples", "schema", "vitest.config.ts", "tsconfig.json", "package.json"]) {
    cpSync(join(root, p), join(dir, p), { recursive: true, filter: (s) => !s.includes(`${join("tests", ".tmp")}`) });
  }
}

let bad = 0;
copyTo(join(work, "baseline"));
const base = runTests(join(work, "baseline"));
console.log(`baseline: ${base.status === 0 ? "all tests pass" : "TESTS FAIL BEFORE ANY CHANGE"}`);
if (base.status !== 0) {
  console.log(base.out.slice(-1500));
  process.exit(1);
}

for (const [i, m] of mutations.entries()) {
  const dir = join(work, `m${i}`);
  copyTo(dir);
  const p = join(dir, m.file);
  const text = readFileSync(p, "utf8");
  if (!text.includes(m.find)) {
    console.log(`mutation "${m.name}": the text to break was not found (update this script)`);
    bad++;
    continue;
  }
  writeFileSync(p, text.replace(m.find, m.replace));
  const r = runTests(dir);
  const caught = r.status !== 0 && r.failed > 0;
  console.log(`mutation "${m.name}": ${caught ? `caught by ${r.names.length} test(s): ${r.names.join("; ")}` : "NOT CAUGHT, tests still pass"}`);
  if (!caught) bad++;
}
rmSync(work, { recursive: true, force: true });
process.exit(bad ? 1 : 0);

