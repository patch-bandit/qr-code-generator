import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/core/schema";
import { MAX_IMAGE_FILE_BYTES, loadConfigFile } from "../src/node/files";
import { root, tsxLoaderUrl } from "./helpers";

const dir = mkdtempSync(join(tmpdir(), "bandit-codes-paths-"));
const sub = join(dir, "cfg");

function write(name: string, image: unknown, folder = sub) {
  const file = join(folder, name);
  writeFileSync(file, JSON.stringify({ type: "link", content: { url: "https://example.com" }, image }));
  return file;
}
const errors = (r: ReturnType<typeof loadConfigFile>) => (r.ok ? "" : r.errors.join(" "));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeAll(() => {
  mkdirSync(join(sub, "assets"), { recursive: true });
  copyFileSync(join(root, "examples", "assets", "sample-logo.png"), join(sub, "assets", "logo.png"));
  copyFileSync(join(root, "examples", "assets", "sample-logo.png"), join(dir, "outside.png"));
});

describe("image files named in a config (command line)", () => {
  it("reads a png inside the config's own folder", () => {
    expect(loadConfigFile(write("ok.json", { mode: "logo", src: "assets/logo.png" })).ok).toBe(true);
  });

  it("refuses a path that climbs out of the folder", () => {
    expect(errors(loadConfigFile(write("up.json", { mode: "logo", src: "../outside.png" })))).toContain("inside the config file's folder");
  });

  it("refuses absolute paths", () => {
    expect(errors(loadConfigFile(write("abs.json", { mode: "logo", src: join(dir, "outside.png") })))).toContain("inside the config file's folder");
  });

  it("refuses network share and extended paths without touching them", () => {
    for (const src of ["\\\\server\\share\\logo.png", "//server/share/logo.png", "\\\\?\\C:\\logo.png"]) {
      expect(errors(loadConfigFile(write("unc.json", { mode: "logo", src })))).toContain("inside the config file's folder");
    }
  });

  it("refuses SVG logos, from a file or inline, because the renderer could follow links inside them", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/hosts"/></svg>').toString("base64");
    expect(errors(loadConfigFile(write("svg1.json", { mode: "logo", src: `data:image/svg+xml;base64,${svg}` })))).toContain("only supported in the web app");
    writeFileSync(join(sub, "assets", "logo.svg"), "<svg/>");
    expect(errors(loadConfigFile(write("svg2.json", { mode: "logo", src: "assets/logo.svg" })))).toContain("Unsupported image type");
  });

  it("refuses an image file over the size cap before reading it", () => {
    writeFileSync(join(sub, "assets", "huge.png"), Buffer.alloc(MAX_IMAGE_FILE_BYTES + 1));
    expect(errors(loadConfigFile(write("huge.json", { mode: "logo", src: "assets/huge.png" })))).toContain("over 10 MB");
  });

  it("says plainly when the file is missing", () => {
    expect(loadConfigFile(write("missing.json", { mode: "logo", src: "assets/nope.png" })).ok).toBe(false);
  });
});

describe("command line output and option checks", () => {
  const cli = join(root, "src", "cli.ts");
  const tsxLoader = tsxLoaderUrl();
  const run = (cwd: string, args: string[]) => spawnSync(process.execPath, ["--import", tsxLoader, cli, ...args], { cwd, encoding: "utf8" });
  const cfg = (file: string) => JSON.stringify({ type: "link", content: { url: "https://example.com" }, output: { file } });

  it("refuses a config output file that goes out through a symbolic link", (ctx) => {
    const work = join(dir, "work");
    mkdirSync(work, { recursive: true });
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    try {
      symlinkSync(elsewhere, join(work, "link"), "junction");
    } catch {
      ctx.skip("this machine does not allow creating symbolic links or junctions");
      return;
    }
    writeFileSync(join(work, "c.json"), cfg("link/out.png"));
    const r = run(work, ["c.json"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("inside the current folder");
    expect(existsSync(join(elsewhere, "out.png"))).toBe(false);
  });

  it("still writes a config output file in a new subfolder", () => {
    const work = join(dir, "work2");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "c.json"), cfg("sub/new/out.png"));
    expect(run(work, ["c.json"]).status).toBe(0);
    expect(existsSync(join(work, "sub", "new", "out.png"))).toBe(true);
  });

  it("treats -o or -f without a value as a usage error", () => {
    const work = join(dir, "work3");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "c.json"), cfg("a.png"));
    for (const args of [["c.json", "-o"], ["c.json", "--out"], ["c.json", "-f"], ["c.json", "-o", "--no-verify"]]) {
      const r = run(work, args);
      expect(r.status, args.join(" ")).toBe(1);
      expect(r.stderr).toContain("needs a value");
    }
    expect(existsSync(join(work, "a.png"))).toBe(false);
  });
});

describe("images that say bitmap but hold markup", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const cfg = (src: string) => ({ type: "link", content: { url: "https://example.com" }, image: { mode: "logo", src } });

  it("refuses png, jpeg, webp and gif data URIs whose bytes start with <", () => {
    for (const mime of ["png", "jpeg", "webp", "gif"]) {
      for (const body of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<?xml version="1.0"?><svg/>', '  \n<svg/>', "\uFEFF<svg/>"]) {
        const r = parseConfig(cfg(`data:image/${mime};base64,${b64(body)}`));
        expect(r.ok, `${mime} ${JSON.stringify(body)}`).toBe(false);
        if (!r.ok) expect(r.errors.join(" ")).toContain("markup");
      }
    }
  });

  it("accepts a real png data URI and a declared svg is left to the other rule", () => {
    const real = readFileSync(join(root, "examples", "assets", "sample-logo.png")).toString("base64");
    expect(parseConfig(cfg(`data:image/png;base64,${real}`)).ok).toBe(true);
    expect(parseConfig(cfg(`data:image/svg+xml;base64,${b64("<svg/>")}`)).ok).toBe(true);
  });
});

describe("output file names from a config", () => {
  const cli = join(root, "src", "cli.ts");
  const tsxLoader = tsxLoaderUrl();
  const run = (cwd: string, args: string[]) => spawnSync(process.execPath, ["--import", tsxLoader, cli, ...args], { cwd, encoding: "utf8" });

  it("refuses a colon and Windows device names, and still allows -o and ordinary names", () => {
    const work = join(dir, "names");
    mkdirSync(work, { recursive: true });
    for (const file of ["ok.png:stream", "nul.png", "CON", "sub/aux.svg", "sub\\nul.png", "a\\\\prn.png", "COM¹.png", "CONOUT$", "com1.txt.png", "name.png.", "name.png "]) {
      writeFileSync(join(work, "c.json"), JSON.stringify({ type: "link", content: { url: "https://example.com" }, output: { file } }));
      const r = run(work, ["c.json"]);
      expect(r.status, file).toBe(2);
      expect(r.stderr, file).toContain("not allowed");
    }
    writeFileSync(join(work, "c.json"), JSON.stringify({ type: "link", content: { url: "https://example.com" }, output: { file: "console.png" } }));
    expect(run(work, ["c.json"]).status).toBe(0);
    expect(existsSync(join(work, "console.png"))).toBe(true);
    expect(run(work, ["c.json", "-o", "nul.png"]).status).not.toBe(2);
  });
});
