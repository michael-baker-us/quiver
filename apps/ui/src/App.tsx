import { useEffect, useMemo, useState } from "react";
import {
  createCollection,
  createEnvironment,
  createFolder,
  deleteCollection,
  deleteEnvironment,
  deleteFolder,
  deleteRequest,
  getWorkspace,
  moveRequest,
  renameCollection,
  renameEnvironment,
  renameFolder,
  renameRequest,
  runAll,
  type CollectionSummary,
  type RunEvent,
  type WorkspaceInfo,
} from "./api.js";
import { Sidebar, type Draft, type Selection, type SidebarAction } from "./Sidebar.js";
import { RequestPanel } from "./RequestPanel.js";
import { EnvironmentPanel } from "./EnvironmentPanel.js";
import { RunPanel } from "./RunPanel.js";
import { Docs } from "./Docs.js";
import { PromptDialog } from "./PromptDialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { toCollectionDirName, toEnvironmentName, toFolderPath, toRequestPath } from "./names.js";
import { useTheme } from "./theme.js";

const NEW_REQUEST_TEMPLATE = `name: My new request
method: GET
url: "{{baseUrl}}/change-me"
tests:
  - status: 200
`;

type DialogState =
  | SidebarAction
  | null;

interface RunState {
  collectionId: string;
  /** Captured at run start so a mid-run rename doesn't relabel the panel. */
  collectionName: string;
  events: RunEvent[];
  running: boolean;
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [envSelections, setEnvSelections] = useState<Record<string, string>>({});
  const [showDocs, setShowDocs] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  /** Failures from actions with no dialog to show them in (drag-and-drop moves). */
  const [actionError, setActionError] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();

  const refresh = useMemo(
    () => () =>
      getWorkspace()
        .then(setWorkspace)
        .catch((error: Error) => setLoadError(error.message)),
    [],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  const collections = workspace?.collections ?? [];
  // The "active" collection — targeted by the env picker and ▶ Run all — is
  // the last one the user touched: clicking its header or opening anything
  // inside it. An open selection must not override an explicit header click.
  const activeCollectionId =
    activeId !== null && collections.some((c) => c.id === activeId)
      ? activeId
      : collections[0]?.id ?? null;
  const activeCollection = collections.find((c) => c.id === activeCollectionId);

  /** The chosen environment for a collection, remembered per collection. */
  function envFor(collection: CollectionSummary | undefined): string | undefined {
    if (!collection) return undefined;
    const stored =
      envSelections[collection.id] ??
      localStorage.getItem(`quiver-env-${collection.id}`) ??
      undefined;
    if (stored && collection.environments.includes(stored)) return stored;
    return collection.environments[0];
  }

  function chooseEnv(collectionId: string, name: string) {
    setEnvSelections((current) => ({ ...current, [collectionId]: name }));
    localStorage.setItem(`quiver-env-${collectionId}`, name);
  }

  function selectRequest(collectionId: string, path: string) {
    setSelection({ kind: "request", collectionId, path });
    setActiveId(collectionId);
    setShowDocs(false);
  }

  function selectEnvironment(collectionId: string, name: string) {
    setSelection({ kind: "environment", collectionId, name });
    setActiveId(collectionId);
    setShowDocs(false);
  }

  async function handleRun(collectionId: string) {
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection || run?.running) return;
    setRun({ collectionId, collectionName: collection.name, events: [], running: true });
    try {
      await runAll(collectionId, envFor(collection), (event) =>
        setRun((r) => (r ? { ...r, events: [...r.events, event] } : r)),
      );
    } catch (error) {
      setRun((r) =>
        r
          ? {
              ...r,
              events: [...r.events, { type: "summary", passed: 0, failed: -1, durationMs: 0 }],
            }
          : r,
      );
      setLoadError((error as Error).message);
    } finally {
      setRun((r) => (r ? { ...r, running: false } : r));
    }
  }

  async function handleMoveRequest(
    from: { collectionId: string; path: string },
    toCollectionId: string,
    toPath: string,
  ) {
    // Moving the open request remounts its editor, so unsaved edits would
    // vanish silently — a rename dialog can warn, a drop can't.
    if (isOpenRequest(from.collectionId, from.path) && editorDirty) {
      setActionError("Save or discard your edits before moving the open request.");
      return;
    }
    try {
      await moveRequest(from.collectionId, from.path, toCollectionId, toPath);
      setActionError(null);
      if (isOpenRequest(from.collectionId, from.path)) {
        setSelection({ kind: "request", collectionId: toCollectionId, path: toPath });
      }
      await refresh();
    } catch (error) {
      setActionError(`Could not move ${from.path}: ${(error as Error).message}`);
    }
  }

  function handleAction(action: SidebarAction) {
    if (action.type === "run-collection") {
      void handleRun(action.collectionId);
      return;
    }
    setDialog(action);
  }

  /** True when `path` is the request open in the editor for `collectionId`. */
  function isOpenRequest(collectionId: string, path: string): boolean {
    return (
      selection?.kind === "request" &&
      selection.collectionId === collectionId &&
      selection.path === path
    );
  }

  function discardNote(affected: boolean): string {
    return affected && editorDirty ? " Unsaved changes in the open editor will be discarded." : "";
  }

  function renderDialog() {
    if (!dialog) return null;
    switch (dialog.type) {
      case "new-collection":
        return (
          <PromptDialog
            title="New collection"
            hint="Name your collection; a matching folder is created in the workspace with a collection.yaml inside."
            placeholder="My Orders API"
            submitLabel="Create"
            transform={toCollectionDirName}
            preview={(dir) => (
              <>
                Will create folder <code>{dir}/</code>
              </>
            )}
            onSubmit={async (raw, dirName) => {
              await createCollection(dirName, raw.trim());
              setActiveId(dirName);
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "new-request": {
        const prefix = dialog.folderPrefix;
        return (
          <PromptDialog
            title={prefix ? `New request in ${prefix}/` : "New request"}
            hint={
              <>
                Folders group related requests and are created automatically, e.g.{" "}
                <code>users/create-user</code>. Requests run in alphabetical order, so use
                numeric prefixes (<code>01-login</code>) when order matters.
              </>
            }
            placeholder="users/create-user"
            submitLabel="Create"
            transform={(input) => {
              const path = toRequestPath(input);
              return path ? (prefix ? `${prefix}/${path}` : path) : null;
            }}
            preview={(path) => (
              <>
                Will create <code>{path}</code>
              </>
            )}
            onSubmit={async (_raw, path) => {
              setDraft({ collectionId: dialog.collectionId, path });
              selectRequest(dialog.collectionId, path);
            }}
            onClose={() => setDialog(null)}
          />
        );
      }
      case "new-folder": {
        const parent = dialog.parent;
        return (
          <PromptDialog
            title={parent ? `New folder in ${parent}/` : "New folder"}
            hint="Folders keep related requests together; requests inside run in alphabetical path order."
            placeholder="users"
            submitLabel="Create"
            transform={(input) => {
              const path = toFolderPath(input);
              return path ? (parent ? `${parent}/${path}` : path) : null;
            }}
            preview={(path) => (
              <>
                Will create folder <code>{path}/</code>
              </>
            )}
            onSubmit={async (_raw, path) => {
              await createFolder(dialog.collectionId, path);
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      }
      case "new-environment":
        return (
          <PromptDialog
            title="New environment"
            hint={
              <>
                Environments hold the variables requests reference, like{" "}
                <code>{"{{baseUrl}}"}</code> — one file per target (local, staging, …).
              </>
            }
            placeholder="staging"
            submitLabel="Create"
            transform={toEnvironmentName}
            preview={(name) => (
              <>
                Will create <code>environments/{name}.yaml</code>
              </>
            )}
            onSubmit={async (_raw, name) => {
              await createEnvironment(dialog.collectionId, name);
              await refresh();
              selectEnvironment(dialog.collectionId, name);
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "rename-collection":
        return (
          <PromptDialog
            title="Rename collection"
            hint="Changes the display name in collection.yaml; the folder on disk keeps its name."
            placeholder="My API"
            initialValue={dialog.currentName}
            submitLabel="Rename"
            transform={(input) => (input.trim() === "" ? null : input.trim())}
            onSubmit={async (_raw, name) => {
              await renameCollection(dialog.collectionId, name);
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "rename-request":
        return (
          <PromptDialog
            title="Rename request file"
            hint={
              <>
                Renaming the file changes its run order (alphabetical). The display name is
                edited in the request itself.
                {discardNote(isOpenRequest(dialog.collectionId, dialog.path))}
              </>
            }
            placeholder="users/01-create-user"
            initialValue={dialog.path}
            submitLabel="Rename"
            transform={toRequestPath}
            preview={(path) => (
              <>
                Will rename to <code>{path}</code>
              </>
            )}
            onSubmit={async (_raw, to) => {
              await renameRequest(dialog.collectionId, dialog.path, to);
              if (isOpenRequest(dialog.collectionId, dialog.path)) {
                setSelection({ kind: "request", collectionId: dialog.collectionId, path: to });
              }
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "rename-folder":
        return (
          <PromptDialog
            title="Rename folder"
            hint="Moves every request inside; you can also type a new path to move the folder."
            placeholder="users"
            initialValue={dialog.path}
            submitLabel="Rename"
            transform={toFolderPath}
            preview={(path) => (
              <>
                Will rename to <code>{path}/</code>
              </>
            )}
            onSubmit={async (_raw, to) => {
              await renameFolder(dialog.collectionId, dialog.path, to);
              const prefix = `${dialog.path}/`;
              if (
                selection?.kind === "request" &&
                selection.collectionId === dialog.collectionId &&
                selection.path.startsWith(prefix)
              ) {
                setSelection({
                  ...selection,
                  path: `${to}/${selection.path.slice(prefix.length)}`,
                });
              }
              if (draft?.collectionId === dialog.collectionId && draft.path.startsWith(prefix)) {
                setDraft({ ...draft, path: `${to}/${draft.path.slice(prefix.length)}` });
              }
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "rename-environment":
        return (
          <PromptDialog
            title="Rename environment"
            placeholder="staging"
            initialValue={dialog.name}
            submitLabel="Rename"
            transform={toEnvironmentName}
            preview={(name) => (
              <>
                Will rename to <code>environments/{name}.yaml</code>
              </>
            )}
            onSubmit={async (_raw, to) => {
              await renameEnvironment(dialog.collectionId, dialog.name, to);
              if (
                selection?.kind === "environment" &&
                selection.collectionId === dialog.collectionId &&
                selection.name === dialog.name
              ) {
                setSelection({ ...selection, name: to });
              }
              if (envSelections[dialog.collectionId] === dialog.name) {
                chooseEnv(dialog.collectionId, to);
              }
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "delete-collection":
        return (
          <ConfirmDialog
            title={`Delete collection "${dialog.name}"?`}
            message={
              <>
                Deletes the <code>{dialog.collectionId}/</code> directory and everything in it
                from disk. If the files are committed to Git this is recoverable with{" "}
                <code>git checkout</code>.
              </>
            }
            onConfirm={async () => {
              await deleteCollection(dialog.collectionId);
              if (selection?.collectionId === dialog.collectionId) setSelection(null);
              if (draft?.collectionId === dialog.collectionId) setDraft(null);
              if (run?.collectionId === dialog.collectionId) setRun(null);
              if (activeId === dialog.collectionId) setActiveId(null);
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "delete-folder":
        return (
          <ConfirmDialog
            title={`Delete folder ${dialog.path}/?`}
            message={
              <>
                Deletes the folder and every request in it from disk — recoverable via Git if
                committed.
                {discardNote(
                  selection?.kind === "request" &&
                    selection.collectionId === dialog.collectionId &&
                    selection.path.startsWith(`${dialog.path}/`),
                )}
              </>
            }
            onConfirm={async () => {
              await deleteFolder(dialog.collectionId, dialog.path);
              if (
                selection?.kind === "request" &&
                selection.collectionId === dialog.collectionId &&
                selection.path.startsWith(`${dialog.path}/`)
              ) {
                setSelection(null);
              }
              if (
                draft?.collectionId === dialog.collectionId &&
                draft.path.startsWith(`${dialog.path}/`)
              ) {
                setDraft(null);
              }
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "delete-request":
        return (
          <ConfirmDialog
            title="Delete request?"
            message={
              <>
                Deletes <code>{dialog.path}</code> from disk — recoverable via Git if committed.
                {discardNote(isOpenRequest(dialog.collectionId, dialog.path))}
              </>
            }
            onConfirm={async () => {
              const isDraftOnly =
                draft?.collectionId === dialog.collectionId && draft.path === dialog.path;
              if (isDraftOnly) {
                // An unsaved draft has no file yet; just drop it.
                setDraft(null);
              } else {
                await deleteRequest(dialog.collectionId, dialog.path);
              }
              if (isOpenRequest(dialog.collectionId, dialog.path)) setSelection(null);
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      case "delete-environment":
        return (
          <ConfirmDialog
            title={`Delete environment "${dialog.name}"?`}
            message={
              <>
                Deletes <code>environments/{dialog.name}.yaml</code> from disk — recoverable via
                Git if committed.
              </>
            }
            onConfirm={async () => {
              await deleteEnvironment(dialog.collectionId, dialog.name);
              if (
                selection?.kind === "environment" &&
                selection.collectionId === dialog.collectionId &&
                selection.name === dialog.name
              ) {
                setSelection(null);
              }
              await refresh();
            }}
            onClose={() => setDialog(null)}
          />
        );
      default:
        return null;
    }
  }

  if (loadError && !workspace) {
    return <div className="fatal">Failed to load workspace: {loadError}</div>;
  }
  if (!workspace) return <div className="fatal">Loading…</div>;

  const activeEnv = envFor(activeCollection);
  const selectionCollection = collections.find((c) => c.id === selection?.collectionId);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">q</span>
          quiver
        </span>
        {activeCollection && (
          <span
            className="collection-name"
            title={activeCollection.id === "." ? undefined : activeCollection.id}
          >
            {activeCollection.name}
          </span>
        )}
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
        {activeCollection && activeCollection.environments.length > 0 && (
          <label className="env-picker">
            env
            <select
              value={activeEnv}
              onChange={(e) => chooseEnv(activeCollection.id, e.target.value)}
            >
              {activeCollection.environments.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {activeCollection && (
          <button
            className="primary"
            onClick={() => void handleRun(activeCollection.id)}
            disabled={run?.running ?? false}
            title={`Run every request in ${activeCollection.name}`}
          >
            {run?.running ? "Running…" : "▶ Run all"}
          </button>
        )}
      </header>
      {actionError && (
        <div className="action-error" role="alert">
          <span>{actionError}</span>
          <button className="ghost icon-only" aria-label="Dismiss error" onClick={() => setActionError(null)}>
            ✕
          </button>
        </div>
      )}
      <div className="layout">
        <Sidebar
          workspace={workspace}
          selection={selection}
          draft={draft}
          activeCollectionId={activeCollectionId}
          onSelectRequest={selectRequest}
          onSelectEnvironment={selectEnvironment}
          onActivateCollection={setActiveId}
          onAction={handleAction}
          onMoveRequest={(from, toCollectionId, toPath) =>
            void handleMoveRequest(from, toCollectionId, toPath)
          }
        />
        <main className="main">
          {showDocs ? (
            <Docs />
          ) : collections.length === 0 ? (
            <div className="empty">
              <h2>Welcome to quiver</h2>
              <p>This workspace has no collections yet.</p>
              <p>
                <button className="primary" onClick={() => setDialog({ type: "new-collection" })}>
                  Create your first collection
                </button>
              </p>
              <p className="hint">
                A collection is a folder of plain YAML request files in your Git repository —
                everything you create here shows up in <code>git diff</code>.
              </p>
            </div>
          ) : selection?.kind === "request" ? (
            <RequestPanel
              key={`${selection.collectionId}:${selection.path}`}
              collectionId={selection.collectionId}
              relativePath={selection.path}
              env={envFor(selectionCollection)}
              isNew={
                draft?.collectionId === selection.collectionId && draft.path === selection.path
              }
              template={NEW_REQUEST_TEMPLATE}
              onSaved={() => {
                setDraft((d) =>
                  d && selection.kind === "request" && d.path === selection.path ? null : d,
                );
                refresh();
              }}
              onDirtyChange={setEditorDirty}
            />
          ) : selection?.kind === "environment" ? (
            <EnvironmentPanel
              key={`${selection.collectionId}:env:${selection.name}`}
              collectionId={selection.collectionId}
              name={selection.name}
              onSaved={refresh}
            />
          ) : (
            <div className="empty">
              <h2>{activeCollection ? `Welcome to ${activeCollection.name}` : "Welcome"}</h2>
              <p>Select a request on the left to view, edit, and send it.</p>
              <p className="hint">
                New here? Open the{" "}
                <button className="link" onClick={() => setShowDocs(true)}>
                  guide
                </button>{" "}
                for a walkthrough of requests, variables, and tests.
              </p>
              <p className="hint">
                Requests are plain YAML files in your Git repository — anything you save here
                shows up in <code>git diff</code>.
              </p>
              <p className="hint">
                Tips: <kbd>⌘</kbd>+<kbd>Enter</kbd> sends the open request, <kbd>⌘</kbd>+
                <kbd>S</kbd> saves it. Hover a collection, folder, or request for its ⋯ menu, or
                drag a request onto a folder or collection to move it.
              </p>
            </div>
          )}
        </main>
        {run !== null && (
          <RunPanel
            events={run.events}
            running={run.running}
            collectionName={run.collectionName}
            onClose={() => setRun(null)}
          />
        )}
      </div>
      {renderDialog()}
    </div>
  );
}
