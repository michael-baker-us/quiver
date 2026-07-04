const VAR_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const ENV_PREFIX = "$env.";
const MAX_DEPTH = 5;

export class MissingVariableError extends Error {
  constructor(public readonly names: string[]) {
    super(`Unresolved variable(s): ${names.join(", ")}`);
    this.name = "MissingVariableError";
  }
}

function substituteOnce(
  input: string,
  vars: Record<string, string>,
  missing: Set<string>,
): string {
  return input.replace(VAR_PATTERN, (match, rawName: string) => {
    const name = rawName.trim();
    if (name.startsWith(ENV_PREFIX)) {
      const envName = name.slice(ENV_PREFIX.length);
      const value = process.env[envName];
      if (value === undefined) {
        missing.add(name);
        return match;
      }
      return value;
    }
    const value = vars[name];
    if (value === undefined) {
      missing.add(name);
      return match;
    }
    return value;
  });
}

/**
 * Replaces {{name}} placeholders from `vars` and {{$env.NAME}} from process
 * env. Variable values may themselves contain placeholders (resolved up to
 * MAX_DEPTH levels). Throws MissingVariableError listing every unresolvable
 * name, so a user sees all problems at once rather than one per run.
 */
export function resolveString(
  input: string,
  vars: Record<string, string>,
): string {
  let current = input;
  const missing = new Set<string>();
  for (let i = 0; i < MAX_DEPTH; i++) {
    missing.clear();
    const next = substituteOnce(current, vars, missing);
    if (next === current) break;
    current = next;
  }
  if (missing.size > 0) {
    throw new MissingVariableError([...missing].sort());
  }
  return current;
}

/** Recursively resolves placeholders in every string of a JSON-like value. */
export function resolveDeep(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") return resolveString(value, vars);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, vars));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveDeep(v, vars),
      ]),
    );
  }
  return value;
}

export function resolveStringMap(
  map: Record<string, string>,
  vars: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k, resolveString(v, vars)]),
  );
}
