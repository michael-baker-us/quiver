import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnvironment } from "../src/loader.js";
import {
  createCollection,
  createEnvironment,
  createFolder,
  deleteCollection,
  deleteEnvironment,
  deleteFolder,
  deleteRequest,
  importCollectionFiles,
  renameEnvironment,
  moveRequest,
  renameFolder,
  renameRequest,
  resolveInside,
  updateCollectionName,
  writeEnvironment,
  WorkspaceMutationError,
} from "../src/mutations.js";

let dir: string;

const REQUEST_YAML = 'name: Ping\nmethod: GET\nurl: "http://example.test/ping"\n';

async function expectError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceMutationError);
  expect((error as WorkspaceMutationError).code).toBe(code);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "quiver-mutations-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolveInside", () => {
  it("resolves normal relative paths", () => {
    expect(resolveInside(dir, "a/b.request.yaml")).toBe(
      path.join(path.resolve(dir), "a", "b.request.yaml"),
    );
  });

  it.each(["../x", "/etc/passwd", "a/../../b", "a/./b", "", "a//b", "a\\b", ".."])(
    "rejects %j",
    (bad) => {
      expect(() => resolveInside(dir, bad)).toThrowError(WorkspaceMutationError);
    },
  );
});

describe("createCollection", () => {
  it("creates the directory and collection.yaml", async () => {
    const { id } = await createCollection(dir, "my-api", "My API");
    expect(id).toBe("my-api");
    const raw = await readFile(path.join(dir, "my-api", "collection.yaml"), "utf8");
    expect(raw).toBe("name: My API\n");
  });

  it("allows nested dir names up to the scan depth and rejects deeper ones", async () => {
    await createCollection(dir, "team/apis/orders", "Orders");
    await expectError(createCollection(dir, "a/b/c/d", "Too deep"), "invalid");
  });

  it("rejects traversal, bad segment names, and empty display names", async () => {
    await expectError(createCollection(dir, "../escape", "X"), "invalid");
    await expectError(createCollection(dir, ".hidden", "X"), "invalid");
    await expectError(createCollection(dir, "has space", "X"), "invalid");
    await expectError(createCollection(dir, "ok", "  "), "invalid");
  });

  it("conflicts when a collection already exists there", async () => {
    await createCollection(dir, "my-api", "My API");
    await expectError(createCollection(dir, "my-api", "Again"), "conflict");
  });
});

describe("importCollectionFiles", () => {
  const files = new Map([
    ["collection.yaml", "name: Imported\n"],
    ["environments/default.yaml", "variables:\n  baseUrl: http://example.test\n"],
    ["pets/list-pets.request.yaml", REQUEST_YAML],
  ]);

  it("writes every file under the new collection directory", async () => {
    const { id } = await importCollectionFiles(dir, "imported", files);
    expect(id).toBe("imported");
    for (const [relativePath, content] of files) {
      expect(await readFile(path.join(dir, "imported", relativePath), "utf8")).toBe(content);
    }
  });

  it("requires collection.yaml among the files", async () => {
    await expectError(
      importCollectionFiles(dir, "x", new Map([["a.request.yaml", REQUEST_YAML]])),
      "invalid",
    );
  });

  it("applies the same guards as createCollection", async () => {
    await expectError(importCollectionFiles(dir, "../escape", files), "invalid");
    await createCollection(dir, "taken", "Taken");
    await expectError(importCollectionFiles(dir, "taken", files), "conflict");
  });

  it("rejects file paths that escape the collection directory", async () => {
    const evil = new Map([
      ["collection.yaml", "name: Evil\n"],
      ["../outside.request.yaml", REQUEST_YAML],
    ]);
    await expectError(importCollectionFiles(dir, "evil", evil), "invalid");
  });
});

describe("updateCollectionName", () => {
  it("changes name while preserving comments and other fields", async () => {
    const file = path.join(dir, "collection.yaml");
    await writeFile(
      file,
      "# team collection\nname: Old\ndescription: Keep me\ndefaults:\n  headers:\n    X-Team: core\n",
    );
    await updateCollectionName(dir, "New Name");
    const raw = await readFile(file, "utf8");
    expect(raw).toContain("# team collection");
    expect(raw).toContain("name: New Name");
    expect(raw).toContain("description: Keep me");
    expect(raw).toContain("X-Team: core");
    expect(raw).not.toContain("name: Old");
  });

  it("errors when there is no collection.yaml", async () => {
    await expectError(updateCollectionName(dir, "X"), "not-found");
  });
});

describe("deleteCollection", () => {
  it("removes the collection directory recursively", async () => {
    await createCollection(dir, "doomed", "Doomed");
    await writeFile(path.join(dir, "doomed", "a.request.yaml"), REQUEST_YAML);
    await deleteCollection(dir, "doomed");
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses "." and unknown ids', async () => {
    await expectError(deleteCollection(dir, "."), "invalid");
    await expectError(deleteCollection(dir, "nope"), "not-found");
    await expectError(deleteCollection(dir, "../other"), "invalid");
  });

  it("refuses a directory that is not a collection", async () => {
    await mkdir(path.join(dir, "plain"));
    await expectError(deleteCollection(dir, "plain"), "not-found");
  });
});

describe("folders", () => {
  it("creates nested folders and conflicts on existing ones", async () => {
    await createFolder(dir, "users/admin");
    expect((await stat(path.join(dir, "users", "admin"))).isDirectory()).toBe(true);
    await expectError(createFolder(dir, "users/admin"), "conflict");
  });

  it("refuses the reserved environments/ directory in all operations", async () => {
    await expectError(createFolder(dir, "environments"), "invalid");
    await expectError(createFolder(dir, "environments/sub"), "invalid");
    await expectError(renameFolder(dir, "environments", "envs"), "invalid");
    await expectError(deleteFolder(dir, "environments"), "invalid");
  });

  it("renames a folder, moving its contents", async () => {
    await createFolder(dir, "users");
    await writeFile(path.join(dir, "users", "a.request.yaml"), REQUEST_YAML);
    await renameFolder(dir, "users", "people/members");
    const raw = await readFile(
      path.join(dir, "people", "members", "a.request.yaml"),
      "utf8",
    );
    expect(raw).toBe(REQUEST_YAML);
  });

  it("supports case-only renames and rejects real conflicts", async () => {
    await createFolder(dir, "users");
    await renameFolder(dir, "users", "Users");
    const entries = await readdir(dir);
    expect(entries).toContain("Users");

    await createFolder(dir, "other");
    await expectError(renameFolder(dir, "other", "Users"), "conflict");
  });

  it("refuses moving a folder inside itself and missing sources", async () => {
    await createFolder(dir, "a");
    await expectError(renameFolder(dir, "a", "a/b"), "invalid");
    await expectError(renameFolder(dir, "missing", "elsewhere"), "not-found");
  });

  it("deletes folders recursively", async () => {
    await createFolder(dir, "users/admin");
    await writeFile(path.join(dir, "users", "a.request.yaml"), REQUEST_YAML);
    await deleteFolder(dir, "users");
    expect(await readdir(dir)).toEqual([]);
    await expectError(deleteFolder(dir, "users"), "not-found");
  });
});

describe("requests", () => {
  it("renames a request file, creating target folders", async () => {
    await writeFile(path.join(dir, "a.request.yaml"), REQUEST_YAML);
    await renameRequest(dir, "a.request.yaml", "users/01-a.request.yaml");
    const raw = await readFile(path.join(dir, "users", "01-a.request.yaml"), "utf8");
    expect(raw).toBe(REQUEST_YAML);
  });

  it("requires the .request.yaml suffix on both sides", async () => {
    await writeFile(path.join(dir, "a.request.yaml"), REQUEST_YAML);
    await expectError(renameRequest(dir, "a.request.yaml", "b.yaml"), "invalid");
    await expectError(renameRequest(dir, "a.yaml", "b.request.yaml"), "invalid");
  });

  it("rejects conflicts, missing sources, and traversal", async () => {
    await writeFile(path.join(dir, "a.request.yaml"), REQUEST_YAML);
    await writeFile(path.join(dir, "b.request.yaml"), REQUEST_YAML);
    await expectError(renameRequest(dir, "a.request.yaml", "b.request.yaml"), "conflict");
    await expectError(renameRequest(dir, "x.request.yaml", "y.request.yaml"), "not-found");
    await expectError(renameRequest(dir, "a.request.yaml", "../b.request.yaml"), "invalid");
  });

  it("moves a request between two collection roots, creating target folders", async () => {
    const fromRoot = path.join(dir, "alpha");
    const toRoot = path.join(dir, "beta");
    await mkdir(fromRoot, { recursive: true });
    await mkdir(toRoot, { recursive: true });
    await writeFile(path.join(fromRoot, "a.request.yaml"), REQUEST_YAML);

    await moveRequest(fromRoot, "a.request.yaml", toRoot, "users/a.request.yaml");
    const raw = await readFile(path.join(toRoot, "users", "a.request.yaml"), "utf8");
    expect(raw).toBe(REQUEST_YAML);
    await expectError(deleteRequest(fromRoot, "a.request.yaml"), "not-found");
  });

  it("guards cross-root moves like renames: conflicts, missing sources, traversal", async () => {
    const fromRoot = path.join(dir, "alpha");
    const toRoot = path.join(dir, "beta");
    await mkdir(fromRoot, { recursive: true });
    await mkdir(toRoot, { recursive: true });
    await writeFile(path.join(fromRoot, "a.request.yaml"), REQUEST_YAML);
    await writeFile(path.join(toRoot, "a.request.yaml"), REQUEST_YAML);

    await expectError(
      moveRequest(fromRoot, "a.request.yaml", toRoot, "a.request.yaml"),
      "conflict",
    );
    await expectError(
      moveRequest(fromRoot, "ghost.request.yaml", toRoot, "b.request.yaml"),
      "not-found",
    );
    // "../a.request.yaml" from beta's perspective points back into alpha.
    await expectError(
      moveRequest(fromRoot, "a.request.yaml", toRoot, "../alpha/b.request.yaml"),
      "invalid",
    );
    await expectError(moveRequest(fromRoot, "a.request.yaml", toRoot, "b.yaml"), "invalid");
  });

  it("deletes a request file", async () => {
    await writeFile(path.join(dir, "a.request.yaml"), REQUEST_YAML);
    await deleteRequest(dir, "a.request.yaml");
    expect(await readdir(dir)).toEqual([]);
    await expectError(deleteRequest(dir, "a.request.yaml"), "not-found");
    await expectError(deleteRequest(dir, "collection.yaml"), "invalid");
  });
});

describe("environments", () => {
  it("creates an empty environment and round-trips writes through loadEnvironment", async () => {
    await createEnvironment(dir, "staging");
    expect(await loadEnvironment(dir, "staging")).toEqual({ variables: {} });

    await writeEnvironment(dir, "staging", {
      baseUrl: "https://staging.example.com",
      apiToken: "{{$env.STAGING_API_TOKEN}}",
    });
    expect(await loadEnvironment(dir, "staging")).toEqual({
      variables: {
        baseUrl: "https://staging.example.com",
        apiToken: "{{$env.STAGING_API_TOKEN}}",
      },
    });
  });

  it("validates names and reports conflicts / missing environments", async () => {
    await expectError(createEnvironment(dir, "../evil"), "invalid");
    await expectError(createEnvironment(dir, ".hidden"), "invalid");
    await createEnvironment(dir, "staging");
    await expectError(createEnvironment(dir, "staging"), "conflict");
    await expectError(writeEnvironment(dir, "missing", {}), "not-found");
  });

  it("renames and deletes environments", async () => {
    await createEnvironment(dir, "staging");
    await renameEnvironment(dir, "staging", "prod");
    expect(await loadEnvironment(dir, "prod")).toEqual({ variables: {} });
    await expectError(renameEnvironment(dir, "staging", "x"), "not-found");

    await createEnvironment(dir, "extra");
    await expectError(renameEnvironment(dir, "extra", "prod"), "conflict");

    await deleteEnvironment(dir, "prod");
    await expectError(deleteEnvironment(dir, "prod"), "not-found");
  });
});
