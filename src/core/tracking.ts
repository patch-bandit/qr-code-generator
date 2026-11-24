import { z } from "zod";

/** Campaign tags (utm_*) that Bandit Codes adds to a link before the code is made. Bandit Codes counts nothing itself. */

const tag = z
  .string()
  .max(100, "Keep each tag under 100 characters")
  .refine((v) => v.length <= 100, "Keep each tag under 100 characters")
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Tags cannot contain control characters")
  .refine((v) => !/[\uD800-\uDFFF]/.test(v.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")), "Tags cannot contain broken characters");

export const campaignSchema = z
  .object({
    source: tag.optional(),
    medium: tag.optional(),
    campaign: tag.optional(),
    content: tag.optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const set = Object.values(c).some((v) => v !== undefined && v.trim() !== "");
    if (!set) return;
    if (!c.source?.trim()) ctx.addIssue({ code: "custom", path: ["source"], message: "Add a source (where the code lives, such as flyer), or clear the other tag fields" });
    if (!c.medium?.trim()) ctx.addIssue({ code: "custom", path: ["medium"], message: "Add a medium (the kind of thing, such as print), or clear the other tag fields" });
  });

export type Campaign = z.infer<typeof campaignSchema>;

const KEYS: [keyof Campaign, string][] = [
  ["source", "utm_source"],
  ["medium", "utm_medium"],
  ["campaign", "utm_campaign"],
  ["content", "utm_content"],
];

function queryKeys(query: string): Set<string> {
  const keys = new Set<string>();
  for (const part of query.split("&")) {
    if (!part) continue;
    const raw = part.split("=")[0];
    let k = raw;
    try {
      k = decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      /* keep the raw key */
    }
    keys.add(k.toLowerCase());
  }
  return keys;
}

/**
 * Adds the tags to a web address. The existing query string and #fragment stay exactly as written.
 * A utm_ key that is already in the address wins, and is listed in `kept`.
 */
export function applyCampaign(url: string, campaign: Campaign | undefined): { url: string; kept: string[] } {
  const tags = KEYS.map(([k, name]) => [name, (campaign?.[k] ?? "").trim()] as const).filter(([, v]) => v !== "");
  if (!tags.length) return { url, kept: [] };
  const hash = url.indexOf("#");
  const base = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? "" : url.slice(hash);
  const q = base.indexOf("?");
  const path = q === -1 ? base : base.slice(0, q);
  let query = q === -1 ? "" : base.slice(q + 1);
  const present = queryKeys(query);
  const kept: string[] = [];
  const add: string[] = [];
  for (const [name, value] of tags) {
    if (present.has(name)) kept.push(name);
    else add.push(`${name}=${encodeURIComponent(value)}`);
  }
  if (add.length) {
    if (query !== "" && !query.endsWith("&")) query += "&";
    query += add.join("&");
  }
  return { url: `${path}${query ? `?${query}` : ""}${fragment}`, kept };
}

export function addCampaignTags(url: string, campaign: Campaign | undefined): string {
  return applyCampaign(url, campaign).url;
}
