import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import {
  collectionFileSchema,
  environmentFileSchema,
  requestFileSchema,
  type CollectionDefinition,
  type EnvironmentDefinition,
  type RequestDefinition,
} from "./schema.js";

export const COLLECTION_FILENAME = "collection.yaml";
export const REQUEST_SUFFIX = ".request.yaml";
export const ENVIRONMENTS_DIRNAME = "environments";

export class CollectionFormatError extends Error {
  constructor(
    public readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "CollectionFormatError";
  }
}

export interface LoadedRequest {
  /** Absolute path of the request file. */
  filePath: string;
  /** Path relative to the collection root, used for display and ordering. */
  relativePath: string;
  definition: RequestDefinition;
}

export interface LoadedCollection {
  rootDir: string;
  collection: CollectionDefinition;
  requests: LoadedRequest[];
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${where}: ${issue.message}`;
    })
    .join("; ");
}

async function loadYamlFile<T>(
  filePath: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw new CollectionFormatError(filePath, "file not found or unreadable");
  }
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (error) {
    throw new CollectionFormatError(
      filePath,
      `invalid YAML — ${(error as Error).message}`,
    );
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new CollectionFormatError(filePath, formatZodError(result.error));
  }
  return result.data;
}

export async function loadRequestFile(filePath: string): Promise<LoadedRequest> {
  const definition = await loadYamlFile(filePath, requestFileSchema);
  return {
    filePath: path.resolve(filePath),
    relativePath: path.basename(filePath),
    definition,
  };
}

/**
 * Walks up from `startPath` looking for a directory containing
 * collection.yaml. Returns undefined when none is found.
 */
export async function findCollectionRoot(
  startPath: string,
): Promise<string | undefined> {
  let dir = path.resolve(startPath);
  if ((await stat(dir)).isFile()) dir = path.dirname(dir);
  while (true) {
    try {
      await stat(path.join(dir, COLLECTION_FILENAME));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }
}

async function collectRequestFiles(dir: string, rootDir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ENVIRONMENTS_DIRNAME && dir === rootDir) continue;
      if (entry.name.startsWith(".")) continue;
      files.push(...(await collectRequestFiles(fullPath, rootDir)));
    } else if (entry.name.endsWith(REQUEST_SUFFIX)) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Loads a collection directory: collection.yaml plus every *.request.yaml
 * beneath it. Requests run in path order (alphabetical within each
 * directory), so numeric prefixes like `01-login.request.yaml` control
 * sequencing.
 */
export async function loadCollection(rootDir: string): Promise<LoadedCollection> {
  const resolvedRoot = path.resolve(rootDir);
  const collection = await loadYamlFile(
    path.join(resolvedRoot, COLLECTION_FILENAME),
    collectionFileSchema,
  );
  const files = await collectRequestFiles(resolvedRoot, resolvedRoot);
  const requests = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      relativePath: path.relative(resolvedRoot, filePath),
      definition: await loadYamlFile(filePath, requestFileSchema),
    })),
  );
  return { rootDir: resolvedRoot, collection, requests };
}

export async function loadEnvironment(
  rootDir: string,
  name: string,
): Promise<EnvironmentDefinition> {
  return loadYamlFile(
    path.join(rootDir, ENVIRONMENTS_DIRNAME, `${name}.yaml`),
    environmentFileSchema,
  );
}

export async function listEnvironments(rootDir: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(rootDir, ENVIRONMENTS_DIRNAME));
    return entries
      .filter((name) => name.endsWith(".yaml"))
      .map((name) => name.slice(0, -".yaml".length))
      .sort();
  } catch {
    return [];
  }
}
