import { getPath, NOT_FOUND } from "./jsonpath.js";
import type { Assertion } from "./schema.js";
import type { HttpResponse } from "./http.js";

export interface AssertionResult {
  ok: boolean;
  description: string;
  /** Human-readable explanation when the assertion failed. */
  detail?: string;
}

function format(value: unknown): string {
  if (value === NOT_FOUND) return "<not found>";
  return JSON.stringify(value);
}

export function evaluateAssertion(
  assertion: Assertion,
  response: HttpResponse,
): AssertionResult {
  if ("status" in assertion) {
    const ok = response.status === assertion.status;
    return {
      ok,
      description: `status is ${assertion.status}`,
      detail: ok ? undefined : `got ${response.status} ${response.statusText}`,
    };
  }

  if ("header" in assertion) {
    const actual = response.headers[assertion.header.toLowerCase()];
    if (assertion.equals !== undefined) {
      const ok = actual === assertion.equals;
      return {
        ok,
        description: `header ${assertion.header} equals ${format(assertion.equals)}`,
        detail: ok ? undefined : `got ${format(actual)}`,
      };
    }
    if (assertion.contains !== undefined) {
      const ok = actual !== undefined && actual.includes(assertion.contains);
      return {
        ok,
        description: `header ${assertion.header} contains ${format(assertion.contains)}`,
        detail: ok ? undefined : `got ${format(actual)}`,
      };
    }
    const ok = actual !== undefined;
    return {
      ok,
      description: `header ${assertion.header} is present`,
      detail: ok ? undefined : "header missing",
    };
  }

  if ("jsonpath" in assertion) {
    if (response.bodyJson === undefined) {
      return {
        ok: false,
        description: `jsonpath ${assertion.jsonpath}`,
        detail: "response body is not valid JSON",
      };
    }
    const actual = getPath(response.bodyJson, assertion.jsonpath);
    if (assertion.exists !== undefined) {
      const ok = (actual !== NOT_FOUND) === assertion.exists;
      return {
        ok,
        description: `jsonpath ${assertion.jsonpath} ${assertion.exists ? "exists" : "does not exist"}`,
        detail: ok ? undefined : `got ${format(actual)}`,
      };
    }
    if (assertion.equals !== undefined) {
      const ok =
        actual !== NOT_FOUND &&
        JSON.stringify(actual) === JSON.stringify(assertion.equals);
      return {
        ok,
        description: `jsonpath ${assertion.jsonpath} equals ${format(assertion.equals)}`,
        detail: ok ? undefined : `got ${format(actual)}`,
      };
    }
    if (assertion.contains !== undefined) {
      const ok =
        actual !== NOT_FOUND &&
        typeof actual === "string" &&
        actual.includes(assertion.contains);
      return {
        ok,
        description: `jsonpath ${assertion.jsonpath} contains ${format(assertion.contains)}`,
        detail: ok ? undefined : `got ${format(actual)}`,
      };
    }
    const ok = actual !== NOT_FOUND;
    return {
      ok,
      description: `jsonpath ${assertion.jsonpath} exists`,
      detail: ok ? undefined : "path not found",
    };
  }

  if ("bodyContains" in assertion) {
    const ok = response.bodyText.includes(assertion.bodyContains);
    return {
      ok,
      description: `body contains ${format(assertion.bodyContains)}`,
      detail: ok
        ? undefined
        : `body (${response.bodyText.length} chars) does not contain it`,
    };
  }

  const ok = response.timeMs < assertion.responseTimeBelow;
  return {
    ok,
    description: `response time below ${assertion.responseTimeBelow}ms`,
    detail: ok ? undefined : `took ${Math.round(response.timeMs)}ms`,
  };
}
