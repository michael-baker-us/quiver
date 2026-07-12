// Pretty-printers for the request-body editor's "Format" button. Purely a
// display/editing affordance — the runner parses JSON regardless of
// whitespace, so formatting never changes what gets sent.

/** Reformats JSON with 2-space indentation, or null if the text isn't valid JSON. */
export function formatJson(text: string): string | null {
  if (text.trim() === "") return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/** Matches one XML node: a whole tag (`<...>`) or a run of text between tags. */
const XML_NODE = /<[^>]+>|[^<]+/g;

/**
 * Best-effort XML reindenter. Lexical, not a parser: it tracks tag depth and
 * keeps an element that holds only text on one line (`<a>text</a>`). Constructs
 * whose content can contain `>` (CDATA, comments) may not survive intact — the
 * button is a convenience, not a canonicalizer.
 */
export function formatXml(input: string): string {
  const tokens = input.match(XML_NODE);
  if (!tokens) return input;

  const pad = (depth: number) => "  ".repeat(Math.max(0, depth));
  const lines: string[] = [];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!.trim();
    if (!tok) continue;

    if (tok.startsWith("</")) {
      depth--;
      lines.push(pad(depth) + tok);
    } else if (tok.startsWith("<?") || tok.startsWith("<!") || tok.endsWith("/>")) {
      // Declaration, comment, doctype, or self-closing element.
      lines.push(pad(depth) + tok);
    } else if (tok.startsWith("<")) {
      // Opening tag. Collapse `<tag>text</tag>` onto a single line.
      const next = tokens[i + 1]?.trim();
      const after = tokens[i + 2]?.trim();
      if (next && !next.startsWith("<") && after?.startsWith("</")) {
        lines.push(pad(depth) + tok + next + after);
        i += 2;
      } else {
        lines.push(pad(depth) + tok);
        depth++;
      }
    } else {
      lines.push(pad(depth) + tok);
    }
  }

  return lines.join("\n");
}
