import { describe, expect, it } from "vitest";
import { buildPayload, parseConfig, verify, foldLine } from "../src/core";
import { nodeRasterizer } from "../src/node/raster";

function cfg(input: unknown) {
  const r = parseConfig(input);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.config;
}
const rejects = (input: unknown) => expect(parseConfig(input).ok).toBe(false);

describe("scan badge tells the truth about the downloaded file", () => {
  it("won't scan when the download size leaves under 4 pixels per module", async () => {
    const c = cfg({
      type: "link",
      content: { url: "https://example.com/" + "a".repeat(900) },
      style: { errorCorrection: "H", size: 128 },
    });
    const r = await verify(c, nodeRasterizer);
    expect(r.ok).toBe(false);
  });

  it("won't scan with a quiet zone under 2 modules", async () => {
    const c = cfg({ type: "link", content: { url: "https://example.com" }, style: { quietZone: 0 } });
    expect((await verify(c, nodeRasterizer)).ok).toBe(false);
  });

  it("still scans a normal code", async () => {
    const c = cfg({ type: "link", content: { url: "https://example.com" } });
    expect((await verify(c, nodeRasterizer)).ok).toBe(true);
  });
});

describe("link and date validation", () => {
  it("rejects whitespace, control characters and scheme-only links", () => {
    for (const url of [" https://a.com/x", "https://a.com/x y", "https://a.com/\r\nfoo", "http:evil", "javascript:alert(1)", "data:text/html,hi"]) {
      rejects({ type: "link", content: { url } });
    }
  });
  it("rejects dates that do not exist", () => {
    for (const start of ["2026-02-30", "2026-13-45", "2026-03-14T25:61"]) {
      rejects({ type: "event", content: { title: "x", start } });
    }
    expect(parseConfig({ type: "event", content: { title: "x", start: "2028-02-29" } }).ok).toBe(true);
  });
});

describe("vCard and calendar follow the standards", () => {
  it("folds long lines at 75 octets and never splits a character", () => {
    const folded = foldLine("NOTE:" + "é".repeat(200));
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("NOTE:" + "é".repeat(200));
  });
  it("a long vCard note is folded in the payload", () => {
    const p = buildPayload(cfg({ type: "vcard", content: { firstName: "A", note: "x".repeat(200) } }));
    for (const line of p.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("calendar events carry PRODID, UID and DTSTAMP", () => {
    const p = buildPayload(cfg({ type: "event", content: { title: "Open house", start: "2027-05-01T10:00" } }));
    expect(p).toContain("PRODID:");
    expect(p).toMatch(/UID:[0-9a-f]{8}@bandit-codes/);
    expect(p).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });
});
