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

/** Machine-readable output for CI pipelines and tool integrations. */
export function reportJson(summary: RunSummary): void {
  console.log(
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
}
