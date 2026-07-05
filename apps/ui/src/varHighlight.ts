// Mirrors the placeholder syntax in packages/core/src/variables.ts. Kept in
// sync by the shared pattern below; the UI version never throws — it reports
// resolution status so hover tooltips can explain what will happen at send
// time instead of failing.
const VAR_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const ENV_PREFIX = "$env.";
const MAX_DEPTH = 5;

export type VariableToken =
  | { kind: "text"; raw: string; start: number }
  | { kind: "var"; raw: string; name: string; start: number };

/** Splits text into literal runs and {{variable}} placeholders, preserving offsets. */
export function tokenizeVariables(input: string): VariableToken[] {
  const tokens: VariableToken[] = [];
  let last = 0;
  for (const match of input.matchAll(VAR_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) {
      tokens.push({ kind: "text", raw: input.slice(last, start), start: last });
    }
    tokens.push({ kind: "var", raw: match[0], name: (match[1] ?? "").trim(), start });
    last = start + match[0].length;
  }
  if (last < input.length) {
    tokens.push({ kind: "text", raw: input.slice(last), start: last });
  }
  return tokens;
}

export type VariableResolution =
  /** Defined in the current environment; `value` has nested placeholders expanded. */
  | { status: "resolved"; value: string }
  /** {{$env.NAME}} — read from the server's OS environment when sending. */
  | { status: "env"; envName: string }
  /** Unknown here — either a typo or a variable captured earlier in a run. */
  | { status: "missing" };

export function resolveVariableForDisplay(
  name: string,
  vars: Record<string, string>,
): VariableResolution {
  if (name.startsWith(ENV_PREFIX)) {
    return { status: "env", envName: name.slice(ENV_PREFIX.length) };
  }
  const direct = vars[name];
  if (direct === undefined) return { status: "missing" };
  let value = direct;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const next = value.replace(VAR_PATTERN, (match, rawName: string) => {
      const nested = rawName.trim();
      if (nested.startsWith(ENV_PREFIX)) return match;
      return vars[nested] ?? match;
    });
    if (next === value) break;
    value = next;
  }
  return { status: "resolved", value };
}
