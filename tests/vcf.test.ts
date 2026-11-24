import { describe, expect, it } from "vitest";
import { buildPayload, parseConfig } from "../src/core";
import { vcardFile } from "../app/lib/vcf";

const make = (type: string, content: object) => {
  const p = parseConfig({ type, content });
  if (!p.ok) throw new Error(p.errors.join());
  return p.config;
};

describe("contact file", () => {
  it("holds the same text as the code, byte for byte", () => {
    const c = make("vcard", { firstName: "Ana", lastName: "Díaz, Jr.", organization: "A;B", phones: ["+15415550100"], emails: ["ana@example.com"] });
    const f = vcardFile(c)!;
    expect(f.text).toBe(buildPayload(c));
    expect(Buffer.from(f.text)).toEqual(Buffer.from(buildPayload(c)));
    expect(f.text.startsWith("BEGIN:VCARD")).toBe(true);
    expect(f.mime.startsWith("text/vcard")).toBe(true);
    expect(f.name.endsWith(".vcf")).toBe(true);
  });
  it("is offered only for a contact code", () => {
    expect(vcardFile(make("text", { text: "hi" }))).toBeNull();
  });
});
