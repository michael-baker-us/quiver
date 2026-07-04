import type { AssertionResult, HttpMethod } from "@quiver/core";

export interface RequestSummary {
  relativePath: string;
  name: string;
  method: HttpMethod;
}

export interface CollectionInfo {
  name: string;
  description?: string;
  environments: string[];
  requests: RequestSummary[];
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
  | ({ type: "result" } & SendResult)
  | { type: "summary"; passed: number; failed: number; durationMs: number };

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

export async function getCollection(): Promise<CollectionInfo> {
  const res = await checkOk(await fetch("/api/collection"));
  return (await res.json()) as CollectionInfo;
}

export async function getRequestFile(relativePath: string): Promise<string> {
  const res = await checkOk(
    await fetch(`/api/requests/${encodeURIComponent(relativePath)}`),
  );
  const data = (await res.json()) as { content: string };
  return data.content;
}

export async function saveRequestFile(
  relativePath: string,
  content: string,
): Promise<void> {
  await checkOk(
    await fetch(`/api/requests/${encodeURIComponent(relativePath)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  );
}

export async function sendRequest(
  relativePath: string,
  env: string | undefined,
): Promise<SendResult> {
  const res = await checkOk(
    await fetch("/api/send", {
      method: "POST",
      body: JSON.stringify({ path: relativePath, env }),
    }),
  );
  return (await res.json()) as SendResult;
}

/** Streams NDJSON run events; onEvent fires as each request finishes. */
export async function runAll(
  env: string | undefined,
  onEvent: (event: RunEvent) => void,
): Promise<void> {
  const res = await checkOk(
    await fetch("/api/run", { method: "POST", body: JSON.stringify({ env }) }),
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
