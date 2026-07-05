export type ResponseBodyFormat = "json" | "xml" | "csv" | "text";

/**
 * Picks the response body renderer from the Content-Type header. The header
 * wins over JSON sniffing so a text/csv body like "123" (valid JSON) still
 * renders as CSV. Without a recognized header we keep the historical
 * behavior: anything that parsed as JSON renders as JSON.
 */
export function detectBodyFormat(
  contentType: string | undefined,
  hasParsedJson: boolean,
): ResponseBodyFormat {
  const mediaType = (contentType ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  // "includes" catches suffixed types too: application/hal+json, image/svg+xml.
  if (mediaType.includes("json")) return hasParsedJson ? "json" : "text";
  if (mediaType.includes("xml")) return "xml";
  if (mediaType.includes("csv")) return "csv";
  return hasParsedJson ? "json" : "text";
}

/**
 * Parses CSV text (RFC 4180: quoted fields, "" escapes, CRLF or LF rows)
 * into rows of cells. Returns null on an unterminated quote — the one case
 * where a table would misrepresent the data — so callers can fall back to
 * showing the raw text. Rows may be ragged; the table renders them as-is.
 */
export function parseCsv(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        field += text[i];
        i++;
      }
      if (!closed) return null;
    } else if (char === ",") {
      endField();
      i++;
    } else if (char === "\n") {
      endRow();
      i++;
    } else if (char === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      i++;
    }
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}
