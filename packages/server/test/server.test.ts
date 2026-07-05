import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUiServer, type RunningServer } from "../src/index.js";

let api: Server;
let apiBaseUrl: string;

function startFakeApi(): Promise<string> {
  api = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: req.url, ok: true }));
  });
  return new Promise((resolve) => {
    api.listen(0, "127.0.0.1", () => {
      const address = api.address();
      if (address === null || typeof address === "string") {
        throw new Error("unexpected address");
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

const GET_THING_YAML = [
  "name: Get thing",
  "method: GET",
  'url: "{{baseUrl}}/thing"',
  "tests:",
  "  - status: 200",
  "  - jsonpath: $.ok",
  "    equals: true",
].join("\n");

async function writeCollection(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "collection.yaml"), `name: ${name}\n`);
  await mkdir(path.join(dir, "environments"), { recursive: true });
  await writeFile(
    path.join(dir, "environments", "local.yaml"),
    `variables:\n  baseUrl: ${apiBaseUrl}\n`,
  );
  await mkdir(path.join(dir, "things"), { recursive: true });
  await writeFile(path.join(dir, "things", "get-thing.request.yaml"), GET_THING_YAML);
}

beforeAll(async () => {
  apiBaseUrl = await startFakeApi();
});

afterAll(() => {
  api.close();
});

describe("workspace mode", () => {
  let workspaceDir: string;
  let ui: RunningServer;

  beforeAll(async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), "quiver-server-test-"));
    await writeCollection(path.join(workspaceDir, "alpha"), "Alpha");
    await mkdir(path.join(workspaceDir, "alpha", "drafts")); // empty folder
    await writeCollection(path.join(workspaceDir, "nested", "beta"), "Beta");
    // Broken collection: invalid schema (name missing).
    await mkdir(path.join(workspaceDir, "broken"));
    await writeFile(path.join(workspaceDir, "broken", "collection.yaml"), "nope: true\n");
    // Collections hiding in node_modules must not be picked up.
    await mkdir(path.join(workspaceDir, "node_modules", "trap"), { recursive: true });
    await writeFile(
      path.join(workspaceDir, "node_modules", "trap", "collection.yaml"),
      "name: Trap\n",
    );
    ui = await startUiServer({ workspaceDir, port: 0 });
  });

  afterAll(async () => {
    await ui.close();
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it("GET /api/workspace lists every collection with folders and environments", async () => {
    const res = await fetch(`${ui.url}/api/workspace`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      mode: string;
      collections: {
        id: string;
        name: string;
        environments: string[];
        folders: string[];
        requests: { relativePath: string }[];
        error?: string;
      }[];
    };
    expect(data.mode).toBe("workspace");
    expect(data.collections.map((c) => c.id)).toEqual(["alpha", "broken", "nested/beta"]);

    const alpha = data.collections[0]!;
    expect(alpha.name).toBe("Alpha");
    expect(alpha.environments).toEqual(["local"]);
    expect(alpha.folders).toEqual(["drafts", "things"]);
    expect(alpha.requests.map((r) => r.relativePath)).toEqual([
      "things/get-thing.request.yaml",
    ]);

    const broken = data.collections[1]!;
    expect(broken.error).toContain("collection.yaml");
    expect(broken.requests).toEqual([]);
  });

  it("reads a request file through an encoded collection id", async () => {
    const res = await fetch(
      `${ui.url}/api/collections/nested%2Fbeta/requests/things/get-thing.request.yaml`,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string };
    expect(data.content).toContain("name: Get thing");
  });

  it("rejects traversal in collection ids and request paths", async () => {
    const idEscape = await fetch(
      `${ui.url}/api/collections/..%2F..%2Fetc/requests/x.request.yaml`,
    );
    expect(idEscape.status).toBe(404);
    const pathEscape = await fetch(
      `${ui.url}/api/collections/alpha/requests/..%2Fescape.request.yaml`,
    );
    expect(pathEscape.status).toBe(400);
    const wrongType = await fetch(`${ui.url}/api/collections/alpha/requests/collection.yaml`);
    expect(wrongType.status).toBe(400);
    const unknown = await fetch(
      `${ui.url}/api/collections/ghost/requests/x.request.yaml`,
    );
    expect(unknown.status).toBe(404);
  });

  it("PUT validates YAML against the request schema before writing", async () => {
    const invalid = await fetch(
      `${ui.url}/api/collections/alpha/requests/things/get-thing.request.yaml`,
      { method: "PUT", body: JSON.stringify({ content: "method: TELEPORT\nurl: x" }) },
    );
    expect(invalid.status).toBe(400);
    const error = (await invalid.json()) as { error: string };
    expect(error.error).toContain("method");

    // The bad save must not have clobbered the file.
    const unchanged = await fetch(
      `${ui.url}/api/collections/alpha/requests/things/get-thing.request.yaml`,
    );
    expect(((await unchanged.json()) as { content: string }).content).toContain("Get thing");
  });

  it("PUT writes a valid file and the workspace reflects it", async () => {
    const content = [
      "name: Get thing (renamed)",
      "method: GET",
      'url: "{{baseUrl}}/thing"',
      "tests:",
      "  - status: 200",
    ].join("\n");
    const res = await fetch(
      `${ui.url}/api/collections/alpha/requests/things/get-thing.request.yaml`,
      { method: "PUT", body: JSON.stringify({ content }) },
    );
    expect(res.status).toBe(200);

    const listing = await fetch(`${ui.url}/api/workspace`);
    const data = (await listing.json()) as {
      collections: { id: string; requests: { name: string }[] }[];
    };
    expect(data.collections[0]?.requests[0]?.name).toBe("Get thing (renamed)");
  });

  it("POST send executes a request with the chosen environment", async () => {
    const res = await fetch(`${ui.url}/api/collections/alpha/send`, {
      method: "POST",
      body: JSON.stringify({ path: "things/get-thing.request.yaml", env: "local" }),
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      passed: boolean;
      response: { status: number; bodyJson: unknown };
    };
    expect(result.passed).toBe(true);
    expect(result.response.bodyJson).toEqual({ path: "/thing", ok: true });

    const badEnv = await fetch(`${ui.url}/api/collections/alpha/send`, {
      method: "POST",
      body: JSON.stringify({ path: "things/get-thing.request.yaml", env: "nope" }),
    });
    expect(badEnv.status).toBe(400);
  });

  it("POST run streams NDJSON results with report entries, then a summary", async () => {
    const res = await fetch(`${ui.url}/api/collections/alpha/run`, {
      method: "POST",
      body: JSON.stringify({ env: "local" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: "result", passed: true });
    expect(lines[1]).toMatchObject({ type: "summary", passed: 1, failed: 0 });
    expect(lines[0].report).toMatchObject({
      file: "things/get-thing.request.yaml",
      request: { url: `${apiBaseUrl}/thing` },
    });
    expect(lines[0].report.response.body).toContain('"ok":true');
  });

  it("creates a collection and uses it immediately", async () => {
    const created = await fetch(`${ui.url}/api/collections`, {
      method: "POST",
      body: JSON.stringify({ dirName: "gamma", name: "Gamma" }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: "gamma", name: "Gamma" });

    const dup = await fetch(`${ui.url}/api/collections`, {
      method: "POST",
      body: JSON.stringify({ dirName: "gamma", name: "Again" }),
    });
    expect(dup.status).toBe(409);
    const escape = await fetch(`${ui.url}/api/collections`, {
      method: "POST",
      body: JSON.stringify({ dirName: "../evil", name: "Evil" }),
    });
    expect(escape.status).toBe(400);

    // Save a request into the fresh collection right away.
    const saved = await fetch(
      `${ui.url}/api/collections/gamma/requests/ping.request.yaml`,
      {
        method: "PUT",
        body: JSON.stringify({ content: `name: Ping\nmethod: GET\nurl: "${apiBaseUrl}/ping"` }),
      },
    );
    expect(saved.status).toBe(200);

    const listing = await fetch(`${ui.url}/api/workspace`);
    const data = (await listing.json()) as { collections: { id: string; name: string }[] };
    expect(data.collections.map((c) => c.id)).toContain("gamma");
  });

  it("renames and deletes a collection", async () => {
    const renamed = await fetch(`${ui.url}/api/collections/gamma`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Gamma v2" }),
    });
    expect(renamed.status).toBe(200);
    const listing = await fetch(`${ui.url}/api/workspace`);
    const data = (await listing.json()) as { collections: { id: string; name: string }[] };
    expect(data.collections.find((c) => c.id === "gamma")?.name).toBe("Gamma v2");

    const deleted = await fetch(`${ui.url}/api/collections/gamma`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const gone = await fetch(
      `${ui.url}/api/collections/gamma/requests/ping.request.yaml`,
    );
    expect(gone.status).toBe(404);
    const again = await fetch(`${ui.url}/api/collections/gamma`, { method: "DELETE" });
    expect(again.status).toBe(404);
  });

  it("creates, renames, and deletes folders", async () => {
    const created = await fetch(`${ui.url}/api/collections/alpha/folders`, {
      method: "POST",
      body: JSON.stringify({ path: "users/admin" }),
    });
    expect(created.status).toBe(201);
    const dup = await fetch(`${ui.url}/api/collections/alpha/folders`, {
      method: "POST",
      body: JSON.stringify({ path: "users/admin" }),
    });
    expect(dup.status).toBe(409);
    const reserved = await fetch(`${ui.url}/api/collections/alpha/folders`, {
      method: "POST",
      body: JSON.stringify({ path: "environments" }),
    });
    expect(reserved.status).toBe(400);

    const renamed = await fetch(`${ui.url}/api/collections/alpha/folders/rename`, {
      method: "POST",
      body: JSON.stringify({ from: "users", to: "people" }),
    });
    expect(renamed.status).toBe(200);

    let listing = (await (await fetch(`${ui.url}/api/workspace`)).json()) as {
      collections: { folders: string[] }[];
    };
    expect(listing.collections[0]?.folders).toContain("people/admin");
    expect(listing.collections[0]?.folders).not.toContain("users");

    const escape = await fetch(`${ui.url}/api/collections/alpha/folders/..%2Fnested`, {
      method: "DELETE",
    });
    expect(escape.status).toBe(400);

    const deleted = await fetch(`${ui.url}/api/collections/alpha/folders/people`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    listing = (await (await fetch(`${ui.url}/api/workspace`)).json()) as {
      collections: { folders: string[] }[];
    };
    expect(listing.collections[0]?.folders).not.toContain("people");
  });

  it("renames and deletes request files", async () => {
    await fetch(`${ui.url}/api/collections/alpha/requests/tmp.request.yaml`, {
      method: "PUT",
      body: JSON.stringify({ content: `name: Tmp\nmethod: GET\nurl: "${apiBaseUrl}/tmp"` }),
    });

    const renamed = await fetch(`${ui.url}/api/collections/alpha/requests/rename`, {
      method: "POST",
      body: JSON.stringify({ from: "tmp.request.yaml", to: "things/02-tmp.request.yaml" }),
    });
    expect(renamed.status).toBe(200);

    const conflict = await fetch(`${ui.url}/api/collections/alpha/requests/rename`, {
      method: "POST",
      body: JSON.stringify({
        from: "things/02-tmp.request.yaml",
        to: "things/get-thing.request.yaml",
      }),
    });
    expect(conflict.status).toBe(409);
    const missing = await fetch(`${ui.url}/api/collections/alpha/requests/rename`, {
      method: "POST",
      body: JSON.stringify({ from: "ghost.request.yaml", to: "x.request.yaml" }),
    });
    expect(missing.status).toBe(404);

    const deleted = await fetch(
      `${ui.url}/api/collections/alpha/requests/things/02-tmp.request.yaml`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    const gone = await fetch(
      `${ui.url}/api/collections/alpha/requests/things/02-tmp.request.yaml`,
    );
    expect(gone.status).toBe(404);
  });

  it("creates, edits, renames, and deletes environments", async () => {
    const created = await fetch(`${ui.url}/api/collections/alpha/environments`, {
      method: "POST",
      body: JSON.stringify({ name: "staging" }),
    });
    expect(created.status).toBe(201);
    const badName = await fetch(`${ui.url}/api/collections/alpha/environments`, {
      method: "POST",
      body: JSON.stringify({ name: "../evil" }),
    });
    expect(badName.status).toBe(400);

    const empty = await fetch(`${ui.url}/api/collections/alpha/environments/staging`);
    expect(await empty.json()).toEqual({ name: "staging", variables: {} });

    const badWrite = await fetch(`${ui.url}/api/collections/alpha/environments/staging`, {
      method: "PUT",
      body: JSON.stringify({ variables: { count: 1 } }),
    });
    expect(badWrite.status).toBe(400);

    const write = await fetch(`${ui.url}/api/collections/alpha/environments/staging`, {
      method: "PUT",
      body: JSON.stringify({ variables: { baseUrl: apiBaseUrl, token: "{{$env.TOKEN}}" } }),
    });
    expect(write.status).toBe(200);
    const readBack = await fetch(`${ui.url}/api/collections/alpha/environments/staging`);
    expect(await readBack.json()).toEqual({
      name: "staging",
      variables: { baseUrl: apiBaseUrl, token: "{{$env.TOKEN}}" },
    });

    const renamed = await fetch(`${ui.url}/api/collections/alpha/environments/rename`, {
      method: "POST",
      body: JSON.stringify({ from: "staging", to: "prod" }),
    });
    expect(renamed.status).toBe(200);

    const deleted = await fetch(`${ui.url}/api/collections/alpha/environments/prod`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const gone = await fetch(`${ui.url}/api/collections/alpha/environments/prod`);
    expect(gone.status).toBe(404);
  });

  it("POST /api/report formats a supplied summary without re-running", async () => {
    const summary = {
      passed: 1,
      failed: 1,
      durationMs: 120,
      results: [
        {
          name: "Get thing",
          file: "things/get-thing.request.yaml",
          method: "GET",
          passed: false,
          status: 500,
          timeMs: 40,
          assertions: [
            { ok: true, description: "status is 200" },
            { ok: false, description: "jsonpath $.ok equals", detail: "got false" },
          ],
        },
      ],
    };

    const junit = await fetch(`${ui.url}/api/report`, {
      method: "POST",
      body: JSON.stringify({ format: "junit", summary }),
    });
    expect(junit.status).toBe(200);
    expect(await junit.text()).toContain('failures="1"');

    const html = await fetch(`${ui.url}/api/report`, {
      method: "POST",
      body: JSON.stringify({ format: "html", name: "Alpha", summary }),
    });
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("Alpha — quiver report");

    const badFormat = await fetch(`${ui.url}/api/report`, {
      method: "POST",
      body: JSON.stringify({ format: "pdf", summary }),
    });
    expect(badFormat.status).toBe(400);
  });

  it("the old single-collection routes are gone", async () => {
    expect((await fetch(`${ui.url}/api/collection`)).status).toBe(404);
    expect(
      (await fetch(`${ui.url}/api/send`, { method: "POST", body: "{}" })).status,
    ).toBe(404);
    expect(
      (await fetch(`${ui.url}/api/run`, { method: "POST", body: "{}" })).status,
    ).toBe(404);
  });

  it("serves a helpful page when the UI bundle is missing", async () => {
    const res = await fetch(`${ui.url}/`);
    // Depending on whether build:ui has run, this is the app or the hint page.
    expect([200, 503]).toContain(res.status);
  });
});

describe("collection mode", () => {
  let collectionDir: string;
  let ui: RunningServer;

  beforeAll(async () => {
    collectionDir = await mkdtemp(path.join(tmpdir(), "quiver-server-solo-"));
    await writeCollection(collectionDir, "Solo");
    ui = await startUiServer({ workspaceDir: collectionDir, port: 0 });
  });

  afterAll(async () => {
    await ui.close();
    await rm(collectionDir, { recursive: true, force: true });
  });

  it('serves the collection as id "."', async () => {
    const res = await fetch(`${ui.url}/api/workspace`);
    const data = (await res.json()) as {
      mode: string;
      collections: { id: string; name: string }[];
    };
    expect(data.mode).toBe("collection");
    expect(data.collections).toHaveLength(1);
    expect(data.collections[0]).toMatchObject({ id: ".", name: "Solo" });

    // "." would be normalized away by URL parsing, so the root id is "~".
    const file = await fetch(
      `${ui.url}/api/collections/~/requests/things/get-thing.request.yaml`,
    );
    expect(file.status).toBe(200);

    const send = await fetch(`${ui.url}/api/collections/~/send`, {
      method: "POST",
      body: JSON.stringify({ path: "things/get-thing.request.yaml", env: "local" }),
    });
    expect(((await send.json()) as { passed: boolean }).passed).toBe(true);
  });

  it("refuses collection creation and deletion", async () => {
    const create = await fetch(`${ui.url}/api/collections`, {
      method: "POST",
      body: JSON.stringify({ dirName: "sub", name: "Sub" }),
    });
    expect(create.status).toBe(400);

    const del = await fetch(`${ui.url}/api/collections/~`, { method: "DELETE" });
    expect(del.status).toBe(400);

    // Other collections don't exist in this mode, even if a nested dir has one.
    const other = await fetch(`${ui.url}/api/collections/things/run`, { method: "POST", body: "{}" });
    expect(other.status).toBe(404);
  });
});
