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

export const DEFAULT_TIMEOUT_MS = 30_000;

function applyAuth(headers: Headers, auth: Auth | undefined): void {
  if (!auth || auth.type === "none") return;
  switch (auth.type) {
    case "bearer":
      headers.set("Authorization", `Bearer ${auth.token}`);
      break;
    case "basic": {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString(
        "base64",
      );
      headers.set("Authorization", `Basic ${encoded}`);
      break;
    }
    case "apikey":
      headers.set(auth.header, auth.value);
      break;
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

export async function executeRequest(
  request: ResolvedRequest,
): Promise<HttpResponse> {
  const url = new URL(request.url);
  for (const [key, value] of Object.entries(request.query)) {
    url.searchParams.append(key, value);
  }

  const headers = new Headers(request.headers);
  applyAuth(headers, request.auth);

  let bodyText: string | undefined;
  if (request.body && request.method !== "GET" && request.method !== "HEAD") {
    bodyText = serializeBody(headers, request.body);
  }

  const started = performance.now();
  const response = await fetch(url, {
    method: request.method,
    headers,
    body: bodyText,
    signal: AbortSignal.timeout(request.timeoutMs),
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
