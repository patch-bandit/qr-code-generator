import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./helpers";

/** The generator's core and browser helpers never reach a network and never store anything on the device. */
const FORBIDDEN = /\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie)/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("no network, storage or cookie calls", () => {
  for (const dir of ["src/core", "app/lib", "app/components"]) {
    it(`${dir} has none`, () => {
      const hits = files(join(root, dir)).filter((f) => FORBIDDEN.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
      expect(hits).toEqual([]);
    });
  }
});
