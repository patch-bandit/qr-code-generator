import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildJsonSchema } from "../scripts/make-schema";
import { decodePngFile, example, root } from "./helpers";

const tmp = join(root, "tests", ".tmp");
const run = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", join(root, "src", "cli.ts"), ...args], { cwd: root, encoding: "utf8" });

beforeAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
});

describe("command line", () => {
  it("writes a PNG that decodes to the configured link", async () => {
    const out = join(tmp, "link.png");
    const r = run([example("link"), "-o", out]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("scans");
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).subarray(1, 4).toString()).toBe("PNG");
    expect(await decodePngFile(out)).toBe("https://example.com/welcome");
  });

  it("writes an SVG", () => {
    const out = join(tmp, "wifi.svg");
    const r = run([example("wifi"), "-o", out]);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(out, "utf8").startsWith("<svg")).toBe(true);
  });

  it("refuses a config whose output file points outside the current folder", () => {
    const cfg = join(tmp, "escape.json");
    const target = join(root, "..", "bandit-codes-escape-test.png");
    writeFileSync(cfg, JSON.stringify({ type: "link", content: { url: "https://example.com" }, output: { file: "../../../bandit-codes-escape-test.png" } }));
    const r = run([cfg]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("inside the current folder");
    expect(existsSync(target)).toBe(false);
    writeFileSync(cfg, JSON.stringify({ type: "link", content: { url: "https://example.com" }, output: { file: join(tmp, "abs.png") } }));
    expect(run([cfg]).status).toBe(2);
  });

  it("builds a logo example with its image file", () => {
    const r = run([example("logo"), "-o", join(tmp, "logo.png")]);
    expect(r.status, r.stderr).toBe(0);
  });

  it("exits 2 and names the problem for an invalid config", () => {
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, JSON.stringify({ type: "link", content: { url: "not a url" } }));
    const r = run([bad]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("content.url");
  });

  it("exits 3 when the result won't scan", () => {
    const faint = join(tmp, "faint.json");
    writeFileSync(
      faint,
      JSON.stringify({
        type: "link",
        content: { url: "https://example.com" },
        style: { dotColor: "#F2F2F2", backgroundColor: "#FFFFFF" },
      }),
    );
    const r = run([faint, "-o", join(tmp, "faint.png")]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("won't scan");
  });

  it("prints help", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });
});

describe("schema file", () => {
  it("matches the zod schema (run `npm run schema` after changing it)", () => {
    const committed = readFileSync(join(root, "schema", "bandit-codes.schema.json"), "utf8");
    // Line endings depend on the checkout settings, so compare without them.
    expect(committed.replace(/\r\n/g, "\n")).toBe(buildJsonSchema().replace(/\r\n/g, "\n"));
  });

  it("is valid JSON describing every type", () => {
    const s = JSON.parse(buildJsonSchema());
    const text = JSON.stringify(s);
    for (const t of ["link", "text", "vcard", "wifi", "email", "sms", "phone", "geo", "event"]) {
      expect(text).toContain(`"${t}"`);
    }
  });
});

