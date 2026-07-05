import { useEffect, useMemo, useRef, useState } from "react";
import { getEnvironment, getRequestFile, saveRequestFile, sendRequest, type SendResult } from "./api.js";
import { VariableInput } from "./VariableInput.js";
import { ResponsePane } from "./ResponsePane.js";
import { RequestFormTab, TAB_LABELS, tabBadge, type FormTab } from "./RequestForm.js";
import { DEFAULT_SPLIT, MAX_SPLIT, MIN_SPLIT, SplitPane, type SplitOrientation } from "./SplitPane.js";
import {
  HTTP_METHODS,
  parseRequestContent,
  stringifyFormData,
  type RequestFormData,
} from "./requestFormData.js";

type EditorMode = "form" | "yaml";

export function RequestPanel({
  collectionId,
  relativePath,
  env,
  isNew,
  template,
  onSaved,
  onDirtyChange,
}: {
  collectionId: string;
  relativePath: string;
  env: string | undefined;
  isNew: boolean;
  template: string;
  onSaved: () => void;
  /** Lets the app warn before rename/delete discards unsaved edits. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [formData, setFormData] = useState<RequestFormData | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("form");
  const [tab, setTab] = useState<FormTab>("params");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>(() =>
    localStorage.getItem("quiver-split-orientation") === "row" ? "row" : "column",
  );
  // For {{var}} hover tooltips. Loaded when the selected environment changes;
  // edits made in the environment panel show up next time this panel mounts.
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    const stored = Number(localStorage.getItem("quiver-split-ratio"));
    return stored >= MIN_SPLIT && stored <= MAX_SPLIT ? stored : DEFAULT_SPLIT;
  });

  function toggleSplitOrientation() {
    setSplitOrientation((current) => {
      const next = current === "column" ? "row" : "column";
      localStorage.setItem("quiver-split-orientation", next);
      return next;
    });
  }

  function handleSplitRatio(ratio: number) {
    setSplitRatio(ratio);
    localStorage.setItem("quiver-split-ratio", String(ratio));
  }

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
    if (!env) {
      setEnvVars({});
      return;
    }
    let cancelled = false;
    getEnvironment(collectionId, env)
      .then((vars) => !cancelled && setEnvVars(vars))
      .catch(() => !cancelled && setEnvVars({}));
    return () => {
      cancelled = true;
    };
  }, [collectionId, env]);

  useEffect(() => {
    if (isNew) {
      applyLoadedContent(template, null);
      return;
    }
    getRequestFile(collectionId, relativePath)
      .then((text) => applyLoadedContent(text, text))
      .catch((error: Error) => setProblem(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, relativePath, isNew, template]);

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

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // In YAML mode the URL bar is read-only (the text is the source of truth;
  // editing these fields would force a rewrite that destroys comments).
  // Parsing here is read-only and safe; mid-edit parse failures fall back to
  // the last good form state.
  const barData = useMemo(() => {
    if (mode === "form") return formData;
    if (content !== null) {
      const parsed = parseRequestContent(content);
      if ("data" in parsed) return parsed.data;
    }
    return formData;
  }, [mode, formData, content]);

  async function save(): Promise<boolean> {
    if (liveSerialized === null) return false;
    setProblem(null);
    try {
      await saveRequestFile(collectionId, relativePath, liveSerialized);
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
      setResult(await sendRequest(collectionId, relativePath, env));
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Postman muscle memory: Cmd/Ctrl+Enter sends, Cmd/Ctrl+S saves.
  const actions = useRef({ send, save, dirty, busy });
  actions.current = { send, save, dirty, busy };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const { send, save, dirty, busy } = actions.current;
      if (event.key === "Enter" && !busy) {
        event.preventDefault();
        void send();
      } else if (event.key === "s") {
        event.preventDefault();
        if (dirty && !busy) void save();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (content === null) {
    return <div className="empty">{problem ?? "Loading…"}</div>;
  }

  const formEditable = mode === "form" && formData !== null;

  return (
    <div className="request-panel">
      <div className="request-header">
        <input
          className="request-title"
          value={barData?.name ?? ""}
          placeholder="Untitled request"
          disabled={!formEditable}
          onChange={(e) => formData && setFormData({ ...formData, name: e.target.value })}
          title={formEditable ? "Click to rename" : "Switch to Form view to rename"}
        />
        <span className="path">
          {relativePath}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </span>
        <button
          className="ghost icon-only"
          onClick={toggleSplitOrientation}
          title={
            splitOrientation === "column"
              ? "Show response side-by-side"
              : "Show response below"
          }
          aria-label="Toggle request/response layout"
        >
          {splitOrientation === "column" ? "◫" : "⊟"}
        </button>
      </div>

      <div className="url-bar">
        <div className="url-bar-group">
          <select
            value={barData?.method ?? "GET"}
            disabled={!formEditable}
            onChange={(e) =>
              formData &&
              setFormData({ ...formData, method: e.target.value as RequestFormData["method"] })
            }
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <VariableInput
            value={barData?.url ?? ""}
            placeholder="{{baseUrl}}/path"
            disabled={!formEditable}
            variables={envVars}
            onChange={(url) => formData && setFormData({ ...formData, url })}
          />
        </div>
        <button onClick={() => void save()} disabled={!dirty || busy}>
          Save
        </button>
        <button
          className="primary"
          onClick={() => void send()}
          disabled={busy}
          title="⌘+Enter"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>

      <SplitPane
        orientation={splitOrientation}
        ratio={splitRatio}
        onRatioChange={handleSplitRatio}
        first={
          <>
            <div className="tab-strip">
              {mode === "form" && formData ? (
                (Object.keys(TAB_LABELS) as FormTab[]).map((key) => {
                  const badge = tabBadge(formData, key);
                  return (
                    <button
                      key={key}
                      className={tab === key ? "active" : undefined}
                      onClick={() => setTab(key)}
                    >
                      {TAB_LABELS[key]}
                      {badge === "dot" && <span className="tab-dot" />}
                      {typeof badge === "number" && badge > 0 && (
                        <span className="tab-count">{badge}</span>
                      )}
                    </button>
                  );
                })
              ) : (
                <span className="hint" style={{ alignSelf: "center" }}>
                  Raw file — comments and formatting are preserved until you save from Form view.
                </span>
              )}
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
            </div>

            {mode === "form" ? (
              formData ? (
                <div className="tab-body">
                  <RequestFormTab
                    tab={tab}
                    value={formData}
                    onChange={setFormData}
                    variables={envVars}
                  />
                </div>
              ) : (
                <div className="problem">
                  {formError ?? "Could not parse this file into the form editor."}
                  <div>
                    <button onClick={switchToYaml}>Switch to YAML view to fix it</button>
                  </div>
                </div>
              )
            ) : (
              <div className="yaml-pane">
                <textarea
                  className="editor"
                  spellCheck={false}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>
            )}

            {problem && <div className="problem">{problem}</div>}
          </>
        }
        second={result ? <ResponsePane result={result} /> : null}
      />
    </div>
  );
}
