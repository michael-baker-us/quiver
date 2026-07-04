import { useMemo, useState } from "react";
import type { SendResult } from "./api.js";
import { tokenizeJson } from "./jsonHighlight.js";

function StatusPill({ status, statusText }: { status: number; statusText: string }) {
  const kind = status < 300 ? "ok" : status < 500 ? "warn" : "err";
  return (
    <span className={`status-pill status-${kind}`}>
      {status} {statusText}
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function HighlightedJson({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeJson(text), [text]);
  return (
    <pre className="body-view">
      {tokens.map((token, i) =>
        token.type === "plain" ? (
          token.text
        ) : (
          <span key={i} className={`json-${token.type}`}>
            {token.text}
          </span>
        ),
      )}
    </pre>
  );
}

export function AssertionList({ result }: { result: SendResult }) {
  if (result.assertions.length === 0) return null;
  return (
    <ul className="assertions">
      {result.assertions.map((assertion, i) => (
        <li key={i} className={assertion.ok ? "pass" : "fail"}>
          {assertion.ok ? "✓" : "✗"} {assertion.description}
          {assertion.detail && <span className="detail"> — {assertion.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ResponsePane({ result }: { result: SendResult }) {
  const [tab, setTab] = useState<"body" | "headers">("body");

  if (result.error) {
    return (
      <div className="response">
        <div className="problem" style={{ margin: 0 }}>{result.error}</div>
      </div>
    );
  }
  if (!result.response) return null;
  const response = result.response;

  const isJson = response.bodyJson !== undefined;
  const body = isJson
    ? JSON.stringify(response.bodyJson, null, 2)
    : (response.bodyText ?? "");
  const sizeBytes = new TextEncoder().encode(
    response.bodyText ?? (isJson ? body : ""),
  ).length;

  return (
    <div className="response">
      <div className="response-meta">
        <span className="response-label">Response</span>
        <StatusPill status={response.status} statusText={response.statusText} />
        <span className="meta-stat">{response.timeMs} ms</span>
        <span className="meta-stat">{formatSize(sizeBytes)}</span>
        {Object.entries(result.captured).map(([key, value]) => (
          <span key={key} className="captured" title="Captured variable">
            {key} = {value}
          </span>
        ))}
      </div>
      <AssertionList result={result} />
      <div className="tabs">
        <button
          className={tab === "body" ? "active" : undefined}
          onClick={() => setTab("body")}
        >
          Body
        </button>
        <button
          className={tab === "headers" ? "active" : undefined}
          onClick={() => setTab("headers")}
        >
          Headers
          <span className="tab-count">
            {Object.keys(response.headers ?? {}).length}
          </span>
        </button>
      </div>
      {tab === "body" ? (
        isJson ? (
          <HighlightedJson text={body} />
        ) : (
          <pre className="body-view">{body}</pre>
        )
      ) : (
        <pre className="body-view">
          {Object.entries(response.headers ?? {})
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n")}
        </pre>
      )}
    </div>
  );
}
