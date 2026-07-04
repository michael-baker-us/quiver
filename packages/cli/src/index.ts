#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import {
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
import { reportJson, reportResult, reportSummary } from "./reporter.js";

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
  .option("-r, --reporter <name>", "output format: pretty | json", "pretty")
  .option("-v, --verbose", "show passing assertions and captured variables")
  .action(
    async (
      dir: string,
      options: {
        env?: string;
        bail?: boolean;
        reporter: string;
        verbose?: boolean;
      },
    ) => {
      if (options.reporter !== "pretty" && options.reporter !== "json") {
        fail(`Unknown reporter "${options.reporter}" — use pretty or json`);
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

      if (options.reporter === "json") reportJson(summary);
      else reportSummary(summary);
      process.exit(exitCode(summary));
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

program.parseAsync().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
