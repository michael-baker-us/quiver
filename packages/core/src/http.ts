import type { Auth, HttpMethod, RequestBody } from "./schema.js";

export interface ResolvedRequest {
  name: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  auth?: Auth;
  body?: RequestBody;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  /** Parsed body when the response is valid JSON, else undefined. */
  bodyJson: unknown | undefined;
  timeMs: number;
}

/**
 * The request exactly as it goes on the wire: final URL (query appended),
 * headers after auth and content-type injection, serialized body. This is
 * what reports show for debugging — the request *file* only shows intent.
 */
export interface SentRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  bodyText?: string;
  /**
   * Lowercased names of headers carrying credentials (auth-injected).
   * Reports must redact their values.
   */
  sensitiveHeaders: string[];
}

export interface PreparedRequest extends SentRequest {
  timeoutMs: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Returns the lowercased names of any credential headers it set. */
function applyAuth(headers: Headers, auth: Auth | undefined): string[] {
  if (!auth || auth.type === "none") return [];
  switch (auth.type) {
    case "bearer":
      headers.set("Authorization", `Bearer ${auth.token}`);
      return ["authorization"];
    case "basic": {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString(
        "base64",
      );
      headers.set("Authorization", `Basic ${encoded}`);
      return ["authorization"];
    }
    case "apikey":
      headers.set(auth.header, auth.value);
      return [auth.header.toLowerCase()];
  }
}

function serializeBody(headers: Headers, body: RequestBody): string {
  switch (body.type) {
    case "json":
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      return JSON.stringify(body.content);
    case "text":
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "text/plain");
      }
      return body.content;
    case "form":
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/x-www-form-urlencoded");
      }
      return new URLSearchParams(body.content).toString();
  }
}

/**
 * Turns a resolved request into exactly what will be sent — pure, so the
 * runner can record it (and reports can show it) even when the network call
 * itself fails afterwards.
 */
export function prepareRequest(request: ResolvedRequest): PreparedRequest {
  const url = new URL(request.url);
  for (const [key, value] of Object.entries(request.query)) {
    url.searchParams.append(key, value);
  }

  const headers = new Headers(request.headers);
  const sensitiveHeaders = applyAuth(headers, request.auth);

  let bodyText: string | undefined;
  if (request.body && request.method !== "GET" && request.method !== "HEAD") {
    bodyText = serializeBody(headers, request.body);
  }

  const headerRecord: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerRecord[key] = value;
  });

  return {
    method: request.method,
    url: url.toString(),
    headers: headerRecord,
    bodyText,
    sensitiveHeaders,
    timeoutMs: request.timeoutMs,
  };
}

export async function executeRequest(
  prepared: PreparedRequest,
): Promise<HttpResponse> {
  const started = performance.now();
  const response = await fetch(prepared.url, {
    method: prepared.method,
    headers: prepared.headers,
    body: prepared.bodyText,
    signal: AbortSignal.timeout(prepared.timeoutMs),
    redirect: "follow",
  });
  const responseText = await response.text();
  const timeMs = performance.now() - started;

  let bodyJson: unknown | undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json") || responseText.length > 0) {
    try {
      bodyJson = JSON.parse(responseText);
    } catch {
      bodyJson = undefined;
    }
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    bodyText: responseText,
    bodyJson,
    timeMs,
  };
}
