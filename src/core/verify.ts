import { decodePixels, type Pixels } from "./decode";
import { buildPayload } from "./payload";
import { createMatrix, effectiveEcc, renderSvg } from "./render";
import type { Config } from "./schema";

export type { Pixels };

/** Turns an SVG string into pixels or a PNG. The browser and Node each bring one. */
export interface Rasterizer {
  toPixels(svg: string, size: number): Promise<Pixels>;
  toPng(svg: string, size: number): Promise<Uint8Array>;
}

export type VerifyResult =
  | { ok: true; decoded: string }
  | { ok: false; reason: "unreadable" | "different"; message: string; decoded?: string };

/**
 * Pixels per module used when checking. A phone camera sees a printed code at
 * a few pixels per module, so the code has to read at each of these sizes.
 */
export const CHECK_PX_PER_MODULE = [6, 8, 10];

/** Below this many pixels per module in the downloaded file, a scanner cannot be expected to read it. */
export const MIN_PX_PER_MODULE = 4;

/**
 * Draws the code, reads it back the way a scanner would, at several sizes, and
 * compares what it read with the content the config asked for.
 */
export async function verify(config: Config, rasterizer: Rasterizer): Promise<VerifyResult> {
  const payload = buildPayload(config);
  const n = createMatrix(payload, effectiveEcc(config)).size;
  const total = n + 2 * config.style.quietZone;
  if (config.style.quietZone < 2) {
    return {
      ok: false,
      reason: "unreadable",
      message: "The empty margin around the code is too small. Phone cameras need at least 2 modules; 4 is the standard.",
    };
  }
  if (config.style.size / total < MIN_PX_PER_MODULE) {
    return {
      ok: false,
      reason: "unreadable",
      message: "At this download size each dot is only a few pixels wide, so the file may not scan. Pick a larger size or shorten the content.",
    };
  }
  for (const per of CHECK_PX_PER_MODULE) {
    const size = total * per;
    const px = await rasterizer.toPixels(renderSvg(config, { size }), size);
    const hit = decodePixels(px);
    if (!hit) {
      return {
        ok: false,
        reason: "unreadable",
        message: "This code did not read back. Try stronger contrast, a larger quiet zone, or a smaller logo.",
      };
    }
    if (hit !== payload) {
      return {
        ok: false,
        reason: "different",
        message: "The code reads, but not as the content you entered. Try different colors or a simpler style.",
        decoded: hit,
      };
    }
  }
  return { ok: true, decoded: payload };
}




