import BinaryBitmap from "@zxing/library/esm/core/BinaryBitmap";
import DecodeHintType from "@zxing/library/esm/core/DecodeHintType";
import HybridBinarizer from "@zxing/library/esm/core/common/HybridBinarizer";
import QRCodeReader from "@zxing/library/esm/core/qrcode/QRCodeReader";
import RGBLuminanceSource from "@zxing/library/esm/core/RGBLuminanceSource";

export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** Reads a QR code out of RGBA pixels. Returns the text, or null when nothing reads. */
export function decodePixels(px: Pixels): string | null {
  const lum = new Uint8ClampedArray(px.width * px.height);
  for (let i = 0; i < lum.length; i++) {
    const o = i * 4;
    lum[i] = (px.data[o] * 299 + px.data[o + 1] * 587 + px.data[o + 2] * 114) / 1000;
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, px.width, px.height)));
  try {
    return new QRCodeReader().decode(bitmap, new Map([[DecodeHintType.TRY_HARDER, true]])).getText();
  } catch {
    return null;
  }
}
