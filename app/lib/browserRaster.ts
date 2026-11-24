import type { Pixels, Rasterizer } from "@/core";

async function draw(svg: string, size: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser cannot draw the code.");
    ctx.drawImage(img, 0, 0, size, size);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterizer for the browser: the SVG is drawn on a canvas, on this device. */
export const browserRasterizer: Rasterizer = {
  async toPixels(svg, size): Promise<Pixels> {
    const canvas = await draw(svg, size);
    const d = canvas.getContext("2d")!.getImageData(0, 0, size, size);
    return { data: d.data, width: size, height: size };
  },
  async toPng(svg, size) {
    const canvas = await draw(svg, size);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("Could not make the PNG.");
    return new Uint8Array(await blob.arrayBuffer());
  },
};

export const MAX_SIDE = 8000;
export const MAX_PIXELS = 50_000_000;
export const HEADER_BYTES = 2_000_000;

/** Reads the pixel size from the file header (PNG, GIF, JPEG, WebP) without decoding the image. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length > 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") {
    return { width: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, height: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
  }
  if (b.length > 10 && ascii(0, 3) === "GIF") return { width: u16le(6), height: u16le(8) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = u16be(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(i + 7), height: u16be(i + 5) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (kind === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === "VP8L") {
      const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/** Reads an image file, shrinks it to fit `max` pixels, and returns a data: URI. Nothing is uploaded. */
export async function fileToDataUri(file: File, max: number, kind: "png" | "jpeg"): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new Error("Use a PNG, JPEG, WebP or GIF image.");
  }
  if (file.size > 20_000_000) throw new Error("That image is over 20 MB. Try a smaller one.");
  // Phone photos can carry large EXIF or color-profile blocks before the size marker,
  // so look through the first 2 MB, which is far more than any real header needs.
  const dims = imageSize(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
  if (!dims) throw new Error("This image's size could not be read, so it was not loaded. Try saving it again as a PNG or JPEG.");
  if (dims.width > MAX_SIDE || dims.height > MAX_SIDE || dims.width * dims.height > MAX_PIXELS) {
    throw new Error("That image is too large to load here. Try one under 8000 pixels on each side.");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if (kind === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL(kind === "png" ? "image/png" : "image/jpeg", 0.88);
}
