import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/core";
import { loadConfigFile } from "../src/node/files";
import { example, root } from "./helpers";
import { join } from "node:path";

const bad = (input: unknown) => {
  const r = parseConfig(input);
  if (r.ok) throw new Error("expected the config to be rejected");
  return r.errors.join(" | ");
};

describe("config validation", () => {
  it("accepts every committed example", () => {
    const files = readdirSync(join(root, "examples")).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(11);
    for (const f of files) {
      const r = loadConfigFile(join(root, "examples", f));
      expect(r.ok, `${f}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true);
    }
  });

  it("fills defaults", () => {
    const r = parseConfig({ type: "link", content: { url: "https://example.com" } });
    expect(r.ok && r.config.style).toMatchObject({
      dotColor: "#000000",
      backgroundColor: "#FFFFFF",
      dotShape: "square",
      cornerStyle: "square",
      quietZone: 4,
      errorCorrection: "M",
      size: 1024,
    });
    expect(r.ok && r.config.output.format).toBe("png");
    expect(r.ok && r.config.image.mode).toBe("none");
  });

  it("a preset fills the style and explicit fields win", () => {
    const r = parseConfig({ type: "link", content: { url: "https://example.com" }, style: { preset: "alley", dotColor: "#000000" } });
    expect(r.ok && r.config.style.dotColor).toBe("#000000");
    expect(r.ok && r.config.style.dotShape).toBe("rounded");
  });

  it("rejects an unknown type, unknown fields and missing content", () => {
    expect(bad({ type: "fax", content: {} })).toContain("type");
    expect(bad({ type: "link" })).toContain("content");
    expect(bad({ type: "link", content: { url: "https://example.com", extra: 1 } })).toMatch(/extra|Unrecognized/);
    expect(bad({ type: "link", content: { url: "https://example.com" }, colour: "red" })).toMatch(/colour|Unrecognized/);
  });

  it("rejects web addresses that are not http or https", () => {
    expect(bad({ type: "link", content: { url: "javascript:alert(1)" } })).toContain("http");
    expect(bad({ type: "link", content: { url: "example.com" } })).toContain("http");
  });

  it("rejects bad colors and out-of-range style numbers", () => {
    const base = { type: "link", content: { url: "https://example.com" } };
    expect(bad({ ...base, style: { dotColor: "red" } })).toContain("hex");
    expect(bad({ ...base, style: { dotColor: "#12345" } })).toContain("hex");
    expect(bad({ ...base, style: { quietZone: -1 } })).toContain("quietZone");
    expect(bad({ ...base, style: { quietZone: 17 } })).toContain("quietZone");
    expect(bad({ ...base, style: { size: 10 } })).toContain("size");
    expect(bad({ ...base, style: { errorCorrection: "Z" } })).toContain("errorCorrection");
    expect(bad({ ...base, style: { dotShape: "star" } })).toContain("dotShape");
  });

  it("needs a name or organization on a contact card", () => {
    expect(bad({ type: "vcard", content: { phones: ["+1 555 0100"] } })).toContain("name");
    expect(bad({ type: "vcard", content: { firstName: "A", emails: ["nope"] } })).toContain("emails");
    expect(bad({ type: "vcard", content: { firstName: "A", phones: ["call me"] } })).toContain("phones");
  });

  it("needs a Wi-Fi password unless the network is open", () => {
    expect(bad({ type: "wifi", content: { ssid: "Net", security: "WPA" } })).toContain("password");
    expect(parseConfig({ type: "wifi", content: { ssid: "Net", security: "nopass" } }).ok).toBe(true);
    expect(bad({ type: "wifi", content: { ssid: "x".repeat(33), password: "p" } })).toContain("ssid");
  });

  it("checks map coordinates", () => {
    expect(bad({ type: "geo", content: { latitude: 91, longitude: 0 } })).toContain("latitude");
    expect(bad({ type: "geo", content: { latitude: 0, longitude: -181 } })).toContain("longitude");
  });

  it("checks event dates", () => {
    expect(bad({ type: "event", content: { title: "X", start: "14/03/2027" } })).toContain("start");
    expect(bad({ type: "event", content: { title: "X", start: "2027-03-14T10:00", end: "2027-03-14T09:00" } })).toContain("End");
    expect(bad({ type: "event", content: { title: "X", start: "2027-03-14", end: "2027-03-15T09:00" } })).toContain("both");
  });

  it("needs an image when an image mode is chosen", () => {
    const base = { type: "link", content: { url: "https://example.com" } };
    expect(bad({ ...base, image: { mode: "logo" } })).toContain("image");
    expect(bad({ ...base, image: { mode: "logo", src: "x", scale: 0.9 } })).toContain("scale");
    expect(bad({ ...base, image: { mode: "blend", src: "x", veil: 2 } })).toContain("veil");
  });

  it("reports a missing or broken config file", () => {
    const r = loadConfigFile(example("does-not-exist"));
    expect(r.ok).toBe(false);
  });
});
