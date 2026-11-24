import { describe, expect, it } from "vitest";
import fixture from "./shared-fixture.json";
import {
  checkBase,
  checkDestination,
  checkSlug,
  csvCell,
  parseLinksFile,
  rulesOf,
  writeRules,
  type LinksFile,
  type RuleFormat,
} from "../src/core";
import { applyCampaign } from "../src/core";

type Case = { kind: string; input: string; ok: boolean; note: string; campaign?: Record<string, string>; expect?: string };
const cases = fixture.cases as Case[];

describe("shared fixture", () => {
  for (const c of cases) {
    const label = `${c.kind} ${c.ok ? "accepts" : "refuses"}: ${c.note}`;
    it(label, () => {
      if (c.kind === "destination") expect(checkDestination(c.input, c.campaign as never).ok).toBe(c.ok);
      else if (c.kind === "base") expect(checkBase(c.input).ok).toBe(c.ok);
      else if (c.kind === "slug") expect(checkSlug(c.input).ok).toBe(c.ok);
      else if (c.kind === "merge") expect(applyCampaign(c.input, c.campaign as never).url).toBe(c.expect);
      else throw new Error(`unknown fixture kind ${c.kind}`);
    });
  }
});

const file = (over: Partial<LinksFile> = {}): LinksFile => ({
  format: "bandit-codes-links",
  version: 1,
  base: "https://example.com/qr/",
  links: [
    { slug: "menu", label: "Menu", destination: "https://shop.example.com/menu?a=1#top", campaign: { source: "flyer", medium: "print", campaign: "", content: "" } },
    { slug: "sale", label: "Sale", destination: "https://shop.example.com/a.b/c", campaign: { source: "", medium: "", campaign: "", content: "" } },
  ],
  ...over,
});
const NOW = new Date("2026-11-19T00:00:00Z");

describe("writers", () => {
  const expected: Record<RuleFormat, string> = {
    cloudflare: `example.com/qr/menu,https://shop.example.com/menu?a=1&utm_source=flyer&utm_medium=print,302
example.com/qr/sale,https://shop.example.com/a.b/c,302
`,
    redirection: `"source","target","regex","code"\n"/qr/menu","https://shop.example.com/menu?a=1&utm_source=flyer&utm_medium=print","0","302"\n"/qr/sale","https://shop.example.com/a.b/c","0","302"\n`,
    netlify: `# Bandit Codes forwarding rules for https://example.com/qr/, made 2026-11-19. 302 (temporary) redirects.\n/qr/menu  https://shop.example.com/menu?a=1&utm_source=flyer&utm_medium=print  302\n/qr/sale  https://shop.example.com/a.b/c  302\n`,
    apache: `# Bandit Codes forwarding rules for https://example.com/qr/, made 2026-11-19. 302 (temporary) redirects.\nRedirectMatch 302 "^/qr/menu/?$" "https://shop.example.com/menu?a=1&utm_source=flyer&utm_medium=print"\nRedirectMatch 302 "^/qr/sale/?$" "https://shop.example.com/a.b/c"\n`,
    nginx: `# Bandit Codes forwarding rules for https://example.com/qr/, made 2026-11-19. 302 (temporary) redirects.\nlocation ~ ^/qr/menu/?$ { return 302 "https://shop.example.com/menu?a=1&utm_source=flyer&utm_medium=print"; }\nlocation ~ ^/qr/sale/?$ { return 302 "https://shop.example.com/a.b/c"; }\n`,
    json: "",
  };
  for (const f of Object.keys(expected) as RuleFormat[]) {
    if (f === "json") continue;
    it(`${f} output matches the expected file`, () => expect(writeRules(file(), f, NOW)).toBe(expected[f]));
  }
  it("fragment is cut", () => {
    expect(rulesOf(file())[0].cutFragment).toBe(true);
    expect(writeRules(file(), "apache", NOW).split(String.fromCharCode(10)).filter((l) => !l.startsWith("#")).join("")).not.toContain("#");
  });
  it("a dot in the base path is written escaped in apache and nginx", () => {
    const f = file({ base: "https://example.com/my.dir/" });
    expect(writeRules(f, "apache", NOW)).toContain('"^/my\\.dir/menu/?$"');
    expect(writeRules(f, "nginx", NOW)).toContain("^/my\\.dir/menu/?$");
  });
  it("json round trip", () => {
    const text = writeRules(file(), "json");
    const back = parseLinksFile(text);
    expect(back.ok && back.file).toEqual(file());
  });
  it("server-active characters never make a second directive", () => {
    const f = file({ links: [{ slug: "x", label: "", destination: "https://e.com/a$b;c{d}e%zz?q=1;DROP", campaign: { source: "", medium: "", campaign: "", content: "" } }] });
    for (const fmt of ["apache", "nginx"] as RuleFormat[]) {
      const out = writeRules(f, fmt, NOW).split("\n").filter((l) => l && !l.startsWith("#"));
      expect(out).toHaveLength(1);
      const target = /"([^"]*)"[^"]*$/.exec(out[0].replace(/\s*;?\s*\}\s*$/, ""))![1];
      expect(target).not.toMatch(/[$;{}]/);
      expect(out[0]).toContain("%24");
      expect(out[0]).toContain("%3B");
      expect(out[0]).toContain("%25zz");
    }
  });
  it("netlify placeholders are escaped", () => {
    const f = file({ links: [{ slug: "x", label: "", destination: "https://e.com/*/:id", campaign: { source: "", medium: "", campaign: "", content: "" } }] });
    const out = writeRules(f, "netlify", NOW);
    expect(out).toContain("%2A");
    expect(out).toContain("/%3Aid");
  });
  it("labels never reach server files", () => {
    const f = file();
    f.links[0].label = "SECRET-LABEL";
    for (const fmt of ["cloudflare", "redirection", "netlify", "apache", "nginx"] as RuleFormat[]) expect(writeRules(f, fmt, NOW)).not.toContain("SECRET");
  });
});

describe("csv safety", () => {
  it("quotes, doubles quotes, neutralizes formulas", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    for (const s of ["=1+1", "+1", "-1", "@x", "\tx", "  =x"]) expect(csvCell(s).startsWith(`"'`)).toBe(true);
  });
});

describe("links file", () => {
  const base = { format: "bandit-codes-links", version: 1, base: "https://example.com/qr/", links: [] };
  it("accepts empty list and unknown keys", () => expect(parseLinksFile({ ...base, extra: 1 }).ok).toBe(true));
  it("refuses unknown format and version", () => {
    expect(parseLinksFile({ ...base, format: "x" }).ok).toBe(false);
    expect(parseLinksFile({ ...base, version: 2 }).ok).toBe(false);
  });
  it("refuses bad json, non-objects, over 500 links, over 1 MB", () => {
    expect(parseLinksFile("{").ok).toBe(false);
    expect(parseLinksFile("[]").ok).toBe(false);
    const row = { slug: "a", destination: "https://e.com/" };
    expect(parseLinksFile({ ...base, links: Array.from({ length: 501 }, (_, i) => ({ ...row, slug: `a${i}` })) }).ok).toBe(false);
    expect(parseLinksFile(" ".repeat(1_000_001)).ok).toBe(false);
  });
  it("refuses duplicate slugs and bad rows, with the row number", () => {
    const r = parseLinksFile({ ...base, links: [{ slug: "a", destination: "https://e.com/" }, { slug: "a", destination: "javascript:1" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/Link 2/);
  });
});

describe("review fixes: hidden separators", () => {
  const c = String.fromCharCode;
  for (const [name, ch] of [["no-break space", 0xa0], ["next line", 0x85], ["line separator", 0x2028], ["ideographic space", 0x3000], ["right-to-left override", 0x202e], ["zero-width space", 0x200b], ["byte order mark", 0xfeff]] as const) {
    it(`refuses a ${name} in a destination`, () => {
      expect(checkDestination(`https://a.com/x${c(ch)}301!/*`).ok).toBe(false);
    });
  }
  it("refuses a lone surrogate but keeps a real emoji", () => {
    expect(checkDestination("https://a.com/" + c(0xd800)).ok).toBe(false);
    expect(checkDestination("https://a.com/" + c(0xdc00)).ok).toBe(false);
    expect(checkDestination("https://a.com/\u{1F600}").ok).toBe(true);
  });
});

describe("cloudflare list format", () => {
  // Source: https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/reference/csv-file-format (read 2026-11-19): no header row, source then target then status code, a URL with a comma in quotes.
  it("has no header row, a scheme-less source, and quotes only a cell with a comma", () => {
    const f = file({ links: [{ slug: "a", label: "A", destination: "https://shop.example.com/x,y", campaign: { source: "", medium: "", campaign: "", content: "" } }] });
    const out = writeRules(f, "cloudflare", NOW);
    expect(out).not.toMatch(/source_url|status_code/);
    expect(out).toBe('example.com/qr/a,"https://shop.example.com/x,y",302'+"\n");
  });
});
