import type {
  AssertionResult,
  HttpMethod,
  JsonResult,
  JsonSummary,
} from "@quiver/core";

export interface RequestSummary {
  relativePath: string;
  name: string;
  method: HttpMethod;
}

export interface CollectionSummary {
  /** POSIX relative dir path from the workspace root; "." when the server was started on a collection. */
  id: string;
  name: string;
  description?: string;
  environments: string[];
  folders: string[];
  requests: RequestSummary[];
  /** Set when collection.yaml failed to load; other fields are empty then. */
  error?: string;
}

export interface WorkspaceInfo {
  mode: "collection" | "workspace";
  collections: CollectionSummary[];
}

export interface ResponseInfo {
  status: number;
  statusText: string;
  timeMs: number;
  headers?: Record<string, string>;
  bodyText?: string;
  bodyJson?: unknown;
}

export interface SendResult {
  name: string;
  relativePath: string;
  method: HttpMethod;
  passed: boolean;
  error?: string;
  assertions: AssertionResult[];
  captured: Record<string, string>;
  response?: ResponseInfo;
}

export type RunEvent =
  | ({
      type: "result";
      /**
       * The report-ready form of this result, redacted server-side
       * (credential headers, captured values) — safe to put in a shareable
       * report, unlike the live fields above.
       */
      report?: JsonResult;
    } & SendResult)
  | { type: "summary"; passed: number; failed: number; durationMs: number };

/** The JsonSummary shape the server's /api/report endpoint expects. */
export type RunReportPayload = JsonSummary;

/** Folds a finished run's streamed events into a report payload; null until the summary arrives. */
export function summarizeRunEvents(events: RunEvent[]): RunReportPayload | null {
  const summary = events.find((e) => e.type === "summary");
  if (!summary || summary.type !== "summary" || summary.failed < 0) return null;
  return {
    passed: summary.passed,
    failed: summary.failed,
    durationMs: summary.durationMs,
    results: events
      .filter((e) => e.type === "result")
      .map(
        (result) =>
          // Prefer the server's redacted report entry; fall back to the
          // basic fields so an old-format stream still yields a report.
          result.report ?? {
            name: result.name,
            file: result.relativePath,
            method: result.method,
            passed: result.passed,
            error: result.error,
            status: result.response?.status,
            timeMs: result.response?.timeMs,
            assertions: result.assertions.map((a) => ({
              ok: a.ok,
              description: a.description,
              detail: a.detail,
            })),
          },
      ),
  };
}

/**
 * A collection id is always one URL segment. "." (the root collection) would
 * be normalized away by URL parsing, so it travels as the reserved "~".
 */
function collectionUrl(collectionId: string, rest = ""): string {
  const segment = collectionId === "." ? "~" : encodeURIComponent(collectionId);
  return `/api/collections/${segment}${rest}`;
}

async function checkOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // keep the status-line message
  }
  throw new Error(message);
}

async function jsonRequest(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<void> {
  await checkOk(
    await fetch(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function getWorkspace(): Promise<WorkspaceInfo> {
  const res = await checkOk(await fetch("/api/workspace"));
  return (await res.json()) as WorkspaceInfo;
}

// --- collections ---

export async function createCollection(dirName: string, name: string): Promise<void> {
  await jsonRequest("/api/collections", "POST", { dirName, name });
}

export async function renameCollection(collectionId: string, name: string): Promise<void> {
  await jsonRequest(collectionUrl(collectionId), "PATCH", { name });
}

export async function deleteCollection(collectionId: string): Promise<void> {
  await jsonRequest(collectionUrl(collectionId), "DELETE");
}

// --- requests ---

export async function getRequestFile(
  collectionId: string,
  relativePath: string,
): Promise<string> {
  const res = await checkOk(
    await fetch(collectionUrl(collectionId, `/requests/${encodeURIComponent(relativePath)}`)),
  );
  const data = (await res.json()) as { content: string };
  return data.content;
}

export async function saveRequestFile(
  collectionId: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await jsonRequest(
    collectionUrl(collectionId, `/requests/${encodeURIComponent(relativePath)}`),
    "PUT",
    { content },
  );
}

export async function renameRequest(
  collectionId: string,
  from: string,
  to: string,
): Promise<void> {
  await jsonRequest(collectionUrl(collectionId, "/requests/rename"), "POST", { from, to });
}

/** Moves a request file, possibly across collections (drag-and-drop). */
export async function moveRequest(
  fromCollection: string,
  fromPath: string,
  toCollection: string,
  toPath: string,
): Promise<void> {
  await jsonRequest("/api/requests/move", "POST", {
    fromCollection,
    fromPath,
    toCollection,
    toPath,
  });
}

export async function deleteRequest(
  collectionId: string,
  relativePath: string,
): Promise<void> {
  await jsonRequest(
    collectionUrl(collectionId, `/requests/${encodeURIComponent(relativePath)}`),
    "DELETE",
  );
}

// --- folders ---

export async function createFolder(collectionId: string, path: string): Promise<void> {
  await jsonRequest(collectionUrl(collectionId, "/folders"), "POST", { path });
}

export async function renameFolder(
  collectionId: string,
  from: string,
  to: string,
): Promise<void> {
  await jsonRequest(collectionUrl(collectionId, "/folders/rename"), "POST", { from, to });
}

export async function deleteFolder(collectionId: string, path: string): Promise<void> {
  await jsonRequest(
    collectionUrl(collectionId, `/folders/${encodeURIComponent(path)}`),
    "DELETE",
  );
}

// --- environments ---

export async function createEnvironment(collectionId: string, name: string): Promise<void> {
  await jsonRequest(collectionUrl(collectionId, "/environments"), "POST", { name });
}

export async function getEnvironment(
  collectionId: string,
  name: string,
): Promise<Record<string, string>> {
  const res = await checkOk(
    await fetch(collectionUrl(collectionId, `/environments/${encodeURIComponent(name)}`)),
  );
  const data = (await res.json()) as { variables: Record<string, string> };
  return data.variables;
}

export async function saveEnvironment(
  collectionId: string,
  name: string,
  variables: Record<string, string>,
): Promise<void> {
  await jsonRequest(
    collectionUrl(collectionId, `/environments/${encodeURIComponent(name)}`),
    "PUT",
    { variables },
  );
}

export async function renameEnvironment(
  collectionId: string,
  from: string,
  to: string,
): Promise<void> {
  await jsonRequest(collectionUrl(collectionId, "/environments/rename"), "POST", { from, to });
}

export async function deleteEnvironment(collectionId: string, name: string): Promise<void> {
  await jsonRequest(
    collectionUrl(collectionId, `/environments/${encodeURIComponent(name)}`),
    "DELETE",
  );
}

// --- send / run / report ---

export async function sendRequest(
  collectionId: string,
  relativePath: string,
  env: string | undefined,
): Promise<SendResult> {
  const res = await checkOk(
    await fetch(collectionUrl(collectionId, "/send"), {
      method: "POST",
      body: JSON.stringify({ path: relativePath, env }),
    }),
  );
  return (await res.json()) as SendResult;
}

/** Asks the server to format an already-finished run — never re-executes it. */
export async function fetchReport(
  format: "junit" | "html",
  name: string,
  summary: RunReportPayload,
): Promise<string> {
  const res = await checkOk(
    await fetch("/api/report", {
      method: "POST",
      body: JSON.stringify({ format, name, summary }),
    }),
  );
  return await res.text();
}

/** Streams NDJSON run events; onEvent fires as each request finishes. */
export async function runAll(
  collectionId: string,
  env: string | undefined,
  onEvent: (event: RunEvent) => void,
): Promise<void> {
  const res = await checkOk(
    await fetch(collectionUrl(collectionId, "/run"), {
      method: "POST",
      body: JSON.stringify({ env }),
    }),
  );
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as RunEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as RunEvent);
}
