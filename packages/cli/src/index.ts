#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { startUiServer } from "@quiver/server";
import {
  exportK6,
  findCollectionRoot,
  importOpenApi,
  listEnvironments,
  loadCollection,
  loadEnvironment,
  loadOpenApiFile,
  loadRequestFile,
  runCollection,
  runRequest,
  type RunSummary,
} from "@quiver/core";
import {
  buildHtmlReport,
  buildJunitXml,
  reportResult,
  reportSummary,
  toJsonSummary,
  type JsonSummary,
} from "./reporter.js";

const BATCH_REPORTERS = ["json", "junit", "html"] as const;
type BatchReporter = (typeof BATCH_REPORTERS)[number];

function formatSummary(
  reporter: BatchReporter,
  summary: RunSummary,
  collectionName: string,
): string {
  const data = toJsonSummary(summary);
  if (reporter === "json") return JSON.stringify(data, null, 2);
  if (reporter === "junit") return buildJunitXml(data);
  return buildHtmlReport(data, collectionName);
}

const program = new Command();

program
  .name("quiver")
  .description("Git-friendly API client and collection runner")
  .version("0.1.0");

async function resolveVariables(
  rootDir: string | undefined,
  envName: string | undefined,
): Promise<Record<string, string>> {
  if (!envName) return {};
  if (!rootDir) {
    fail(
      `--env ${envName} given, but no collection.yaml found in any parent directory`,
    );
  }
  try {
    const environment = await loadEnvironment(rootDir, envName);
    return environment.variables;
  } catch (error) {
    const available = await listEnvironments(rootDir);
    const hint =
      available.length > 0
        ? ` Available environments: ${available.join(", ")}`
        : "";
    fail(`${(error as Error).message}${hint}`);
  }
}

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(2);
}

function exitCode(summary: RunSummary): number {
  return summary.failed > 0 ? 1 : 0;
}

program
  .command("send")
  .description("Send a single request file")
  .argument("<file>", "path to a .request.yaml file")
  .option("-e, --env <name>", "environment to load variables from")
  .option("-v, --verbose", "show passing assertions and captured variables")
  .action(async (file: string, options: { env?: string; verbose?: boolean }) => {
    const request = await loadRequestFile(file);
    const rootDir = await findCollectionRoot(path.resolve(file));
    const variables = await resolveVariables(rootDir, options.env);
    const collection = rootDir
      ? (await loadCollection(rootDir)).collection
      : undefined;

    const result = await runRequest(request, variables, collection);
    reportResult(result, options.verbose ?? true);
    if (result.response) {
      const body =
        result.response.bodyJson !== undefined
          ? JSON.stringify(result.response.bodyJson, null, 2)
          : result.response.bodyText;
      console.log(`\n${body}`);
    }
    process.exit(result.passed ? 0 : 1);
  });

program
  .command("run")
  .description("Run every request in a collection directory")
  .argument("<dir>", "collection directory (contains collection.yaml)")
  .option("-e, --env <name>", "environment to load variables from")
  .option("-b, --bail", "stop at the first failing request")
  .option(
    "-r, --reporter <name>",
    "output format: pretty | json | junit | html",
    "pretty",
  )
  .option("-o, --output <file>", "write the json/junit/html report to a file instead of stdout")
  .option("-v, --verbose", "show passing assertions and captured variables")
  .action(
    async (
      dir: string,
      options: {
        env?: string;
        bail?: boolean;
        reporter: string;
        output?: string;
        verbose?: boolean;
      },
    ) => {
      const isBatchReporter = (r: string): r is BatchReporter =>
        (BATCH_REPORTERS as readonly string[]).includes(r);
      if (options.reporter !== "pretty" && !isBatchReporter(options.reporter)) {
        fail(`Unknown reporter "${options.reporter}" — use pretty, ${BATCH_REPORTERS.join(", ")}`);
      }
      if (options.output && options.reporter === "pretty") {
        fail(`--output requires --reporter ${BATCH_REPORTERS.join(", ")}`);
      }
      const loaded = await loadCollection(dir);
      const variables = await resolveVariables(loaded.rootDir, options.env);

      if (options.reporter === "pretty") {
        console.log(pc.bold(`\n${loaded.collection.name}\n`));
      }
      const summary = await runCollection(loaded, {
        variables,
        bail: options.bail,
        onResult:
          options.reporter === "pretty"
            ? (result) => reportResult(result, options.verbose ?? false)
            : undefined,
      });

      if (options.reporter === "pretty") {
        reportSummary(summary);
      } else if (isBatchReporter(options.reporter)) {
        const text = formatSummary(options.reporter, summary, loaded.collection.name);
        if (options.output) {
          await writeFile(options.output, text);
          console.error(pc.dim(`Wrote ${options.reporter} report to ${options.output}`));
        } else {
          console.log(text);
        }
      }
      process.exit(exitCode(summary));
    },
  );

program
  .command("report")
  .description("Reformat a saved `quiver run --reporter json` file as junit or html")
  .argument("<file>", "JSON file produced by quiver run --reporter json")
  .requiredOption("-f, --format <format>", "junit | html")
  .option("-o, --output <file>", "write to a file instead of stdout")
  .option("-n, --name <name>", "collection name shown in the html report title", "quiver run")
  .action(async (file: string, options: { format: string; output?: string; name: string }) => {
    if (options.format !== "junit" && options.format !== "html") {
      fail(`Unknown format "${options.format}" — use junit or html`);
    }
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      return fail(`${file} not found or unreadable`);
    }
    let data: JsonSummary;
    try {
      data = JSON.parse(raw) as JsonSummary;
    } catch {
      return fail(`${file} is not valid JSON`);
    }
    if (typeof data.passed !== "number" || !Array.isArray(data.results)) {
      fail(`${file} doesn't look like a quiver JSON run report`);
    }
    const text = options.format === "junit" ? buildJunitXml(data) : buildHtmlReport(data, options.name);
    if (options.output) {
      await writeFile(options.output, text);
      console.log(`Wrote ${options.format} report to ${options.output}`);
    } else {
      console.log(text);
    }
  });

program
  .command("export-k6")
  .description("Generate a k6 load-testing script from a collection")
  .argument("<dir>", "collection directory (contains collection.yaml)")
  .requiredOption("-o, --out <file>", "path to write the generated script")
  .option("-e, --env <name>", "environment to resolve {{variables}} from at export time")
  .option("--vus <n>", "virtual users", "10")
  .option("--duration <duration>", "k6 duration string, e.g. 30s, 5m", "30s")
  .action(
    async (
      dir: string,
      options: { out: string; env?: string; vus: string; duration: string },
    ) => {
      const loaded = await loadCollection(dir);
      const variables = await resolveVariables(loaded.rootDir, options.env);
      const vus = Number(options.vus);
      if (!Number.isFinite(vus) || vus <= 0) fail(`--vus must be a positive number`);
      const script = exportK6(loaded, variables, { vus, duration: options.duration });
      await writeFile(options.out, script);
      console.log(`Wrote k6 script to ${options.out}`);
      console.log(pc.dim(`\nRun it with: k6 run ${options.out}`));
    },
  );

program
  .command("list")
  .description("List the requests and environments in a collection")
  .argument("<dir>", "collection directory")
  .action(async (dir: string) => {
    const loaded = await loadCollection(dir);
    console.log(pc.bold(loaded.collection.name));
    for (const request of loaded.requests) {
      const name = request.definition.name ?? request.relativePath;
      console.log(
        `  ${pc.dim(request.definition.method.padEnd(6))} ${name} ${pc.dim(request.relativePath)}`,
      );
    }
    const environments = await listEnvironments(loaded.rootDir);
    if (environments.length > 0) {
      console.log(`\nEnvironments: ${environments.join(", ")}`);
    }
  });

program
  .command("import")
  .description("Generate a collection from an OpenAPI 3.x spec")
  .argument("<spec>", "path to an OpenAPI YAML or JSON file")
  .requiredOption("-o, --out <dir>", "directory to create the collection in")
  .option("-f, --force", "write into a non-empty directory")
  .action(
    async (specPath: string, options: { out: string; force?: boolean }) => {
      const spec = await loadOpenApiFile(specPath);
      const result = importOpenApi(spec);

      await mkdir(options.out, { recursive: true });
      const existing = await readdir(options.out);
      if (existing.length > 0 && !options.force) {
        fail(`${options.out} is not empty — use --force to write anyway`);
      }

      for (const [relativePath, content] of result.files) {
        const target = path.join(options.out, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
        console.log(`  ${pc.green("created")} ${target}`);
      }
      console.log(
        `\nImported ${pc.bold(result.collectionName)}: ${result.files.size - 2} requests`,
      );
      for (const warning of result.warnings) {
        console.log(pc.yellow(`  warning: ${warning}`));
      }
      console.log(
        pc.dim(
          `\nNext: review ${path.join(options.out, "environments/default.yaml")}, then run:\n  quiver run ${options.out} --env default`,
        ),
      );
    },
  );

program
  .command("ui")
  .description("Open the collection in the local web UI")
  .argument("<dir>", "collection directory (contains collection.yaml)")
  .option("-p, --port <port>", "port to listen on", "4123")
  .option("--no-open", "do not open the browser automatically")
  .action(async (dir: string, options: { port: string; open: boolean }) => {
    await loadCollection(dir); // fail fast on a broken collection
    const { url } = await startUiServer({
      rootDir: dir,
      port: Number(options.port),
    });
    console.log(`quiver ui running at ${pc.bold(url)} — Ctrl-C to stop`);
    if (options.open) {
      const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      spawn(opener, [url], { stdio: "ignore", detached: true }).on(
        "error",
        () => {},
      );
    }
  });

program.parseAsync().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
