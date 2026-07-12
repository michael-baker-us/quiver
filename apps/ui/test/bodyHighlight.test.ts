import { describe, expect, it } from "vitest";
import { highlightSyntax } from "../src/bodyHighlight.js";

describe("highlightSyntax", () => {
  it("colors JSON keys, strings, numbers, and literals", () => {
    const spans = highlightSyntax('{"a": 1, "b": true, "c": "x"}', "json");
    const classed = spans.filter((s) => s.className !== null);
    expect(classed).toContainEqual({ className: "json-key", text: '"a"' });
    expect(classed).toContainEqual({ className: "json-number", text: "1" });
    expect(classed).toContainEqual({ className: "json-literal", text: "true" });
    expect(classed).toContainEqual({ className: "json-string", text: '"x"' });
  });

  it("colors XML tags and attributes", () => {
    const spans = highlightSyntax('<item id="1">x</item>', "xml");
    const classed = spans.filter((s) => s.className !== null);
    expect(classed).toContainEqual({ className: "xml-attr", text: "id" });
    expect(classed).toContainEqual({ className: "xml-string", text: '"1"' });
    expect(classed.some((s) => s.className === "xml-tag")).toBe(true);
  });

  it("reproduces the input exactly when spans are concatenated", () => {
    for (const [text, syntax] of [
      ['{"a": 1, "b": [true, null]}', "json"],
      ["<a><b>hi</b></a>", "xml"],
    ] as const) {
      expect(highlightSyntax(text, syntax).map((s) => s.text).join("")).toBe(text);
    }
  });
});
