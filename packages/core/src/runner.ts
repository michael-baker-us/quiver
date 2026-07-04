import { evaluateAssertion, type AssertionResult } from "./assertions.js";
import { getPath, NOT_FOUND } from "./jsonpath.js";
import {
  DEFAULT_TIMEOUT_MS,
  executeRequest,
  type HttpResponse,
  type ResolvedRequest,
} from "./http.js";
import type { LoadedCollection, LoadedRequest } from "./loader.js";
import type { CollectionDefinition, RequestDefinition } from "./schema.js";
import { resolveDeep, resolveString, resolveStringMap } from "./variables.js";

export interface RequestResult {
  request: LoadedRequest;
  /** Undefined when the request could not be sent (resolution/network error). */
  response?: HttpResponse;
  error?: string;
  assertions: AssertionResult[];
  /** Variables captured from this response, e.g. { userId: "42" }. */
  captured: Record<string, string>;
  passed: boolean;
}

export interface RunSummary {
  results: RequestResult[];
  passed: number;
  failed: number;
  durationMs: number;
}

export interface RunOptions {
  variables?: Record<string, string>;
  /** Stop at the first failing request. */
  bail?: boolean;
  /** Called after each request completes; lets reporters stream progress. */
  onResult?: (result: RequestResult) => void;
}

export function resolveRequest(
  definition: RequestDefinition,
  variables: Record<string, string>,
  collection?: CollectionDefinition,
): ResolvedRequest {
  const defaults = collection?.defaults;
  return {
    name: definition.name ?? definition.url,
    method: definition.method,
    url: resolveString(definition.url, variables),
    headers: resolveStringMap(
      { ...defaults?.headers, ...definition.headers },
      variables,
    ),
    query: resolveStringMap(definition.query, variables),
    auth: definition.auth
      ? (resolveDeep(definition.auth, variables) as ResolvedRequest["auth"])
      : undefined,
    body: definition.body
      ? (resolveDeep(definition.body, variables) as ResolvedRequest["body"])
      : undefined,
    timeoutMs:
      definition.timeoutMs ?? defaults?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

function captureVariables(
  capture: Record<string, string>,
  response: HttpResponse,
): { captured: Record<string, string>; errors: string[] } {
  const captured: Record<string, string> = {};
  const errors: string[] = [];
  for (const [name, jsonPath] of Object.entries(capture)) {
    if (response.bodyJson === undefined) {
      errors.push(`capture ${name}: response body is not valid JSON`);
      continue;
    }
    const value = getPath(response.bodyJson, jsonPath);
    if (value === NOT_FOUND) {
      errors.push(`capture ${name}: ${jsonPath} not found in response`);
      continue;
    }
    captured[name] =
      typeof value === "string" ? value : JSON.stringify(value);
  }
  return { captured, errors };
}

export async function runRequest(
  request: LoadedRequest,
  variables: Record<string, string>,
  collection?: CollectionDefinition,
): Promise<RequestResult> {
  let response: HttpResponse;
  try {
    const resolved = resolveRequest(request.definition, variables, collection);
    response = await executeRequest(resolved);
  } catch (error) {
    return {
      request,
      error: error instanceof Error ? error.message : String(error),
      assertions: [],
      captured: {},
      passed: false,
    };
  }

  const assertions = request.definition.tests.map((assertion) =>
    evaluateAssertion(assertion, response),
  );
  const { captured, errors } = captureVariables(
    request.definition.capture,
    response,
  );
  for (const message of errors) {
    assertions.push({ ok: false, description: message });
  }

  return {
    request,
    response,
    assertions,
    captured,
    passed: assertions.every((a) => a.ok),
  };
}

/**
 * Runs every request in the collection sequentially, in file order.
 * Variables captured by earlier requests are visible to later ones, which is
 * what makes login → authenticated-call flows work.
 */
export async function runCollection(
  loaded: LoadedCollection,
  options: RunOptions = {},
): Promise<RunSummary> {
  const variables = { ...options.variables };
  const results: RequestResult[] = [];
  const started = performance.now();

  for (const request of loaded.requests) {
    const result = await runRequest(request, variables, loaded.collection);
    Object.assign(variables, result.captured);
    results.push(result);
    options.onResult?.(result);
    if (!result.passed && options.bail) break;
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    results,
    passed,
    failed: results.length - passed,
    durationMs: performance.now() - started,
  };
}
