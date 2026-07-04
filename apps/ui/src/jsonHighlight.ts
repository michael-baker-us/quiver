export type JsonTokenType = "key" | "string" | "number" | "literal" | "plain";

export interface JsonToken {
  type: JsonTokenType;
  text: string;
}

/** Bodies larger than this render unhighlighted — tokenizing megabytes of JSON would jank the UI. */
export const HIGHLIGHT_MAX_CHARS = 200_000;

const TOKEN_PATTERN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/**
 * Tokenizes pretty-printed JSON text for syntax highlighting. Purely
 * lexical — it never parses, so malformed or truncated JSON degrades to
 * sensible coloring instead of failing. Concatenating the returned token
 * texts always reproduces the input exactly.
 */
export function tokenizeJson(text: string): JsonToken[] {
  if (text.length > HIGHLIGHT_MAX_CHARS) return [{ type: "plain", text }];

  const tokens: JsonToken[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index!;
    if (index > last) tokens.push({ type: "plain", text: text.slice(last, index) });
    const [full, stringPart, colonPart] = match;
    if (stringPart !== undefined) {
      if (colonPart !== undefined) {
        tokens.push({ type: "key", text: stringPart });
        tokens.push({ type: "plain", text: colonPart });
      } else {
        tokens.push({ type: "string", text: stringPart });
      }
    } else if (full === "true" || full === "false" || full === "null") {
      tokens.push({ type: "literal", text: full });
    } else {
      tokens.push({ type: "number", text: full });
    }
    last = index + full.length;
  }
  if (last < text.length) tokens.push({ type: "plain", text: text.slice(last) });
  return tokens;
}
