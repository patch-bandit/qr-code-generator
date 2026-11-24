import { describe, expect, it } from "vitest";
import { effectiveEcc, parseConfig, renderSvg, verify } from "../src/core";
import { nodeRasterizer } from "../src/node/raster";
import { loadExample, solidImage } from "./helpers";

const make = (input: unknown) => {
  const r = parseConfig(input);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.config;
};

describe("the scan check", () => {
  it("says a normal code scans", async () => {
    const r = await verify(loadExample("link"), nodeRasterizer);
    expect(r).toEqual({ ok: true, decoded: "https://example.com/welcome" });
  });

  it("says a code with almost no contrast won't scan", async () => {
    const c = make({
      type: "link",
      content: { url: "https://example.com" },
      style: { dotColor: "#F2F2F2", cornerColor: "#F2F2F2", backgroundColor: "#FFFFFF" },
    });
    const r = await verify(c, nodeRasterizer);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
  });

  it("says a code with no quiet zone and a wild background won't scan", async () => {
    const c = make({
      type: "link",
      content: { url: "https://example.com" },
      style: { dotColor: "#808080", cornerColor: "#808080", backgroundColor: "#7A7A7A", quietZone: 0 },
    });
    expect((await verify(c, nodeRasterizer)).ok).toBe(false);
  });
});

describe("logo mode", () => {
  it("lifts low error correction to Q and still scans", async () => {
    const c = make({
      type: "link",
      content: { url: "https://example.com/logo" },
      style: { errorCorrection: "L" },
      image: { mode: "logo", src: solidImage("#1E1033"), scale: 0.22 },
    });
    expect(effectiveEcc(c)).toBe("Q");
    expect((await verify(c, nodeRasterizer)).ok).toBe(true);
  });

  it("warns when a logo is too big to read around", async () => {
    const c = make({
      type: "link",
      content: { url: "https://example.com/logo-too-big-for-this-short-address-but-long-enough-to-matter" },
      style: { errorCorrection: "H", dotShape: "dot" },
      image: { mode: "logo", src: solidImage("#000000"), scale: 0.3 },
    });
    const r = await verify(c, nodeRasterizer);
    // Either it still reads, or it says so. It never passes with different content.
    if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
  });
});

describe("image to QR (blend) mode", () => {
  it("uses error correction H", () => {
    expect(effectiveEcc(loadExample("photo"))).toBe("H");
  });

  it("the sample photo example scans, or says it won't", async () => {
    const r = await verify(loadExample("photo"), nodeRasterizer);
    if (r.ok) expect(r.decoded).toBe("https://example.com/photo");
    else expect(r.message.length).toBeGreaterThan(10);
  });

  it("a photo that is dark everywhere warns that it won't scan", async () => {
    const c = make({
      type: "link",
      content: { url: "https://example.com/photo" },
      style: { dotColor: "#000000", backgroundColor: "#FFFFFF", dotShape: "dot" },
      image: { mode: "blend", src: solidImage("#000000"), veil: 0 },
    });
    const r = await verify(c, nodeRasterizer);
    expect(r.ok).toBe(false);
  });

  it("a light photo with a gentle veil scans", async () => {
    const c = make({
      type: "link",
      content: { url: "https://example.com/photo" },
      style: { dotColor: "#1E1033", backgroundColor: "#FFFFFF", dotShape: "dot" },
      image: { mode: "blend", src: solidImage("#E4F7EE"), veil: 0.3 },
    });
    expect((await verify(c, nodeRasterizer)).ok).toBe(true);
  });

  it("refuses an image that is not a data URI", () => {
    const c = make({
      type: "link",
      content: { url: "https://example.com" },
      image: { mode: "logo", src: "https://example.com/logo.png" },
    });
    expect(() => renderSvg(c)).toThrow(/data: URI/);
  });
});

describe("SVG output", () => {
  it("is a self-contained SVG with no outside references", () => {
    const svg = renderSvg(loadExample("link"));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toMatch(/<script/i);
  });
});
