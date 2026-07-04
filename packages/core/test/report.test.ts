import { describe, expect, it } from "vitest";
import {
  buildJunitXml,
  isJsonSummary,
  REPORT_BODY_LIMIT,
  toJsonResult,
  toJsonSummary,
  type JsonSummary,
} from "../src/report.js";
import { buildHtmlReport } from "../src/htmlReport.js";
import type { RequestResult, RunSummary } from "../src/runner.js";
import type { RequestDefinition } from "../src/schema.js";

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
      request: {
        url: "https://api.example.test/users?limit=10",
        headers: { accept: "application/json" },
      },
      response: {
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: '{"users":[{"id":1}]}',
      },
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
      request: {
        url: "https://api.example.test/users",
        headers: { "content-type": "application/json" },
        body: '{"email":"ada@example.com"}',
      },
      response: {
        statusText: "Bad Request",
        headers: { "content-type": "application/json" },
        body: '{"error":"email already taken"}',
      },
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

function makeResult(overrides: Partial<RequestResult>): RequestResult {
  const definition: RequestDefinition = {
    name: "Login",
    method: "POST",
    url: "https://api.example.test/login",
    headers: {},
    query: {},
    tests: [],
    capture: {},
  };
  return {
    request: {
      filePath: "/abs/auth/01-login.request.yaml",
      relativePath: "auth/01-login.request.yaml",
      definition,
    },
    assertions: [],
    captured: {},
    passed: true,
    ...overrides,
  };
}

describe("toJsonResult redaction", () => {
  it("redacts credential headers, both auth-injected and well-known names", () => {
    const result = makeResult({
      sent: {
        method: "POST",
        url: "https://api.example.test/login",
        headers: {
          "X-Api-Secret": "s3cr3t-value",
          Cookie: "session=abc",
          "content-type": "application/json",
        },
        sensitiveHeaders: ["x-api-secret"],
      },
    });
    const json = toJsonResult(result);
    expect(json.request?.headers["X-Api-Secret"]).toBe("«redacted»");
    expect(json.request?.headers["Cookie"]).toBe("«redacted»");
    expect(json.request?.headers["content-type"]).toBe("application/json");
    expect(JSON.stringify(json)).not.toContain("s3cr3t-value");
  });

  it("replaces captured values in bodies with a «captured name» marker", () => {
    const result = makeResult({
      captured: { authToken: "tok-abcdef-123456", postId: "7" },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        bodyText: '{"token":"tok-abcdef-123456","postId":7}',
        bodyJson: undefined,
        timeMs: 12,
      },
    });
    const json = toJsonResult(result, result.captured);
    expect(json.response?.body).toContain("«captured authToken»");
    expect(json.response?.body).not.toContain("tok-abcdef-123456");
    // short values are left alone — replacing every "7" would mangle the body
    expect(json.response?.body).toContain('"postId":7');
  });

  it("truncates oversized bodies and flags it", () => {
    const result = makeResult({
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        bodyText: "x".repeat(REPORT_BODY_LIMIT + 500),
        bodyJson: undefined,
        timeMs: 5,
      },
    });
    const json = toJsonResult(result);
    expect(json.response?.body).toHaveLength(REPORT_BODY_LIMIT);
    expect(json.response?.bodyTruncated).toBe(true);
  });
});

describe("toJsonSummary", () => {
  it("scrubs a login response with the token it itself captured", () => {
    const runSummary: RunSummary = {
      passed: 1,
      failed: 0,
      durationMs: 100,
      results: [
        makeResult({
          captured: { authToken: "tok-abcdef-123456" },
          sent: {
            method: "POST",
            url: "https://api.example.test/login",
            headers: {},
            sensitiveHeaders: [],
          },
          response: {
            status: 200,
            statusText: "OK",
            headers: {},
            bodyText: '{"token":"tok-abcdef-123456"}',
            bodyJson: undefined,
            timeMs: 30,
          },
        }),
      ],
    };
    const json = toJsonSummary(runSummary);
    expect(JSON.stringify(json)).not.toContain("tok-abcdef-123456");
    expect(json.results[0]?.response?.body).toContain("«captured authToken»");
  });
});

describe("buildHtmlReport", () => {
  const html = buildHtmlReport(summary, "My <Collection> & Co");

  it("escapes the collection name in the title and heading", () => {
    expect(html).toContain("My &lt;Collection&gt; &amp; Co — quiver report");
  });

  it("includes the summary stats", () => {
    expect(html).toContain('<span class="num">1</span><span class="label">passed</span>');
    expect(html).toContain('<span class="num">1</span><span class="label">failed</span>');
  });

  it("escapes request names containing HTML-significant characters", () => {
    expect(html).toContain("Create &lt;user&gt; &amp; &quot;friend&quot;");
  });

  it("surfaces the request-level error for a failed send", () => {
    expect(html).toContain("fetch failed: getaddrinfo ENOTFOUND");
  });

  it("shows the request as sent and the response exchange", () => {
    expect(html).toContain("https://api.example.test/users?limit=10");
    expect(html).toContain("Request sent");
    expect(html).toContain("email already taken");
  });

  it("pretty-prints JSON bodies for readability", () => {
    expect(html).toContain('&quot;email&quot;: &quot;ada@example.com&quot;');
  });

  it("opens failed requests by default and leaves passed ones collapsed", () => {
    expect(html).toContain('<details class="result fail" open>');
    expect(html).toContain('<details class="result pass">');
  });

  it("is self-contained: no external stylesheets, scripts, or images", () => {
    expect(html).not.toContain("<link");
    expect(html).not.toContain("src=");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("url(");
  });

  it("degrades gracefully when a result has no request/response detail (old run files)", () => {
    const bare = buildHtmlReport(
      {
        passed: 1,
        failed: 0,
        durationMs: 10,
        results: [
          {
            name: "Old entry",
            file: "old.request.yaml",
            method: "GET",
            passed: true,
            status: 200,
            timeMs: 5,
            assertions: [{ ok: true, description: "status is 200" }],
          },
        ],
      },
      "Old run",
    );
    expect(bare).toContain("Old entry");
    expect(bare).not.toContain("Request sent");
  });
});
