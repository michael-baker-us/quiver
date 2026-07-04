import { deref, RefResolutionError } from "./deref.js";

const MAX_DEPTH = 6;

interface SchemaLike {
  type?: string;
  format?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  allOf?: unknown[];
  oneOf?: unknown[];
  anyOf?: unknown[];
  nullable?: boolean;
}

const FORMAT_EXAMPLES: Record<string, string> = {
  "date-time": "2026-01-01T12:00:00Z",
  date: "2026-01-01",
  email: "user@example.com",
  uuid: "00000000-0000-0000-0000-000000000000",
  uri: "https://example.com",
  hostname: "example.com",
  ipv4: "127.0.0.1",
};

/**
 * Produces a plausible example value from a JSON Schema fragment. Explicit
 * `example`/`default`/`enum` values win; otherwise the value is synthesized
 * from the type. Cycles and excessive depth degrade to null rather than
 * failing the whole import.
 */
export function exampleFromSchema(
  doc: unknown,
  schemaNode: unknown,
  seen: ReadonlySet<string> = new Set(),
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return null;

  let schema: SchemaLike;
  let path: ReadonlySet<string>;
  try {
    const resolved = deref(doc, schemaNode, seen);
    schema = (resolved.value ?? {}) as SchemaLike;
    path = resolved.seen;
  } catch (error) {
    if (error instanceof RefResolutionError) return null;
    throw error;
  }

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];

  if (schema.allOf) {
    const merged: Record<string, unknown> = {};
    for (const part of schema.allOf) {
      const value = exampleFromSchema(doc, part, path, depth + 1);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(merged, value);
      }
    }
    return merged;
  }
  const alternative = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (alternative !== undefined) {
    return exampleFromSchema(doc, alternative, path, depth + 1);
  }

  switch (schema.type) {
    case "string":
      return FORMAT_EXAMPLES[schema.format ?? ""] ?? "string";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return true;
    case "array":
      return schema.items !== undefined
        ? [exampleFromSchema(doc, schema.items, path, depth + 1)]
        : [];
    case "object":
    default: {
      if (!schema.properties) return schema.type === "object" ? {} : null;
      const result: Record<string, unknown> = {};
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        result[key] = exampleFromSchema(doc, propSchema, path, depth + 1);
      }
      return result;
    }
  }
}
