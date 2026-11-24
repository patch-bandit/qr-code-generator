import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { classifyScan, decodePhoto, downscale, normalizeDomain, parseConfig, renderSvg, type Pixels } from "../src/core";
import { nodeRasterizer } from "../src/node/raster";

const make = (input: unknown) => {
  const r = parseConfig(input);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.config;
};

const web = (text: string, typed = "") => {
  const r = classifyScan(text, typed);
  if (r.kind !== "web") throw new Error(`expected web, got ${r.kind}`);
  return r;
};

describe("classifyScan: web addresses against a typed domain", () => {
  it("equal host is yours", () => expect(web("https://example.com/a", "example.com").verdict).toBe("yours"));
  it("a subdomain is yours", () => expect(web("https://shop.example.com", "example.com").verdict).toBe("yours"));
  it("www in the typed domain is ignored", () => expect(web("https://example.com", "www.example.com").verdict).toBe("yours"));
  it("a scheme, path and port typed in the box are cleaned", () => expect(web("https://example.com", "HTTPS://Example.com:8080/menu").verdict).toBe("yours"));
  it("a look-alike ending is different", () => expect(web("https://example.com.other.net/x", "example.com").verdict).toBe("different"));
  it("a prefix match is different", () => expect(web("https://notexample.com", "example.com").verdict).toBe("different"));
  it("a port does not change the host", () => expect(web("https://example.com:8443/x", "example.com").verdict).toBe("yours"));
  it("a username part: the host after the @ decides", () => {
    const r = web("https://example.com@evil.com/x", "example.com");
    expect(r.host).toBe("evil.com");
    expect(r.verdict).toBe("different");
    expect(r.userinfo).toBe(true);
  });
  it("an uppercase host is lowercased", () => expect(web("HTTPS://EXAMPLE.COM/x", "example.com").verdict).toBe("yours"));
  it("a trailing dot on the scanned host is dropped", () => expect(web("https://example.com./x", "example.com").verdict).toBe("yours"));
  it("non-English letters show the plain form and the written form", () => {
    const r = web("https://bücher.example/x");
    expect(r.host).toBe("xn--bcher-kva.example");
    expect(r.writtenHost).toBe("bücher.example");
  });
  it("a number host matches only exactly", () => {
    expect(web("http://192.168.1.5/x", "192.168.1.5").verdict).toBe("bad-domain");
    expect(web("http://192.168.1.5/x").isNumberHost).toBe(true);
  });
  it("no typed domain gives no verdict", () => expect(web("https://example.com").verdict).toBe("none"));
  it("a typed domain that is only an ending is refused", () => {
    expect(web("https://example.com", "com").verdict).toBe("bad-domain");
    expect(web("https://example.com", "co.uk").verdict).toBe("bad-domain");
  });
  it("a typed domain with a trailing dot, spaces or all-number part is refused", () => {
    expect(normalizeDomain("example.com.").ok).toBe(false);
    expect(normalizeDomain("exa mple.com").ok).toBe(false);
    expect(normalizeDomain("123.456").ok).toBe(false);
  });
  it("non-English typed domains convert to the plain form", () => {
    expect(normalizeDomain("Bücher.example")).toEqual({ ok: true, domain: "xn--bcher-kva.example" });
  });
  it("an address new URL rejects is reported, not thrown", () => expect(classifyScan("http://", "example.com").kind).toBe("unusable"));
});

describe("classifyScan: other kinds", () => {
  const kinds: [string, string][] = [
    ["mailto:a@example.com", "email"],
    ["tel:+15550100", "phone"],
    ["WIFI:T:WPA;S:Cafe;P:x;;", "wifi"],
    ["BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD", "contact"],
    ["smsto:+15550100:hi", "sms"],
    ["geo:44.05,-123.08", "geo"],
    ["BEGIN:VEVENT\r\nEND:VEVENT", "event"],
    ["just some words", "text"],
    ["javascript:alert(1)", "text"],
  ];
  for (const [text, kind] of kinds) it(`${text.slice(0, 20)} is ${kind}`, () => expect(classifyScan(text).kind).toBe(kind));
  it("empty text and null are empty", () => {
    expect(classifyScan("").kind).toBe("empty");
    expect(classifyScan(null).kind).toBe("empty");
  });
});

/** Draws the code, then returns a changed copy as pixels. */
async function photo(text: string, ecc: "L" | "M" | "Q" | "H", change: (ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, img: Awaited<ReturnType<typeof loadImage>>, size: number) => void, size = 700): Promise<Pixels> {
  const cfg = make({ type: "text", content: { text }, style: { errorCorrection: ecc } });
  const svg = renderSvg(cfg, { size: 600 });
  const img = await loadImage(Buffer.from(svg));
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#cccccc";
  ctx.fillRect(0, 0, size, size);
  change(ctx, img, size);
  const d = ctx.getImageData(0, 0, size, size);
  return { data: new Uint8ClampedArray(d.data), width: size, height: size };
}

describe("decodePhoto reads changed images back to their input", () => {
  const text = "https://example.com/spring?x=1";
  for (const ecc of ["L", "M", "Q", "H"] as const) {
    it(`error correction ${ecc}, as drawn`, async () => {
      expect(await decodePhoto(await photo(text, ecc, (c, i, s) => c.drawImage(i, 50, 50, s - 100, s - 100)))).toBe(text);
    });
  }
  it("scaled small", async () => {
    expect(await decodePhoto(await photo(text, "M", (c, i, s) => c.drawImage(i, 20, 20, s - 40, s - 40), 260))).toBe(text);
  });
  for (const deg of [90, 180, 7]) {
    it(`turned ${deg} degrees`, async () => {
      const px = await photo(text, "M", (c, i, s) => {
        c.translate(s / 2, s / 2);
        c.rotate((deg * Math.PI) / 180);
        c.drawImage(i, -s / 2 + 70, -s / 2 + 70, s - 140, s - 140);
      });
      expect(await decodePhoto(px)).toBe(text);
    });
  }
  it("blurred", async () => {
    const px = await photo(text, "Q", (c, i, s) => {
      c.filter = "blur(2px)";
      c.drawImage(i, 50, 50, s - 100, s - 100);
    });
    expect(await decodePhoto(px)).toBe(text);
  });
  it("with noise", async () => {
    const px = await photo(text, "Q", (c, i, s) => c.drawImage(i, 50, 50, s - 100, s - 100));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < px.data.length; k += 4) {
      const n = (rnd() - 0.5) * 20;
      px.data[k] += n; px.data[k + 1] += n; px.data[k + 2] += n;
    }
    expect(await decodePhoto(px)).toBe(text);
  });
  it("light on dark (colors swapped)", async () => {
    const px = await photo(text, "M", (c, i, s) => c.drawImage(i, 50, 50, s - 100, s - 100));
    for (let k = 0; k < px.data.length; k += 4) {
      px.data[k] = 255 - px.data[k]; px.data[k + 1] = 255 - px.data[k + 1]; px.data[k + 2] = 255 - px.data[k + 2];
    }
    expect(await decodePhoto(px)).toBe(text);
  });
  it("a blank image returns no code", async () => {
    expect(await decodePhoto(await photo(text, "M", () => undefined))).toBeNull();
  });
});

describe("downscale", () => {
  it("keeps an image that already fits", () => {
    const px = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    expect(downscale(px, 10)).toBe(px);
  });
  it("shrinks the long side to the limit", () => {
    const px = { data: new Uint8ClampedArray(100 * 50 * 4).fill(200), width: 100, height: 50 };
    const s = downscale(px, 40);
    expect([s.width, s.height]).toEqual([40, 20]);
    expect(s.data[0]).toBe(200);
  });
});

describe("review fix: backslash in the host part", () => {
  it("never says yours when a backslash hides another host", () => {
    for (const t of ["https://example.com\\@evil.com/", "https://example.com:80\\@evil.com"]) {
      const r = classifyScan(t, "example.com");
      expect(r.kind === "web" && r.verdict).toBe("different");
      expect(r.kind === "web" && r.ambiguous).toBe(true);
    }
  });
  it("a plain address is not ambiguous", () => {
    const r = classifyScan("https://example.com/a\\b", "example.com");
    expect(r.kind === "web" && r.verdict).toBe("yours");
    expect(r.kind === "web" && r.ambiguous).toBe(false);
  });
});
