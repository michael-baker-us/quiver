import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFolders, scanWorkspace } from "../src/workspace.js";

let dir: string;

async function makeDir(): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), "quiver-workspace-test-"));
  return dir;
}

async function addCollection(relative: string): Promise<void> {
  const target = path.join(dir, relative);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "collection.yaml"), `name: ${relative}\n`);
}

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("scanWorkspace", () => {
  it('returns id "." when the directory is itself a collection', async () => {
    await makeDir();
    await writeFile(path.join(dir, "collection.yaml"), "name: Solo\n");
    await mkdir(path.join(dir, "sub"));
    await writeFile(path.join(dir, "sub", "collection.yaml"), "name: Nested\n");

    const refs = await scanWorkspace(dir);
    expect(refs).toEqual([{ id: ".", rootDir: path.resolve(dir) }]);
  });

  it("finds collections at multiple depths, sorted by path", async () => {
    await makeDir();
    await addCollection("alpha");
    await addCollection("nested/beta");

    const refs = await scanWorkspace(dir);
    expect(refs.map((r) => r.id)).toEqual(["alpha", "nested/beta"]);
    expect(refs[1]?.rootDir).toBe(path.join(path.resolve(dir), "nested", "beta"));
  });

  it("skips node_modules, dot-directories, and dirs beyond the depth limit", async () => {
    await makeDir();
    await addCollection("alpha");
    await addCollection("node_modules/trap");
    await addCollection(".hidden/trap");
    await addCollection("a/b/c/d"); // depth 4 > limit 3

    const refs = await scanWorkspace(dir);
    expect(refs.map((r) => r.id)).toEqual(["alpha"]);
  });

  it("does not descend into a found collection", async () => {
    await makeDir();
    await addCollection("outer");
    await addCollection("outer/inner");

    const refs = await scanWorkspace(dir);
    expect(refs.map((r) => r.id)).toEqual(["outer"]);
  });

  it("returns an empty list for an empty directory", async () => {
    await makeDir();
    expect(await scanWorkspace(dir)).toEqual([]);
  });
});

describe("listFolders", () => {
  it("lists nested folders including empty ones, skipping environments/ and dot-dirs", async () => {
    await makeDir();
    await writeFile(path.join(dir, "collection.yaml"), "name: Test\n");
    await mkdir(path.join(dir, "environments"));
    await mkdir(path.join(dir, ".git"));
    await mkdir(path.join(dir, "users", "admin"), { recursive: true });
    await mkdir(path.join(dir, "empty"));
    // A nested dir literally named "environments" is a normal folder.
    await mkdir(path.join(dir, "users", "environments"), { recursive: true });

    expect(await listFolders(dir)).toEqual([
      "empty",
      "users",
      "users/admin",
      "users/environments",
    ]);
  });
});
