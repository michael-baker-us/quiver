import pc from "picocolors";
import type { RequestResult, RunSummary } from "@quiver/core";

export function reportResult(result: RequestResult, verbose: boolean): void {
  const name = result.request.definition.name ?? result.request.relativePath;
  const method = result.request.definition.method;

  if (result.error) {
    console.log(`${pc.red("✗")} ${pc.bold(name)} ${pc.dim(method)}`);
    console.log(`    ${pc.red(result.error)}`);
    return;
  }

  const status = result.response
    ? pc.dim(
        `${result.response.status} · ${Math.round(result.response.timeMs)}ms`,
      )
    : "";
  const mark = result.passed ? pc.green("✓") : pc.red("✗");
  console.log(`${mark} ${pc.bold(name)} ${pc.dim(method)} ${status}`);

  for (const assertion of result.assertions) {
    if (assertion.ok && !verbose) continue;
    const assertMark = assertion.ok ? pc.green("  ✓") : pc.red("  ✗");
    const detail = assertion.detail ? pc.dim(` — ${assertion.detail}`) : "";
    console.log(`${assertMark} ${assertion.description}${detail}`);
  }

  if (verbose && result.response) {
    const captured = Object.entries(result.captured);
    if (captured.length > 0) {
      for (const [key, value] of captured) {
        console.log(pc.dim(`    captured ${key} = ${value}`));
      }
    }
  }
}

export function reportSummary(summary: RunSummary): void {
  const parts = [pc.green(`${summary.passed} passed`)];
  if (summary.failed > 0) parts.push(pc.red(`${summary.failed} failed`));
  console.log(
    `\n${parts.join(", ")} ${pc.dim(`(${Math.round(summary.durationMs)}ms)`)}`,
  );
}

export interface JsonAssertion {
  ok: boolean;
  description: string;
  detail?: string;
}

export interface JsonResult {
  name: string;
  file: string;
  method: string;
  passed: boolean;
  error?: string;
  status?: number;
  timeMs?: number;
  assertions: JsonAssertion[];
}

export interface JsonSummary {
  passed: number;
  failed: number;
  durationMs: number;
  results: JsonResult[];
}

/**
 * Denormalizes a RunSummary into the plain JSON shape used by
 * `--reporter json`, and reused as the input format for `quiver report`
 * (junit/html generated from a previously saved JSON run) and the GitHub
 * Action, so a collection only ever has to be executed once per CI run.
 */
export function toJsonSummary(summary: RunSummary): JsonSummary {
  return {
    passed: summary.passed,
    failed: summary.failed,
    durationMs: Math.round(summary.durationMs),
    results: summary.results.map((result) => ({
      name: result.request.definition.name ?? result.request.relativePath,
      file: result.request.relativePath,
      method: result.request.definition.method,
      passed: result.passed,
      error: result.error,
      status: result.response?.status,
      timeMs: result.response ? Math.round(result.response.timeMs) : undefined,
      assertions: result.assertions.map((a) => ({
        ok: a.ok,
        description: a.description,
        detail: a.detail,
      })),
    })),
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface JunitCase {
  classname: string;
  name: string;
  timeSec: number;
  failureMessage?: string;
}

function buildJunitCases(data: JsonSummary): JunitCase[] {
  const cases: JunitCase[] = [];
  for (const result of data.results) {
    const timeSec = (result.timeMs ?? 0) / 1000;
    if (result.error) {
      cases.push({ classname: result.file, name: result.name, timeSec, failureMessage: result.error });
      continue;
    }
    if (result.assertions.length === 0) {
      // Still represent the request even with no assertions defined, so it
      // isn't invisible in the JUnit viewer.
      cases.push({ classname: result.file, name: `${result.name} (request sent)`, timeSec });
      continue;
    }
    for (const assertion of result.assertions) {
      cases.push({
        classname: result.file,
        name: `${result.name} ➜ ${assertion.description}`,
        timeSec,
        failureMessage: assertion.ok ? undefined : (assertion.detail ?? "assertion failed"),
      });
    }
  }
  return cases;
}

/** Converts a run into JUnit XML (one testcase per assertion) for Jenkins/GitLab/GitHub. */
export function buildJunitXml(data: JsonSummary): string {
  const cases = buildJunitCases(data);
  const failures = cases.filter((c) => c.failureMessage !== undefined).length;
  const totalTime = (data.durationMs / 1000).toFixed(3);
  const body = cases
    .map((c) => {
      const attrs = `classname="${escapeXml(c.classname)}" name="${escapeXml(c.name)}" time="${c.timeSec.toFixed(3)}"`;
      if (c.failureMessage === undefined) return `    <testcase ${attrs} />`;
      return [
        `    <testcase ${attrs}>`,
        `      <failure message="${escapeXml(c.failureMessage)}" />`,
        `    </testcase>`,
      ].join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="quiver" tests="${cases.length}" failures="${failures}" time="${totalTime}">`,
    `  <testsuite name="quiver" tests="${cases.length}" failures="${failures}" time="${totalTime}">`,
    body,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Builds a single self-contained HTML file — no external assets — for CI artifacts. */
export function buildHtmlReport(data: JsonSummary, collectionName: string): string {
  const rows = data.results
    .map((result) => {
      const badge = result.passed ? "PASS" : "FAIL";
      const color = result.passed ? "#17803d" : "#c02b2b";
      const assertionRows = result.assertions
        .map(
          (a) =>
            `<li class="${a.ok ? "pass" : "fail"}">${a.ok ? "✓" : "✗"} ${escapeHtml(a.description)}${
              a.detail ? ` — ${escapeHtml(a.detail)}` : ""
            }</li>`,
        )
        .join("");
      const errorLine = result.error ? `<p class="error">${escapeHtml(result.error)}</p>` : "";
      const meta =
        result.status !== undefined
          ? `<span class="meta">${result.status} · ${result.timeMs}ms</span>`
          : "";
      return `      <details${result.passed ? "" : " open"}>
        <summary style="color:${color}"><strong>${badge}</strong> ${escapeHtml(result.method)} ${escapeHtml(result.name)}${meta}</summary>
        ${errorLine}
        <ul class="assertions">${assertionRows}</ul>
      </details>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(collectionName)} — quiver report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 800px; color: #1c2430; }
  h1 { margin-bottom: 0.2rem; }
  .summary { color: #66707d; margin-bottom: 1.5rem; }
  .summary .pass { color: #17803d; font-weight: 700; }
  .summary .fail { color: #c02b2b; font-weight: 700; }
  details { border: 1px solid #dfe3e8; border-radius: 6px; margin-bottom: 0.5rem; padding: 0.5rem 0.8rem; }
  summary { cursor: pointer; }
  summary .meta { color: #66707d; font-weight: 400; margin-left: 0.5rem; font-size: 0.85em; }
  .assertions { list-style: none; margin: 0.5rem 0 0; padding: 0; font-size: 0.9em; }
  .assertions li.pass { color: #17803d; }
  .assertions li.fail { color: #c02b2b; }
  .error { color: #c02b2b; }
</style>
</head>
<body>
  <h1>${escapeHtml(collectionName)}</h1>
  <p class="summary">
    <span class="pass">${data.passed} passed</span>, <span class="fail">${data.failed} failed</span>
    (${data.durationMs}ms)
  </p>
${rows}
</body>
</html>
`;
}
