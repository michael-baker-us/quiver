import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  listEnvironments,
  loadCollection,
  loadEnvironment,
  requestFileSchema,
  runCollection,
  runRequest,
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
  /** Collection root directory (contains collection.yaml). */
  rootDir: string;
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

/**
 * Maps a client-supplied relative path to an absolute path inside the
 * collection, rejecting traversal attempts and non-request files. Every
 * filesystem write the server performs goes through this gate.
 */
function resolveRequestPath(rootDir: string, relativePath: string): string {
  const target = path.resolve(rootDir, relativePath);
  if (!target.startsWith(rootDir + path.sep)) {
    throw new HttpError(400, "Path escapes the collection directory");
  }
  if (!target.endsWith(".request.yaml")) {
    throw new HttpError(400, "Only *.request.yaml files can be accessed");
  }
  return target;
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

async function handleApi(
  rootDir: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/collection") {
    const loaded = await loadCollection(rootDir);
    sendJson(res, 200, {
      name: loaded.collection.name,
      description: loaded.collection.description,
      environments: await listEnvironments(rootDir),
      requests: loaded.requests.map((request) => ({
        relativePath: request.relativePath,
        name: request.definition.name ?? request.relativePath,
        method: request.definition.method,
      })),
    });
    return;
  }

  if (url.pathname.startsWith("/api/requests/")) {
    const relativePath = decodeURIComponent(
      url.pathname.slice("/api/requests/".length),
    );
    const filePath = resolveRequestPath(rootDir, relativePath);

    if (req.method === "GET") {
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        throw new HttpError(404, `${relativePath} not found`);
      }
      sendJson(res, 200, { relativePath, content });
      return;
    }

    if (req.method === "PUT") {
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
  }

  if (route === "POST /api/send") {
    const body = (await readBody(req)) as { path?: unknown; env?: unknown };
    if (typeof body.path !== "string") {
      throw new HttpError(400, "Expected JSON body: { path: string, env?: string }");
    }
    resolveRequestPath(rootDir, body.path); // traversal guard
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

  if (route === "POST /api/run") {
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
    const summary = await runCollection(loaded, {
      variables,
      bail: body.bail === true,
      onResult: (result) => {
        res.write(
          JSON.stringify({ type: "result", ...serializeResult(result, false) }) +
            "\n",
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

  throw new HttpError(404, `No route for ${route}`);
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

export async function startUiServer(
  options: UiServerOptions,
): Promise<RunningServer> {
  const rootDir = path.resolve(options.rootDir);
  const host = options.host ?? "127.0.0.1";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    const handler = url.pathname.startsWith("/api/")
      ? handleApi(rootDir, req, res, url)
      : handleStatic(res, url.pathname);
    handler.catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
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
