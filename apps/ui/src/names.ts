/**
 * Client-side normalizers for names typed into creation/rename dialogs.
 * These mirror the server's validation so mistakes are caught before a
 * request is made — the server remains the authority.
 */

/** Matches core's rule: segments start alphanumeric, then word chars, dots, dashes. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function cleanSegments(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, "-");
  if (!cleaned || cleaned.includes("\\")) return null;
  // Dot-leading segments cover both traversal ("..") and hidden files.
  if (cleaned.split("/").some((seg) => seg === "" || seg.startsWith("."))) return null;
  return cleaned;
}

/** Normalizes user input like "users/create user" to a valid request path. */
export function toRequestPath(input: string): string | null {
  const cleaned = cleanSegments(
    input.replace(/\.request\.ya?ml$/i, "").replace(/\.ya?ml$/i, ""),
  );
  return cleaned ? `${cleaned}.request.yaml` : null;
}

/** Normalizes a folder path; the top-level environments/ dir is reserved. */
export function toFolderPath(input: string): string | null {
  const cleaned = cleanSegments(input);
  if (!cleaned) return null;
  if (cleaned === "environments" || cleaned.startsWith("environments/")) return null;
  return cleaned;
}

/** Environment names are single path segments (they become environments/<name>.yaml). */
export function toEnvironmentName(input: string): string | null {
  const cleaned = input.trim().replace(/\s+/g, "-");
  return NAME_PATTERN.test(cleaned) ? cleaned : null;
}

/**
 * Derives a directory name from a collection's display name, Postman-style:
 * the user types "My Orders API", the folder becomes my-orders-api.
 */
export function toCollectionDirName(input: string): string | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9./_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/.]+|[-/.]+$/g, "");
  if (!cleaned) return null;
  const segments = cleaned.split("/");
  if (segments.length > 3) return null;
  if (!segments.every((seg) => NAME_PATTERN.test(seg))) return null;
  return cleaned;
}
