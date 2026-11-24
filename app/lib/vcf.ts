import { buildPayload, type Config } from "@/core";

/** The contact file for a contact code: the same vCard text that is inside the code, byte for byte. Null for any other type. */
export function vcardFile(config: Config): { text: string; name: string; mime: string } | null {
  if (config.type !== "vcard") return null;
  return { text: buildPayload(config), name: "bandit-codes-contact.vcf", mime: "text/vcard;charset=utf-8" };
}
