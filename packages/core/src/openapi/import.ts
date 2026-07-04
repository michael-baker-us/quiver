import { readFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { deref, RefResolutionError } from "./deref.js";
import { exampleFromSchema } from "./example.js";
import { httpMethodSchema, type Assertion, type Auth, type HttpMethod } from "../schema.js";

export interface ImportResult {
  collectionName: string;
  /** Relative path within the new collection dir → YAML file content. */
  files: Map<string, string>;
  warnings: string[];
}

interface ParameterObject {
  name?: string;
  in?: string;
  required?: boolean;
  example?: unknown;
  schema?: unknown;
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  security?: Record<string, unknown>[];
}

interface SecuritySchemeObject {
  type?: string;
  scheme?: string;
  in?: string;
  name?: string;
}

export function kebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function toEnvVarName(schemeName: string, suffix: string): string {
  const base = schemeName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
  return `${base}_${suffix}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export async function loadOpenApiFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return parseYaml(raw); // YAML is a superset of JSON, so this handles both
}

function resolveAuth(
  doc: Record<string, unknown>,
  operation: OperationObject,
  warnings: string[],
): Auth | undefined {
  const security =
    operation.security ??
    (asRecord(doc)?.security as Record<string, unknown>[] | undefined);
  const first = security?.[0];
  if (!first) return undefined;
  const schemeName = Object.keys(first)[0];
  if (!schemeName) return undefined;

  const components = asRecord(doc.components);
  const schemes = asRecord(components?.securitySchemes);
  const scheme = asRecord(schemes?.[schemeName]) as
    | SecuritySchemeObject
    | undefined;
  if (!scheme) {
    warnings.push(`security scheme "${schemeName}" is not defined; skipped`);
    return undefined;
  }

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return { type: "bearer", token: `{{$env.${toEnvVarName(schemeName, "TOKEN")}}}` };
  }
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return {
      type: "basic",
      username: `{{$env.${toEnvVarName(schemeName, "USERNAME")}}}`,
      password: `{{$env.${toEnvVarName(schemeName, "PASSWORD")}}}`,
    };
  }
  if (scheme.type === "apiKey" && scheme.in === "header" && scheme.name) {
    return {
      type: "apikey",
      header: scheme.name,
      value: `{{$env.${toEnvVarName(schemeName, "KEY")}}}`,
    };
  }
  warnings.push(
    `security scheme "${schemeName}" (${scheme.type ?? "unknown"}) is not supported; add auth manually`,
  );
  return undefined;
}

function parameterValue(doc: unknown, param: ParameterObject): string {
  if (param.example !== undefined) return String(param.example);
  const example = param.schema
    ? exampleFromSchema(doc, param.schema)
    : undefined;
  if (
    example !== undefined &&
    example !== null &&
    example !== "string" &&
    typeof example !== "object"
  ) {
    return String(example);
  }
  return `{{${param.name}}}`; // fails loudly at run time until the user fills it in
}

function buildRequestObject(
  doc: Record<string, unknown>,
  urlPath: string,
  method: HttpMethod,
  operation: OperationObject,
  pathParameters: unknown[],
  warnings: string[],
): Record<string, unknown> {
  const label = `${method} ${urlPath}`;
  const request: Record<string, unknown> = {
    name: operation.summary ?? operation.operationId ?? label,
    method,
  };

  const parameters = [...pathParameters, ...(operation.parameters ?? [])]
    .map((p) => deref(doc, p).value as ParameterObject)
    .filter((p) => p.name !== undefined);

  let url = urlPath;
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  for (const param of parameters) {
    switch (param.in) {
      case "path":
        url = url.replace(`{${param.name}}`, parameterValue(doc, param));
        break;
      case "query":
        if (param.required) query[param.name!] = parameterValue(doc, param);
        break;
      case "header":
        if (param.required) headers[param.name!] = parameterValue(doc, param);
        break;
      default:
        break; // cookie params are rare; skip silently
    }
  }
  request.url = `{{baseUrl}}${url}`;
  if (Object.keys(headers).length > 0) request.headers = headers;
  if (Object.keys(query).length > 0) request.query = query;

  const auth = resolveAuth(doc, operation, warnings);
  if (auth) request.auth = auth;

  if (operation.requestBody !== undefined) {
    const requestBody = asRecord(deref(doc, operation.requestBody).value);
    const content = asRecord(requestBody?.content);
    const jsonContent = asRecord(content?.["application/json"]);
    if (jsonContent?.schema !== undefined) {
      request.body = {
        type: "json",
        content: exampleFromSchema(doc, jsonContent.schema),
      };
    } else if (content) {
      warnings.push(
        `${label}: request body has no application/json content; add body manually`,
      );
    }
  }

  const statusCodes = Object.keys(operation.responses ?? {})
    .filter((code) => /^2\d\d$/.test(code))
    .sort();
  const expectedStatus = statusCodes[0] ? Number(statusCodes[0]) : 200;
  const tests: Assertion[] = [{ status: expectedStatus }];
  const response = asRecord(
    operation.responses?.[statusCodes[0] ?? ""] !== undefined
      ? deref(doc, operation.responses![statusCodes[0]!]).value
      : undefined,
  );
  if (asRecord(response?.content)?.["application/json"] !== undefined) {
    tests.push({ header: "content-type", contains: "application/json" });
  }
  request.tests = tests;

  return request;
}

function requestFileName(
  urlPath: string,
  method: HttpMethod,
  operation: OperationObject,
): string {
  if (operation.operationId) return kebabCase(operation.operationId);
  const slug = kebabCase(urlPath.replace(/[{}]/g, ""));
  return `${method.toLowerCase()}-${slug || "root"}`;
}

function groupDir(urlPath: string, operation: OperationObject): string {
  const tag = operation.tags?.[0];
  if (tag) return kebabCase(tag);
  const segment = urlPath.split("/").find((s) => s && !s.startsWith("{"));
  return segment ? kebabCase(segment) : "root";
}

/**
 * Converts an OpenAPI 3.x document into a quiver collection: one request
 * file per operation, grouped by tag, with example bodies, auth mapped to
 * {{$env.*}} secrets, and a status assertion per request. Returns files
 * in memory; callers decide where (or whether) to write them.
 */
export function importOpenApi(spec: unknown): ImportResult {
  const doc = asRecord(spec);
  if (!doc) throw new Error("Spec is not a JSON/YAML object");
  if (typeof doc.swagger === "string") {
    throw new Error(
      "Swagger 2.0 specs are not supported — convert to OpenAPI 3.x first (e.g. with swagger2openapi)",
    );
  }
  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3.")) {
    throw new Error("Not an OpenAPI 3.x document (missing/unsupported 'openapi' field)");
  }

  const warnings: string[] = [];
  const files = new Map<string, string>();
  const info = asRecord(doc.info);
  const collectionName =
    typeof info?.title === "string" ? info.title : "Imported API";

  const collection: Record<string, unknown> = { name: collectionName };
  if (typeof info?.description === "string") {
    collection.description = info.description;
  }
  files.set("collection.yaml", stringifyYaml(collection));

  const servers = doc.servers as { url?: string }[] | undefined;
  let baseUrl = servers?.[0]?.url?.replace(/\/+$/, "");
  if (!baseUrl || baseUrl.startsWith("/")) {
    warnings.push(
      "spec has no absolute server URL — set baseUrl in environments/default.yaml",
    );
    baseUrl = "https://CHANGE-ME.example.com";
  }
  files.set(
    "environments/default.yaml",
    stringifyYaml({ variables: { baseUrl } }),
  );

  const paths = asRecord(doc.paths) ?? {};
  for (const [urlPath, rawPathItem] of Object.entries(paths)) {
    let pathItem: Record<string, unknown> | undefined;
    try {
      pathItem = asRecord(deref(doc, rawPathItem).value);
    } catch (error) {
      if (error instanceof RefResolutionError) {
        warnings.push(`${urlPath}: ${error.message}; skipped`);
        continue;
      }
      throw error;
    }
    if (!pathItem) continue;
    const pathParameters = (pathItem.parameters as unknown[]) ?? [];

    for (const [key, value] of Object.entries(pathItem)) {
      const parsedMethod = httpMethodSchema.safeParse(key.toUpperCase());
      if (!parsedMethod.success) continue;
      const operation = asRecord(value) as OperationObject | undefined;
      if (!operation) continue;

      const method = parsedMethod.data;
      const label = `${method} ${urlPath}`;
      let request: Record<string, unknown>;
      try {
        request = buildRequestObject(
          doc,
          urlPath,
          method,
          operation,
          pathParameters,
          warnings,
        );
      } catch (error) {
        if (error instanceof RefResolutionError) {
          warnings.push(`${label}: ${error.message}; skipped`);
          continue;
        }
        throw error;
      }

      const dir = groupDir(urlPath, operation);
      let fileName = requestFileName(urlPath, method, operation);
      let relativePath = `${dir}/${fileName}.request.yaml`;
      for (let n = 2; files.has(relativePath); n++) {
        relativePath = `${dir}/${fileName}-${n}.request.yaml`;
      }
      files.set(relativePath, stringifyYaml(request));
    }
  }

  return { collectionName, files, warnings: [...new Set(warnings)] };
}
