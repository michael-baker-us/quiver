import type { CollectionDefinition, HttpMethod, RequestDefinition } from "./schema.js";
import { DEFAULT_BODY_CONTENT_TYPES } from "./http.js";
import type { LoadedCollection } from "./loader.js";

export interface K6ExportOptions {
  vus?: number;
  duration?: string;
}

const VAR_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

function toJsIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || "_value";
}

/**
 * Escapes text for embedding inside a JS template literal. Order matters:
 * backslashes must be doubled first, so a backslash introduced by escaping
 * a backtick isn't itself re-escaped by a later pass.
 */
function escapeForTemplateLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/**
 * Converts quiver's `{{name}}` placeholders into JS template-literal source
 * text (including the surrounding backticks). `{{$env.X}}` becomes
 * `${__ENV.X}` — k6's own mechanism for passing secrets at run time
 * (`k6 run -e X=... script.js`), so secrets are never baked into the
 * generated file. A name already captured earlier in this script becomes a
 * live reference to that JS variable. Anything else is resolved from the
 * environment's variables at export time.
 *
 * `jsonSafe` must be true when `text` is itself already-JSON-serialized
 * text (a request body) — a substituted value can contain a `"` or `\`
 * (a real JWT payload, for instance), and without JSON-escaping it, the
 * substitution would corrupt the JSON syntax around it rather than just
 * fill in a value.
 */
function toJsTemplateLiteral(
  text: string,
  envVars: Record<string, string>,
  capturedNames: ReadonlySet<string>,
  jsonSafe = false,
): string {
  const jsonEscape = (s: string) => JSON.stringify(s).slice(1, -1);
  let out = "";
  let lastIndex = 0;
  VAR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VAR_PATTERN.exec(text))) {
    out += escapeForTemplateLiteral(text.slice(lastIndex, match.index));
    const name = match[1]!.trim();
    if (name.startsWith("$env.")) {
      const expr = "__ENV." + name.slice("$env.".length);
      out += jsonSafe ? `\${JSON.stringify(${expr}).slice(1, -1)}` : `\${${expr}}`;
    } else if (capturedNames.has(name)) {
      const expr = toJsIdentifier(name);
      out += jsonSafe ? `\${JSON.stringify(${expr}).slice(1, -1)}` : `\${${expr}}`;
    } else if (name in envVars) {
      out += escapeForTemplateLiteral(jsonSafe ? jsonEscape(envVars[name]!) : envVars[name]!);
    } else {
      const expr = `__ENV.${name}`;
      out += jsonSafe
        ? `\${JSON.stringify(${expr}).slice(1, -1) /* TODO: unresolved quiver variable "${name}" */}`
        : `\${${expr} /* TODO: unresolved quiver variable "${name}" */}`;
    }
    lastIndex = VAR_PATTERN.lastIndex;
  }
  out += escapeForTemplateLiteral(text.slice(lastIndex));
  return "`" + out + "`";
}

function k6HttpMethod(method: HttpMethod): string {
  return method === "DELETE" ? "del" : method.toLowerCase();
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

/**
 * Converts our JSONPath subset into k6's `res.json(selector)` syntax.
 * Confirmed against a live k6 run: k6's selector is a pure dot-path where
 * array indices are numeric segments (`0.id`), NOT bracket subscripts
 * (`[0].id`, which silently resolves to undefined) — so `$[0].id` must
 * become `0.id`, not `[0].id`.
 */
function jsonpathToK6Selector(jsonpath: string): string {
  const dotted = jsonpath
    .slice(1) // drop leading "$"
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/\["((?:[^"\\]|\\.)*)"\]/g, (_, key: string) => "." + key.replace(/\\(.)/g, "$1"))
    .replace(/\['((?:[^'\\]|\\.)*)'\]/g, (_, key: string) => "." + key.replace(/\\(.)/g, "$1"));
  return dotted.replace(/^\./, "");
}

function jsonAccessor(jsonpath: string, resVar: string): string {
  const selector = jsonpathToK6Selector(jsonpath);
  return selector ? `${resVar}.json(${JSON.stringify(selector)})` : `${resVar}.json()`;
}

function buildHeaders(
  def: RequestDefinition,
  defaults: CollectionDefinition["defaults"] | undefined,
  envVars: Record<string, string>,
  capturedNames: ReadonlySet<string>,
): string[] {
  const merged: Record<string, string> = { ...defaults?.headers, ...def.headers };
  const lines = Object.entries(merged).map(
    ([key, value]) => `${JSON.stringify(key)}: ${toJsTemplateLiteral(value, envVars, capturedNames)},`,
  );
  if (def.auth?.type === "bearer") {
    lines.push(`Authorization: ${toJsTemplateLiteral(`Bearer ${def.auth.token}`, envVars, capturedNames)},`);
  } else if (def.auth?.type === "basic") {
    const user = toJsTemplateLiteral(def.auth.username, envVars, capturedNames);
    const pass = toJsTemplateLiteral(def.auth.password, envVars, capturedNames);
    lines.push(
      "Authorization: `Basic ${encoding.b64encode(" + user + " + ':' + " + pass + ")}`,",
    );
  } else if (def.auth?.type === "apikey") {
    lines.push(
      `${JSON.stringify(def.auth.header)}: ${toJsTemplateLiteral(def.auth.value, envVars, capturedNames)},`,
    );
  }
  // Mirror the runtime's Content-Type defaulting, except for form bodies:
  // k6 sets application/x-www-form-urlencoded itself for plain-object bodies.
  if (def.body && def.body.type !== "form" && !merged["Content-Type"]) {
    lines.push(`"Content-Type": ${JSON.stringify(DEFAULT_BODY_CONTENT_TYPES[def.body.type])},`);
  }
  return lines;
}

function buildUrlExpr(
  def: RequestDefinition,
  envVars: Record<string, string>,
  capturedNames: ReadonlySet<string>,
): string {
  const urlLiteral = toJsTemplateLiteral(def.url, envVars, capturedNames);
  const queryEntries = Object.entries(def.query);
  if (queryEntries.length === 0) return urlLiteral;
  const paramsExpr = queryEntries
    .map(([key, value]) => `${JSON.stringify(key)}: ${toJsTemplateLiteral(value, envVars, capturedNames)}`)
    .join(", ");
  // No URLSearchParams in k6's JS runtime — build the query string by hand.
  return (
    "((_u, _q) => `${_u}?${Object.entries(_q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`)(" +
    `${urlLiteral}, { ${paramsExpr} })`
  );
}

function buildBodyExpr(
  def: RequestDefinition,
  envVars: Record<string, string>,
  capturedNames: ReadonlySet<string>,
): string {
  if (!def.body) return "null";
  if (def.body.type === "text" || def.body.type === "xml" || def.body.type === "csv") {
    return toJsTemplateLiteral(def.body.content, envVars, capturedNames);
  }
  if (def.body.type === "form") {
    const entries = Object.entries(def.body.content)
      .map(([key, value]) => `${JSON.stringify(key)}: ${toJsTemplateLiteral(value, envVars, capturedNames)}`)
      .join(", ");
    return `{ ${entries} }`; // k6 serializes a plain object body as application/x-www-form-urlencoded
  }
  // JSON: resolve {{vars}} textually inside the already-serialized JSON, so
  // nested string fields (auth tokens, ids) get substituted correctly. Uses
  // the JSON-safe substitution mode since a captured/secret value landing
  // inside this text must itself be JSON-escaped, not just JS-escaped.
  return toJsTemplateLiteral(JSON.stringify(def.body.content), envVars, capturedNames, true);
}

/**
 * k6 preserves the server's original header casing (e.g. "Content-Type"),
 * unlike quiver's own runtime which normalizes to lowercase — so header
 * checks look the name up case-insensitively via this helper, declared once
 * per iteration (see `__header` in the generated script).
 */
function buildChecks(def: RequestDefinition, label: string): string[] {
  return def.tests.map((assertion) => {
    const prefix = `${label}: `;
    if ("status" in assertion) {
      return `${JSON.stringify(`${prefix}status is ${assertion.status}`)}: (r) => r.status === ${assertion.status},`;
    }
    if ("header" in assertion) {
      const accessor = `__header(r, ${JSON.stringify(assertion.header)})`;
      if (assertion.equals !== undefined) {
        return `${JSON.stringify(`${prefix}header ${assertion.header} equals`)}: (r) => ${accessor} === ${JSON.stringify(assertion.equals)},`;
      }
      if (assertion.contains !== undefined) {
        return `${JSON.stringify(`${prefix}header ${assertion.header} contains`)}: (r) => (${accessor} || '').includes(${JSON.stringify(assertion.contains)}),`;
      }
      return `${JSON.stringify(`${prefix}header ${assertion.header} is present`)}: (r) => ${accessor} !== undefined,`;
    }
    if ("jsonpath" in assertion) {
      const accessor = jsonAccessor(assertion.jsonpath, "r");
      if (assertion.exists !== undefined) {
        return `${JSON.stringify(`${prefix}jsonpath ${assertion.jsonpath} ${assertion.exists ? "exists" : "does not exist"}`)}: (r) => (${jsonAccessor(assertion.jsonpath, "r")} !== undefined) === ${assertion.exists},`;
      }
      if (assertion.equals !== undefined) {
        return `${JSON.stringify(`${prefix}jsonpath ${assertion.jsonpath} equals`)}: (r) => JSON.stringify(${accessor}) === ${JSON.stringify(JSON.stringify(assertion.equals))},`;
      }
      if (assertion.contains !== undefined) {
        return `${JSON.stringify(`${prefix}jsonpath ${assertion.jsonpath} contains`)}: (r) => String(${accessor}).includes(${JSON.stringify(assertion.contains)}),`;
      }
      return `${JSON.stringify(`${prefix}jsonpath ${assertion.jsonpath} exists`)}: (r) => ${accessor} !== undefined,`;
    }
    if ("bodyContains" in assertion) {
      return `${JSON.stringify(`${prefix}body contains ${assertion.bodyContains}`)}: (r) => r.body.includes(${JSON.stringify(assertion.bodyContains)}),`;
    }
    return `${JSON.stringify(`${prefix}response time below ${assertion.responseTimeBelow}ms`)}: (r) => r.timings.duration < ${assertion.responseTimeBelow},`;
  });
}

/**
 * Assignments (not declarations) — a captured variable is declared once
 * with `let` at the top of the iteration function so it's visible across
 * every request's block; each `{ }` block below is its own lexical scope,
 * so a `const` declared inside one is invisible to a later block.
 */
function buildCaptureAssignments(def: RequestDefinition): string[] {
  return Object.entries(def.capture).map(
    ([name, jsonpath]) => `${toJsIdentifier(name)} = ${jsonAccessor(jsonpath, "res")};`,
  );
}

/** Anchors used by tests to extract the per-iteration function body for isolated evaluation. */
export const K6_ITERATION_SIGNATURE = "function quiverIteration(http, check, encoding, __ENV) {";
export const K6_ITERATION_CLOSE = "}\n\nexport default function () {";

/**
 * Generates a runnable k6 load-test script from a quiver collection. Runs
 * requests in the same order as `quiver run`, threading captured variables
 * into later requests exactly as the real runner does. `envVars` should be
 * the variables from the environment picked at export time; `{{$env.*}}`
 * secrets are left dynamic (mapped to k6's own `__ENV`) rather than baked in.
 */
export function exportK6(
  loaded: LoadedCollection,
  envVars: Record<string, string>,
  options: K6ExportOptions = {},
): string {
  const vus = options.vus ?? 10;
  const duration = options.duration ?? "30s";
  const capturedNames = new Set<string>();
  const blocks: string[] = [];

  const allCaptureNames = new Set<string>();
  for (const request of loaded.requests) {
    for (const name of Object.keys(request.definition.capture)) allCaptureNames.add(name);
  }
  const captureDeclarationLine =
    allCaptureNames.size > 0
      ? `let ${[...allCaptureNames].map(toJsIdentifier).join(", ")};`
      : "";

  for (const request of loaded.requests) {
    const def = request.definition;
    const label = def.name ?? request.relativePath;
    const urlExpr = buildUrlExpr(def, envVars, capturedNames);
    const headerLines = buildHeaders(def, loaded.collection.defaults, envVars, capturedNames);
    const bodyExpr = buildBodyExpr(def, envVars, capturedNames);
    const checks = buildChecks(def, label);
    const captureAssignments = buildCaptureAssignments(def);
    const timeoutMs = def.timeoutMs ?? loaded.collection.defaults?.timeoutMs;

    const paramsLines = [
      "headers: {",
      indent(headerLines.join("\n"), 2),
      "},",
      ...(timeoutMs ? [`timeout: ${JSON.stringify(`${timeoutMs}ms`)},`] : []),
    ].join("\n");

    const isBodyless = def.method === "GET" || def.method === "HEAD" || def.method === "OPTIONS";
    const args = isBodyless
      ? [urlExpr, `{\n${indent(paramsLines, 2)}\n}`]
      : [urlExpr, bodyExpr, `{\n${indent(paramsLines, 2)}\n}`];

    const block = [
      `// ${label}`,
      "{",
      `const res = http.${k6HttpMethod(def.method)}(`,
      indent(args.join(",\n"), 2),
      ");",
      checks.length > 0
        ? ["check(res, {", indent(checks.join("\n"), 2), "});"].join("\n")
        : "",
      ...captureAssignments,
      "}",
    ]
      .filter(Boolean)
      .join("\n");

    blocks.push(indent(block, 2));
    for (const name of Object.keys(def.capture)) capturedNames.add(name);
  }

  return [
    "import http from 'k6/http';",
    "import encoding from 'k6/encoding';",
    "import { check, sleep } from 'k6';",
    "",
    "// Generated by `quiver export-k6` — https://github.com/michael-baker-us/quiver",
    "// Secrets ({{$env.NAME}}) map to k6 environment variables: k6 run -e NAME=value script.js",
    "export const options = {",
    `  vus: ${vus},`,
    `  duration: ${JSON.stringify(duration)},`,
    "};",
    "",
    K6_ITERATION_SIGNATURE,
    "  const __header = (r, name) => {",
    "    const k = Object.keys(r.headers).find((x) => x.toLowerCase() === name.toLowerCase());",
    "    return k ? r.headers[k] : undefined;",
    "  };",
    ...(captureDeclarationLine ? [indent(captureDeclarationLine, 2)] : []),
    "",
    blocks.join("\n\n"),
    K6_ITERATION_CLOSE,
    "  quiverIteration(http, check, encoding, __ENV);",
    "  sleep(1); // adjust or remove to control pacing between iterations",
    "}",
    "",
  ].join("\n");
}
