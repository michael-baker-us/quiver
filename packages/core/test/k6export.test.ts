import { describe, expect, it } from "vitest";
import type { LoadedCollection, LoadedRequest } from "../src/loader.js";
import type { RequestDefinition } from "../src/schema.js";
import { exportK6, K6_ITERATION_CLOSE, K6_ITERATION_SIGNATURE } from "../src/k6export.js";

function makeRequest(relativePath: string, definition: RequestDefinition): LoadedRequest {
  return { filePath: `/fake/${relativePath}`, relativePath, definition };
}

const loaded: LoadedCollection = {
  rootDir: "/fake",
  collection: { name: "K6 Export Test", defaults: { headers: { Accept: "application/json" } } },
  requests: [
    makeRequest("auth/01-login.request.yaml", {
      method: "POST",
      url: "{{baseUrl}}/login",
      headers: {},
      query: {},
      body: {
        type: "json",
        content: {
          username: "ada",
          note: 'say "hi"\\backslash\nline2',
          bio: "{{$env.BIO}}",
        },
      },
      tests: [{ status: 201 }],
      capture: { authToken: "$.token", userId: "$.user.id" },
    }),
    makeRequest("auth/02-profile.request.yaml", {
      method: "GET",
      url: "{{baseUrl}}/profile",
      headers: {},
      query: { userId: "{{userId}}" },
      auth: { type: "bearer", token: "{{authToken}}" },
      tests: [
        { jsonpath: "$.name", equals: "Ada" },
        { jsonpath: "$.name", contains: "Ad" },
        { jsonpath: "$.missing", exists: false },
      ],
      capture: {},
    }),
    makeRequest("auth/03-basic-ping.request.yaml", {
      method: "GET",
      url: "{{baseUrl}}/ping",
      headers: {},
      query: {},
      auth: {
        type: "basic",
        username: "{{$env.BASIC_USER}}",
        password: "{{$env.BASIC_PASS}}",
      },
      tests: [],
      capture: {},
    }),
  ],
};

const envVars = { baseUrl: "https://api.example.com" };

/** Extracts the isolated per-iteration function body and eval's it standalone. */
function loadQuiverIteration(script: string): Function {
  const start = script.indexOf(K6_ITERATION_SIGNATURE);
  const bodyStart = start + K6_ITERATION_SIGNATURE.length;
  const end = script.indexOf(K6_ITERATION_CLOSE, bodyStart);
  expect(start, "iteration signature should be present").toBeGreaterThan(-1);
  expect(end, "iteration close anchor should be present").toBeGreaterThan(-1);
  const body = script.slice(bodyStart, end);
  // eslint-disable-next-line no-new-func
  return new Function("http", "check", "encoding", "__ENV", body);
}

function jget(obj: unknown, selector: string): unknown {
  if (!selector) return obj;
  const parts = selector.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const arrayLoaded: LoadedCollection = {
  rootDir: "/fake",
  collection: { name: "Array Capture Test" },
  requests: [
    makeRequest("list.request.yaml", {
      method: "GET",
      url: "{{baseUrl}}/items",
      headers: {},
      query: {},
      tests: [
        { header: "Content-Type", contains: "json" },
        { jsonpath: "$[0].id", exists: true },
      ],
      capture: { firstId: "$[0].id" },
    }),
    makeRequest("get-first.request.yaml", {
      method: "GET",
      url: "{{baseUrl}}/items/{{firstId}}",
      headers: {},
      query: {},
      tests: [],
      capture: {},
    }),
  ],
};

describe("exportK6: bracket-index jsonpath and case-insensitive headers", () => {
  it("captures via a leading array-index jsonpath ($[0].id) and finds headers regardless of case", () => {
    const script = exportK6(arrayLoaded, { baseUrl: "https://api.example.com" });
    const quiverIteration = loadQuiverIteration(script);

    const calls: { url: string }[] = [];
    let callIndex = 0;
    const responses = [
      {
        status: 200,
        headers: { "Content-Type": "application/json" }, // real k6 casing, not lowercase
        body: JSON.stringify([{ id: 42 }, { id: 43 }]),
        json: (selector?: string) => jget(JSON.parse('[{"id":42},{"id":43}]'), selector ?? ""),
        timings: { duration: 5 },
      },
      { status: 200, headers: {}, body: "{}", json: () => ({}), timings: { duration: 5 } },
    ];
    const http = {
      get: (url: string, _params: unknown) => {
        calls.push({ url });
        return responses[callIndex++];
      },
    };
    const checkResults: Record<string, boolean>[] = [];
    function check(res: unknown, checks: Record<string, (r: unknown) => boolean>) {
      const results: Record<string, boolean> = {};
      for (const [description, predicate] of Object.entries(checks)) results[description] = predicate(res);
      checkResults.push(results);
    }

    quiverIteration(http, check, {}, {});

    expect(calls[0]!.url).toBe("https://api.example.com/items");
    expect(calls[1]!.url).toBe("https://api.example.com/items/42");
    expect(checkResults[0]).toEqual({
      "list.request.yaml: header Content-Type contains": true,
      "list.request.yaml: jsonpath $[0].id exists": true,
    });
  });
});

describe("exportK6 generated script", () => {
  const script = exportK6(loaded, envVars, { vus: 5, duration: "1m" });

  it("includes the requested load options", () => {
    expect(script).toContain("vus: 5");
    expect(script).toContain('duration: "1m"');
  });

  it("actually executes: chains capture across requests, escapes JSON bodies, and evaluates checks", () => {
    const calls: { method: string; url: string; body: unknown; params: any }[] = [];
    const checkResults: Record<string, boolean>[] = [];

    const loginResponseBody = JSON.stringify({ token: "abc123", user: { id: 7 } });
    const profileResponseBody = JSON.stringify({ name: "Ada", roles: ["admin", "user"] });
    let callIndex = 0;

    const fakeResponses = [
      {
        status: 201,
        headers: {},
        body: loginResponseBody,
        json: (selector?: string) => jget(JSON.parse(loginResponseBody), selector ?? ""),
        timings: { duration: 42 },
      },
      {
        status: 200,
        headers: {},
        body: profileResponseBody,
        json: (selector?: string) => jget(JSON.parse(profileResponseBody), selector ?? ""),
        timings: { duration: 12 },
      },
      {
        status: 200,
        headers: {},
        body: "pong",
        json: () => undefined,
        timings: { duration: 5 },
      },
    ];

    function record(method: string) {
      return (url: string, ...rest: unknown[]) => {
        const response = fakeResponses[callIndex]!;
        // http.get/head/options(url, params); everything else (url, body, params)
        const [body, params] = rest.length === 1 ? [undefined, rest[0]] : rest;
        calls.push({ method, url, body, params });
        callIndex++;
        return response;
      };
    }

    const http = {
      get: record("get"),
      post: record("post"),
      put: record("put"),
      patch: record("patch"),
      del: record("del"),
      head: record("head"),
      options: record("options"),
    };

    function check(res: unknown, checks: Record<string, (r: unknown) => boolean>) {
      const results: Record<string, boolean> = {};
      for (const [description, predicate] of Object.entries(checks)) {
        results[description] = predicate(res);
      }
      checkResults.push(results);
      return Object.values(results).every(Boolean);
    }

    const encoding = {
      b64encode: (s: string) => Buffer.from(s, "utf8").toString("base64"),
    };

    const __ENV = { BIO: 'hello "world"', BASIC_USER: "svc-account", BASIC_PASS: "p@ss\"w0rd" };

    const quiverIteration = loadQuiverIteration(script);
    quiverIteration(http, check, encoding, __ENV);

    expect(calls).toHaveLength(3);

    // --- Request 1: login — JSON body escaping, including a JSON-unsafe env var ---
    const loginCall = calls[0]!;
    expect(loginCall.method).toBe("post");
    expect(loginCall.url).toBe("https://api.example.com/login");
    expect(typeof loginCall.body).toBe("string");
    const parsedSentBody = JSON.parse(loginCall.body as string);
    expect(parsedSentBody).toEqual({
      username: "ada",
      note: 'say "hi"\\backslash\nline2',
      bio: 'hello "world"',
    });
    expect(loginCall.params.headers["Content-Type"]).toBe("application/json");
    expect(loginCall.params.headers.Accept).toBe("application/json");
    expect(checkResults[0]).toEqual({ "auth/01-login.request.yaml: status is 201": true });

    // --- Request 2: profile — capture chaining into auth + query, jsonpath assertions ---
    const profileCall = calls[1]!;
    expect(profileCall.method).toBe("get");
    expect(profileCall.url).toBe("https://api.example.com/profile?userId=7");
    expect(profileCall.params.headers.Authorization).toBe("Bearer abc123");
    expect(checkResults[1]).toEqual({
      "auth/02-profile.request.yaml: jsonpath $.name equals": true,
      "auth/02-profile.request.yaml: jsonpath $.name contains": true,
      "auth/02-profile.request.yaml: jsonpath $.missing does not exist": true,
    });

    // --- Request 3: basic auth built from two {{$env.*}} values, one containing a quote ---
    const pingCall = calls[2]!;
    const expectedAuth =
      "Basic " + Buffer.from("svc-account:p@ss\"w0rd", "utf8").toString("base64");
    expect(pingCall.params.headers.Authorization).toBe(expectedAuth);
  });
});
