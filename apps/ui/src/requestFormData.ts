import type { Assertion, HttpMethod, RequestDefinition } from "@quiver/core";
import { parse as parseYamlDoc, stringify as stringifyYamlDoc } from "yaml";

export interface KeyValueRow {
  key: string;
  value: string;
}

export type AuthType = "none" | "bearer" | "basic" | "apikey";
export type BodyType = "none" | "json" | "text" | "form";

export type TestFormRow =
  | { kind: "status"; status: string }
  | { kind: "header"; header: string; mode: "present" | "equals" | "contains"; value: string }
  | {
      kind: "jsonpath";
      jsonpath: string;
      mode: "exists" | "notExists" | "equals" | "contains";
      value: string;
    }
  | { kind: "bodyContains"; value: string }
  | { kind: "responseTimeBelow"; value: string };

export interface RequestFormData {
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValueRow[];
  query: KeyValueRow[];
  timeoutMs: string;
  authType: AuthType;
  authBearerToken: string;
  authBasicUsername: string;
  authBasicPassword: string;
  authApiKeyHeader: string;
  authApiKeyValue: string;
  bodyType: BodyType;
  bodyJsonText: string;
  bodyPlainText: string;
  bodyForm: KeyValueRow[];
  tests: TestFormRow[];
  capture: KeyValueRow[];
}

export const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

function toKvRows(record: Record<string, string> | undefined): KeyValueRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

function fromKvRows(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) result[row.key] = row.value;
  }
  return result;
}

/**
 * Interprets a test-value field as JSON when possible (so `42`, `true`,
 * `"text"`, `[1,2]` all work) and falls back to the raw text otherwise, so
 * a non-technical user can type `active` and get the string "active"
 * without knowing JSON quoting rules.
 */
export function parseLooseJson(text: string): unknown {
  if (text.trim() === "") return "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function formatLooseJson(value: unknown): string {
  if (value === undefined) return "";
  return JSON.stringify(value);
}

export function emptyFormData(): RequestFormData {
  return {
    name: "",
    method: "GET",
    url: "",
    headers: [],
    query: [],
    timeoutMs: "",
    authType: "none",
    authBearerToken: "",
    authBasicUsername: "",
    authBasicPassword: "",
    authApiKeyHeader: "X-API-Key",
    authApiKeyValue: "",
    bodyType: "none",
    bodyJsonText: "{}",
    bodyPlainText: "",
    bodyForm: [],
    tests: [{ kind: "status", status: "200" }],
    capture: [],
  };
}

function testToFormRow(assertion: Assertion): TestFormRow {
  if ("status" in assertion) {
    return { kind: "status", status: String(assertion.status) };
  }
  if ("header" in assertion) {
    if (assertion.equals !== undefined) {
      return { kind: "header", header: assertion.header, mode: "equals", value: assertion.equals };
    }
    if (assertion.contains !== undefined) {
      return { kind: "header", header: assertion.header, mode: "contains", value: assertion.contains };
    }
    return { kind: "header", header: assertion.header, mode: "present", value: "" };
  }
  if ("jsonpath" in assertion) {
    if (assertion.exists !== undefined) {
      return {
        kind: "jsonpath",
        jsonpath: assertion.jsonpath,
        mode: assertion.exists ? "exists" : "notExists",
        value: "",
      };
    }
    if (assertion.equals !== undefined) {
      return {
        kind: "jsonpath",
        jsonpath: assertion.jsonpath,
        mode: "equals",
        value: formatLooseJson(assertion.equals),
      };
    }
    if (assertion.contains !== undefined) {
      return {
        kind: "jsonpath",
        jsonpath: assertion.jsonpath,
        mode: "contains",
        value: assertion.contains,
      };
    }
    return { kind: "jsonpath", jsonpath: assertion.jsonpath, mode: "exists", value: "" };
  }
  if ("bodyContains" in assertion) {
    return { kind: "bodyContains", value: assertion.bodyContains };
  }
  return { kind: "responseTimeBelow", value: String(assertion.responseTimeBelow) };
}

export function newTestRow(kind: TestFormRow["kind"]): TestFormRow {
  switch (kind) {
    case "status":
      return { kind: "status", status: "200" };
    case "header":
      return { kind: "header", header: "", mode: "present", value: "" };
    case "jsonpath":
      return { kind: "jsonpath", jsonpath: "$.", mode: "exists", value: "" };
    case "bodyContains":
      return { kind: "bodyContains", value: "" };
    case "responseTimeBelow":
      return { kind: "responseTimeBelow", value: "2000" };
  }
}

function formRowToTest(row: TestFormRow): Assertion | null {
  switch (row.kind) {
    case "status": {
      const status = Number(row.status);
      return Number.isFinite(status) ? { status } : null;
    }
    case "header": {
      if (!row.header.trim()) return null;
      if (row.mode === "equals") return { header: row.header, equals: row.value };
      if (row.mode === "contains") return { header: row.header, contains: row.value };
      return { header: row.header };
    }
    case "jsonpath": {
      if (!row.jsonpath.trim()) return null;
      if (row.mode === "equals") return { jsonpath: row.jsonpath, equals: parseLooseJson(row.value) };
      if (row.mode === "contains") return { jsonpath: row.jsonpath, contains: row.value };
      if (row.mode === "notExists") return { jsonpath: row.jsonpath, exists: false };
      return { jsonpath: row.jsonpath, exists: true };
    }
    case "bodyContains":
      return row.value ? { bodyContains: row.value } : null;
    case "responseTimeBelow": {
      const ms = Number(row.value);
      return Number.isFinite(ms) && ms > 0 ? { responseTimeBelow: ms } : null;
    }
  }
}

export function toFormData(def: Partial<RequestDefinition>): RequestFormData {
  const base = emptyFormData();
  const auth = def.auth;
  const body = def.body;
  return {
    ...base,
    name: def.name ?? "",
    method: def.method ?? "GET",
    url: def.url ?? "",
    headers: toKvRows(def.headers),
    query: toKvRows(def.query),
    timeoutMs: def.timeoutMs !== undefined ? String(def.timeoutMs) : "",
    authType: auth?.type ?? "none",
    authBearerToken: auth?.type === "bearer" ? auth.token : "",
    authBasicUsername: auth?.type === "basic" ? auth.username : "",
    authBasicPassword: auth?.type === "basic" ? auth.password : "",
    authApiKeyHeader: auth?.type === "apikey" ? auth.header : "X-API-Key",
    authApiKeyValue: auth?.type === "apikey" ? auth.value : "",
    bodyType: body?.type ?? "none",
    bodyJsonText:
      body?.type === "json" ? JSON.stringify(body.content, null, 2) : base.bodyJsonText,
    bodyPlainText: body?.type === "text" ? body.content : "",
    bodyForm: body?.type === "form" ? toKvRows(body.content) : [],
    tests: def.tests && def.tests.length > 0 ? def.tests.map(testToFormRow) : [],
    capture: toKvRows(def.capture),
  };
}

/** Builds the plain object that gets YAML-serialized and sent to the server. */
export function fromFormData(form: RequestFormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (form.name.trim()) result.name = form.name.trim();
  result.method = form.method;
  result.url = form.url;

  const headers = fromKvRows(form.headers);
  if (Object.keys(headers).length > 0) result.headers = headers;
  const query = fromKvRows(form.query);
  if (Object.keys(query).length > 0) result.query = query;

  if (form.timeoutMs.trim()) {
    const ms = Number(form.timeoutMs);
    if (Number.isFinite(ms) && ms > 0) result.timeoutMs = ms;
  }

  if (form.authType === "bearer") {
    result.auth = { type: "bearer", token: form.authBearerToken };
  } else if (form.authType === "basic") {
    result.auth = {
      type: "basic",
      username: form.authBasicUsername,
      password: form.authBasicPassword,
    };
  } else if (form.authType === "apikey") {
    result.auth = {
      type: "apikey",
      header: form.authApiKeyHeader || "X-API-Key",
      value: form.authApiKeyValue,
    };
  }

  if (form.bodyType === "json") {
    let content: unknown = {};
    if (form.bodyJsonText.trim()) {
      try {
        content = JSON.parse(form.bodyJsonText);
      } catch {
        // Invalid JSON-in-progress; kept verbatim so nothing is silently
        // dropped. The server will reject a bad save with a clear message.
        content = form.bodyJsonText;
      }
    }
    result.body = { type: "json", content };
  } else if (form.bodyType === "text") {
    result.body = { type: "text", content: form.bodyPlainText };
  } else if (form.bodyType === "form") {
    result.body = { type: "form", content: fromKvRows(form.bodyForm) };
  }

  const tests = form.tests.map(formRowToTest).filter((t): t is Assertion => t !== null);
  if (tests.length > 0) result.tests = tests;

  const capture = fromKvRows(form.capture);
  if (Object.keys(capture).length > 0) result.capture = capture;

  return result;
}

export function stringifyFormData(form: RequestFormData): string {
  return stringifyYamlDoc(fromFormData(form));
}

export type ParseResult = { data: RequestFormData } | { error: string };

/**
 * Parses raw YAML text into form state. Deliberately lightweight (no schema
 * validation) — the server is the source of truth for correctness on save;
 * this only needs enough structure to populate the form fields.
 */
export function parseRequestContent(content: string): ParseResult {
  let doc: unknown;
  try {
    doc = parseYamlDoc(content);
  } catch (error) {
    return { error: `Invalid YAML: ${(error as Error).message}` };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { error: "Expected a YAML object at the top level" };
  }
  const record = doc as Partial<RequestDefinition>;
  if (typeof record.method !== "string" || typeof record.url !== "string") {
    return { error: "Missing required \"method\" or \"url\" field" };
  }
  return { data: toFormData(record) };
}
