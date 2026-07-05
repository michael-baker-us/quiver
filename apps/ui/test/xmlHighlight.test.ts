import { describe, expect, it } from "vitest";
import { HIGHLIGHT_MAX_CHARS } from "../src/jsonHighlight.js";
import { tokenizeXml, type XmlToken } from "../src/xmlHighlight.js";

function joined(tokens: XmlToken[]): string {
  return tokens.map((t) => t.text).join("");
}

function byType(tokens: XmlToken[], type: XmlToken["type"]): string[] {
  return tokens.filter((t) => t.type === type).map((t) => t.text);
}

describe("tokenizeXml", () => {
  it("classifies tags, attributes, and attribute values", () => {
    const text = '<book id="42" lang=\'en\'>\n  <title>Dune</title>\n</book>';
    const tokens = tokenizeXml(text);

    expect(byType(tokens, "tag")).toEqual([
      "<book", ">", "<title", ">", "</title", ">", "</book", ">",
    ]);
    expect(byType(tokens, "attr")).toEqual(["id", "lang"]);
    expect(byType(tokens, "string")).toEqual(['"42"', "'en'"]);
    expect(byType(tokens, "plain")).toContain("Dune");
  });

  it("handles the XML declaration, comments, CDATA, and self-closing tags", () => {
    const text =
      '<?xml version="1.0"?><!-- note --><root><br/><![CDATA[<raw> & stuff]]></root>';
    const tokens = tokenizeXml(text);

    expect(byType(tokens, "comment")).toEqual(["<!-- note -->"]);
    expect(byType(tokens, "string")).toContain("<![CDATA[<raw> & stuff]]>");
    expect(byType(tokens, "tag")).toContain("<?xml");
    expect(byType(tokens, "tag")).toContain("/>");
    expect(joined(tokens)).toBe(text);
  });

  it("does not highlight tag-like text content", () => {
    const tokens = tokenizeXml("<msg>a &lt;b&gt; c</msg>");
    expect(byType(tokens, "plain")).toContain("a &lt;b&gt; c");
  });

  it("round-trips exactly: concatenated tokens reproduce the input", () => {
    const text = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<!DOCTYPE catalog>",
      "<catalog xmlns:x=\"urn:x\" empty=''>",
      '  <x:item selected value="a > b &amp; c" />',
      "  <!-- multi\n  line -->",
      "  text with spaces  ",
      "</catalog>",
    ].join("\n");
    expect(joined(tokenizeXml(text))).toBe(text);
  });

  it("degrades gracefully on truncated markup without throwing", () => {
    for (const text of ["<root><unclosed attr=\"va", "<!-- never closed", "<![CDATA[ open", "just < text"]) {
      expect(joined(tokenizeXml(text))).toBe(text);
    }
  });

  it("skips highlighting for oversized bodies", () => {
    const text = `<big>${"x".repeat(HIGHLIGHT_MAX_CHARS)}</big>`;
    expect(tokenizeXml(text)).toEqual([{ type: "plain", text }]);
  });
});
