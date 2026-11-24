import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const script = resolve(root, "scripts/brand-check.mjs");

function checkSample(filename: string, content: string) {
  const dir = mkdtempSync(join(tmpdir(), "bandit-codes-brand-"));
  try {
    writeFileSync(join(dir, filename), content, "utf8");
    return spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("brand case", () => {
  it("writes the product as Bandit Codes in visible copy", () => {
    const out = execFileSync(process.execPath, [script, root], { encoding: "utf8" });
    expect(out).toContain("passed");
  });

  it("refuses wrong brand forms and wrong split logo markup", () => {
    const wrongForms = [
      ["lowercase c", "sample.md", `Welcome to ${"Bandit" + " codes"}.`],
      ["all lowercase", "sample.md", `Welcome to ${"bandit" + " codes"}.`],
      ["all caps", "sample.md", `Welcome to ${"BANDIT" + " CODES"}.`],
      ["joined", "sample.md", `Welcome to ${"Bandit" + "Codes"}.`],
      ["joined lowercase c", "sample.md", `Welcome to ${"Bandit" + "codes"}.`],
      ["wrong split logo", "sample.tsx", `<span>${"bandit" + " <span>codes</span>"}</span>`],
    ] as const;

    for (const [label, file, text] of wrongForms) {
      const res = checkSample(file, text);
      expect(res.status, label).not.toBe(0);
    }
  });

  it("allows Bandit Codes in prose, identifiers, env vars, file names, and lowercase domains in addresses", () => {
    const ok = [
      "Bandit Codes is free. Visit https://bandit-codes.example/.",
      '<a href="https://bandit-codes.example/count-your-scans/">Bandit Codes</a>',
      "const banditCodesTotal = 0;",
      "BANDIT_CODES_BASE_PATH=/qr bandit-codes-config.json",
      "<span>Bandit <span>Codes</span></span>",
    ].join("\n");
    const res = checkSample("ok.tsx", ok);
    expect(res.status, res.stderr).toBe(0);
  });
});
