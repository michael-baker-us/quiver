import { describe, expect, it } from "vitest";
import { evaluateAssertion } from "../src/assertions.js";
import type { HttpResponse } from "../src/http.js";

function response(overrides: Partial<HttpResponse> = {}): HttpResponse {
  const bodyText = JSON.stringify({ data: { id: 42, tags: ["a", "b"] } });
  return {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json; charset=utf-8" },
    bodyText,
    bodyJson: JSON.parse(bodyText),
    timeMs: 120,
    ...overrides,
  };
}

describe("evaluateAssertion", () => {
  it("checks status", () => {
    expect(evaluateAssertion({ status: 200 }, response()).ok).toBe(true);
    const failed = evaluateAssertion({ status: 201 }, response());
    expect(failed.ok).toBe(false);
    expect(failed.detail).toContain("200");
  });

  it("checks headers case-insensitively", () => {
    expect(
      evaluateAssertion(
        { header: "Content-Type", contains: "application/json" },
        response(),
      ).ok,
    ).toBe(true);
    expect(
      evaluateAssertion({ header: "X-Missing", equals: "x" }, response()).ok,
    ).toBe(false);
  });

  it("checks jsonpath equals with deep equality", () => {
    expect(
      evaluateAssertion(
        { jsonpath: "$.data.tags", equals: ["a", "b"] },
        response(),
      ).ok,
    ).toBe(true);
    expect(
      evaluateAssertion({ jsonpath: "$.data.id", equals: 41 }, response()).ok,
    ).toBe(false);
  });

  it("checks jsonpath existence both ways", () => {
    expect(
      evaluateAssertion({ jsonpath: "$.data.id", exists: true }, response()).ok,
    ).toBe(true);
    expect(
      evaluateAssertion({ jsonpath: "$.nope", exists: false }, response()).ok,
    ).toBe(true);
    expect(
      evaluateAssertion({ jsonpath: "$.nope", exists: true }, response()).ok,
    ).toBe(false);
  });

  it("fails jsonpath assertions on non-JSON bodies with a clear message", () => {
    const result = evaluateAssertion(
      { jsonpath: "$.a", exists: true },
      response({ bodyJson: undefined, bodyText: "<html>" }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not valid JSON");
  });

  it("checks bodyContains and responseTimeBelow", () => {
    expect(evaluateAssertion({ bodyContains: '"id":42' }, response()).ok).toBe(
      true,
    );
    expect(
      evaluateAssertion({ responseTimeBelow: 100 }, response()).ok,
    ).toBe(false);
    expect(
      evaluateAssertion({ responseTimeBelow: 500 }, response()).ok,
    ).toBe(true);
  });
});
