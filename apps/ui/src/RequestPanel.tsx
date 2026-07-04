import { useEffect, useState } from "react";
import { getRequestFile, saveRequestFile, sendRequest, type SendResult } from "./api.js";
import { ResponsePane } from "./ResponsePane.js";
import { RequestForm } from "./RequestForm.js";
import { parseRequestContent, stringifyFormData, type RequestFormData } from "./requestFormData.js";

type EditorMode = "form" | "yaml";

export function RequestPanel({
  relativePath,
  env,
  isNew,
  template,
  onSaved,
}: {
  relativePath: string;
  env: string | undefined;
  isNew: boolean;
  template: string;
  onSaved: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [formData, setFormData] = useState<RequestFormData | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("form");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  function applyLoadedContent(text: string, saved: string | null) {
    setContent(text);
    setSavedContent(saved);
    const parsed = parseRequestContent(text);
    if ("data" in parsed) {
      setFormData(parsed.data);
      setFormError(null);
      setMode("form");
    } else {
      setFormData(null);
      setFormError(parsed.error);
      setMode("yaml");
    }
  }

  useEffect(() => {
    if (isNew) {
      applyLoadedContent(template, null);
      return;
    }
    getRequestFile(relativePath)
      .then((text) => applyLoadedContent(text, text))
      .catch((error: Error) => setProblem(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relativePath, isNew, template]);

  // The form and the raw YAML text only sync at explicit boundaries — mode
  // switches and saves — never per keystroke. Re-deriving YAML from form
  // state on every edit would reformat a JSON body textarea while the user
  // is mid-edit (e.g. an incomplete `{"a": 1,`), corrupting what they typed.
  function switchToForm() {
    if (content === null) return;
    const parsed = parseRequestContent(content);
    if ("data" in parsed) {
      setFormData(parsed.data);
      setFormError(null);
    } else {
      setFormData(null);
      setFormError(parsed.error);
    }
    setMode("form");
  }

  function switchToYaml() {
    if (mode === "form" && formData) {
      setContent(stringifyFormData(formData));
    }
    setMode("yaml");
  }

  const liveSerialized = mode === "form" && formData ? stringifyFormData(formData) : content;
  const dirty = liveSerialized !== null && liveSerialized !== savedContent;

  async function save(): Promise<boolean> {
    if (liveSerialized === null) return false;
    setProblem(null);
    try {
      await saveRequestFile(relativePath, liveSerialized);
      setSavedContent(liveSerialized);
      setContent(liveSerialized);
      const reparsed = parseRequestContent(liveSerialized);
      if ("data" in reparsed) {
        setFormData(reparsed.data);
        setFormError(null);
      } else {
        setFormData(null);
        setFormError(reparsed.error);
      }
      onSaved();
      return true;
    } catch (error) {
      setProblem((error as Error).message);
      return false;
    }
  }

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      if (dirty && !(await save())) return;
      setProblem(null);
      setResult(await sendRequest(relativePath, env));
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (content === null) {
    return <div className="empty">{problem ?? "Loading…"}</div>;
  }

  return (
    <div className="request-panel">
      <div className="panel-header">
        <span className="path">
          {relativePath}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </span>
        <div className="mode-toggle">
          <button
            className={mode === "form" ? "active" : undefined}
            onClick={switchToForm}
            disabled={mode === "form"}
          >
            Form
          </button>
          <button
            className={mode === "yaml" ? "active" : undefined}
            onClick={switchToYaml}
            disabled={mode === "yaml"}
          >
            YAML
          </button>
        </div>
        <span className="spacer" />
        <button onClick={() => void save()} disabled={!dirty || busy}>
          Save
        </button>
        <button className="primary" onClick={() => void send()} disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>

      {mode === "form" ? (
        formData ? (
          <RequestForm value={formData} onChange={setFormData} />
        ) : (
          <div className="problem">
            {formError ?? "Could not parse this file into the form editor."}
            <div>
              <button onClick={switchToYaml}>Switch to YAML view to fix it</button>
            </div>
          </div>
        )
      ) : (
        <textarea
          className="editor"
          spellCheck={false}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      )}

      {problem && <div className="problem">{problem}</div>}
      {result && <ResponsePane result={result} />}
    </div>
  );
}
