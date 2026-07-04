import { describe, expect, it } from "vitest";
import { summarizeRunEvents, type RunEvent } from "../src/api.js";

const resultEvent: RunEvent = {
  type: "result",
  name: "Get thing",
  relativePath: "things/get-thing.request.yaml",
  method: "GET",
  passed: false,
  assertions: [
    { ok: true, description: "status is 200" },
    { ok: false, description: "jsonpath $.ok equals", detail: "got false" },
  ],
  captured: { token: "abc" },
  response: { status: 500, statusText: "Internal Server Error", timeMs: 41 },
};

describe("summarizeRunEvents", () => {
  it("returns null while the run has no summary yet", () => {
    expect(summarizeRunEvents([resultEvent])).toBeNull();
  });

  it("returns null for an aborted run (failed: -1 sentinel)", () => {
    expect(
      summarizeRunEvents([{ type: "summary", passed: 0, failed: -1, durationMs: 0 }]),
    ).toBeNull();
  });

  it("folds events into the server's JsonSummary shape", () => {
    const payload = summarizeRunEvents([
      resultEvent,
      { type: "summary", passed: 1, failed: 1, durationMs: 120 },
    ]);
    expect(payload).toEqual({
      passed: 1,
      failed: 1,
      durationMs: 120,
      results: [
        {
          name: "Get thing",
          file: "things/get-thing.request.yaml",
          method: "GET",
          passed: false,
          error: undefined,
          status: 500,
          timeMs: 41,
          assertions: [
            { ok: true, description: "status is 200", detail: undefined },
            { ok: false, description: "jsonpath $.ok equals", detail: "got false" },
          ],
        },
      ],
    });
    // captured variables must not leak into a report that may be shared
    expect(JSON.stringify(payload)).not.toContain("abc");
  });

  it("prefers the server's redacted report entry when present", () => {
    const report = {
      name: "Get thing",
      file: "things/get-thing.request.yaml",
      method: "GET",
      passed: false,
      status: 500,
      timeMs: 41,
      assertions: [],
      request: {
        url: "https://api.test/thing",
        headers: { authorization: "«redacted»" },
      },
      response: {
        statusText: "Internal Server Error",
        headers: {},
        body: '{"ok":false}',
      },
    };
    const payload = summarizeRunEvents([
      { ...resultEvent, report },
      { type: "summary", passed: 0, failed: 1, durationMs: 50 },
    ]);
    expect(payload?.results[0]).toEqual(report);
    // the raw (unredacted) event fields must not leak into the payload
    expect(JSON.stringify(payload)).not.toContain("abc");
  });

  it("carries request-level errors through", () => {
    const payload = summarizeRunEvents([
      {
        type: "result",
        name: "Down",
        relativePath: "down.request.yaml",
        method: "GET",
        passed: false,
        error: "fetch failed",
        assertions: [],
        captured: {},
      },
      { type: "summary", passed: 0, failed: 1, durationMs: 10 },
    ]);
    expect(payload?.results[0]?.error).toBe("fetch failed");
    expect(payload?.results[0]?.status).toBeUndefined();
  });
});
