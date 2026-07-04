import {
  REPORT_BODY_LIMIT,
  type JsonRequestDetail,
  type JsonResponseDetail,
  type JsonResult,
  type JsonSummary,
} from "./report.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBytes(length: number): string {
  if (length < 1024) return `${length} B`;
  return `${(length / 1024).toFixed(1)} KB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function statusClass(status: number): string {
  if (status < 300) return "s-ok";
  if (status < 400) return "s-redirect";
  if (status < 500) return "s-warn";
  return "s-err";
}

/** Re-indents a JSON body for readability; anything else passes through. */
function displayBody(body: string, truncated: boolean): string {
  if (truncated) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function headersSection(headers: Record<string, string>): string {
  const entries = Object.entries(headers);
  if (entries.length === 0) return "";
  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<details class="sub"><summary>Headers <span class="sub-meta">${entries.length}</span></summary><table class="headers"><tbody>${rows}</tbody></table></details>`;
}

function bodySection(
  detail: { body?: string; bodyTruncated?: boolean },
  open: boolean,
): string {
  if (detail.body === undefined) return "";
  const truncated = detail.bodyTruncated === true;
  const size = formatBytes(detail.body.length) + (truncated ? "+" : "");
  const note = truncated
    ? `<p class="trunc-note">Only the first ${REPORT_BODY_LIMIT.toLocaleString("en-US")} characters are included in this report.</p>`
    : "";
  return `<details class="sub"${open ? " open" : ""}><summary>Body <span class="sub-meta">${size}</span></summary>
${note}<pre>${escapeHtml(displayBody(detail.body, truncated))}</pre></details>`;
}

function requestSection(method: string, request: JsonRequestDetail): string {
  return `<section>
<h2>Request sent</h2>
<p class="url-line"><b>${escapeHtml(method)}</b> <code>${escapeHtml(request.url)}</code></p>
${headersSection(request.headers)}
${bodySection(request, false)}
</section>`;
}

function responseSection(result: JsonResult): string {
  const response = result.response;
  if (!response) return "";
  const statusText = [result.status, response.statusText]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
  const meta = [
    result.status !== undefined
      ? `<span class="status ${statusClass(result.status)}">${escapeHtml(statusText)}</span>`
      : "",
    result.timeMs !== undefined ? `${formatDuration(result.timeMs)}` : "",
    response.body !== undefined ? formatBytes(response.body.length) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<section>
<h2>Response</h2>
<p class="url-line">${meta}</p>
${headersSection(response.headers)}
${bodySection(response, !result.passed)}
</section>`;
}

function checksSection(result: JsonResult): string {
  if (result.assertions.length === 0) {
    return `<section><h2>Checks</h2><p class="muted">No checks are defined for this request — it counts as passed as long as it gets any response.</p></section>`;
  }
  const items = result.assertions
    .map(
      (a) =>
        `<li class="${a.ok ? "pass" : "fail"}"><span class="mark">${a.ok ? "✓" : "✗"}</span> ${escapeHtml(a.description)}${
          a.detail ? `<span class="detail"> — ${escapeHtml(a.detail)}</span>` : ""
        }</li>`,
    )
    .join("");
  return `<section><h2>Checks</h2><ul class="checks">${items}</ul></section>`;
}

function resultCard(result: JsonResult): string {
  const stateClass = result.passed ? "pass" : "fail";
  const errorBox = result.error
    ? `<div class="error-box"><b>The request could not be completed.</b> ${escapeHtml(result.error)}</div>`
    : "";
  const statusPill =
    result.status !== undefined
      ? `<span class="status ${statusClass(result.status)}">${result.status}</span>`
      : "";
  const time = result.timeMs !== undefined ? `<span class="time">${formatDuration(result.timeMs)}</span>` : "";
  return `<details class="result ${stateClass}"${result.passed ? "" : " open"}>
<summary><span class="chev">▸</span><span class="pill ${stateClass}">${result.passed ? "PASS" : "FAIL"}</span><span class="method m-${escapeHtml(result.method.toLowerCase())}">${escapeHtml(result.method)}</span><span class="name">${escapeHtml(result.name)}</span><span class="file">${escapeHtml(result.file)}</span><span class="grow"></span>${statusPill}${time}</summary>
<div class="result-detail">
${errorBox}
${checksSection(result)}
${result.request ? requestSection(result.method, result.request) : ""}
${responseSection(result)}
</div>
</details>`;
}

const REPORT_STYLES = `
:root {
  --ink: #1c2430; --muted: #66707d; --line: #e3e7ec; --bg: #f4f5f7; --card: #ffffff;
  --green: #17803d; --green-bg: #e6f4ea; --red: #c02b2b; --red-bg: #fbeaea;
  --amber: #b45309; --amber-bg: #fdf3e3; --blue: #1d4ed8; --blue-bg: #e8eefc;
  --purple: #7c3aed; --purple-bg: #f1eafd; --accent: #4f46e5;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
.wrap { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
.brand { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; margin: 0; }
h1 { margin: 0.1rem 0 0.2rem; font-size: 1.6rem; }
.generated { color: var(--muted); margin: 0 0 1.25rem; font-size: 0.9rem; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 0.8rem 1rem; }
.stat .num { display: block; font-size: 1.6rem; font-weight: 700; }
.stat .label { color: var(--muted); font-size: 0.85rem; }
.stat.good .num { color: var(--green); }
.stat.bad .num { color: var(--red); }
.bar { height: 8px; border-radius: 4px; background: var(--red); overflow: hidden; margin: 1rem 0 0.5rem; }
.bar span { display: block; height: 100%; background: var(--green); }
.verdict { border-radius: 10px; padding: 0.7rem 1rem; margin: 0.75rem 0 0; font-weight: 600; }
.verdict.good { background: var(--green-bg); color: var(--green); }
.verdict.bad { background: var(--red-bg); color: var(--red); }
.toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin: 1.25rem 0 0.75rem; }
.toolbar button { font: inherit; font-size: 0.85rem; padding: 0.35rem 0.8rem; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
.toolbar button:hover { border-color: var(--accent); }
.toolbar button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.toolbar .plain { border-radius: 8px; }
details.result { background: var(--card); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 0.6rem; }
details.result > summary { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; padding: 0.65rem 0.9rem; cursor: pointer; list-style: none; }
details.result > summary::-webkit-details-marker { display: none; }
.chev { color: var(--muted); font-size: 0.75rem; transition: transform 0.12s; }
details[open] > summary .chev { transform: rotate(90deg); }
.pill { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; padding: 0.15rem 0.5rem; border-radius: 999px; }
.pill.pass { background: var(--green-bg); color: var(--green); }
.pill.fail { background: var(--red-bg); color: var(--red); }
.method { font-family: var(--mono); font-size: 0.72rem; font-weight: 700; padding: 0.12rem 0.4rem; border-radius: 5px; color: var(--muted); background: var(--bg); }
.m-get { color: var(--green); background: var(--green-bg); }
.m-post { color: var(--amber); background: var(--amber-bg); }
.m-put { color: var(--blue); background: var(--blue-bg); }
.m-patch { color: var(--purple); background: var(--purple-bg); }
.m-delete { color: var(--red); background: var(--red-bg); }
.name { font-weight: 600; }
.file { font-family: var(--mono); font-size: 0.72rem; color: var(--muted); }
.grow { flex: 1; }
.status { font-family: var(--mono); font-size: 0.75rem; font-weight: 700; padding: 0.12rem 0.45rem; border-radius: 5px; }
.s-ok { color: var(--green); background: var(--green-bg); }
.s-redirect { color: var(--blue); background: var(--blue-bg); }
.s-warn { color: var(--amber); background: var(--amber-bg); }
.s-err { color: var(--red); background: var(--red-bg); }
.time { color: var(--muted); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.result-detail { border-top: 1px solid var(--line); padding: 0.9rem 1rem 1.1rem; display: grid; gap: 1rem; }
.result-detail h2 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 0.4rem; }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; font-size: 0.9rem; }
.checks .mark { font-weight: 700; }
.checks li.pass .mark { color: var(--green); }
.checks li.fail { color: var(--red); }
.checks .detail { color: var(--muted); }
.checks li.fail .detail { color: inherit; }
.url-line { margin: 0 0 0.5rem; font-size: 0.9rem; overflow-wrap: anywhere; }
.url-line code { font-family: var(--mono); font-size: 0.82rem; }
.error-box { background: var(--red-bg); border: 1px solid #efc6c6; color: var(--red); border-radius: 8px; padding: 0.7rem 0.9rem; font-size: 0.9rem; }
details.sub { border: 1px solid var(--line); border-radius: 8px; margin-top: 0.4rem; overflow: hidden; }
details.sub > summary { padding: 0.4rem 0.7rem; cursor: pointer; font-size: 0.83rem; background: #fafbfc; list-style: none; }
details.sub > summary::-webkit-details-marker { display: none; }
details.sub[open] > summary { border-bottom: 1px solid var(--line); }
.sub-meta { color: var(--muted); font-size: 0.75rem; margin-left: 0.3rem; }
table.headers { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
table.headers th, table.headers td { text-align: left; vertical-align: top; padding: 0.3rem 0.7rem; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
table.headers tr:first-child th, table.headers tr:first-child td { border-top: none; }
table.headers th { font-family: var(--mono); font-weight: 500; color: var(--muted); white-space: nowrap; width: 1%; }
pre { margin: 0; padding: 0.7rem 0.9rem; font-family: var(--mono); font-size: 0.78rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; overflow: auto; max-height: 420px; }
.trunc-note { margin: 0; padding: 0.4rem 0.9rem 0; color: var(--amber); font-size: 0.78rem; }
.muted { color: var(--muted); font-size: 0.9rem; margin: 0; }
footer { margin-top: 2rem; color: var(--muted); font-size: 0.8rem; }
body[data-filter="fail"] details.result.pass { display: none; }
body[data-filter="pass"] details.result.fail { display: none; }
@media print { .toolbar { display: none; } }
`;

const REPORT_SCRIPT = `
(function () {
  var filters = document.querySelectorAll(".toolbar [data-filter]");
  filters.forEach(function (button) {
    button.addEventListener("click", function () {
      document.body.setAttribute("data-filter", button.getAttribute("data-filter"));
      filters.forEach(function (other) {
        other.classList.toggle("active", other === button);
      });
    });
  });
  function setAll(open) {
    document.querySelectorAll("details.result").forEach(function (card) {
      card.open = open;
    });
  }
  document.getElementById("expand-all").addEventListener("click", function () { setAll(true); });
  document.getElementById("collapse-all").addEventListener("click", function () { setAll(false); });
})();
`;

/**
 * Builds a single self-contained HTML file (inline styles/script, no
 * external assets) meant to be attached to a ticket or emailed. Written for
 * readers who never open a terminal: each request is a card that expands
 * into its checks and the full request/response exchange. Secrets never
 * appear — credential headers and captured values are removed upstream in
 * toJsonResult.
 */
export function buildHtmlReport(data: JsonSummary, collectionName: string): string {
  const total = data.results.length;
  const passPercent = total === 0 ? 100 : (data.passed / total) * 100;
  const verdict =
    data.failed === 0
      ? `<p class="verdict good">✓ Everything passed. All ${total} request${total === 1 ? "" : "s"} behaved as expected.</p>`
      : `<p class="verdict bad">✗ ${data.failed} of ${total} request${total === 1 ? "" : "s"} failed — expanded below. Open one to see exactly what was sent and what came back.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(collectionName)} — quiver report</title>
<style>${REPORT_STYLES}</style>
</head>
<body data-filter="all">
<div class="wrap">
<header>
<p class="brand">quiver run report</p>
<h1>${escapeHtml(collectionName)}</h1>
<p class="generated">Generated ${new Date().toUTCString()}</p>
</header>
<section class="stats">
<div class="stat"><span class="num">${total}</span><span class="label">requests</span></div>
<div class="stat good"><span class="num">${data.passed}</span><span class="label">passed</span></div>
<div class="stat bad"><span class="num">${data.failed}</span><span class="label">failed</span></div>
<div class="stat"><span class="num">${formatDuration(data.durationMs)}</span><span class="label">total time</span></div>
</section>
<div class="bar"><span style="width:${passPercent.toFixed(1)}%"></span></div>
${verdict}
<div class="toolbar">
<div>
<button type="button" data-filter="all" class="active">All (${total})</button>
<button type="button" data-filter="fail">Failed (${data.failed})</button>
<button type="button" data-filter="pass">Passed (${data.passed})</button>
</div>
<div>
<button type="button" class="plain" id="expand-all">Expand all</button>
<button type="button" class="plain" id="collapse-all">Collapse all</button>
</div>
</div>
<main>
${data.results.map(resultCard).join("\n")}
</main>
<footer>Generated by quiver. Credential headers and captured values are redacted automatically, so this file is safe to share.</footer>
</div>
<script>${REPORT_SCRIPT}</script>
</body>
</html>
`;
}
