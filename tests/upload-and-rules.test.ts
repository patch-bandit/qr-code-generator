import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig, renderSvg } from "../src/core";
import { HEADER_BYTES, fileToDataUri, imageSize } from "../app/lib/browserRaster";
import { MAX_IMPORT_BYTES, canDownload, importTooLarge, vcardImportNotice } from "../app/lib/rules";

/** A JPEG whose size marker sits after `padding` bytes of APP1 (EXIF-style) data. */
function jpegWithPadding(padding: number, w: number, h: number): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  let left = padding;
  while (left > 0) {
    const chunk = Math.min(left, 65533); // segment length field counts itself (2 bytes)
    parts.push(0xff, 0xe1, (chunk + 2) >> 8, (chunk + 2) & 0xff);
    for (let i = 0; i < chunk; i++) parts.push(0);
    left -= chunk;
  }
  parts.push(0xff, 0xc0, 0, 11, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 0, 0, 0);
  return Uint8Array.from(parts);
}

const asFile = (bytes: Uint8Array, type = "image/jpeg") => new File([bytes as BlobPart], "photo", { type });

afterEach(() => vi.unstubAllGlobals());

describe("photo upload", () => {
  it("reads the size of a JPEG that has more than 100 KB of EXIF before the size marker", () => {
    expect(imageSize(jpegWithPadding(150_000, 4000, 3000))).toEqual({ width: 4000, height: 3000 });
  });

  it("accepts such a photo and hands it to the decoder", async () => {
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("reached the decoder")));
    await expect(fileToDataUri(asFile(jpegWithPadding(150_000, 4000, 3000)), 1000, "jpeg")).rejects.toThrow("reached the decoder");
  });

  it("still refuses an oversized image before decoding it", async () => {
    const decoder = vi.fn();
    vi.stubGlobal("createImageBitmap", decoder);
    await expect(fileToDataUri(asFile(jpegWithPadding(150_000, 30000, 30000)), 1000, "jpeg")).rejects.toThrow("too large");
    await expect(fileToDataUri(asFile(jpegWithPadding(10, 8001, 100)), 1000, "jpeg")).rejects.toThrow("too large");
    expect(decoder).not.toHaveBeenCalled();
  });

  it("refuses wrong types, files over 20 MB, and sizes it cannot read", async () => {
    const decoder = vi.fn();
    vi.stubGlobal("createImageBitmap", decoder);
    await expect(fileToDataUri(asFile(new Uint8Array(10), "image/svg+xml"), 1000, "png")).rejects.toThrow("PNG, JPEG");
    await expect(fileToDataUri(asFile(new Uint8Array(20_000_001)), 1000, "png")).rejects.toThrow("20 MB");
    await expect(fileToDataUri(asFile(new Uint8Array(500)), 1000, "png")).rejects.toThrow("size could not be read");
    // padding beyond what the page will search is reported as unreadable, not accepted blindly
    await expect(fileToDataUri(asFile(jpegWithPadding(HEADER_BYTES + 100_000, 100, 100)), 1000, "jpeg")).rejects.toThrow("size could not be read");
    expect(decoder).not.toHaveBeenCalled();
  });
});

describe("page rules", () => {
  it("warns when a contact card has more than two phones or emails", () => {
    const many = parseConfig({ type: "vcard", content: { firstName: "A", phones: ["+1 555 0100", "+1 555 0101", "+1 555 0102"] } });
    const few = parseConfig({ type: "vcard", content: { firstName: "A", phones: ["+1 555 0100"] } });
    const emails = parseConfig({ type: "vcard", content: { firstName: "A", emails: ["a@example.com", "b@example.com", "c@example.com"] } });
    if (!many.ok || !few.ok || !emails.ok) throw new Error("setup");
    expect(vcardImportNotice(many.config)).toContain("check the code");
    expect(vcardImportNotice(emails.config)).toContain("check the code");
    expect(vcardImportNotice(few.config)).toBe("");
  });

  it("offers downloads only for a drawn code whose check has finished", () => {
    expect(canDownload("<svg/>", false, "scans")).toBe(true);
    expect(canDownload("<svg/>", false, "wont")).toBe(true);
    expect(canDownload("<svg/>", false, "checking")).toBe(false);
    expect(canDownload(null, false, "scans")).toBe(false);
    expect(canDownload("<svg/>", true, "scans")).toBe(false);
  });

  it("caps the settings file it will read at 12 MB", () => {
    expect(MAX_IMPORT_BYTES).toBe(12_000_000);
    expect(importTooLarge(12_000_000)).toBe(false);
    expect(importTooLarge(12_000_001)).toBe(true);
  });

  it("allows a quiet zone of 16 and no more", () => {
    const ok = parseConfig({ type: "link", content: { url: "https://example.com" }, style: { quietZone: 16 } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(renderSvg(ok.config).startsWith("<svg")).toBe(true);
    expect(parseConfig({ type: "link", content: { url: "https://example.com" }, style: { quietZone: 17 } }).ok).toBe(false);
  });
});
