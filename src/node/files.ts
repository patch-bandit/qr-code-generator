import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseConfig, type Config, type ParseResult } from "../core/schema";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Largest image file the command line will read. */
export const MAX_IMAGE_FILE_BYTES = 10_000_000;

/** Turns an image file into a base64 data: URI. */
export function fileToDataUri(file: string): string {
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) throw new Error(`Unsupported image type: ${extname(file) || "(none)"}. Use png, jpg, webp or gif.`);
  if (statSync(file).size > MAX_IMAGE_FILE_BYTES) throw new Error("That image file is over 10 MB. Use a smaller one.");
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

/**
 * Reads a config file. An image `src` that is a file path is converted to a data: URI
 * so the core stays free of file access. The path must stay inside the config file's
 * own folder: a config from someone else must not be able to pull in other files or
 * start a network connection through a \\server\share path.
 */
export function loadConfigFile(path: string): ParseResult {
  const abs = resolve(path);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    return { ok: false, errors: [`config: could not read ${path}: ${(e as Error).message}`] };
  }
  const img = (raw as { image?: { src?: unknown } } | null)?.image;
  if (img && typeof img.src === "string") {
    if (/^data:image\/svg/i.test(img.src)) {
      return { ok: false, errors: ["image.src: SVG logos are only supported in the web app. Use a png, jpg, webp or gif."] };
    }
    if (!img.src.startsWith("data:")) {
      try {
        if (/^[\\/]{2}/.test(img.src) || /^\\\\\?\\/.test(img.src) || isAbsolute(img.src)) {
          throw new Error("Use a path inside the config file's folder, such as assets/logo.png.");
        }
        const base = realpathSync(dirname(abs));
        const file = realpathSync(resolve(base, img.src));
        const rel = relative(base, file);
        if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
          throw new Error("The image must be inside the config file's folder.");
        }
        img.src = fileToDataUri(file);
      } catch (e) {
        return { ok: false, errors: [`image.src: ${(e as Error).message}`] };
      }
    }
  }
  return parseConfig(raw);
}

export type { Config };

/**
 * True when `target` (which may not exist yet) lands inside `base` once symbolic links
 * are followed. The nearest existing parent is resolved with realpath, so a link inside
 * `base` that points elsewhere does not count as inside.
 */
export function landsInside(base: string, target: string): boolean {
  const root = realpathSync(base);
  let existing = resolve(target);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return false;
    rest.unshift(basename(existing));
    existing = parent;
  }
  const real = resolve(realpathSync(existing), ...rest);
  const rel = relative(root, real);
  return !(rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel));
}

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * Why a file name from a config is not allowed as an output path, or null if it is fine.
 * A colon would write an NTFS alternate data stream, and Windows device names such as
 * NUL or CON are not real files.
 */
export function outputNameProblem(path: string): string | null {
  if (path.includes(":")) return "The output file name cannot contain a colon.";
  for (const part of path.split(/[\\/]+/)) {
    if (RESERVED.test(part.split(".")[0].trimEnd())) return `"${part}" is a reserved Windows device name.`;
    if (/[. ]$/.test(part) && part !== "." && part !== "..") return "The output file name cannot end in a dot or a space.";
  }
  return null;
}
