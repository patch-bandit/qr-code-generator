import type { Config } from "@/core";

/** Largest settings file the page will read. A real Bandit Codes config is far smaller. */
export const MAX_IMPORT_BYTES = 12_000_000;

export const importTooLarge = (bytes: number) => bytes > MAX_IMPORT_BYTES;

/** The form shows two phone numbers and two emails; a longer list in a file is cut. */
export function vcardImportNotice(c: Config): string {
  if (c.type !== "vcard") return "";
  const many = (c.content.phones?.length ?? 0) > 2 || (c.content.emails?.length ?? 0) > 2;
  return many
    ? "This form shows two phone numbers and two emails. Extra ones in the file were left out, so check the code before you download it."
    : "";
}

/** Downloads are offered only for a drawn code whose scan check has finished. */
export function canDownload(svg: string | null, busy: boolean, state: string): boolean {
  return !!svg && !busy && state !== "checking";
}
