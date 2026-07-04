import { useEffect, useMemo, useState } from "react";
import {
  getCollection,
  runAll,
  type CollectionInfo,
  type RunEvent,
} from "./api.js";
import { Sidebar } from "./Sidebar.js";
import { RequestPanel } from "./RequestPanel.js";
import { RunPanel } from "./RunPanel.js";
import { Docs } from "./Docs.js";
import { NewRequestDialog } from "./NewRequestDialog.js";
import { useTheme } from "./theme.js";

const NEW_REQUEST_TEMPLATE = `name: My new request
method: GET
url: "{{baseUrl}}/change-me"
tests:
  - status: 200
`;

export function App() {
  const [collection, setCollection] = useState<CollectionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [env, setEnv] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [runEvents, setRunEvents] = useState<RunEvent[] | null>(null);
  const [running, setRunning] = useState(false);
  const [theme, toggleTheme] = useTheme();

  const refresh = useMemo(
    () => () =>
      getCollection()
        .then((data) => {
          setCollection(data);
          setEnv((current) => current ?? data.environments[0]);
        })
        .catch((error: Error) => setLoadError(error.message)),
    [],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleCreate(path: string) {
    setShowNewDialog(false);
    setDraft(path);
    setSelected(path);
    setShowDocs(false);
  }

  function handleSelect(path: string) {
    setSelected(path);
    setShowDocs(false);
  }

  async function handleRunAll() {
    setRunning(true);
    setRunEvents([]);
    try {
      await runAll(env, (event) =>
        setRunEvents((events) => [...(events ?? []), event]),
      );
    } catch (error) {
      setRunEvents((events) => [
        ...(events ?? []),
        { type: "summary", passed: 0, failed: -1, durationMs: 0 },
      ]);
      setLoadError((error as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (loadError && !collection) {
    return <div className="fatal">Failed to load collection: {loadError}</div>;
  }
  if (!collection) return <div className="fatal">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">q</span>
          quiver
        </span>
        <span className="collection-name">{collection.name}</span>
        <span className="spacer" />
        <button className="ghost" onClick={() => setShowDocs((v) => !v)}>
          {showDocs ? "Close guide" : "Guide"}
        </button>
        <button
          className="ghost icon-only"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        {collection.environments.length > 0 && (
          <label className="env-picker">
            env
            <select value={env} onChange={(e) => setEnv(e.target.value)}>
              {collection.environments.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="primary" onClick={handleRunAll} disabled={running}>
          {running ? "Running…" : "▶ Run all"}
        </button>
      </header>
      <div className="layout">
        <Sidebar
          requests={collection.requests}
          selected={selected}
          draft={draft}
          onSelect={handleSelect}
          onNew={() => setShowNewDialog(true)}
        />
        <main className="main">
          {showDocs ? (
            <Docs />
          ) : selected ? (
            <RequestPanel
              key={selected}
              relativePath={selected}
              env={env}
              isNew={selected === draft}
              template={NEW_REQUEST_TEMPLATE}
              onSaved={() => {
                setDraft((d) => (d === selected ? null : d));
                refresh();
              }}
            />
          ) : (
            <div className="empty">
              <h2>Welcome to {collection.name}</h2>
              <p>Select a request on the left to view, edit, and send it.</p>
              <p className="hint">
                New here? Open the{" "}
                <button className="link" onClick={() => setShowDocs(true)}>
                  guide
                </button>{" "}
                for a walkthrough of requests, variables, and tests.
              </p>
              <p className="hint">
                Requests are plain YAML files in your Git repository — anything
                you save here shows up in <code>git diff</code>.
              </p>
              <p className="hint">
                Tips: <kbd>⌘</kbd>+<kbd>Enter</kbd> sends the open request,{" "}
                <kbd>⌘</kbd>+<kbd>S</kbd> saves it.
              </p>
            </div>
          )}
        </main>
        {runEvents !== null && (
          <RunPanel
            events={runEvents}
            running={running}
            onClose={() => setRunEvents(null)}
          />
        )}
      </div>
      {showNewDialog && (
        <NewRequestDialog
          onCreate={handleCreate}
          onClose={() => setShowNewDialog(false)}
        />
      )}
    </div>
  );
}
