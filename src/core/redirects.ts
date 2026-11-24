import { applyCampaign, campaignSchema, type Campaign } from "./tracking";

/**
 * Forwarding rules for a changeable code. The person keeps a short list (short address, page, tags); these functions check it
 * and write it as the file a server or plugin wants. Bandit Codes hosts and forwards nothing.
 * Everything that is pasted into a server file is checked here first, on the raw text, before any URL parser can tidy it.
 */

export const MAX_DESTINATION = 2000;
export const MAX_LINKS = 500;
export const MAX_FILE_BYTES = 1_000_000;
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type Check<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** Controls (ASCII and C1), every kind of space, line and paragraph separators, zero-width and bidi marks, and lone surrogates are refused: a lenient parser may read them as separators. */
const BAD_CHARS = /[\u0000-\u001f\u007f-\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff\\ "'<>]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Host rules on the raw text: ASCII letters, digits, dots and hyphens; a number host must be a plain dotted IP address. */
function checkHost(host: string): string | null {
  if (host === "") return "The address has no host.";
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return "The host may hold only English letters, digits, dots and hyphens. Use the plain (xn--) form for other letters.";
  let h = host;
  const dotted = h.endsWith(".");
  if (dotted) h = h.slice(0, -1);
  const labels = h.split(".");
  if (labels.some((l) => l === "")) return "The host has an empty part.";
  if (labels.some((l) => l.length > 63)) return "A part of the host is over 63 characters.";
  const last = labels[labels.length - 1];
  if (/^(\d+|0x[0-9a-f]*)$/i.test(last) || labels.every((l) => /^\d+$/.test(l))) {
    if (dotted) return "An IP address cannot end in a dot.";
    if (labels.length !== 4) return "A number host must be a full four-part IP address.";
    for (const l of labels) {
      if (!/^\d+$/.test(l) || (l.length > 1 && l.startsWith("0")) || Number(l) > 255) return "A number host must be four plain parts from 0 to 255.";
    }
  }
  return null;
}

/** Splits `scheme://authority rest` from the raw text. Returns null when the shape is not http or https with two slashes. */
function splitAddress(raw: string): { authority: string; rest: string } | null {
  const m = /^https?:\/\/([^/?#]*)([\s\S]*)$/i.exec(raw);
  return m ? { authority: m[1], rest: m[2] } : null;
}

function checkAuthority(authority: string, allowPort: boolean): string | null {
  if (authority.includes("@")) return "The address has a name before the @ sign.";
  if (authority.startsWith("[")) return "An IPv6 address is not accepted.";
  const colon = authority.indexOf(":");
  let host = authority;
  if (colon !== -1) {
    host = authority.slice(0, colon);
    const port = authority.slice(colon + 1);
    if (!allowPort) return "The address cannot hold a port.";
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return "The port must be a number from 1 to 65535.";
  }
  const why = checkHost(host);
  if (why) return why;
  return null;
}

/**
 * Checks a destination page address. With a campaign, the tags are merged first and the 2,000-character limit counts the tagged address.
 * Returns the tagged address (an existing utm_ key wins).
 */
export function checkDestination(input: unknown, campaign?: Campaign): Check<{ url: string; kept: string[] }> {
  if (typeof input !== "string" || input === "") return { ok: false, reason: "Add the page address." };
  if (BAD_CHARS.test(input)) return { ok: false, reason: "The address holds a space, quote, backslash, angle bracket or control character." };
  const parts = splitAddress(input);
  if (!parts) return { ok: false, reason: "The address must start with http:// or https://." };
  const why = checkAuthority(parts.authority, true);
  if (why) return { ok: false, reason: why };
  try {
    const u = new URL(input);
    // The converted host must pass the same rules (a parser can change what the raw text says).
    const converted = checkHost(u.hostname);
    if (converted) return { ok: false, reason: converted };
  } catch {
    return { ok: false, reason: "That is not a usable web address." };
  }
  let tags: Campaign | undefined;
  if (campaign) {
    const parsed = campaignSchema.safeParse(campaign);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "The tags are not valid." };
    tags = parsed.data;
  }
  const merged = applyCampaign(input, tags);
  // encodeURIComponent leaves an apostrophe as is, and the final address may not hold one; the address itself was already checked above.
  if (merged.url.includes("'")) return { ok: false, reason: "A campaign tag cannot contain an apostrophe. Use a plain letter, number, hyphen or underscore instead." };
  if (merged.url.length > MAX_DESTINATION) {
    return { ok: false, reason: `The address with its tags is over ${MAX_DESTINATION} characters. Bandit Codes' generator allows more, so a code that scans can still be refused here.` };
  }
  return { ok: true, url: merged.url, kept: merged.kept };
}

/** Checks the base address printed in the code: scheme, host, then a path ending in a slash. */
export function checkBase(input: unknown): Check<{ origin: string; path: string }> {
  if (typeof input !== "string" || input === "") return { ok: false, reason: "Add the base address." };
  if (BAD_CHARS.test(input)) return { ok: false, reason: "The base address holds a space, quote, backslash, angle bracket or control character." };
  const parts = splitAddress(input);
  if (!parts) return { ok: false, reason: "The base address must start with http:// or https://." };
  const why = checkAuthority(parts.authority, false);
  if (why) return { ok: false, reason: why };
  const rest = parts.rest;
  if (/[?#]/.test(rest)) return { ok: false, reason: "The base address cannot hold a query or a #fragment." };
  if (!rest.startsWith("/")) return { ok: false, reason: "The base address must end in a path such as /qr/." };
  if (!rest.endsWith("/")) return { ok: false, reason: "The base address must end in a slash." };
  if (rest === "/") return { ok: false, reason: "The base needs a folder in its path, such as /qr/, so one rule cannot take over the whole site." };
  if (!/^[A-Za-z0-9._~/-]+$/.test(rest)) return { ok: false, reason: "The base path may hold only letters, digits and . _ ~ - /" };
  if (rest.includes("//")) return { ok: false, reason: "The base path cannot hold two slashes in a row." };
  if (rest.split("/").some((s) => s === "." || s === "..")) return { ok: false, reason: "The base path cannot hold a . or .. part." };
  const origin = input.slice(0, input.length - rest.length);
  return { ok: true, origin, path: rest };
}

export function checkSlug(input: unknown): Check<{ slug: string }> {
  if (typeof input !== "string" || !SLUG_PATTERN.test(input)) {
    return { ok: false, reason: "A short name uses lowercase letters, digits, hyphens and underscores, starts with a letter or digit, and is at most 64 characters." };
  }
  return { ok: true, slug: input };
}

/** A starting slug from a label: lowercase, hyphens, at most 64 characters. May return an empty string. */
export function suggestSlug(label: string): string {
  const s = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return s;
}

export interface LinkRow {
  slug: string;
  label: string;
  destination: string;
  campaign: { source: string; medium: string; campaign: string; content: string };
}
export interface LinksFile {
  format: "bandit-codes-links";
  version: 1;
  base: string;
  links: LinkRow[];
}

const CAMPAIGN_KEYS = ["source", "medium", "campaign", "content"] as const;

/** Reads and checks a links file (text or an object). Unknown keys are ignored; an unknown format or version, or any bad row, refuses the file. */
export function parseLinksFile(input: unknown): { ok: true; file: LinksFile } | { ok: false; errors: string[] } {
  let data: unknown = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > MAX_FILE_BYTES) return { ok: false, errors: ["The file is over 1 MB."] };
    try {
      data = JSON.parse(input);
    } catch {
      return { ok: false, errors: ["This is not a valid JSON file."] };
    }
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, errors: ["This is not a Bandit Codes links file."] };
  const d = data as Record<string, unknown>;
  if (d.format !== "bandit-codes-links") return { ok: false, errors: ["This is not a Bandit Codes links file."] };
  if (d.version !== 1) return { ok: false, errors: ["This links file has a version Bandit Codes does not read."] };
  const errors: string[] = [];
  const base = checkBase(d.base);
  if (!base.ok) errors.push(`Base address: ${base.reason}`);
  if (!Array.isArray(d.links)) return { ok: false, errors: [...errors, "The file has no list of links."] };
  if (d.links.length > MAX_LINKS) return { ok: false, errors: [...errors, `The file has more than ${MAX_LINKS} links.`] };
  const seen = new Set<string>();
  const links: LinkRow[] = [];
  d.links.forEach((raw, i) => {
    const n = `Link ${i + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${n}: not a link.`);
      return;
    }
    const r = raw as Record<string, unknown>;
    const slug = checkSlug(r.slug);
    if (!slug.ok) errors.push(`${n}: ${slug.reason}`);
    else if (seen.has(slug.slug)) errors.push(`${n}: the short name ${slug.slug} is used twice.`);
    else seen.add(slug.slug);
    const label = typeof r.label === "string" ? r.label : "";
    if (typeof r.label !== "string" && r.label !== undefined) errors.push(`${n}: the label must be text.`);
    if (label.length > 200) errors.push(`${n}: the label is over 200 characters.`);
    const c = (typeof r.campaign === "object" && r.campaign !== null ? r.campaign : {}) as Record<string, unknown>;
    const campaign = { source: "", medium: "", campaign: "", content: "" };
    for (const k of CAMPAIGN_KEYS) {
      if (c[k] === undefined) continue;
      if (typeof c[k] !== "string") errors.push(`${n}: the ${k} tag must be text.`);
      else campaign[k] = c[k] as string;
    }
    const dest = checkDestination(r.destination, campaign);
    if (!dest.ok) errors.push(`${n}: ${dest.reason}`);
    if (slug.ok && dest.ok) links.push({ slug: slug.slug, label, destination: r.destination as string, campaign });
  });
  if (errors.length || !base.ok) return { ok: false, errors };
  return { ok: true, file: { format: "bandit-codes-links", version: 1, base: d.base as string, links } };
}

export function writeLinksJson(file: LinksFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/* ------------------------------------------------------------------ writers */

export type RuleFormat = "cloudflare" | "redirection" | "netlify" | "apache" | "nginx" | "json";
export const RULE_FORMATS: { id: RuleFormat; label: string; file: string }[] = [
  { id: "cloudflare", label: "Cloudflare bulk redirect list (CSV)", file: "bandit-codes-cloudflare.csv" },
  { id: "redirection", label: "WordPress Redirection plugin (CSV import)", file: "bandit-codes-redirection.csv" },
  { id: "netlify", label: "Netlify _redirects", file: "_redirects" },
  { id: "apache", label: "Apache (.htaccess or site config)", file: "bandit-codes-apache.conf" },
  { id: "nginx", label: "nginx (site config)", file: "bandit-codes-nginx.conf" },
  { id: "json", label: "Bandit Codes links file (JSON)", file: "bandit-codes-links.json" },
];

interface Rule {
  /** The address printed in the code, without a trailing slash. */
  full: string;
  path: string;
  /** The page address with its tags, with any #fragment cut off. */
  target: string;
  /** True when the fragment was cut. */
  cutFragment: boolean;
}

/** Rules from a checked file. The #fragment is cut, because a browser never sends it to a server. */
export function rulesOf(file: LinksFile): Rule[] {
  const base = checkBase(file.base);
  if (!base.ok) throw new Error(base.reason);
  return file.links.map((l) => {
    const dest = checkDestination(l.destination, l.campaign);
    if (!dest.ok) throw new Error(`${l.slug}: ${dest.reason}`);
    const hash = dest.url.indexOf("#");
    const target = hash === -1 ? dest.url : dest.url.slice(0, hash);
    return { full: `${base.origin}${base.path}${l.slug}`, path: `${base.path}${l.slug}`, target, cutFragment: hash !== -1 };
  });
}

/** Characters that act inside server settings are written as %-codes. A % that already starts a valid %-code is left alone. */
export function serverSafe(s: string): string {
  return s
    .replace(/%(?![0-9A-Fa-f]{2})/g, "%25")
    .replace(/\$/g, "%24")
    .replace(/;/g, "%3B")
    .replace(/\{/g, "%7B")
    .replace(/\}/g, "%7D");
}

/** Netlify reads `*` and a `:` that starts a path part as placeholders; they are written as %-codes. */
export function netlifySafe(s: string): string {
  const i = s.indexOf("://");
  const head = i === -1 ? "" : s.slice(0, i + 3);
  const tail = i === -1 ? s : s.slice(i + 3);
  return head + tail.replace(/\*/g, "%2A").replace(/\/:/g, "/%3A");
}

/** One spreadsheet cell: always quoted, quotes doubled, and a leading formula character is neutralized. */
export function csvCell(v: string): string {
  const t = v.replace(/^ +/, "");
  const guarded = /^[=+\-@\t\r\n]/.test(t) ? `'${t}` : v;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function cfCell(v: string): string {
  const q = csvCell(v);
  return /[",]/.test(v) || q !== `"${v}"` ? q : v;
}

function comment(file: LinksFile, now: Date): string {
  return `# Bandit Codes forwarding rules for ${file.base}, made ${now.toISOString().slice(0, 10)}. 302 (temporary) redirects.`;
}

const escDot = (s: string) => s.replace(/\./g, "\\.");

export function writeRules(file: LinksFile, format: RuleFormat, now: Date = new Date()): string {
  if (format === "json") return writeLinksJson(file);
  const rules = rulesOf(file);
  switch (format) {
    case "cloudflare":
      // Cloudflare's documented bulk list CSV: no header row; source, target, status code; quotes only where a comma needs them.
      return `${rules.map((r) => [r.full.replace(/^https?:\/\//i, ""), r.target, "302"].map(cfCell).join(",")).join("\n")}\n`;
    case "redirection":
      return `${["source", "target", "regex", "code"].map(csvCell).join(",")}\n${rules.map((r) => [r.path, r.target, "0", "302"].map(csvCell).join(",")).join("\n")}\n`;
    case "netlify":
      return `${comment(file, now)}\n${rules.map((r) => `${r.path}  ${netlifySafe(r.target)}  302`).join("\n")}\n`;
    case "apache":
      return `${comment(file, now)}\n${rules.map((r) => `RedirectMatch 302 "^${escDot(r.path)}/?$" "${serverSafe(r.target)}"`).join("\n")}\n`;
    case "nginx":
      return `${comment(file, now)}\n${rules.map((r) => `location ~ ^${escDot(r.path)}/?$ { return 302 "${serverSafe(r.target)}"; }`).join("\n")}\n`;
  }
}

/** Notes shown beside the preview: what was changed on the way into the file. */
export function ruleNotes(file: LinksFile): string[] {
  const notes: string[] = [];
  for (const r of rulesOf(file)) {
    if (r.cutFragment) notes.push(`${r.path}: the #fragment was cut off, because browsers never send it to a server.`);
    if (/[$;{}]|%(?![0-9A-Fa-f]{2})/.test(r.target)) notes.push(`${r.path}: characters that act inside a server file were written as %-codes (a ; can act as a query separator, so the change is real).`);
  }
  return notes;
}
