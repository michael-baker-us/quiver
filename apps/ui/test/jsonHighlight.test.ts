import { describe, expect, it } from "vitest";
import { HIGHLIGHT_MAX_CHARS, tokenizeJson, type JsonToken } from "../src/jsonHighlight.js";

function joined(tokens: JsonToken[]): string {
  return tokens.map((t) => t.text).join("");
}

describe("tokenizeJson", () => {
  it("classifies keys, strings, numbers, and literals", () => {
    const text = JSON.stringify(
      { name: "Ada", age: 36, active: true, score: -1.5e3, nothing: null },
      null,
      2,
    );
    const tokens = tokenizeJson(text);
    const byType = (type: JsonToken["type"]) =>
      tokens.filter((t) => t.type === type).map((t) => t.text);

    expect(byType("key")).toEqual(['"name"', '"age"', '"active"', '"score"', '"nothing"']);
    expect(byType("string")).toEqual(['"Ada"']);
    expect(byType("number")).toEqual(["36", "-1500"]);
    expect(byType("literal")).toEqual(["true", "null"]);
  });

  it("round-trips exactly: concatenated tokens reproduce the input", () => {
    const text = JSON.stringify(
      { items: [{ id: 1, note: 'say "hi": true, 42' }, null, false], "weird key": "v" },
      null,
      2,
    );
    expect(joined(tokenizeJson(text))).toBe(text);
  });

  it("treats string contents as strings, not keys/numbers/literals", () => {
    const tokens = tokenizeJson('{"msg": "true 42 null \\"quoted\\""}');
    expect(tokens.filter((t) => t.type === "literal")).toEqual([]);
    expect(tokens.filter((t) => t.type === "number")).toEqual([]);
    expect(tokens.filter((t) => t.type === "string").map((t) => t.text)).toEqual([
      '"true 42 null \\"quoted\\""',
    ]);
  });

  it("degrades gracefully on malformed JSON without throwing", () => {
    const text = '{"incomplete": [1, 2,';
    expect(joined(tokenizeJson(text))).toBe(text);
  });

  it("skips highlighting for oversized bodies", () => {
    const text = `{"big": "${"x".repeat(HIGHLIGHT_MAX_CHARS)}"}`;
    expect(tokenizeJson(text)).toEqual([{ type: "plain", text }]);
  });
});
