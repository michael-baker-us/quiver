import { HIGHLIGHT_MAX_CHARS } from "./jsonHighlight.js";

export type XmlTokenType = "tag" | "attr" | "string" | "comment" | "plain";

export interface XmlToken {
  type: XmlTokenType;
  text: string;
}

/**
 * Chunks the document into comments, CDATA sections, and tag-shaped spans;
 * everything between chunks is text content. Unterminated constructs match
 * to end-of-input so truncated bodies still tokenize.
 */
const CHUNK_PATTERN =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[^>]*(?:>|$)/g;

const TAG_OPEN_PATTERN = /^<[/?!]?[\w.:-]*/;
const TAG_CLOSE_PATTERN = /(\/>|\?>|>)$/;
const ATTR_PATTERN =
  /([\w.:-]+)(\s*=\s*)("[^"]*"?|'[^']*'?)|"[^"]*"?|'[^']*'?|[\w.:-]+/g;

/** Tokenizes the inside of a single tag: name, attributes, quoted values. */
function tokenizeTag(chunk: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  const open = TAG_OPEN_PATTERN.exec(chunk)![0];
  tokens.push({ type: "tag", text: open });

  let rest = chunk.slice(open.length);
  const closeMatch = TAG_CLOSE_PATTERN.exec(rest);
  const close = closeMatch ? closeMatch[0] : "";
  if (close) rest = rest.slice(0, rest.length - close.length);

  let last = 0;
  for (const match of rest.matchAll(ATTR_PATTERN)) {
    const index = match.index!;
    if (index > last) tokens.push({ type: "plain", text: rest.slice(last, index) });
    const [full, name, equals, value] = match;
    if (name !== undefined && equals !== undefined && value !== undefined) {
      tokens.push({ type: "attr", text: name });
      tokens.push({ type: "plain", text: equals });
      tokens.push({ type: "string", text: value });
    } else if (full.startsWith('"') || full.startsWith("'")) {
      tokens.push({ type: "string", text: full });
    } else {
      tokens.push({ type: "attr", text: full });
    }
    last = index + full.length;
  }
  if (last < rest.length) tokens.push({ type: "plain", text: rest.slice(last) });

  if (close) tokens.push({ type: "tag", text: close });
  return tokens;
}

/**
 * Tokenizes XML text for syntax highlighting. Purely lexical, like
 * tokenizeJson — malformed or truncated markup degrades to sensible coloring
 * instead of failing. Concatenating the returned token texts always
 * reproduces the input exactly.
 */
export function tokenizeXml(text: string): XmlToken[] {
  if (text.length > HIGHLIGHT_MAX_CHARS) return [{ type: "plain", text }];

  const tokens: XmlToken[] = [];
  let last = 0;
  for (const match of text.matchAll(CHUNK_PATTERN)) {
    const index = match.index!;
    if (index > last) tokens.push({ type: "plain", text: text.slice(last, index) });
    const chunk = match[0];
    if (chunk.startsWith("<!--")) {
      tokens.push({ type: "comment", text: chunk });
    } else if (chunk.startsWith("<![CDATA[")) {
      tokens.push({ type: "string", text: chunk });
    } else {
      tokens.push(...tokenizeTag(chunk));
    }
    last = index + chunk.length;
  }
  if (last < text.length) tokens.push({ type: "plain", text: text.slice(last) });
  return tokens;
}
