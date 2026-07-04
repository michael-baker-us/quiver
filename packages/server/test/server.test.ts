import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUiServer, type RunningServer } from "../src/index.js";

let api: Server;
let apiBaseUrl: string;
let collectionDir: string;
let ui: RunningServer;

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

async function writeCollection(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "quiver-server-test-"));
  await writeFile(path.join(dir, "collection.yaml"), "name: Server Test\n");
  await mkdir(path.join(dir, "environments"));
  await writeFile(
    path.join(dir, "environments", "local.yaml"),
    `variables:\n  baseUrl: ${apiBaseUrl}\n`,
  );
  await mkdir(path.join(dir, "things"));
  await writeFile(
    path.join(dir, "things", "get-thing.request.yaml"),
    [
      "name: Get thing",
      "method: GET",
      'url: "{{baseUrl}}/thing"',
      "tests:",
      "  - status: 200",
      "  - jsonpath: $.ok",
      "    equals: true",
    ].join("\n"),
  );
  return dir;
}

beforeAll(async () => {
  apiBaseUrl = await startFakeApi();
  collectionDir = await writeCollection();
  ui = await startUiServer({ rootDir: collectionDir, port: 0 });
});

afterAll(async () => {
  await ui.close();
  api.close();
  await rm(collectionDir, { recursive: true, force: true });
});

describe("ui server API", () => {
  it("GET /api/collection returns requests and environments", async () => {
    const res = await fetch(`${ui.url}/api/collection`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      name: string;
      environments: string[];
      requests: { relativePath: string; method: string }[];
    };
    expect(data.name).toBe("Server Test");
    expect(data.environments).toEqual(["local"]);
    expect(data.requests).toEqual([
      {
        relativePath: "things/get-thing.request.yaml",
        name: "Get thing",
        method: "GET",
      },
    ]);
  });

  it("GET /api/requests/<path> returns the raw file", async () => {
    const res = await fetch(
      `${ui.url}/api/requests/things/get-thing.request.yaml`,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string };
    expect(data.content).toContain("name: Get thing");
  });

  it("rejects path traversal and non-request files", async () => {
    const escape = await fetch(
      `${ui.url}/api/requests/..%2F..%2Fetc%2Fpasswd.request.yaml`,
    );
    expect(escape.status).toBe(400);
    const wrongType = await fetch(`${ui.url}/api/requests/collection.yaml`);
    expect(wrongType.status).toBe(400);
  });

  it("PUT validates YAML against the request schema before writing", async () => {
    const invalid = await fetch(
      `${ui.url}/api/requests/things/get-thing.request.yaml`,
      {
        method: "PUT",
        body: JSON.stringify({ content: "method: TELEPORT\nurl: x" }),
      },
    );
    expect(invalid.status).toBe(400);
    const error = (await invalid.json()) as { error: string };
    expect(error.error).toContain("method");

    // The bad save must not have clobbered the file.
    const unchanged = await fetch(
      `${ui.url}/api/requests/things/get-thing.request.yaml`,
    );
    expect(((await unchanged.json()) as { content: string }).content).toContain(
      "Get thing",
    );
  });

  it("PUT writes a valid file and the collection reflects it", async () => {
    const content = [
      "name: Get thing (renamed)",
      "method: GET",
      'url: "{{baseUrl}}/thing"',
      "tests:",
      "  - status: 200",
    ].join("\n");
    const res = await fetch(
      `${ui.url}/api/requests/things/get-thing.request.yaml`,
      { method: "PUT", body: JSON.stringify({ content }) },
    );
    expect(res.status).toBe(200);

    const listing = await fetch(`${ui.url}/api/collection`);
    const data = (await listing.json()) as { requests: { name: string }[] };
    expect(data.requests[0]?.name).toBe("Get thing (renamed)");
  });

  it("POST /api/send executes a request with the chosen environment", async () => {
    const res = await fetch(`${ui.url}/api/send`, {
      method: "POST",
      body: JSON.stringify({
        path: "things/get-thing.request.yaml",
        env: "local",
      }),
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      passed: boolean;
      response: { status: number; bodyJson: unknown };
    };
    expect(result.passed).toBe(true);
    expect(result.response.status).toBe(200);
    expect(result.response.bodyJson).toEqual({ path: "/thing", ok: true });
  });

  it("POST /api/send reports a helpful error for unknown environments", async () => {
    const res = await fetch(`${ui.url}/api/send`, {
      method: "POST",
      body: JSON.stringify({
        path: "things/get-thing.request.yaml",
        env: "nope",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/run streams NDJSON results then a summary", async () => {
    const res = await fetch(`${ui.url}/api/run`, {
      method: "POST",
      body: JSON.stringify({ env: "local" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: "result", passed: true });
    expect(lines[1]).toMatchObject({ type: "summary", passed: 1, failed: 0 });
  });

  it("serves a helpful page when the UI bundle is missing", async () => {
    const res = await fetch(`${ui.url}/`);
    // Depending on whether build:ui has run, this is the app or the hint page.
    expect([200, 503]).toContain(res.status);
  });
});
