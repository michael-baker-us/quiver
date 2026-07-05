import { describe, expect, it } from "vitest";
import { detectBodyFormat, parseCsv } from "../src/responseBody.js";

describe("detectBodyFormat", () => {
  it("detects json, xml, and csv from the content type", () => {
    expect(detectBodyFormat("application/json", true)).toBe("json");
    expect(detectBodyFormat("application/xml", false)).toBe("xml");
    expect(detectBodyFormat("text/xml; charset=utf-8", false)).toBe("xml");
    expect(detectBodyFormat("text/csv", false)).toBe("csv");
    expect(detectBodyFormat("TEXT/CSV; header=present", false)).toBe("csv");
  });

  it("recognizes structured-syntax suffixes", () => {
    expect(detectBodyFormat("application/hal+json", true)).toBe("json");
    expect(detectBodyFormat("application/atom+xml", false)).toBe("xml");
  });

  it("lets the content type win over JSON sniffing", () => {
    // "123" is valid JSON, so bodyJson gets populated — but it's a CSV response.
    expect(detectBodyFormat("text/csv", true)).toBe("csv");
  });

  it("falls back to sniffed JSON when the content type is missing or unrecognized", () => {
    expect(detectBodyFormat(undefined, true)).toBe("json");
    expect(detectBodyFormat("text/plain", true)).toBe("json");
    expect(detectBodyFormat("text/plain", false)).toBe("text");
  });

  it("renders unparsable json content types as text", () => {
    expect(detectBodyFormat("application/json", false)).toBe("text");
  });
});

describe("parseCsv", () => {
  it("parses rows and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3\n4,5,6")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted fields with commas, newlines, and escaped quotes", () => {
    expect(parseCsv('name,note\n"Doe, Jane","line1\nline2"\n"say ""hi"""')).toEqual([
      ["name", "note"],
      ["Doe, Jane", "line1\nline2"],
      ['say "hi"'],
    ]);
  });

  it("handles CRLF rows and ignores a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves empty fields", () => {
    expect(parseCsv("a,,c\n,,")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("returns null on an unterminated quote so callers can show raw text", () => {
    expect(parseCsv('a,"unterminated\n1,2')).toBeNull();
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});
