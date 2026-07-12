import { describe, expect, it } from "vitest";
import { formatJson, formatXml } from "../src/bodyFormat.js";

describe("formatJson", () => {
  it("reindents compact JSON with 2 spaces", () => {
    expect(formatJson('{"a":1,"b":[2,3]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
    );
  });

  it("returns null for invalid or empty input", () => {
    expect(formatJson("{ nope")).toBeNull();
    expect(formatJson("   ")).toBeNull();
    expect(formatJson("")).toBeNull();
  });
});

describe("formatXml", () => {
  it("indents nested elements", () => {
    expect(formatXml("<a><b>1</b><c>2</c></a>")).toBe(
      ["<a>", "  <b>1</b>", "  <c>2</c>", "</a>"].join("\n"),
    );
  });

  it("keeps a text-only element on one line", () => {
    expect(formatXml("<name>Ada</name>")).toBe("<name>Ada</name>");
  });

  it("handles self-closing tags and declarations", () => {
    expect(formatXml('<?xml version="1.0"?><root><item id="1"/></root>')).toBe(
      ['<?xml version="1.0"?>', "<root>", '  <item id="1"/>', "</root>"].join("\n"),
    );
  });

  it("collapses insignificant whitespace between tags", () => {
    expect(formatXml("<a>\n  <b>x</b>\n</a>")).toBe(
      ["<a>", "  <b>x</b>", "</a>"].join("\n"),
    );
  });
});
