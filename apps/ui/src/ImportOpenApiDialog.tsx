import { useState } from "react";
import { importOpenApiSpec, type ImportOpenApiResult } from "./api.js";
import { toCollectionDirName } from "./names.js";

/**
 * Imports an OpenAPI 3.x spec as a new collection: pick a YAML/JSON file,
 * confirm the folder name (pre-filled from the file name), and the server
 * generates one request per operation. Importer warnings (unmapped auth
 * schemes, non-JSON bodies, missing server URLs) are shown before the dialog
 * closes so they aren't silently dropped.
 */
export function ImportOpenApiDialog({
  onImported,
  onClose,
}: {
  /** Called once the collection exists on disk, before warnings are shown. */
  onImported: (result: ImportOpenApiResult) => Promise<void>;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [spec, setSpec] = useState<string | null>(null);
  const [dirInput, setDirInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportOpenApiResult | null>(null);

  const dirName = toCollectionDirName(dirInput);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setSpec(await file.text());
    setError(null);
    // Suggest a folder name from the file name; the user can still edit it.
    if (dirInput.trim() === "") {
      setDirInput(file.name.replace(/\.(ya?ml|json)$/i, ""));
    }
  }

  async function submit() {
    if (!spec || !dirName || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importOpenApiSpec(dirName, spec);
      await onImported(result);
      if (result.warnings.length > 0) setDone(result);
      else onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-label="Import OpenAPI spec"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && done === null) void submit();
        }}
      >
        <h2>Import OpenAPI spec</h2>
        {done ? (
          <>
            <p className="hint">
              Imported <strong>{done.name}</strong>: {done.requests} request
              {done.requests === 1 ? "" : "s"} in <code>{done.id}/</code>. Some parts of the
              spec could not be mapped:
            </p>
            <ul className="hint import-warnings">
              {done.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">
              Generates a new collection from an OpenAPI 3.x file (YAML or JSON) — one request
              per operation, grouped by tag, with a <code>baseUrl</code> environment from the
              spec's server URL. Swagger 2.0 specs must be converted first.
            </p>
            <input
              type="file"
              accept=".yaml,.yml,.json,application/yaml,application/json"
              onChange={(e) => void pickFile(e.target.files?.[0])}
            />
            <input
              placeholder="Folder name, e.g. petstore"
              value={dirInput}
              onChange={(e) => setDirInput(e.target.value)}
            />
            {dirName && spec && (
              <p className="hint">
                Will import <code>{fileName}</code> into folder <code>{dirName}/</code>
              </p>
            )}
            {error && <p className="problem">{error}</p>}
            <div className="modal-actions">
              <button onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => void submit()}
                disabled={!spec || !dirName || busy}
              >
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
