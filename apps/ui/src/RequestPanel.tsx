import { useEffect, useState } from "react";
import {
  getRequestFile,
  saveRequestFile,
  sendRequest,
  type SendResult,
} from "./api.js";
import { ResponsePane } from "./ResponsePane.js";

export function RequestPanel({
  relativePath,
  env,
  isNew,
  template,
  onSaved,
}: {
  relativePath: string;
  env: string | undefined;
  /** True for a request that has never been saved — starts from the template. */
  isNew: boolean;
  template: string;
  onSaved: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    if (isNew) {
      setContent(template);
      setSavedContent(null); // never saved → always dirty until first save
      return;
    }
    getRequestFile(relativePath)
      .then((text) => {
        setContent(text);
        setSavedContent(text);
      })
      .catch((error: Error) => setProblem(error.message));
    // isNew only ever flips true→false after the first save, when the file
    // exists and this fetch returns what was just written.
  }, [relativePath, isNew, template]);

  const dirty = content !== null && content !== savedContent;

  async function save(): Promise<boolean> {
    if (content === null) return false;
    setProblem(null);
    try {
      await saveRequestFile(relativePath, content);
      setSavedContent(content);
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
        <span className="spacer" />
        <button onClick={() => void save()} disabled={!dirty || busy}>
          Save
        </button>
        <button className="primary" onClick={() => void send()} disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      <textarea
        className="editor"
        spellCheck={false}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      {problem && <div className="problem">{problem}</div>}
      {result && <ResponsePane result={result} />}
    </div>
  );
}
