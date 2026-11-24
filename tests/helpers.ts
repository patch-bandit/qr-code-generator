import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderSvg, type Config } from "../src/core";
import { decodePixels } from "../src/core/decode";
import { loadConfigFile } from "../src/node/files";
import { nodeRasterizer } from "../src/node/raster";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** File URL of the tsx loader, found by walking up from this folder (the mutation proof runs tests from a copy inside the repo). */
export function tsxLoaderUrl(): string {
  let dir = root;
  for (let i = 0; i < 6; i++) {
    const file = join(dir, "node_modules", "tsx", "dist", "esm", "index.mjs");
    if (existsSync(file)) return pathToFileURL(file).href;
    dir = join(dir, "..");
  }
  throw new Error("tsx is not installed");
}
export const example = (name: string) => join(root, "examples", `${name}.json`);

export function loadExample(name: string): Config {
  const r = loadConfigFile(example(name));
  if (!r.ok) throw new Error(`example ${name} invalid: ${r.errors.join("; ")}`);
  return r.config;
}

/** Draws the code and reads it back with an separate decode call (not through verify). */
export async function decodeConfig(config: Config, size = 1000): Promise<string | null> {
  const p = await nodeRasterizer.toPixels(renderSvg(config, { size }), size);
  return decodePixels(p);
}

/** Splits on a separator that is not escaped, leaving escapes in place. */
export function splitUnescaped(s: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      cur += s[i] + s[i + 1];
      i++;
    } else if (s[i] === sep) {
      parts.push(cur);
      cur = "";
    } else cur += s[i];
  }
  parts.push(cur);
  return parts;
}

export function unescapeText(s: string): string {
  return s.replace(/\\(.)/gs, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** A small independent reader for the vCard text the app writes. */
export function parseVcard(payload: string) {
  const lines = payload.split("\r\n");
  const get = (key: string) =>
    lines.filter((l) => l.toUpperCase().startsWith(key + ":") || l.toUpperCase().startsWith(key + ";")).map((l) => l.slice(l.indexOf(":") + 1));
  const n = splitUnescaped(get("N")[0] ?? "", ";").map(unescapeText);
  const adr = splitUnescaped(get("ADR")[0] ?? "", ";").map(unescapeText);
  return {
    begin: lines[0],
    end: lines[lines.length - 1],
    lastName: n[0],
    firstName: n[1],
    fn: unescapeText(get("FN")[0] ?? ""),
    organization: get("ORG")[0] ? unescapeText(get("ORG")[0]) : undefined,
    title: get("TITLE")[0] ? unescapeText(get("TITLE")[0]) : undefined,
    phones: get("TEL"),
    emails: get("EMAIL"),
    url: get("URL")[0],
    adr,
    note: get("NOTE")[0] ? unescapeText(get("NOTE")[0]) : undefined,
  };
}

export function parseWifi(payload: string) {
  const body = payload.replace(/^WIFI:/, "").replace(/;;$/, "");
  const out: Record<string, string> = {};
  for (const part of splitUnescaped(body, ";")) {
    const i = part.indexOf(":");
    out[part.slice(0, i)] = unescapeText(part.slice(i + 1));
  }
  return out;
}

export function parseIcs(payload: string) {
  const out: Record<string, string> = {};
  for (const line of payload.split("\r\n")) {
    const i = line.indexOf(":");
    out[line.slice(0, i).split(";")[0]] = unescapeText(line.slice(i + 1));
  }
  return out;
}

/** A solid-color PNG as a data URI, for image-mode tests. */
export function solidImage(color: string, size = 200): string {
  const c = createCanvas(size, size);
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  return `data:image/png;base64,${c.toBuffer("image/png").toString("base64")}`;
}

export async function decodePngFile(file: string): Promise<string | null> {
  const img = await loadImage(readFileSync(file));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, img.width, img.height);
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height);
  return decodePixels({ data: new Uint8ClampedArray(d.data), width: img.width, height: img.height });
}


