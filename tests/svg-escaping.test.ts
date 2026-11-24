import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { escapeXml, parseConfig, renderSvg, svgElement, verify } from "../src/core";
import { nodeRasterizer } from "../src/node/raster";
import { solidImage } from "./helpers";

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const VALID_ENTITY = /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;

function decodeXmlEntities(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "<") throw new Error("Unescaped '<' inside XML value");
    if (ch === "&") {
      const m = VALID_ENTITY.exec(raw.slice(i));
      if (!m) throw new Error(`Invalid XML entity near: ${raw.slice(i, i + 16)}`);
      const ent = m[1];
      if (ent === "amp") out += "&";
      else if (ent === "lt") out += "<";
      else if (ent === "gt") out += ">";
      else if (ent === "quot") out += '"';
      else if (ent === "apos") out += "'";
      else if (ent.startsWith("#x")) out += String.fromCodePoint(parseInt(ent.slice(2), 16));
      else out += String.fromCodePoint(parseInt(ent.slice(1), 10));
      i += m[0].length - 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Strict XML 1.0 well-formedness parser for SVG output tests. */
function parseXmlStrict(xml: string): XmlNode {
  let pos = 0;
  const len = xml.length;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;

  const skipWs = () => {
    while (pos < len && /\s/.test(xml[pos])) pos++;
  };

  skipWs();
  while (pos < len) {
    if (xml[pos] === "<") {
      if (xml[pos + 1] === "/") {
        pos += 2;
        const m = /^([A-Za-z_][\w:.-]*)\s*>/.exec(xml.slice(pos));
        if (!m) throw new Error(`Malformed closing tag at ${pos}`);
        const top = stack.pop();
        if (!top || top.tag !== m[1]) throw new Error(`Mismatched closing tag </${m[1]}>`);
        pos += m[0].length;
        if (stack.length === 0) {
          root = top;
          skipWs();
          if (pos !== len) throw new Error(`Trailing content after root element at ${pos}`);
        }
        continue;
      }

      pos += 1;
      const nameMatch = /^([A-Za-z_][\w:.-]*)/.exec(xml.slice(pos));
      if (!nameMatch) throw new Error(`Malformed tag name at ${pos}`);
      const tag = nameMatch[1];
      pos += tag.length;

      const attrs: Record<string, string> = {};
      while (pos < len) {
        const before = pos;
        skipWs();
        if (xml[pos] === ">" || (xml[pos] === "/" && xml[pos + 1] === ">")) break;
        if (pos === before) throw new Error(`Missing whitespace before attribute at ${pos}`);
        const attrMatch = /^([A-Za-z_][\w:.-]*)\s*=\s*/.exec(xml.slice(pos));
        if (!attrMatch) throw new Error(`Malformed attribute at ${pos}: ${xml.slice(pos, pos + 20)}`);
        const attrName = attrMatch[1];
        if (Object.hasOwn(attrs, attrName)) throw new Error(`Duplicate attribute ${attrName}`);
        pos += attrMatch[0].length;
        const quote = xml[pos];
        if (quote !== '"' && quote !== "'") throw new Error(`Unquoted attribute ${attrName} at ${pos}`);
        pos += 1;
        const end = xml.indexOf(quote, pos);
        if (end < 0) throw new Error(`Unterminated attribute ${attrName}`);
        const rawVal = xml.slice(pos, end);
        attrs[attrName] = decodeXmlEntities(rawVal);
        pos = end + 1;
      }

      let selfClosing = false;
      if (xml[pos] === "/" && xml[pos + 1] === ">") {
        selfClosing = true;
        pos += 2;
      } else if (xml[pos] === ">") {
        pos += 1;
      } else {
        throw new Error(`Unterminated start tag <${tag}>`);
      }

      const node: XmlNode = { tag, attrs, children: [], text: "" };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else if (root !== null) {
        throw new Error("Multiple root elements");
      }

      if (selfClosing) {
        if (stack.length === 0) {
          root = node;
          skipWs();
          if (pos !== len) throw new Error(`Trailing content after root element at ${pos}`);
        }
      } else {
        stack.push(node);
      }
    } else {
      const next = xml.indexOf("<", pos);
      const rawText = next < 0 ? xml.slice(pos) : xml.slice(pos, next);
      if (stack.length === 0) {
        if (rawText.trim()) throw new Error("Unexpected text outside root element");
      } else {
        if (rawText.includes(">")) throw new Error("Unescaped '>' in text node");
        stack[stack.length - 1].text += decodeXmlEntities(rawText);
      }
      pos = next < 0 ? len : next;
    }
  }

  if (stack.length > 0 || !root) throw new Error("Unclosed XML elements");
  return root;
}

function walk(node: XmlNode, fn: (n: XmlNode) => void) {
  fn(node);
  for (const child of node.children) walk(child, fn);
}

describe("SVG export XML escaping (security L4)", () => {
  const hostile = `" onload="alert(1)" /><script>alert('xss' & "bad")</script><rect data-x='`;

  it("strict XML parser rejects unescaped hostile markup (self-check)", async () => {
    const broken = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="${hostile}"/></svg>`;
    expect(() => parseXmlStrict(broken)).toThrow();
    await expect(sharp(Buffer.from(broken)).metadata()).rejects.toThrow();
  });

  it("escapeXml escapes &, <, >, \", and '", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe("a &amp; b &lt; c &gt; d &quot; e &#39; f");
  });

  it("svgElement escapes every attribute and text value and parses as strict XML", async () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
      svgElement("title", { id: hostile, "data-note": `1 < 2 & 3 > 0 "ok" 'yes'` }, hostile) +
      `</svg>`;

    const doc = parseXmlStrict(svg);
    const meta = await sharp(Buffer.from(svg)).metadata();
    expect(meta.format).toBe("svg");

    const tags: string[] = [];
    const attrNames: string[] = [];
    walk(doc, (n) => {
      tags.push(n.tag.toLowerCase());
      attrNames.push(...Object.keys(n.attrs).map((k) => k.toLowerCase()));
    });
    expect(tags).toEqual(["svg", "title"]);
    expect(tags).not.toContain("script");
    expect(attrNames).not.toContain("onload");
    expect(doc.children[0].attrs.id).toBe(hostile);
    expect(doc.children[0].attrs["data-note"]).toBe(`1 < 2 & 3 > 0 "ok" 'yes'`);
    expect(doc.children[0].text).toBe(hostile);
  });

  it("renderSvg with hostile QR payload parses as valid XML and scans back cleanly", async () => {
    const parsed = parseConfig({
      type: "text",
      content: { text: `<script>alert("xss")</script> & 'single' > <` },
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const svg = renderSvg(parsed.config);
    const doc = parseXmlStrict(svg);
    expect(doc.tag).toBe("svg");
    expect((await sharp(Buffer.from(svg)).metadata()).format).toBe("svg");
    const res = await verify(parsed.config, nodeRasterizer);
    expect(res).toEqual({ ok: true, decoded: `<script>alert("xss")</script> & 'single' > <` });
  });

  it("renderSvg neutralizes hostile colors and escapes hostile attributes directly passed in", async () => {
    const parsed = parseConfig({
      type: "link",
      content: { url: "https://example.com" },
      image: { mode: "logo", src: solidImage("#1E1033"), scale: 0.2 },
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));

    const hostileConfig = {
      ...parsed.config,
      style: {
        ...parsed.config.style,
        dotColor: hostile,
        cornerColor: `#112233' onclick='alert(2)'><script>x</script>`,
        backgroundColor: `" /><script>alert(3)</script><rect fill="`,
      },
    };

    const svg = renderSvg(hostileConfig, {
      size: `256" onload="alert(1)" data-bad="<>&'` as unknown as number,
    });

    const doc = parseXmlStrict(svg);
    expect(doc.tag).toBe("svg");
    expect(doc.attrs.width).toBe(`256" onload="alert(1)" data-bad="<>&'`);

    const allTags: string[] = [];
    const allAttrNames: string[] = [];
    const allFills: string[] = [];
    walk(doc, (n) => {
      allTags.push(n.tag.toLowerCase());
      for (const [k, v] of Object.entries(n.attrs)) {
        allAttrNames.push(k.toLowerCase());
        if (k === "fill" || k === "stroke") allFills.push(v);
      }
    });
    expect(allTags).not.toContain("script");
    expect(allAttrNames).not.toContain("onload");
    expect(allAttrNames).not.toContain("onclick");
    for (const color of allFills) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }

    // With normal numeric size and hostile colors, librsvg/libxml2 also parses and renders the SVG cleanly.
    const svgCleanSize = renderSvg(hostileConfig);
    expect(parseXmlStrict(svgCleanSize).tag).toBe("svg");
    expect((await sharp(Buffer.from(svgCleanSize)).metadata()).format).toBe("svg");
  });

  it("renderSvg rejects hostile image.src containing markup injection", () => {
    const parsed = parseConfig({
      type: "link",
      content: { url: "https://example.com" },
      image: { mode: "blend", src: solidImage("#E4F7EE"), veil: 0.3 },
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));

    const hostileImg = {
      ...parsed.config,
      image: { ...parsed.config.image, src: `data:image/png;base64,AAAA" onload="alert(1)` },
    };
    expect(() => renderSvg(hostileImg)).toThrow(/data: URI/);
  });
});
