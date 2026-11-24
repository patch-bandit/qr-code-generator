import { describe, expect, it } from "vitest";
import { addCampaignTags, applyCampaign, buildPayload, parseConfig, verify } from "../src/core";
import { nodeRasterizer } from "../src/node/raster";
import { contentToForm, formToContent, CAMPAIGN_PRESETS, TYPE_META } from "../app/lib/forms";

const tags = { source: "flyer", medium: "print", campaign: "spring-sale" };

describe("campaign tags", () => {
  it("adds the tags to a plain address", () => {
    expect(addCampaignTags("https://example.com", tags)).toBe(
      "https://example.com?utm_source=flyer&utm_medium=print&utm_campaign=spring-sale",
    );
  });
  it("keeps the existing query exactly as written, and the fragment after the tags", () => {
    expect(addCampaignTags("https://example.com/a?x=1&y=a+b%20c#top", tags)).toBe(
      "https://example.com/a?x=1&y=a+b%20c&utm_source=flyer&utm_medium=print&utm_campaign=spring-sale#top",
    );
    expect(addCampaignTags("https://example.com/a#frag?not=query", { source: "a", medium: "b" })).toBe(
      "https://example.com/a?utm_source=a&utm_medium=b#frag?not=query",
    );
  });
  it("handles a trailing ? or &", () => {
    expect(addCampaignTags("https://e.com/?", { source: "a", medium: "b" })).toBe("https://e.com/?utm_source=a&utm_medium=b");
    expect(addCampaignTags("https://e.com/?x=1&", { source: "a", medium: "b" })).toBe("https://e.com/?x=1&utm_source=a&utm_medium=b");
  });
  it("encodes values, including spaces, ampersands, hashes and unicode", () => {
    const u = addCampaignTags("https://e.com", { source: "a b&c", medium: "#x", campaign: "café", content: "1=2" });
    expect(u).toBe("https://e.com?utm_source=a%20b%26c&utm_medium=%23x&utm_campaign=caf%C3%A9&utm_content=1%3D2");
    expect(new URL(u).searchParams.get("utm_source")).toBe("a b&c");
    expect(new URL(u).hash).toBe("");
  });
  it("lets a utm key already in the address win, in any letter case, and says so", () => {
    const r = applyCampaign("https://e.com/?UTM_Source=old", tags);
    expect(r.kept).toEqual(["utm_source"]);
    expect(r.url).toBe("https://e.com/?UTM_Source=old&utm_medium=print&utm_campaign=spring-sale");
  });
  it("adds nothing when no tag is set, and is stable to apply twice", () => {
    expect(addCampaignTags("https://e.com/?x=1#h", undefined)).toBe("https://e.com/?x=1#h");
    expect(addCampaignTags("https://e.com", { source: "", medium: "" })).toBe("https://e.com");
    const once = addCampaignTags("https://e.com/?x=1#h", tags);
    expect(addCampaignTags(once, tags)).toBe(once);
  });
});

describe("campaign tags in the config", () => {
  const cfg = (content: unknown, type = "link") => parseConfig({ type, content });
  it("needs source and medium together", () => {
    expect(cfg({ url: "https://e.com", campaign: { campaign: "x" } }).ok).toBe(false);
    expect(cfg({ url: "https://e.com", campaign: { source: "a" } }).ok).toBe(false);
    expect(cfg({ url: "https://e.com", campaign: { source: "a", medium: "b" } }).ok).toBe(true);
    expect(cfg({ url: "https://e.com", campaign: {} }).ok).toBe(true);
  });
  it("limits length, refuses control characters and unknown keys", () => {
    expect(cfg({ url: "https://e.com", campaign: { source: "a".repeat(101), medium: "b" } }).ok).toBe(false);
    expect(cfg({ url: "https://e.com", campaign: { source: "a\nb", medium: "b" } }).ok).toBe(false);
    expect(cfg({ url: "https://e.com", campaign: { source: "a", medium: "b", term: "x" } }).ok).toBe(false);
  });
  it("refuses broken characters and an address too long once tagged", () => {
    expect(cfg({ url: "https://e.com", campaign: { source: "\uD800", medium: "b" } }).ok).toBe(false);
    expect(cfg({ url: "https://e.com", campaign: { source: "\u{1F600}", medium: "b" } }).ok).toBe(true);
    const long = "https://e.com/" + "a".repeat(1980);
    expect(cfg({ url: long, campaign: { source: "é".repeat(100), medium: "é".repeat(100), campaign: "é".repeat(100) } }).ok).toBe(false);
    expect(cfg({ url: long }).ok).toBe(true);
  });
  it("is only for link codes", () => {
    expect(cfg({ text: "hi", campaign: { source: "a", medium: "b" } }, "text").ok).toBe(false);
  });
  it("the code carries the tagged address and a scan reads it back, for every preset", async () => {
    for (const p of CAMPAIGN_PRESETS) {
      const r = cfg({ url: "https://example.com/menu?table=4#top", campaign: { source: p.source, medium: p.medium, campaign: "test" } });
      if (!r.ok) throw new Error(r.errors.join());
      const expected = `https://example.com/menu?table=4&utm_source=${p.source}&utm_medium=${p.medium}&utm_campaign=test#top`;
      expect(buildPayload(r.config)).toBe(expected);
      // verify reads the code back at 6, 8 and 10 pixels per module and compares it with the payload.
      const v = await verify(r.config, nodeRasterizer);
      expect(v.ok, p.label).toBe(true);
      if (v.ok) expect(v.decoded).toBe(expected);
    }
  });
});

describe("form mapping for the tag fields", () => {
  it("round trips through import, and an untagged link has no campaign key", () => {
    const v = { url: "https://e.com", utmSource: "flyer", utmMedium: "print", utmCampaign: "", utmContent: "" };
    const content = formToContent("link", v) as Record<string, unknown>;
    expect(content.campaign).toEqual({ source: "flyer", medium: "print" });
    expect(contentToForm("link", content)).toMatchObject(v);
    expect(formToContent("link", { ...v, utmSource: "", utmMedium: "" })).toEqual({ url: "https://e.com" });
  });
  it("the tag fields sit in their own group and only on Link", () => {
    for (const [t, m] of Object.entries(TYPE_META)) {
      const grouped = m.fields.filter((f) => f.group === "campaign").length;
      expect(grouped, t).toBe(t === "link" ? 4 : 0);
    }
  });
});
