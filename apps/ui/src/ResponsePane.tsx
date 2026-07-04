import { useState } from "react";
import type { SendResult } from "./api.js";

function StatusPill({ status, statusText }: { status: number; statusText: string }) {
  const kind = status < 300 ? "ok" : status < 500 ? "warn" : "err";
  return (
    <span className={`status-pill status-${kind}`}>
      {status} {statusText}
    </span>
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
        <div className="problem">{result.error}</div>
      </div>
    );
  }
  if (!result.response) return null;
  const response = result.response;

  const body =
    response.bodyJson !== undefined
      ? JSON.stringify(response.bodyJson, null, 2)
      : (response.bodyText ?? "");

  return (
    <div className="response">
      <div className="response-meta">
        <StatusPill status={response.status} statusText={response.statusText} />
        <span className="time">{response.timeMs} ms</span>
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
        </button>
      </div>
      {tab === "body" ? (
        <pre className="body-view">{body}</pre>
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
