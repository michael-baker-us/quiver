/**
 * Minimal JSONPath subset: `$` root, `.key` / `["key"]` member access, and
 * `[0]` array index. Covers the assertion/capture cases we support without
 * pulling in a full JSONPath engine; extend or swap for a library if filter
 * expressions are ever needed.
 */

export class JsonPathSyntaxError extends Error {
  constructor(path: string, position: number) {
    super(`Invalid JSONPath "${path}" at position ${position}`);
    this.name = "JsonPathSyntaxError";
  }
}

type Segment = string | number;

const TOKEN =
  /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]|\['((?:[^'\\]|\\.)*)'\]/y;

export function parsePath(path: string): Segment[] {
  if (!path.startsWith("$")) throw new JsonPathSyntaxError(path, 0);
  const segments: Segment[] = [];
  let pos = 1;
  while (pos < path.length) {
    TOKEN.lastIndex = pos;
    const match = TOKEN.exec(path);
    if (!match) throw new JsonPathSyntaxError(path, pos);
    const [, dotKey, index, dqKey, sqKey] = match;
    if (dotKey !== undefined) segments.push(dotKey);
    else if (index !== undefined) segments.push(Number(index));
    else if (dqKey !== undefined) segments.push(dqKey.replace(/\\(.)/g, "$1"));
    else if (sqKey !== undefined) segments.push(sqKey.replace(/\\(.)/g, "$1"));
    pos = TOKEN.lastIndex;
  }
  return segments;
}

const NOT_FOUND: unique symbol = Symbol("not-found");
export { NOT_FOUND };

/** Returns the value at `path`, or NOT_FOUND if any segment is absent. */
export function getPath(root: unknown, path: string): unknown | typeof NOT_FOUND {
  let current: unknown = root;
  for (const segment of parsePath(path)) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return NOT_FOUND;
      current = current[segment];
    } else {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current) ||
        !(segment in current)
      ) {
        return NOT_FOUND;
      }
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}
