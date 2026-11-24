// Brand-case check: visible copy writes the product as "Bandit Codes" (capital B, capital C, one space).
// Flags wrong casing or spacing in prose (Bandit codes, bandit codes, BANDIT CODES, BanditCodes, Banditcodes) and wrong-case split logo markup.
// Not flagged: identifiers (bandit-codes-, banditCodes, BANDIT_CODES_ env names, package names), file names, URLs, the lowercase domain in real addresses and code, and the iCalendar PRODID line.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = process.argv[2] || ".";
const SKIP = new Set(["node_modules", ".git", "out", ".next", "evidence", "dist", "generator", "runs", ".agent"]);
const EXT = new Set([".svg", ".yml", ".yaml", ".conf", ".ts", ".tsx", ".md", ".mjs", ".css", ".txt", ".html", ".json"]);
const NOT_FILES = new Set(["brand-check.mjs", "package-lock.json", "shared-fixture.json"]);
function checkLine(line) {
  const hits = [];
  for (const m of line.matchAll(/(?<![\w/.@-])bandit[ ]codes(?![\w-])/gi)) {
    if (m[0] !== "Bandit Codes") hits.push(`${m[0]} (write Bandit Codes)`);
  }
  for (const m of line.matchAll(/(?<![\w/.-])(?:BanditCodes|Banditcodes|BANDITCODES|banditcodes)(?![\w-])/g)) {
    hits.push(`${m[0]} (write Bandit Codes)`);
  }
  for (const m of line.matchAll(/(?<![\w/.-])bandit\s*<span>\s*codes\s*<\/span>/gi)) {
    if (!/^Bandit\s*<span>\s*Codes\s*<\/span>$/.test(m[0])) hits.push(`${m[0]} (write Bandit <span>Codes</span>)`);
  }
  return hits;
}
const bad = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if ((EXT.has(extname(name)) || name === "Dockerfile" || name === "NOTICE" || name === "LICENSE") && !NOT_FILES.has(name)) scan(p);
  }
}
function scan(p) {
  readFileSync(p, "utf8").split("\n").forEach((line, i) => {
    if (/PRODID|Copyright \(c\)/.test(line)) return;
    for (const why of checkLine(line)) bad.push(`${p}:${i + 1}  ${why}`);
  });
}
walk(root);
if (bad.length) {
  console.error(bad.join("\n"));
  process.exit(1);
}
console.log("brand-case check passed");
