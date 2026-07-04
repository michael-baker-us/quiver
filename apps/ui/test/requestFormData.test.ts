import { describe, expect, it } from "vitest";
import type { RequestDefinition } from "@quiver/core";
import {
  emptyFormData,
  formatLooseJson,
  fromFormData,
  parseLooseJson,
  parseRequestContent,
  stringifyFormData,
  toFormData,
} from "../src/requestFormData.js";

describe("parseLooseJson / formatLooseJson", () => {
  it("interprets JSON literals", () => {
    expect(parseLooseJson("42")).toBe(42);
    expect(parseLooseJson("true")).toBe(true);
    expect(parseLooseJson('"quoted"')).toBe("quoted");
    expect(parseLooseJson("[1,2]")).toEqual([1, 2]);
  });

  it("falls back to raw text for non-JSON input", () => {
    expect(parseLooseJson("active")).toBe("active");
    expect(parseLooseJson("")).toBe("");
  });

  it("round-trips through format then parse", () => {
    for (const value of [42, true, "hello", [1, 2], { a: 1 }]) {
      expect(parseLooseJson(formatLooseJson(value))).toEqual(value);
    }
  });
});

describe("toFormData / fromFormData round trip", () => {
  function roundTrip(def: RequestDefinition): Record<string, unknown> {
    return fromFormData(toFormData(def));
  }

  it("preserves a minimal GET request", () => {
    const def: RequestDefinition = {
      method: "GET",
      url: "{{baseUrl}}/things",
      headers: {},
      query: {},
      tests: [],
      capture: {},
    };
    expect(roundTrip(def)).toEqual({ method: "GET", url: "{{baseUrl}}/things" });
  });

  it("preserves name, headers, query, and timeout", () => {
    const def: RequestDefinition = {
      name: "List things",
      method: "GET",
      url: "{{baseUrl}}/things",
      headers: { "X-Trace": "abc" },
      query: { limit: "10" },
      timeoutMs: 5000,
      tests: [],
      capture: {},
    };
    expect(roundTrip(def)).toEqual({
      name: "List things",
      method: "GET",
      url: "{{baseUrl}}/things",
      headers: { "X-Trace": "abc" },
      query: { limit: "10" },
      timeoutMs: 5000,
    });
  });

  it("preserves each auth type", () => {
    const bearer: RequestDefinition = {
      method: "GET",
      url: "x",
      headers: {},
      query: {},
      auth: { type: "bearer", token: "{{token}}" },
      tests: [],
      capture: {},
    };
    expect(roundTrip(bearer).auth).toEqual({ type: "bearer", token: "{{token}}" });

    const basic: RequestDefinition = {
      ...bearer,
      auth: { type: "basic", username: "u", password: "p" },
    };
    expect(roundTrip(basic).auth).toEqual({ type: "basic", username: "u", password: "p" });

    const apikey: RequestDefinition = {
      ...bearer,
      auth: { type: "apikey", header: "X-Key", value: "v" },
    };
    expect(roundTrip(apikey).auth).toEqual({ type: "apikey", header: "X-Key", value: "v" });
  });

  it("preserves each body type", () => {
    const base: RequestDefinition = {
      method: "POST",
      url: "x",
      headers: {},
      query: {},
      tests: [],
      capture: {},
    };
    expect(
      roundTrip({ ...base, body: { type: "json", content: { a: 1, b: [1, 2] } } }).body,
    ).toEqual({ type: "json", content: { a: 1, b: [1, 2] } });
    expect(roundTrip({ ...base, body: { type: "text", content: "hello" } }).body).toEqual({
      type: "text",
      content: "hello",
    });
    expect(
      roundTrip({ ...base, body: { type: "form", content: { a: "1" } } }).body,
    ).toEqual({ type: "form", content: { a: "1" } });
  });

  it("preserves every assertion kind", () => {
    const def: RequestDefinition = {
      method: "GET",
      url: "x",
      headers: {},
      query: {},
      tests: [
        { status: 200 },
        { header: "content-type", contains: "json" },
        { header: "x-flag" },
        { jsonpath: "$.id", exists: true },
        { jsonpath: "$.id", exists: false },
        { jsonpath: "$.count", equals: 3 },
        { jsonpath: "$.name", equals: "ada" },
        { jsonpath: "$.tags", equals: ["a", "b"] },
        { jsonpath: "$.name", contains: "ad" },
        { bodyContains: "ok" },
        { responseTimeBelow: 500 },
      ],
      capture: {},
    };
    expect(roundTrip(def).tests).toEqual(def.tests);
  });

  it("preserves capture", () => {
    const def: RequestDefinition = {
      method: "GET",
      url: "x",
      headers: {},
      query: {},
      tests: [],
      capture: { authToken: "$.token", userId: "$.user.id" },
    };
    expect(roundTrip(def).capture).toEqual(def.capture);
  });

  it("omits blank key-value rows and blank test fields", () => {
    const form = emptyFormData();
    form.headers = [{ key: "", value: "x" }, { key: "Real", value: "y" }];
    form.tests = [{ kind: "header", header: "", mode: "present", value: "" }];
    const result = fromFormData(form);
    expect(result.headers).toEqual({ Real: "y" });
    expect(result.tests).toBeUndefined();
  });
});

describe("parseRequestContent", () => {
  it("parses valid YAML with method/url into form data", () => {
    const result = parseRequestContent('method: GET\nurl: "{{baseUrl}}/x"\n');
    expect(result).toHaveProperty("data");
    if ("data" in result) {
      expect(result.data.method).toBe("GET");
      expect(result.data.url).toBe("{{baseUrl}}/x");
    }
  });

  it("reports invalid YAML syntax", () => {
    const result = parseRequestContent("method: [unterminated\n");
    expect(result).toHaveProperty("error");
  });

  it("reports missing required fields", () => {
    const result = parseRequestContent("name: Only a name\n");
    expect(result).toHaveProperty("error");
  });

  it("round-trips a full request through stringifyFormData", () => {
    const yaml = [
      "name: Login",
      "method: POST",
      'url: "{{baseUrl}}/login"',
      "body:",
      "  type: json",
      "  content:",
      "    username: ada",
      "tests:",
      "  - status: 200",
      "capture:",
      "  authToken: $.token",
      "",
    ].join("\n");
    const parsed = parseRequestContent(yaml);
    expect(parsed).toHaveProperty("data");
    if (!("data" in parsed)) throw new Error("expected data");
    const reparsed = parseRequestContent(stringifyFormData(parsed.data));
    expect(reparsed).toEqual(parsed);
  });
});
