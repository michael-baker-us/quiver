import {
  newTestRow,
  type KeyValueRow,
  type RequestFormData,
  type TestFormRow,
} from "./requestFormData.js";

export type FormTab =
  | "params"
  | "headers"
  | "auth"
  | "body"
  | "tests"
  | "capture"
  | "settings";

export const TAB_LABELS: Record<FormTab, string> = {
  params: "Params",
  headers: "Headers",
  auth: "Auth",
  body: "Body",
  tests: "Tests",
  capture: "Capture",
  settings: "Settings",
};

/** Count badge (key-value tabs), "dot" (configured on/off tabs), or null. */
export function tabBadge(form: RequestFormData, tab: FormTab): number | "dot" | null {
  const filled = (rows: KeyValueRow[]) => rows.filter((r) => r.key.trim()).length;
  switch (tab) {
    case "params":
      return filled(form.query);
    case "headers":
      return filled(form.headers);
    case "auth":
      return form.authType !== "none" ? "dot" : null;
    case "body":
      return form.bodyType !== "none" ? "dot" : null;
    case "tests":
      return form.tests.length;
    case "capture":
      return filled(form.capture);
    case "settings":
      return form.timeoutMs.trim() ? "dot" : null;
  }
}

export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = "Name",
  valuePlaceholder = "Value",
}: {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  function update(i: number, patch: Partial<KeyValueRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  return (
    <div className="kv-editor">
      {rows.map((row, i) => (
        <div className="kv-row" key={i}>
          <input
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <input
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <button className="icon-button" onClick={() => remove(i)} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <button className="add-row" onClick={() => onChange([...rows, { key: "", value: "" }])}>
        + Add
      </button>
    </div>
  );
}

function TestRowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: TestFormRow;
  onChange: (row: TestFormRow) => void;
  onRemove: () => void;
}) {
  return (
    <div className="test-row">
      <select
        value={row.kind}
        onChange={(e) => onChange(newTestRow(e.target.value as TestFormRow["kind"]))}
      >
        <option value="status">Status code</option>
        <option value="header">Header</option>
        <option value="jsonpath">JSON value</option>
        <option value="bodyContains">Body contains</option>
        <option value="responseTimeBelow">Response time</option>
      </select>

      {row.kind === "status" && (
        <input
          type="number"
          placeholder="200"
          value={row.status}
          onChange={(e) => onChange({ ...row, status: e.target.value })}
        />
      )}

      {row.kind === "header" && (
        <>
          <input
            placeholder="Header name"
            value={row.header}
            onChange={(e) => onChange({ ...row, header: e.target.value })}
          />
          <select
            value={row.mode}
            onChange={(e) => onChange({ ...row, mode: e.target.value as typeof row.mode })}
          >
            <option value="present">is present</option>
            <option value="equals">equals</option>
            <option value="contains">contains</option>
          </select>
          {row.mode !== "present" && (
            <input
              placeholder="Value"
              value={row.value}
              onChange={(e) => onChange({ ...row, value: e.target.value })}
            />
          )}
        </>
      )}

      {row.kind === "jsonpath" && (
        <>
          <input
            placeholder="$.data.id"
            value={row.jsonpath}
            onChange={(e) => onChange({ ...row, jsonpath: e.target.value })}
          />
          <select
            value={row.mode}
            onChange={(e) => onChange({ ...row, mode: e.target.value as typeof row.mode })}
          >
            <option value="exists">exists</option>
            <option value="notExists">does not exist</option>
            <option value="equals">equals</option>
            <option value="contains">contains</option>
          </select>
          {(row.mode === "equals" || row.mode === "contains") && (
            <input
              placeholder={row.mode === "equals" ? 'e.g. 42, true, "text", [1,2]' : "text"}
              value={row.value}
              onChange={(e) => onChange({ ...row, value: e.target.value })}
            />
          )}
        </>
      )}

      {row.kind === "bodyContains" && (
        <input
          placeholder="text the response body should contain"
          value={row.value}
          onChange={(e) => onChange({ ...row, value: e.target.value })}
        />
      )}

      {row.kind === "responseTimeBelow" && (
        <input
          type="number"
          placeholder="2000"
          value={row.value}
          onChange={(e) => onChange({ ...row, value: e.target.value })}
        />
      )}

      <button className="icon-button" onClick={onRemove} aria-label="Remove test">
        ✕
      </button>
    </div>
  );
}

export function RequestFormTab({
  tab,
  value,
  onChange,
}: {
  tab: FormTab;
  value: RequestFormData;
  onChange: (next: RequestFormData) => void;
}) {
  function set<K extends keyof RequestFormData>(key: K, next: RequestFormData[K]) {
    onChange({ ...value, [key]: next });
  }

  switch (tab) {
    case "params":
      return (
        <>
          <p className="hint">Appended to the URL as a query string, e.g. ?limit=10.</p>
          <KeyValueEditor
            rows={value.query}
            onChange={(rows) => set("query", rows)}
            keyPlaceholder="Param name"
          />
        </>
      );

    case "headers":
      return (
        <KeyValueEditor
          rows={value.headers}
          onChange={(rows) => set("headers", rows)}
          keyPlaceholder="Header name"
        />
      );

    case "auth":
      return (
        <div className="auth-fields">
          <select
            value={value.authType}
            onChange={(e) => set("authType", e.target.value as RequestFormData["authType"])}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic (username/password)</option>
            <option value="apikey">API key header</option>
          </select>
          {value.authType !== "none" && (
            <p className="hint">
              Use <code>{"{{$env.NAME}}"}</code> for secrets — they resolve from OS
              environment variables and never land in Git.
            </p>
          )}
          {value.authType === "bearer" && (
            <input
              placeholder="{{$env.API_TOKEN}}"
              value={value.authBearerToken}
              onChange={(e) => set("authBearerToken", e.target.value)}
            />
          )}
          {value.authType === "basic" && (
            <div className="field-row">
              <input
                placeholder="Username"
                value={value.authBasicUsername}
                onChange={(e) => set("authBasicUsername", e.target.value)}
              />
              <input
                placeholder="Password"
                value={value.authBasicPassword}
                onChange={(e) => set("authBasicPassword", e.target.value)}
              />
            </div>
          )}
          {value.authType === "apikey" && (
            <div className="field-row">
              <input
                placeholder="Header name"
                value={value.authApiKeyHeader}
                onChange={(e) => set("authApiKeyHeader", e.target.value)}
              />
              <input
                placeholder="Value"
                value={value.authApiKeyValue}
                onChange={(e) => set("authApiKeyValue", e.target.value)}
              />
            </div>
          )}
        </div>
      );

    case "body": {
      let jsonBodyError: string | null = null;
      if (value.bodyType === "json" && value.bodyJsonText.trim()) {
        try {
          JSON.parse(value.bodyJsonText);
        } catch (error) {
          jsonBodyError = (error as Error).message;
        }
      }
      return (
        <>
          <select
            style={{ alignSelf: "flex-start" }}
            value={value.bodyType}
            onChange={(e) => set("bodyType", e.target.value as RequestFormData["bodyType"])}
          >
            <option value="none">None</option>
            <option value="json">JSON</option>
            <option value="text">Plain text</option>
            <option value="form">Form (application/x-www-form-urlencoded)</option>
          </select>
          {value.bodyType === "json" && (
            <>
              <textarea
                className="editor small"
                spellCheck={false}
                value={value.bodyJsonText}
                onChange={(e) => set("bodyJsonText", e.target.value)}
              />
              {jsonBodyError && (
                <div className="field-error">Not valid JSON: {jsonBodyError}</div>
              )}
            </>
          )}
          {value.bodyType === "text" && (
            <textarea
              className="editor small"
              spellCheck={false}
              value={value.bodyPlainText}
              onChange={(e) => set("bodyPlainText", e.target.value)}
            />
          )}
          {value.bodyType === "form" && (
            <KeyValueEditor rows={value.bodyForm} onChange={(rows) => set("bodyForm", rows)} />
          )}
        </>
      );
    }

    case "tests":
      return (
        <>
          <p className="hint">
            Run after every send. Values are JSON: numbers, true/false,
            &quot;quoted strings&quot;, or [1,2]. Plain text without quotes is
            treated as a string.
          </p>
          {value.tests.map((row, i) => (
            <TestRowEditor
              key={i}
              row={row}
              onChange={(next) =>
                set("tests", value.tests.map((r, idx) => (idx === i ? next : r)))
              }
              onRemove={() => set("tests", value.tests.filter((_, idx) => idx !== i))}
            />
          ))}
          <button
            className="add-row"
            onClick={() => set("tests", [...value.tests, newTestRow("status")])}
          >
            + Add test
          </button>
        </>
      );

    case "capture":
      return (
        <>
          <p className="hint">
            Save a value from the response for later requests, e.g.{" "}
            <code>authToken</code> → <code>$.token</code>. Captured variables
            work like <code>{"{{authToken}}"}</code> in any later request in the
            run.
          </p>
          <KeyValueEditor
            rows={value.capture}
            onChange={(rows) => set("capture", rows)}
            keyPlaceholder="Variable name"
            valuePlaceholder="$.path.to.value"
          />
        </>
      );

    case "settings":
      return (
        <div className="settings-fields">
          <label className="field">
            <span>Timeout override (ms, optional)</span>
            <input
              value={value.timeoutMs}
              onChange={(e) => set("timeoutMs", e.target.value)}
              placeholder="30000"
            />
          </label>
          <p className="hint" style={{ marginTop: "0.6rem" }}>
            Saving from Form view rewrites the file, so YAML comments or
            non-standard fields won&apos;t survive — use YAML view if you need
            those.
          </p>
        </div>
      );
  }
}
