import { decodePixels, type Pixels } from "./decode";

/**
 * Check your code: reads a photo of a printed code and says, in facts, what is inside and whose domain a web address is on.
 * Pure functions only. Nothing here touches a network, storage or the page.
 */

/** Two-part endings where many unrelated sites share one name. Incomplete on purpose: the full host is always shown too. */
const SHARED_ENDINGS = new Set([
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "com.br", "co.in", "co.za", "com.mx",
  "github.io", "netlify.app", "vercel.app", "herokuapp.com", "blogspot.com", "wordpress.com", "pages.dev", "web.app", "firebaseapp.com",
]);

export type DomainResult = { ok: true; domain: string } | { ok: false; reason: string };

/** Cleans what a person typed into the domain box: scheme, www, port, path and case are removed, non-English letters made plain. */
export function normalizeDomain(typed: string): DomainResult {
  let s = typed.trim();
  if (s === "") return { ok: false, reason: "empty" };
  if (/\s/.test(s)) return { ok: false, reason: "Remove the spaces from the domain." };
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  s = s.split(/[/?#]/)[0];
  const at = s.lastIndexOf("@");
  if (at !== -1) s = s.slice(at + 1);
  s = s.replace(/:\d*$/, "");
  s = s.replace(/^www\./i, "");
  if (s.endsWith(".")) return { ok: false, reason: "Remove the dot at the end of the domain." };
  if (s === "") return { ok: false, reason: "Type a domain such as example.com." };
  let host: string;
  try {
    host = new URL(`http://${s}`).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: "That does not look like a domain. Try one like example.com." };
  }
  if (host.endsWith(".")) return { ok: false, reason: "Remove the dot at the end of the domain." };
  const parts = host.split(".");
  if (parts.length < 2 || parts.some((p) => p === "")) return { ok: false, reason: "Type the whole domain, such as example.com." };
  if (parts.some((p) => /^\d+$/.test(p))) return { ok: false, reason: "A domain cannot have a part that is only numbers." };
  if (SHARED_ENDINGS.has(host)) {
    return { ok: false, reason: "That is an ending many sites share. Type your own name in front of it." };
  }
  if (host.length > 253) return { ok: false, reason: "That domain is too long." };
  return { ok: true, domain: host };
}

export type ScanKind = "text" | "wifi" | "contact" | "email" | "phone" | "sms" | "geo" | "event";

export type ScanResult =
  | { kind: "empty" }
  | { kind: "unusable"; text: string }
  | { kind: Exclude<ScanKind, never>; text: string; web: false }
  | {
      kind: "web";
      web: true;
      text: string;
      /** The host as a browser reads it (plain letters, lowercase). */
      host: string;
      /** The host as written in the code, when it differs from `host` (non-English letters). */
      writtenHost: string | null;
      userinfo: boolean;
      /** A backslash sits in the host part, which different readers split differently. */
      ambiguous: boolean;
      isNumberHost: boolean;
      /** What the typed domain says: not typed, on it, off it, or not usable. */
      verdict: "none" | "yours" | "different" | "bad-domain";
      domainNote: string | null;
    };

const KIND_PREFIXES: [RegExp, Exclude<ScanKind, "text">][] = [
  [/^WIFI:/i, "wifi"],
  [/^BEGIN:VCARD/i, "contact"],
  [/^mailto:/i, "email"],
  [/^MATMSG:/i, "email"],
  [/^tel:/i, "phone"],
  [/^smsto:/i, "sms"],
  [/^sms:/i, "sms"],
  [/^geo:/i, "geo"],
  [/^BEGIN:VEVENT/i, "event"],
  [/^BEGIN:VCALENDAR/i, "event"],
];

/** The host text exactly as written between `//` and the next `/ ? #`, without a username part or a port. */
function writtenHostOf(text: string): string {
  const rest = text.replace(/^https?:\/\//i, "");
  let auth = rest.split(/[/?#]/)[0];
  const at = auth.lastIndexOf("@");
  if (at !== -1) auth = auth.slice(at + 1);
  return auth.replace(/:\d*$/, "");
}

/** Decides what a decoded code holds and, for a web address, how its host relates to the typed domain. Compares parsed hosts, never text prefixes. */
export function classifyScan(text: string | null, typedDomain = ""): ScanResult {
  if (text === null || text === "") return { kind: "empty" };
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { kind: "unusable", text };
    }
    let host = url.hostname.toLowerCase();
    if (host.endsWith(".")) host = host.slice(0, -1);
    if (host === "") return { kind: "unusable", text };
    const written = writtenHostOf(text).toLowerCase().replace(/\.$/, "");
    const isNumberHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
    let verdict: "none" | "yours" | "different" | "bad-domain" = "none";
    let domainNote: string | null = null;
    const d = normalizeDomain(typedDomain);
    if (d.ok) {
      verdict = isNumberHost ? (host === d.domain ? "yours" : "different") : host === d.domain || host.endsWith(`.${d.domain}`) ? "yours" : "different";
    } else if (d.reason !== "empty") {
      verdict = "bad-domain";
      domainNote = d.reason;
    }
    const ambiguous = /^https?:\/\/[^/?#]*\\/i.test(text);
    if (ambiguous && verdict === "yours") verdict = "different";
    return {
      kind: "web",
      web: true,
      text,
      host,
      writtenHost: written !== host ? written : null,
      userinfo: url.username !== "" || url.password !== "",
      ambiguous,
      isNumberHost,
      verdict,
      domainNote,
    };
  }
  for (const [re, kind] of KIND_PREFIXES) if (re.test(text)) return { kind, text, web: false };
  return { kind: "text", text, web: false };
}

/** Shrinks pixels so the long side is at most `max`, averaging the source pixels under each new one. Returns the input when it already fits. */
export function downscale(px: Pixels, max: number): Pixels {
  const long = Math.max(px.width, px.height);
  if (long <= max) return px;
  const f = max / long;
  const w = Math.max(1, Math.round(px.width * f));
  const h = Math.max(1, Math.round(px.height * f));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * px.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * px.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * px.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * px.width) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * px.width + xx) * 4;
          r += px.data[o]; g += px.data[o + 1]; b += px.data[o + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

function invert(px: Pixels): Pixels {
  const data = new Uint8ClampedArray(px.data.length);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - px.data[i]; data[i + 1] = 255 - px.data[i + 1]; data[i + 2] = 255 - px.data[i + 2]; data[i + 3] = 255;
  }
  return { data, width: px.width, height: px.height };
}

export const PHOTO_SIDES = [2400, 1600, 800] as const;

/**
 * Tries to read a code from a photo: the picture is shrunk to 2,400, then 1,600, then 800 pixels on the long side,
 * each tried as it is and then with light and dark swapped, one pass at a time with a pause between passes.
 * Returns the text or null ("could not read" is a normal answer).
 */
export async function decodePhoto(px: Pixels, pause: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0))): Promise<string | null> {
  let first = true;
  let lastW = -1;
  let lastH = -1;
  for (const side of PHOTO_SIDES) {
    const scaled = downscale(px, side);
    if (scaled.width === lastW && scaled.height === lastH) continue;
    lastW = scaled.width;
    lastH = scaled.height;
    for (const variant of [scaled, null] as const) {
      if (!first) await pause();
      first = false;
      const text = decodePixels(variant ?? invert(scaled));
      if (text !== null) return text;
    }
  }
  return null;
}
