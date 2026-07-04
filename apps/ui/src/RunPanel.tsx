import { useState } from "react";
import { fetchReport, summarizeRunEvents, type RunEvent } from "./api.js";
import { MethodBadge } from "./Sidebar.js";

function triggerDownload(filename: string, text: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RunPanel({
  events,
  running,
  collectionName,
  onClose,
}: {
  events: RunEvent[];
  running: boolean;
  collectionName: string;
  onClose: () => void;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const results = events.filter((e) => e.type === "result");
  const summary = events.find((e) => e.type === "summary");
  const reportPayload = running ? null : summarizeRunEvents(events);

  async function download(format: "junit" | "html") {
    if (!reportPayload) return;
    setDownloadError(null);
    try {
      const text = await fetchReport(format, collectionName, reportPayload);
      if (format === "junit") {
        triggerDownload("quiver-results.xml", text, "application/xml");
      } else {
        triggerDownload("quiver-report.html", text, "text/html");
      }
    } catch (error) {
      setDownloadError((error as Error).message);
    }
  }

  return (
    <aside className="run-panel">
      <div className="panel-header">
        <strong>Run results</strong>
        <span className="spacer" />
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <ul className="run-results">
        {results.map((result) => (
          <li key={result.relativePath} className={result.passed ? "pass" : "fail"}>
            <div className="result-name">
              <MethodBadge method={result.method} /> {result.name}
              {result.response && (
                <span className="time">
                  {" "}
                  {result.response.status} · {result.response.timeMs} ms
                </span>
              )}
            </div>
            {result.error && <div className="detail">{result.error}</div>}
            {!result.passed &&
              result.assertions
                .filter((a) => !a.ok)
                .map((a, i) => (
                  <div key={i} className="detail">
                    ✗ {a.description}
                    {a.detail ? ` — ${a.detail}` : ""}
                  </div>
                ))}
          </li>
        ))}
        {running && <li className="run-running">Running…</li>}
      </ul>
      {summary && summary.type === "summary" && (
        <div className={`run-summary ${summary.failed > 0 ? "fail" : "pass"}`}>
          {summary.failed >= 0
            ? `${summary.passed} passed, ${summary.failed} failed (${summary.durationMs} ms)`
            : "Run aborted"}
        </div>
      )}
      {reportPayload && (
        <div className="run-downloads">
          <span className="hint">Download report:</span>
          <button onClick={() => void download("junit")}>JUnit XML</button>
          <button onClick={() => void download("html")}>HTML</button>
        </div>
      )}
      {downloadError && <div className="problem" style={{ margin: 0 }}>{downloadError}</div>}
    </aside>
  );
}
