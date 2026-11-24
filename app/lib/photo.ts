import type { Pixels } from "@/core";
import { HEADER_BYTES, MAX_PIXELS, MAX_SIDE, imageSize } from "./browserRaster";

/** Longest side the reader works from. A bigger photo is shrunk while it is decoded, which also caps memory. */
export const PHOTO_MAX_SIDE = 2400;
const MAX_FILE = 20_000_000;

/** Reads an uploaded photo into pixels on this device. Refuses a wrong type, an oversize file or an oversize picture before decoding it. Nothing is uploaded. */
export async function readPhotoFile(file: File): Promise<Pixels> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Use a PNG, JPEG, WebP or GIF photo.");
  if (file.size > MAX_FILE) throw new Error("That photo is over 20 MB. Try a smaller one.");
  const dims = imageSize(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
  if (!dims) throw new Error("This photo's size could not be read, so it was not opened. Try saving it again as a JPEG or PNG.");
  if (dims.width > MAX_SIDE || dims.height > MAX_SIDE || dims.width * dims.height > MAX_PIXELS) {
    throw new Error("That photo is too large to open here. Try one under 8000 pixels on each side.");
  }
  const long = Math.max(dims.width, dims.height);
  const f = long > PHOTO_MAX_SIDE ? PHOTO_MAX_SIDE / long : 1;
  const w = Math.max(1, Math.round(dims.width * f));
  const h = Math.max(1, Math.round(dims.height * f));
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, f < 1 ? { resizeWidth: w, resizeHeight: h, resizeQuality: "high" } : undefined);
  } catch {
    throw new Error("This photo could not be opened. Try another one.");
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser cannot read the photo.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: d.data, width: d.width, height: d.height };
  } finally {
    bmp.close();
  }
}
