import { tokenizeJson } from "./jsonHighlight.js";
import { tokenizeXml } from "./xmlHighlight.js";

// Bridges the read-only response tokenizers (jsonHighlight / xmlHighlight) to
// the editable request-body overlay. The overlay first splits text on
// {{variables}} (which stay interactive); each literal run between variables is
// then colored here. Reusing the same tokenizers keeps request and response
// highlighting identical.

export type BodySyntax = "json" | "xml";

export interface SyntaxSpan {
  /** CSS class (`json-key`, `xml-tag`, …) or null for uncolored text. */
  className: string | null;
  text: string;
}

/**
 * Colors a run of body text. Concatenating the spans' text reproduces the
 * input exactly, so the overlay stays glyph-aligned with the textarea beneath.
 */
export function highlightSyntax(text: string, syntax: BodySyntax): SyntaxSpan[] {
  if (syntax === "json") {
    return tokenizeJson(text).map((t) => ({
      className: t.type === "plain" ? null : `json-${t.type}`,
      text: t.text,
    }));
  }
  return tokenizeXml(text).map((t) => ({
    className: t.type === "plain" ? null : `xml-${t.type}`,
    text: t.text,
  }));
}
