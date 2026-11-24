import { describe, expect, it } from "vitest";
import { buildPayload, parseConfig, verify } from "../src/core";
import { nodeRasterizer } from "../src/node/raster";
import { decodeConfig, loadExample, parseIcs, parseVcard, parseWifi } from "./helpers";

/** Encode with the app, decode with an independent read, and compare to what went in. */

describe("round trip: encode, decode, same content", () => {
  it("link", async () => {
    const c = loadExample("link");
    expect(await decodeConfig(c)).toBe("https://example.com/welcome");
  });

  it("text, including non-ASCII characters", async () => {
    const parsed = parseConfig({ type: "text", content: { text: "Café ☕ naïve — 日本語" } });
    if (!parsed.ok) throw new Error(parsed.errors.join());
    expect(await decodeConfig(parsed.config)).toBe("Café ☕ naïve — 日本語");
  });

  it("vcard, with commas, semicolons, backslashes and newlines in the fields", async () => {
    const c = loadExample("vcard");
    const decoded = await decodeConfig(c);
    expect(decoded).toBe(buildPayload(c));
    const v = parseVcard(decoded as string);
    // What a phone reads must follow the vCard text rules, not just survive our own parser.
    expect(decoded).toContain("ORG:Example Co\\, Ltd\\; Sample Division");
    expect((decoded as string).replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(v.begin).toBe("BEGIN:VCARD");
    expect(v.end).toBe("END:VCARD");
    expect(v.firstName).toBe("Jordan");
    expect(v.lastName).toBe("Sample");
    expect(v.organization).toBe("Example Co, Ltd; Sample Division");
    expect(v.title).toBe("Head of Examples");
    expect(v.note).toBe("Line one\nLine two; with, punctuation");
    expect(v.phones).toEqual(["+15550100"]);
    expect(v.emails).toEqual(["jordan@example.com"]);
    expect(v.adr.slice(2)).toEqual(["100 Sample Street", "Exampleton", "EX", "00000", "Exampleland"]);
  });

  it("vcard keeps a backslash before a separator intact", async () => {
    const parsed = parseConfig({ type: "vcard", content: { firstName: "A\\;B", lastName: "C,D", organization: "X\\" } });
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const v = parseVcard((await decodeConfig(parsed.config)) as string);
    expect(v.firstName).toBe("A\\;B");
    expect(v.lastName).toBe("C,D");
    expect(v.organization).toBe("X\\");
  });

  it("wifi, with separators in the password", async () => {
    const c = loadExample("wifi");
    const w = parseWifi((await decodeConfig(c)) as string);
    expect(w).toMatchObject({ T: "WPA", S: "ExampleNet", P: "correct-horse;battery:staple" });
  });

  it("wifi open network and hidden flag", async () => {
    const parsed = parseConfig({ type: "wifi", content: { ssid: 'Guest "Lounge"', security: "nopass", hidden: true } });
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const w = parseWifi((await decodeConfig(parsed.config)) as string);
    expect(w).toMatchObject({ T: "nopass", S: 'Guest "Lounge"', H: "true" });
    expect(w.P).toBeUndefined();
  });

  it("email", async () => {
    const decoded = (await decodeConfig(loadExample("email"))) as string;
    const u = new URL(decoded);
    expect(u.protocol).toBe("mailto:");
    expect(u.pathname).toBe("hello@example.com");
    expect(u.searchParams.get("subject")).toBe("Hello there");
    expect(u.searchParams.get("body")).toBe("Sent from a Bandit Codes code.");
  });

  it("sms", async () => {
    expect(await decodeConfig(loadExample("sms"))).toBe("SMSTO:+15550101:Text me back");
  });

  it("phone", async () => {
    expect(await decodeConfig(loadExample("phone"))).toBe("tel:+15550102");
  });

  it("geo", async () => {
    const decoded = (await decodeConfig(loadExample("geo"))) as string;
    expect(decoded.startsWith("geo:47.6205,-122.3493")).toBe(true);
    expect(decodeURIComponent(decoded.split("?q=")[1])).toBe("47.6205,-122.3493(Sample Landmark)");
  });

  it("event", async () => {
    const e = parseIcs((await decodeConfig(loadExample("event"))) as string);
    expect(Object.keys(e)).toContain("DESCRIPTION");
    expect(e.SUMMARY).toBe("Example Open House");
    expect(e.DTSTART).toBe("20270314T100000");
    expect(e.DTEND).toBe("20270314T123000");
    expect(e.LOCATION).toBe("100 Sample Street, Exampleton");
    expect(e.DESCRIPTION).toBe("Come by, say hello; bring a friend.");
  });

  it("all-day event ends the day after", async () => {
    const parsed = parseConfig({ type: "event", content: { title: "Day off", start: "2027-12-31" } });
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const e = parseIcs((await decodeConfig(parsed.config)) as string);
    expect(e.DTSTART).toBe("20271231");
    expect(e.DTEND).toBe("20280101");
  });

  it("every example scans through the built-in check", async () => {
    for (const name of ["link", "text", "vcard", "wifi", "email", "sms", "phone", "geo", "event", "logo"]) {
      const r = await verify(loadExample(name), nodeRasterizer);
      expect(r.ok, name).toBe(true);
    }
  });

  it("every style shape and corner combination scans", async () => {
    for (const dotShape of ["square", "rounded", "dot"] as const) {
      for (const cornerStyle of ["square", "rounded", "circle"] as const) {
        const parsed = parseConfig({
          type: "link",
          content: { url: "https://example.com/style" },
          style: { dotShape, cornerStyle, dotColor: "#1E1033", backgroundColor: "#FFFFFF", errorCorrection: "Q" },
        });
        if (!parsed.ok) throw new Error(parsed.errors.join());
        const r = await verify(parsed.config, nodeRasterizer);
        expect(r.ok, `${dotShape}/${cornerStyle}`).toBe(true);
      }
    }
  });
});

