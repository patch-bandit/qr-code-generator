import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Pixels, Rasterizer } from "../core/verify";

/** Rasterizer for Node: used by the command line and the tests. */
export const nodeRasterizer: Rasterizer = {
  async toPixels(svg, size): Promise<Pixels> {
    const img = await loadImage(Buffer.from(svg));
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size);
    return { data: new Uint8ClampedArray(d.data), width: size, height: size };
  },
  async toPng(svg, size) {
    const img = await loadImage(Buffer.from(svg));
    const canvas = createCanvas(size, size);
    canvas.getContext("2d").drawImage(img, 0, 0, size, size);
    return new Uint8Array(await canvas.encode("png"));
  },
};
