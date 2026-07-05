import { useEffect, useRef, useState } from "react";
import { getEnvironment, saveEnvironment } from "./api.js";
import { KeyValueEditor } from "./RequestForm.js";
import { rowsToVariables, variablesToRows } from "./envRows.js";
import type { KeyValueRow } from "./requestFormData.js";

/** Postman-style key/value editor for one environments/<name>.yaml file. */
export function EnvironmentPanel({
  collectionId,
  name,
  onSaved,
}: {
  collectionId: string;
  name: string;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<KeyValueRow[] | null>(null);
  const [saved, setSaved] = useState<Record<string, string> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getEnvironment(collectionId, name)
      .then((variables) => {
        setRows(variablesToRows(variables));
        setSaved(variables);
      })
      .catch((error: Error) => setProblem(error.message));
  }, [collectionId, name]);

  const dirty =
    rows !== null &&
    saved !== null &&
    JSON.stringify(rowsToVariables(rows)) !== JSON.stringify(saved);

  async function save(): Promise<void> {
    if (rows === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const variables = rowsToVariables(rows);
      await saveEnvironment(collectionId, name, variables);
      setSaved(variables);
      onSaved();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ⌘+S saves, mirroring the request editor.
  const actions = useRef({ save, dirty, busy });
  actions.current = { save, dirty, busy };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "s") return;
      event.preventDefault();
      const { save, dirty, busy } = actions.current;
      if (dirty && !busy) void save();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (rows === null) {
    return <div className="empty">{problem ?? "Loading…"}</div>;
  }

  return (
    <div className="request-panel env-panel">
      <div className="request-header">
        <h2 className="env-title">Environment: {name}</h2>
        <span className="path">
          environments/{name}.yaml
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </span>
        <button className="primary" onClick={() => void save()} disabled={!dirty || busy} title="⌘+S">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="tab-body env-body">
        <KeyValueEditor
          rows={rows}
          onChange={setRows}
          keyPlaceholder="Variable"
          valuePlaceholder="Value"
        />
        <p className="hint">
          Requests reference these as <code>{"{{name}}"}</code>. Don&apos;t put
          secrets here — this file is committed to Git. Reference an OS
          environment variable with <code>{"{{$env.NAME}}"}</code> instead.
        </p>
        <p className="hint">
          Saving rewrites the file from this table, so YAML comments in it
          don&apos;t survive.
        </p>
        {problem && <div className="problem">{problem}</div>}
      </div>
    </div>
  );
}
