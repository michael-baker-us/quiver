import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  buildHtmlReport,
  buildJunitXml,
  COLLECTION_FILENAME,
  createCollection,
  createEnvironment,
  createFolder,
  deleteCollection,
  deleteEnvironment,
  deleteFolder,
  deleteRequest,
  environmentFileSchema,
  isJsonSummary,
  listEnvironments,
  listFolders,
  loadCollection,
  loadEnvironment,
  moveRequest,
  renameEnvironment,
  renameFolder,
  renameRequest,
  REQUEST_SUFFIX,
  requestFileSchema,
  resolveEnvironmentFile,
  resolveInside,
  runCollection,
  runRequest,
  scanWorkspace,
  toJsonResult,
  updateCollectionName,
  WorkspaceMutationError,
  writeEnvironment,
  type RequestResult,
} from "@quiver/core";

const PUBLIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

export interface UiServerOptions {
  /**
   * Directory to serve. Either a collection root (contains collection.yaml —
   * served as a single collection with id ".") or a workspace directory
   * whose subdirectories hold any number of collections.
   */
  workspaceDir: string;
  host?: string;
  port?: number;
}

export interface RunningServer {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") {
    throw new HttpError(400, `Expected ${what} to be a non-empty string`);
  }
  return value;
}

async function isCollectionRoot(dir: string): Promise<boolean> {
  try {
    return (await stat(path.join(dir, COLLECTION_FILENAME))).isFile();
  } catch {
    return false;
  }
}

/**
 * Maps a collection id from the URL to its root directory. In collection
 * mode only "." exists; in workspace mode the id is a relative dir path that
 * must contain collection.yaml. Unknown or escaping ids are 404s — the
 * client is probing for something that isn't there.
 */
async function resolveCollectionDir(
  workspaceDir: string,
  mode: "collection" | "workspace",
  id: string,
): Promise<string> {
  let dir: string;
  if (id === ".") {
    dir = workspaceDir;
  } else if (mode === "collection") {
    throw new HttpError(404, `No collection ${id}`);
  } else {
    try {
      dir = resolveInside(workspaceDir, id);
    } catch {
      throw new HttpError(404, `No collection ${id}`);
    }
  }
  if (!(await isCollectionRoot(dir))) {
    throw new HttpError(404, `No collection ${id}`);
  }
  return dir;
}

/** Traversal + suffix guard for request file paths inside a collection. */
function resolveRequestFile(rootDir: string, relativePath: string): string {
  if (!relativePath.endsWith(REQUEST_SUFFIX)) {
    throw new HttpError(400, `Only *${REQUEST_SUFFIX} files can be accessed`);
  }
  return resolveInside(rootDir, relativePath);
}

async function resolveVariables(
  rootDir: string,
  envName: string | undefined,
): Promise<Record<string, string>> {
  if (!envName) return {};
  try {
    return (await loadEnvironment(rootDir, envName)).variables;
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
}

/** Trims a RequestResult to what the browser needs (no absolute paths). */
function serializeResult(result: RequestResult, includeBody: boolean) {
  return {
    name: result.request.definition.name ?? result.request.relativePath,
    relativePath: result.request.relativePath,
    method: result.request.definition.method,
    passed: result.passed,
    error: result.error,
    assertions: result.assertions,
    captured: result.captured,
    response: result.response
      ? {
          status: result.response.status,
          statusText: result.response.statusText,
          timeMs: Math.round(result.response.timeMs),
          ...(includeBody
            ? {
                headers: result.response.headers,
                bodyText: result.response.bodyText,
                bodyJson: result.response.bodyJson,
              }
            : {}),
        }
      : undefined,
  };
}

async function describeCollection(id: string, rootDir: string) {
  try {
    const loaded = await loadCollection(rootDir);
    return {
      id,
      name: loaded.collection.name,
      description: loaded.collection.description,
      environments: await listEnvironments(rootDir),
      folders: await listFolders(rootDir),
      requests: loaded.requests.map((request) => ({
        relativePath: request.relativePath,
        name: request.definition.name ?? request.relativePath,
        method: request.definition.method,
      })),
    };
  } catch (error) {
    // A broken collection.yaml renders as a broken node, not a dead app.
    return {
      id,
      name: id === "." ? path.basename(rootDir) : id,
      environments: [],
      folders: [],
      requests: [],
      error: (error as Error).message,
    };
  }
}

async function handleWorkspace(
  workspaceDir: string,
  mode: "collection" | "workspace",
  res: ServerResponse,
): Promise<void> {
  const refs = await scanWorkspace(workspaceDir);
  const collections = await Promise.all(
    refs.map((ref) => describeCollection(ref.id, ref.rootDir)),
  );
  sendJson(res, 200, { mode, collections });
}

async function handleCollectionApi(
  workspaceDir: string,
  mode: "collection" | "workspace",
  id: string,
  rest: string[],
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";

  // Collection-level operations don't need the dir to be valid yet.
  if (rest.length === 0) {
    if (method === "PATCH") {
      const rootDir = await resolveCollectionDir(workspaceDir, mode, id);
      const body = (await readBody(req)) as { name?: unknown };
      await updateCollectionName(rootDir, requireString(body.name, "name"));
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === "DELETE") {
      if (mode === "collection") {
        throw new HttpError(400, "Cannot delete the collection this server was started on");
      }
      await deleteCollection(workspaceDir, id);
      sendJson(res, 200, { ok: true });
      return;
    }
    throw new HttpError(404, `No route for ${method} on a collection`);
  }

  const rootDir = await resolveCollectionDir(workspaceDir, mode, id);
  const [resource, ...tail] = rest;
  const tailPath = tail.join("/");

  if (resource === "requests") {
    if (method === "POST" && tailPath === "rename") {
      const body = (await readBody(req)) as { from?: unknown; to?: unknown };
      await renameRequest(
        rootDir,
        requireString(body.from, "from"),
        requireString(body.to, "to"),
      );
      sendJson(res, 200, { ok: true });
      return;
    }
    const filePath = resolveRequestFile(rootDir, tailPath);

    if (method === "GET") {
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        throw new HttpError(404, `${tailPath} not found`);
      }
      sendJson(res, 200, { relativePath: tailPath, content });
      return;
    }
    if (method === "PUT") {
      const body = (await readBody(req)) as { content?: unknown };
      if (typeof body.content !== "string") {
        throw new HttpError(400, "Expected JSON body: { content: string }");
      }
      let data: unknown;
      try {
        data = parseYaml(body.content);
      } catch (error) {
        throw new HttpError(400, `Invalid YAML: ${(error as Error).message}`);
      }
      const parsed = requestFileSchema.safeParse(data);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        throw new HttpError(400, `Invalid request file: ${issues}`);
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, body.content);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === "DELETE") {
      await deleteRequest(rootDir, tailPath);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (resource === "folders") {
    if (method === "POST" && tail.length === 0) {
      const body = (await readBody(req)) as { path?: unknown };
      await createFolder(rootDir, requireString(body.path, "path"));
      sendJson(res, 201, { ok: true });
      return;
    }
    if (method === "POST" && tailPath === "rename") {
      const body = (await readBody(req)) as { from?: unknown; to?: unknown };
      await renameFolder(
        rootDir,
        requireString(body.from, "from"),
        requireString(body.to, "to"),
      );
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === "DELETE" && tail.length > 0) {
      await deleteFolder(rootDir, tailPath);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (resource === "environments") {
    if (method === "POST" && tail.length === 0) {
      const body = (await readBody(req)) as { name?: unknown };
      await createEnvironment(rootDir, requireString(body.name, "name"));
      sendJson(res, 201, { ok: true });
      return;
    }
    if (method === "POST" && tailPath === "rename") {
      const body = (await readBody(req)) as { from?: unknown; to?: unknown };
      await renameEnvironment(
        rootDir,
        requireString(body.from, "from"),
        requireString(body.to, "to"),
      );
      sendJson(res, 200, { ok: true });
      return;
    }
    if (tail.length === 1) {
      const name = tail[0]!;
      if (method === "GET") {
        resolveEnvironmentFile(rootDir, name); // validates the name
        try {
          const env = await loadEnvironment(rootDir, name);
          sendJson(res, 200, { name, variables: env.variables });
        } catch (error) {
          throw new HttpError(404, (error as Error).message);
        }
        return;
      }
      if (method === "PUT") {
        const body = (await readBody(req)) as { variables?: unknown };
        const parsed = environmentFileSchema.safeParse({ variables: body.variables });
        if (!parsed.success) {
          throw new HttpError(
            400,
            "Expected JSON body: { variables: Record<string, string> }",
          );
        }
        await writeEnvironment(rootDir, name, parsed.data.variables);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (method === "DELETE") {
        await deleteEnvironment(rootDir, name);
        sendJson(res, 200, { ok: true });
        return;
      }
    }
  }

  if (resource === "send" && method === "POST" && tail.length === 0) {
    const body = (await readBody(req)) as { path?: unknown; env?: unknown };
    if (typeof body.path !== "string") {
      throw new HttpError(400, "Expected JSON body: { path: string, env?: string }");
    }
    resolveRequestFile(rootDir, body.path); // traversal guard
    const loaded = await loadCollection(rootDir);
    const request = loaded.requests.find((r) => r.relativePath === body.path);
    if (!request) throw new HttpError(404, `${body.path} not found`);
    const variables = await resolveVariables(
      rootDir,
      typeof body.env === "string" ? body.env : undefined,
    );
    const result = await runRequest(request, variables, loaded.collection);
    sendJson(res, 200, serializeResult(result, true));
    return;
  }

  if (resource === "run" && method === "POST" && tail.length === 0) {
    const body = (await readBody(req)) as { env?: unknown; bail?: unknown };
    const loaded = await loadCollection(rootDir);
    const variables = await resolveVariables(
      rootDir,
      typeof body.env === "string" ? body.env : undefined,
    );
    res.writeHead(200, {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache",
    });
    // Accumulates captures as the run progresses so each streamed event's
    // `report` entry is scrubbed with every value captured so far — the
    // client assembles these into a shareable report without a second run.
    const captures: Record<string, string> = {};
    const summary = await runCollection(loaded, {
      variables,
      bail: body.bail === true,
      onResult: (result) => {
        Object.assign(captures, result.captured);
        res.write(
          JSON.stringify({
            type: "result",
            ...serializeResult(result, false),
            report: toJsonResult(result, captures),
          }) + "\n",
        );
      },
    });
    res.end(
      JSON.stringify({
        type: "summary",
        passed: summary.passed,
        failed: summary.failed,
        durationMs: Math.round(summary.durationMs),
      }) + "\n",
    );
    return;
  }

  throw new HttpError(404, `No route for ${method} /api/collections/${id}/${rest.join("/")}`);
}

async function handleApi(
  workspaceDir: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  // Split the RAW pathname so ids containing %2F stay one segment, then
  // decode each segment. `/api/collections/nested%2Fbeta/run` and
  // `/api/collections/nested/beta/run` both address collection nested/beta.
  const segments = url.pathname.split("/").slice(1).map(decodeURIComponent);
  const method = req.method ?? "GET";
  const mode = (await isCollectionRoot(workspaceDir)) ? "collection" : "workspace";

  if (method === "GET" && segments.length === 2 && segments[1] === "workspace") {
    await handleWorkspace(workspaceDir, mode, res);
    return;
  }

  if (segments[1] === "collections") {
    if (segments.length === 2 && method === "POST") {
      if (mode === "collection") {
        throw new HttpError(
          400,
          "This server was started on a single collection; point quiver ui at a parent directory to manage several",
        );
      }
      const body = (await readBody(req)) as { dirName?: unknown; name?: unknown };
      const created = await createCollection(
        workspaceDir,
        requireString(body.dirName, "dirName"),
        requireString(body.name, "name"),
      );
      sendJson(res, 201, { id: created.id, name: body.name });
      return;
    }
    if (segments.length >= 3) {
      // URL normalization strips "." path segments (even percent-encoded),
      // so the root collection's id "." travels as the reserved segment "~".
      const id = segments[2] === "~" ? "." : segments[2]!;
      await handleCollectionApi(workspaceDir, mode, id, segments.slice(3), req, res);
      return;
    }
  }

  // Moving a request can cross collection boundaries (drag-and-drop in the
  // sidebar), so it lives at the workspace level rather than under one
  // collection. Within-collection moves also route here.
  if (method === "POST" && segments.length === 3 && segments[1] === "requests" && segments[2] === "move") {
    const body = (await readBody(req)) as {
      fromCollection?: unknown;
      fromPath?: unknown;
      toCollection?: unknown;
      toPath?: unknown;
    };
    const fromDir = await resolveCollectionDir(
      workspaceDir,
      mode,
      requireString(body.fromCollection, "fromCollection"),
    );
    const toDir = await resolveCollectionDir(
      workspaceDir,
      mode,
      requireString(body.toCollection, "toCollection"),
    );
    await moveRequest(
      fromDir,
      requireString(body.fromPath, "fromPath"),
      toDir,
      requireString(body.toPath, "toPath"),
    );
    sendJson(res, 200, { ok: true });
    return;
  }

  // Formats a run the client already has (from a run stream) as junit or
  // html — stateless, mirroring the CLI's `quiver report`, so the collection
  // never has to be executed a second time to get a report.
  if (method === "POST" && segments.length === 2 && segments[1] === "report") {
    const body = (await readBody(req)) as {
      format?: unknown;
      name?: unknown;
      summary?: unknown;
    };
    if (body.format !== "junit" && body.format !== "html") {
      throw new HttpError(400, 'Expected format: "junit" or "html"');
    }
    if (!isJsonSummary(body.summary)) {
      throw new HttpError(
        400,
        "Expected summary: { passed, failed, durationMs, results[] }",
      );
    }
    if (body.format === "junit") {
      res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
      res.end(buildJunitXml(body.summary));
    } else {
      const name = typeof body.name === "string" ? body.name : "quiver run";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(buildHtmlReport(body.summary, name));
    }
    return;
  }

  throw new HttpError(404, `No route for ${method} ${url.pathname}`);
}

async function handleStatic(res: ServerResponse, pathname: string): Promise<void> {
  // SPA fallback: anything without a file extension serves index.html.
  const relative = path.extname(pathname) ? pathname.slice(1) : "index.html";
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 400, { error: "Bad path" });
    return;
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
    });
    res.end(content);
  } catch {
    if (relative === "index.html") {
      res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<h1>UI not built</h1><p>Run <code>npm run build:ui</code> in the quiver repo, then restart <code>quiver ui</code>.</p>",
      );
    } else {
      sendJson(res, 404, { error: `${pathname} not found` });
    }
  }
}

const MUTATION_STATUS: Record<WorkspaceMutationError["code"], number> = {
  invalid: 400,
  "not-found": 404,
  conflict: 409,
};

export async function startUiServer(
  options: UiServerOptions,
): Promise<RunningServer> {
  const workspaceDir = path.resolve(options.workspaceDir);
  const host = options.host ?? "127.0.0.1";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    const handler = url.pathname.startsWith("/api/")
      ? handleApi(workspaceDir, req, res, url)
      : handleStatic(res, url.pathname);
    handler.catch((error: unknown) => {
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof WorkspaceMutationError
            ? MUTATION_STATUS[error.code]
            : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(res, status, { error: message });
      else res.end();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 4123, host, resolve);
  });
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;

  return {
    server,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
