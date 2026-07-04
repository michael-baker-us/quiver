import type { RequestResult, RunSummary } from "./runner.js";

export interface JsonAssertion {
  ok: boolean;
  description: string;
  detail?: string;
}

/** The request as sent, after redaction — safe to put in a shared report. */
export interface JsonRequestDetail {
  url: string;
  headers: Record<string, string>;
  body?: string;
  bodyTruncated?: boolean;
}

export interface JsonResponseDetail {
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  bodyTruncated?: boolean;
}

export interface JsonResult {
  name: string;
  file: string;
  method: string;
  passed: boolean;
  error?: string;
  status?: number;
  timeMs?: number;
  assertions: JsonAssertion[];
  /** Absent for pre-send failures (unresolvable variable, bad URL). */
  request?: JsonRequestDetail;
  response?: JsonResponseDetail;
}

export interface JsonSummary {
  passed: number;
  failed: number;
  durationMs: number;
  results: JsonResult[];
}

/** Bodies are cut at this length so one huge payload can't balloon a report. */
export const REPORT_BODY_LIMIT = 10_000;

/**
 * Captured values shorter than this are not scrubbed: replacing every "1" in
 * a body would mangle it, and real secrets (tokens, session ids) are long.
 */
const SCRUB_MIN_LENGTH = 8;

const REDACTED = "«redacted»";

/** Headers whose values are credentials no matter how they were set. */
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

function scrubText(text: string, captures: Record<string, string>): string {
  let out = text;
  for (const [name, value] of Object.entries(captures)) {
    if (value.length < SCRUB_MIN_LENGTH) continue;
    out = out.split(value).join(`«captured ${name}»`);
  }
  return out;
}

function scrubHeaders(
  headers: Record<string, string>,
  captures: Record<string, string>,
  sensitiveNames: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    out[key] =
      SENSITIVE_HEADER_NAMES.has(lower) || sensitiveNames.includes(lower)
        ? REDACTED
        : scrubText(value, captures);
  }
  return out;
}

function reportBody(
  text: string | undefined,
  captures: Record<string, string>,
): { body?: string; bodyTruncated?: boolean } {
  if (text === undefined || text.length === 0) return {};
  const scrubbed = scrubText(text, captures);
  if (scrubbed.length <= REPORT_BODY_LIMIT) return { body: scrubbed };
  return { body: scrubbed.slice(0, REPORT_BODY_LIMIT), bodyTruncated: true };
}

/**
 * Converts one runner result into its report shape. Reports are made to be
 * shared (attached to tickets, emailed), so everything secret-shaped is
 * removed here: credential headers are redacted, and every occurrence of a
 * captured value (auth tokens being the classic case) is replaced with
 * «captured name» — which doubles as debugging signal, since it shows where
 * a chained value actually landed. `knownCaptures` must include this
 * result's own captures plus every earlier result's.
 */
export function toJsonResult(
  result: RequestResult,
  knownCaptures: Record<string, string> = {},
): JsonResult {
  return {
    name: result.request.definition.name ?? result.request.relativePath,
    file: result.request.relativePath,
    method: result.request.definition.method,
    passed: result.passed,
    error: result.error,
    status: result.response?.status,
    timeMs: result.response ? Math.round(result.response.timeMs) : undefined,
    assertions: result.assertions.map((a) => ({
      ok: a.ok,
      description: a.description,
      detail: a.detail,
    })),
    request: result.sent
      ? {
          url: scrubText(result.sent.url, knownCaptures),
          headers: scrubHeaders(
            result.sent.headers,
            knownCaptures,
            result.sent.sensitiveHeaders,
          ),
          ...reportBody(result.sent.bodyText, knownCaptures),
        }
      : undefined,
    response: result.response
      ? {
          statusText: result.response.statusText,
          headers: scrubHeaders(result.response.headers, knownCaptures, []),
          ...reportBody(result.response.bodyText, knownCaptures),
        }
      : undefined,
  };
}

/**
 * Denormalizes a RunSummary into the plain JSON shape used by
 * `--reporter json`, and reused as the input format for `quiver report`
 * (junit/html generated from a previously saved JSON run), the GitHub
 * Action, and the web UI's report downloads, so a collection only ever has
 * to be executed once per run.
 */
export function toJsonSummary(summary: RunSummary): JsonSummary {
  const captures: Record<string, string> = {};
  return {
    passed: summary.passed,
    failed: summary.failed,
    durationMs: Math.round(summary.durationMs),
    results: summary.results.map((result) => {
      // Merge before converting: a login response body contains the very
      // token it captures, so a result must be scrubbed with its own values.
      Object.assign(captures, result.captured);
      return toJsonResult(result, captures);
    }),
  };
}

/** Shape check for externally supplied summaries (saved files, API bodies). */
export function isJsonSummary(data: unknown): data is JsonSummary {
  if (data === null || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.passed === "number" &&
    typeof record.failed === "number" &&
    typeof record.durationMs === "number" &&
    Array.isArray(record.results)
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface JunitCase {
  classname: string;
  name: string;
  timeSec: number;
  failureMessage?: string;
}

function buildJunitCases(data: JsonSummary): JunitCase[] {
  const cases: JunitCase[] = [];
  for (const result of data.results) {
    const timeSec = (result.timeMs ?? 0) / 1000;
    if (result.error) {
      cases.push({ classname: result.file, name: result.name, timeSec, failureMessage: result.error });
      continue;
    }
    if (result.assertions.length === 0) {
      // Still represent the request even with no assertions defined, so it
      // isn't invisible in the JUnit viewer.
      cases.push({ classname: result.file, name: `${result.name} (request sent)`, timeSec });
      continue;
    }
    for (const assertion of result.assertions) {
      cases.push({
        classname: result.file,
        name: `${result.name} ➜ ${assertion.description}`,
        timeSec,
        failureMessage: assertion.ok ? undefined : (assertion.detail ?? "assertion failed"),
      });
    }
  }
  return cases;
}

/** Converts a run into JUnit XML (one testcase per assertion) for Jenkins/GitLab/GitHub. */
export function buildJunitXml(data: JsonSummary): string {
  const cases = buildJunitCases(data);
  const failures = cases.filter((c) => c.failureMessage !== undefined).length;
  const totalTime = (data.durationMs / 1000).toFixed(3);
  const body = cases
    .map((c) => {
      const attrs = `classname="${escapeXml(c.classname)}" name="${escapeXml(c.name)}" time="${c.timeSec.toFixed(3)}"`;
      if (c.failureMessage === undefined) return `    <testcase ${attrs} />`;
      return [
        `    <testcase ${attrs}>`,
        `      <failure message="${escapeXml(c.failureMessage)}" />`,
        `    </testcase>`,
      ].join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="quiver" tests="${cases.length}" failures="${failures}" time="${totalTime}">`,
    `  <testsuite name="quiver" tests="${cases.length}" failures="${failures}" time="${totalTime}">`,
    body,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");
}

