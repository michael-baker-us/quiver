import { useMemo, useState } from "react";
import type { SendResult } from "./api.js";
import { tokenizeJson } from "./jsonHighlight.js";
import { tokenizeXml } from "./xmlHighlight.js";
import { detectBodyFormat, parseCsv } from "./responseBody.js";

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

function HighlightedXml({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeXml(text), [text]);
  return (
    <pre className="body-view">
      {tokens.map((token, i) =>
        token.type === "plain" ? (
          token.text
        ) : (
          <span key={i} className={`xml-${token.type}`}>
            {token.text}
          </span>
        ),
      )}
    </pre>
  );
}

/** Rows rendered beyond the header — enough to inspect, cheap to mount. */
const CSV_PREVIEW_ROWS = 200;

function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => parseCsv(text), [text]);
  if (!rows || rows.length === 0) {
    return <pre className="body-view">{text}</pre>;
  }
  const [header = [], ...data] = rows;
  const shown = data.slice(0, CSV_PREVIEW_ROWS);
  return (
    <div className="body-view csv-view">
      <table className="csv-table">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > shown.length && (
        <div className="csv-truncated">
          Showing {shown.length} of {data.length} rows
        </div>
      )}
    </div>
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

  const contentType = Object.entries(response.headers ?? {}).find(
    ([key]) => key.toLowerCase() === "content-type",
  )?.[1];
  const format = detectBodyFormat(contentType, response.bodyJson !== undefined);
  const body =
    format === "json"
      ? JSON.stringify(response.bodyJson, null, 2)
      : (response.bodyText ?? "");
  const sizeBytes = new TextEncoder().encode(
    response.bodyText ?? (format === "json" ? body : ""),
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
        format === "json" ? (
          <HighlightedJson text={body} />
        ) : format === "xml" ? (
          <HighlightedXml text={body} />
        ) : format === "csv" ? (
          <CsvTable text={body} />
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
