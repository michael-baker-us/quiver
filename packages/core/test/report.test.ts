import { describe, expect, it } from "vitest";
import { buildHtmlReport, buildJunitXml, isJsonSummary, type JsonSummary } from "../src/report.js";

const summary: JsonSummary = {
  passed: 1,
  failed: 1,
  durationMs: 250,
  results: [
    {
      name: "List users",
      file: "users/list.request.yaml",
      method: "GET",
      passed: true,
      status: 200,
      timeMs: 40,
      assertions: [{ ok: true, description: "status is 200" }],
    },
    {
      name: "Create <user> & \"friend\"",
      file: "users/create.request.yaml",
      method: "POST",
      passed: false,
      status: 400,
      timeMs: 60,
      assertions: [
        { ok: true, description: "status is 201" },
        { ok: false, description: "jsonpath $.id exists", detail: "got <not found>" },
      ],
    },
    {
      name: "Unreachable host",
      file: "users/timeout.request.yaml",
      method: "GET",
      passed: false,
      error: "fetch failed: getaddrinfo ENOTFOUND",
      assertions: [],
    },
    {
      name: "No assertions defined",
      file: "users/ping.request.yaml",
      method: "GET",
      passed: true,
      status: 200,
      timeMs: 10,
      assertions: [],
    },
  ],
};

describe("buildJunitXml", () => {
  const xml = buildJunitXml(summary);

  it("produces one testcase per assertion, plus a synthetic case for assertion-free requests", () => {
    const testcaseCount = (xml.match(/<testcase /g) ?? []).length;
    // 1 (list users) + 2 (create user) + 1 (unreachable error) + 1 (no assertions) = 5
    expect(testcaseCount).toBe(5);
  });

  it("counts failures correctly in the suite totals", () => {
    // failing: the jsonpath assertion + the unreachable-host error = 2
    expect(xml).toContain('failures="2"');
  });

  it("emits a <failure> element only for failing testcases", () => {
    const failureCount = (xml.match(/<failure /g) ?? []).length;
    expect(failureCount).toBe(2);
  });

  it("escapes XML-significant characters from names and messages", () => {
    expect(xml).toContain("Create &lt;user&gt; &amp; &quot;friend&quot;");
    expect(xml).not.toContain('name="Create <user>');
  });

  it("is well-formed enough to round-trip through DOMParser-less regex balance check", () => {
    const opens = (xml.match(/<testsuite(?!s)/g) ?? []).length;
    const closes = (xml.match(/<\/testsuite>/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});

describe("isJsonSummary", () => {
  it("accepts a real summary and rejects near-misses", () => {
    expect(isJsonSummary(summary)).toBe(true);
    expect(isJsonSummary(null)).toBe(false);
    expect(isJsonSummary("string")).toBe(false);
    expect(isJsonSummary({ passed: 1, failed: 0 })).toBe(false);
    expect(isJsonSummary({ passed: "1", failed: 0, durationMs: 5, results: [] })).toBe(false);
  });
});

describe("buildHtmlReport", () => {
  const html = buildHtmlReport(summary, "My <Collection> & Co");

  it("escapes the collection name in the title and heading", () => {
    expect(html).toContain("My &lt;Collection&gt; &amp; Co — quiver report");
  });

  it("includes the pass/fail summary line", () => {
    expect(html).toContain("1 passed");
    expect(html).toContain("1 failed");
  });

  it("escapes request names containing HTML-significant characters", () => {
    expect(html).toContain("Create &lt;user&gt; &amp; &quot;friend&quot;");
  });

  it("surfaces the request-level error for a failed send", () => {
    expect(html).toContain("fetch failed: getaddrinfo ENOTFOUND");
  });

  it("is a single self-contained document with no external references", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
  });
});
