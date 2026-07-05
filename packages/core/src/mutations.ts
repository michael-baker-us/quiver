import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, stringify as stringifyYaml } from "yaml";
import {
  COLLECTION_FILENAME,
  ENVIRONMENTS_DIRNAME,
  REQUEST_SUFFIX,
} from "./loader.js";
import { WORKSPACE_SCAN_DEPTH } from "./workspace.js";

/**
 * All filesystem mutations a client can perform on a workspace live here, so
 * the server and any future clients share one guarded, tested implementation.
 * Every operation is an ordinary file change — recoverable via Git.
 */
export class WorkspaceMutationError extends Error {
  constructor(
    public readonly code: "invalid" | "not-found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceMutationError";
  }
}

const invalid = (message: string) => new WorkspaceMutationError("invalid", message);
const notFound = (message: string) => new WorkspaceMutationError("not-found", message);
const conflict = (message: string) => new WorkspaceMutationError("conflict", message);

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Resolves a client-supplied relative path against a root, rejecting
 * anything that could escape it. The returned path is absolute.
 */
export function resolveInside(rootDir: string, relative: string): string {
  if (relative === "" || relative.includes("\\") || path.isAbsolute(relative)) {
    throw invalid(`Invalid path: ${JSON.stringify(relative)}`);
  }
  if (relative.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw invalid(`Invalid path: ${JSON.stringify(relative)}`);
  }
  const root = path.resolve(rootDir);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) {
    throw invalid(`Path escapes the collection directory: ${relative}`);
  }
  return target;
}

function validateName(name: string, what: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw invalid(
      `${what} must start with a letter or digit and contain only letters, digits, dots, dashes, and underscores: ${JSON.stringify(name)}`,
    );
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rename guard that works on both case-sensitive and case-insensitive
 * filesystems: a target that "exists" only because it is the source under a
 * different casing (macOS APFS) is not a conflict.
 */
async function assertRenameTargetFree(fromAbs: string, toAbs: string): Promise<void> {
  if (fromAbs === toAbs) throw invalid("Source and target are the same path");
  if (!(await exists(toAbs))) return;
  if (fromAbs.toLowerCase() === toAbs.toLowerCase()) return;
  throw conflict(`Target already exists: ${toAbs}`);
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/**
 * Validates a new collection's directory name and location (depth, segment
 * names, no existing or ancestor collection), returning the absolute target
 * directory without creating it.
 */
async function prepareCollectionTarget(
  workspaceDir: string,
  dirName: string,
): Promise<string> {
  const segments = dirName.split("/");
  if (segments.length > WORKSPACE_SCAN_DEPTH) {
    throw invalid(`Collection directory can be at most ${WORKSPACE_SCAN_DEPTH} levels deep`);
  }
  for (const segment of segments) validateName(segment, "Each directory name segment");
  const target = resolveInside(workspaceDir, dirName);
  if (await exists(path.join(target, COLLECTION_FILENAME))) {
    throw conflict(`A collection already exists at ${dirName}`);
  }
  // A collection nested inside another would never show up in a workspace
  // scan (collection roots are scan leaves), so refuse to create one.
  for (let i = 1; i < segments.length; i++) {
    const ancestor = path.join(path.resolve(workspaceDir), ...segments.slice(0, i));
    if (await exists(path.join(ancestor, COLLECTION_FILENAME))) {
      throw conflict(
        `${segments.slice(0, i).join("/")} is already a collection; collections cannot be nested`,
      );
    }
  }
  return target;
}

export async function createCollection(
  workspaceDir: string,
  dirName: string,
  name: string,
): Promise<{ id: string }> {
  if (name.trim() === "") throw invalid("Collection name must not be empty");
  const target = await prepareCollectionTarget(workspaceDir, dirName);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, COLLECTION_FILENAME), stringifyYaml({ name }));
  return { id: dirName };
}

/**
 * Writes a generated collection (e.g. from the OpenAPI importer) into a new
 * directory: same guards as createCollection, then every file in one pass.
 * Paths in `files` are validated against the target dir, so untrusted spec
 * content cannot write outside it.
 */
export async function importCollectionFiles(
  workspaceDir: string,
  dirName: string,
  files: ReadonlyMap<string, string>,
): Promise<{ id: string }> {
  if (!files.has(COLLECTION_FILENAME)) {
    throw invalid(`Imported collection is missing ${COLLECTION_FILENAME}`);
  }
  const target = await prepareCollectionTarget(workspaceDir, dirName);
  for (const [relativePath, content] of files) {
    const fileTarget = resolveInside(target, relativePath);
    await mkdir(path.dirname(fileTarget), { recursive: true });
    await writeFile(fileTarget, content);
  }
  return { id: dirName };
}

/** Renames a collection's display name in place, preserving everything else in collection.yaml (comments included). */
export async function updateCollectionName(rootDir: string, name: string): Promise<void> {
  if (name.trim() === "") throw invalid("Collection name must not be empty");
  const filePath = path.join(path.resolve(rootDir), COLLECTION_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw notFound(`No ${COLLECTION_FILENAME} found in ${rootDir}`);
  }
  const doc = parseDocument(raw);
  doc.set("name", name);
  await writeFile(filePath, doc.toString());
}

export async function deleteCollection(workspaceDir: string, id: string): Promise<void> {
  if (id === ".") {
    throw invalid("Cannot delete the workspace root collection");
  }
  const target = resolveInside(workspaceDir, id);
  if (!(await exists(path.join(target, COLLECTION_FILENAME)))) {
    throw notFound(`No collection found at ${id}`);
  }
  await rm(target, { recursive: true });
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

function assertNotEnvironmentsDir(relativeDir: string): void {
  if (relativeDir === ENVIRONMENTS_DIRNAME || relativeDir.startsWith(`${ENVIRONMENTS_DIRNAME}/`)) {
    throw invalid(`The top-level ${ENVIRONMENTS_DIRNAME}/ directory is reserved for environments`);
  }
}

export async function createFolder(rootDir: string, relativeDir: string): Promise<void> {
  assertNotEnvironmentsDir(relativeDir);
  const target = resolveInside(rootDir, relativeDir);
  if (await exists(target)) throw conflict(`Folder already exists: ${relativeDir}`);
  await mkdir(target, { recursive: true });
}

export async function renameFolder(rootDir: string, from: string, to: string): Promise<void> {
  assertNotEnvironmentsDir(from);
  assertNotEnvironmentsDir(to);
  if (to === from || to.startsWith(`${from}/`)) {
    throw invalid("Cannot move a folder inside itself");
  }
  const fromAbs = resolveInside(rootDir, from);
  const toAbs = resolveInside(rootDir, to);
  if (!(await exists(fromAbs))) throw notFound(`No folder found at ${from}`);
  await assertRenameTargetFree(fromAbs, toAbs);
  await mkdir(path.dirname(toAbs), { recursive: true });
  await rename(fromAbs, toAbs);
}

export async function deleteFolder(rootDir: string, relativeDir: string): Promise<void> {
  assertNotEnvironmentsDir(relativeDir);
  const target = resolveInside(rootDir, relativeDir);
  if (!(await exists(target))) throw notFound(`No folder found at ${relativeDir}`);
  await rm(target, { recursive: true });
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function assertRequestPath(relativePath: string): void {
  if (!relativePath.endsWith(REQUEST_SUFFIX)) {
    throw invalid(`Request paths must end with ${REQUEST_SUFFIX}: ${relativePath}`);
  }
}

export async function renameRequest(rootDir: string, from: string, to: string): Promise<void> {
  await moveRequest(rootDir, from, rootDir, to);
}

/**
 * Moves a request file between collection roots (or within one — rename is
 * this with both roots equal). Both roots must already be validated
 * collection directories; the paths are guarded here.
 */
export async function moveRequest(
  fromRootDir: string,
  from: string,
  toRootDir: string,
  to: string,
): Promise<void> {
  assertRequestPath(from);
  assertRequestPath(to);
  const fromAbs = resolveInside(fromRootDir, from);
  const toAbs = resolveInside(toRootDir, to);
  if (!(await exists(fromAbs))) throw notFound(`No request found at ${from}`);
  await assertRenameTargetFree(fromAbs, toAbs);
  await mkdir(path.dirname(toAbs), { recursive: true });
  await rename(fromAbs, toAbs);
}

export async function deleteRequest(rootDir: string, relativePath: string): Promise<void> {
  assertRequestPath(relativePath);
  const target = resolveInside(rootDir, relativePath);
  if (!(await exists(target))) throw notFound(`No request found at ${relativePath}`);
  await rm(target);
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

/** Validates an environment name and returns the absolute path of its file. */
export function resolveEnvironmentFile(rootDir: string, name: string): string {
  validateName(name, "Environment name");
  return resolveInside(rootDir, `${ENVIRONMENTS_DIRNAME}/${name}.yaml`);
}

export async function createEnvironment(rootDir: string, name: string): Promise<void> {
  const target = resolveEnvironmentFile(rootDir, name);
  if (await exists(target)) throw conflict(`Environment already exists: ${name}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "variables: {}\n");
}

/** Overwrites an existing environment's variables. Rewrites the whole file, so YAML comments do not survive. */
export async function writeEnvironment(
  rootDir: string,
  name: string,
  variables: Record<string, string>,
): Promise<void> {
  const target = resolveEnvironmentFile(rootDir, name);
  if (!(await exists(target))) throw notFound(`No environment found: ${name}`);
  await writeFile(target, stringifyYaml({ variables }));
}

export async function renameEnvironment(rootDir: string, from: string, to: string): Promise<void> {
  const fromAbs = resolveEnvironmentFile(rootDir, from);
  const toAbs = resolveEnvironmentFile(rootDir, to);
  if (!(await exists(fromAbs))) throw notFound(`No environment found: ${from}`);
  await assertRenameTargetFree(fromAbs, toAbs);
  await rename(fromAbs, toAbs);
}

export async function deleteEnvironment(rootDir: string, name: string): Promise<void> {
  const target = resolveEnvironmentFile(rootDir, name);
  if (!(await exists(target))) throw notFound(`No environment found: ${name}`);
  await rm(target);
}
