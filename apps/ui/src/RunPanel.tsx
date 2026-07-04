import type { RunEvent } from "./api.js";
import { MethodBadge } from "./Sidebar.js";

export function RunPanel({
  events,
  onClose,
}: {
  events: RunEvent[];
  onClose: () => void;
}) {
  const results = events.filter((e) => e.type === "result");
  const summary = events.find((e) => e.type === "summary");

  return (
    <aside className="run-panel">
      <div className="panel-header">
        <strong>Run results</strong>
        <span className="spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      <ul className="run-results">
        {results.map((result) => (
          <li key={result.relativePath} className={result.passed ? "pass" : "fail"}>
            <div>
              {result.passed ? "✓" : "✗"} <MethodBadge method={result.method} />{" "}
              {result.name}
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
      </ul>
      {summary && summary.type === "summary" && (
        <div className={`run-summary ${summary.failed > 0 ? "fail" : "pass"}`}>
          {summary.failed >= 0
            ? `${summary.passed} passed, ${summary.failed} failed (${summary.durationMs} ms)`
            : "Run aborted"}
        </div>
      )}
    </aside>
  );
}
