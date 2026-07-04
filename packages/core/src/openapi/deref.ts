/**
 * Local $ref resolution for OpenAPI documents ("#/components/schemas/User").
 * External file refs are not supported — callers surface that as a warning.
 */

export class RefResolutionError extends Error {
  constructor(ref: string, reason: string) {
    super(`Cannot resolve $ref "${ref}": ${reason}`);
    this.name = "RefResolutionError";
  }
}

function isRefNode(node: unknown): node is { $ref: string } {
  return (
    node !== null &&
    typeof node === "object" &&
    typeof (node as { $ref?: unknown }).$ref === "string"
  );
}

function lookupPointer(doc: unknown, ref: string): unknown {
  const pointer = ref.slice(1); // drop leading '#'
  let current: unknown = doc;
  for (const rawSegment of pointer.split("/").slice(1)) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object") {
      throw new RefResolutionError(ref, `"${segment}" not found`);
    }
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) {
      throw new RefResolutionError(ref, `"${segment}" not found`);
    }
  }
  return current;
}

/**
 * Returns `node`, following $ref chains until a concrete value is reached.
 * `seen` carries the refs already followed on this path — a repeat means a
 * cycle, which is reported rather than looping forever.
 */
export function deref(
  doc: unknown,
  node: unknown,
  seen: ReadonlySet<string> = new Set(),
): { value: unknown; seen: ReadonlySet<string> } {
  let current = node;
  const path = new Set(seen);
  while (isRefNode(current)) {
    const ref = current.$ref;
    if (!ref.startsWith("#/")) {
      throw new RefResolutionError(ref, "external refs are not supported");
    }
    if (path.has(ref)) {
      throw new RefResolutionError(ref, "circular reference");
    }
    path.add(ref);
    current = lookupPointer(doc, ref);
  }
  return { value: current, seen: path };
}
