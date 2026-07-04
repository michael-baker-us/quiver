import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCollection } from "../src/loader.js";
import { runCollection } from "../src/runner.js";

let server: Server;
let baseUrl: string;
let collectionDir: string;

/**
 * Fake API: POST /login returns a token; GET /me echoes back the
 * Authorization header so the test can prove capture-based chaining works.
 */
function startServer(): Promise<string> {
  server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/login") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: "tok-123", user: { id: 7 } }));
    } else if (req.method === "GET" && req.url === "/me") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ auth: req.headers.authorization ?? null }));
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("unexpected server address");
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function writeCollection(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "quiver-test-"));
  await writeFile(
    path.join(dir, "collection.yaml"),
    ["name: Test API", "defaults:", "  headers:", "    Accept: application/json"].join("\n"),
  );
  await mkdir(path.join(dir, "environments"));
  await writeFile(
    path.join(dir, "environments", "local.yaml"),
    ["variables:", `  baseUrl: ${baseUrl}`].join("\n"),
  );
  await mkdir(path.join(dir, "auth"));
  await writeFile(
    path.join(dir, "auth", "01-login.request.yaml"),
    [
      "name: Login",
      "method: POST",
      'url: "{{baseUrl}}/login"',
      "body:",
      "  type: json",
      "  content:",
      "    username: ada",
      "tests:",
      "  - status: 200",
      "  - jsonpath: $.token",
      "    exists: true",
      "capture:",
      "  authToken: $.token",
      "  userId: $.user.id",
    ].join("\n"),
  );
  await writeFile(
    path.join(dir, "auth", "02-me.request.yaml"),
    [
      "name: Who am I",
      "method: GET",
      'url: "{{baseUrl}}/me"',
      "auth:",
      "  type: bearer",
      '  token: "{{authToken}}"',
      "tests:",
      "  - status: 200",
      "  - jsonpath: $.auth",
      '    equals: "Bearer tok-123"',
    ].join("\n"),
  );
  return dir;
}

beforeAll(async () => {
  baseUrl = await startServer();
  collectionDir = await writeCollection();
});

afterAll(async () => {
  server.close();
  await rm(collectionDir, { recursive: true, force: true });
});

describe("runCollection", () => {
  it("runs requests in order and chains captured variables", async () => {
    const loaded = await loadCollection(collectionDir);
    expect(loaded.requests.map((r) => r.definition.name)).toEqual([
      "Login",
      "Who am I",
    ]);

    const summary = await runCollection(loaded, {
      variables: { baseUrl },
    });

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(2);
    expect(summary.results[0]?.captured).toEqual({
      authToken: "tok-123",
      userId: "7",
    });
  });

  it("reports failures without crashing and supports bail", async () => {
    const loaded = await loadCollection(collectionDir);
    // Point at a URL that 404s by overriding the variable.
    const summary = await runCollection(loaded, {
      variables: { baseUrl: `${baseUrl}/missing-prefix` },
      bail: true,
    });
    expect(summary.failed).toBe(1);
    expect(summary.results).toHaveLength(1);
    const first = summary.results[0]!;
    expect(first.passed).toBe(false);
    expect(first.response?.status).toBe(404);
  });

  it("turns unresolvable variables into a failed result, not a crash", async () => {
    const loaded = await loadCollection(collectionDir);
    const summary = await runCollection(loaded, { variables: {} });
    const first = summary.results[0]!;
    expect(first.passed).toBe(false);
    expect(first.error).toContain("baseUrl");
  });
});
