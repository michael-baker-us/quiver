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

export function App() {
  const [collection, setCollection] = useState<CollectionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [env, setEnv] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[] | null>(null);
  const [running, setRunning] = useState(false);

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
        <span className="brand">quiver</span>
        <span className="collection-name">{collection.name}</span>
        <span className="spacer" />
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
        <button
          className="primary"
          onClick={handleRunAll}
          disabled={running}
        >
          {running ? "Running…" : "▶ Run all"}
        </button>
      </header>
      <div className="layout">
        <Sidebar
          requests={collection.requests}
          selected={selected}
          onSelect={setSelected}
        />
        <main className="main">
          {selected ? (
            <RequestPanel
              key={selected}
              relativePath={selected}
              env={env}
              onSaved={refresh}
            />
          ) : (
            <div className="empty">
              <p>Select a request on the left to view, edit, and send it.</p>
              <p className="hint">
                Requests are plain YAML files in your Git repository — anything
                you save here shows up in <code>git diff</code>.
              </p>
            </div>
          )}
        </main>
        {runEvents !== null && (
          <RunPanel events={runEvents} onClose={() => setRunEvents(null)} />
        )}
      </div>
    </div>
  );
}
