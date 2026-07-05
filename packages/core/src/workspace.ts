import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { COLLECTION_FILENAME, ENVIRONMENTS_DIRNAME } from "./loader.js";

/**
 * A workspace is a directory served by `quiver ui`. If it contains
 * collection.yaml itself it is a single collection (id "."); otherwise every
 * directory beneath it (up to WORKSPACE_SCAN_DEPTH) containing
 * collection.yaml is a collection, identified by its POSIX-style relative
 * path — stable across renames of the display name, and safe to use in URLs.
 */
export interface WorkspaceCollectionRef {
  /** POSIX relative dir path from the workspace root, or "." for the root itself. */
  id: string;
  /** Absolute path of the collection root directory. */
  rootDir: string;
}

export const WORKSPACE_SCAN_DEPTH = 3;

const SKIPPED_DIRS = new Set(["node_modules"]);

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

async function isCollectionRoot(dir: string): Promise<boolean> {
  try {
    return (await stat(path.join(dir, COLLECTION_FILENAME))).isFile();
  } catch {
    return false;
  }
}

async function scanDir(
  dir: string,
  workspaceDir: string,
  depth: number,
  found: WorkspaceCollectionRef[],
): Promise<void> {
  if (depth > WORKSPACE_SCAN_DEPTH) return;
  if (await isCollectionRoot(dir)) {
    // A collection root is a leaf: *.request.yaml beneath it belongs to it,
    // so nested collection.yaml files are not scanned for.
    found.push({ id: toPosix(path.relative(workspaceDir, dir)) || ".", rootDir: dir });
    return;
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
    await scanDir(path.join(dir, entry.name), workspaceDir, depth + 1, found);
  }
}

/**
 * Finds every collection in a workspace directory. A directory that is
 * itself a collection root yields exactly one entry with id ".".
 */
export async function scanWorkspace(
  workspaceDir: string,
): Promise<WorkspaceCollectionRef[]> {
  const resolved = path.resolve(workspaceDir);
  const found: WorkspaceCollectionRef[] = [];
  await scanDir(resolved, resolved, 0, found);
  return found;
}

async function collectDirs(
  dir: string,
  rootDir: string,
  found: string[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ENVIRONMENTS_DIRNAME && dir === rootDir) continue;
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    found.push(toPosix(path.relative(rootDir, fullPath)));
    await collectDirs(fullPath, rootDir, found);
  }
}

/**
 * Lists every folder inside a collection (POSIX relative paths, sorted),
 * including empty ones — the UI shows folders the moment they are created,
 * before any request lives in them. Skips the top-level environments/
 * directory and dot-directories, mirroring the request loader's rules.
 */
export async function listFolders(rootDir: string): Promise<string[]> {
  const resolved = path.resolve(rootDir);
  const found: string[] = [];
  await collectDirs(resolved, resolved, found);
  return found.sort();
}
