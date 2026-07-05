import { useMemo, useState } from "react";
import type { CollectionSummary, WorkspaceInfo } from "./api.js";
import { ContextMenu, type MenuItem } from "./ContextMenu.js";
import { buildTree, dropDestination, filterTree, type TreeNode } from "./sidebarTree.js";

export function MethodBadge({ method }: { method: string }) {
  const label = method === "DELETE" ? "DEL" : method === "OPTIONS" ? "OPT" : method;
  return <span className={`method method-${method.toLowerCase()}`}>{label}</span>;
}

/** What's open in the main pane. */
export type Selection =
  | { kind: "request"; collectionId: string; path: string }
  | { kind: "environment"; collectionId: string; name: string };

/** An unsaved new request, shown in the tree until first save. */
export interface Draft {
  collectionId: string;
  path: string;
}

/** Everything the sidebar can ask the app to do; App owns dialogs and API calls. */
export type SidebarAction =
  | { type: "new-collection" }
  | { type: "new-request"; collectionId: string; folderPrefix?: string }
  | { type: "new-folder"; collectionId: string; parent?: string }
  | { type: "new-environment"; collectionId: string }
  | { type: "run-collection"; collectionId: string }
  | { type: "rename-collection"; collectionId: string; currentName: string }
  | { type: "delete-collection"; collectionId: string; name: string }
  | { type: "rename-folder"; collectionId: string; path: string }
  | { type: "delete-folder"; collectionId: string; path: string }
  | { type: "rename-request"; collectionId: string; path: string }
  | { type: "delete-request"; collectionId: string; path: string }
  | { type: "rename-environment"; collectionId: string; name: string }
  | { type: "delete-environment"; collectionId: string; name: string };

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** The request being dragged, tracked in state because dataTransfer payloads are unreadable during dragover. */
interface DragState {
  collectionId: string;
  path: string;
}

export function Sidebar({
  workspace,
  selection,
  draft,
  activeCollectionId,
  onSelectRequest,
  onSelectEnvironment,
  onActivateCollection,
  onAction,
  onMoveRequest,
}: {
  workspace: WorkspaceInfo;
  selection: Selection | null;
  draft: Draft | null;
  activeCollectionId: string | null;
  onSelectRequest: (collectionId: string, path: string) => void;
  onSelectEnvironment: (collectionId: string, name: string) => void;
  onActivateCollection: (collectionId: string) => void;
  onAction: (action: SidebarAction) => void;
  onMoveRequest: (from: DragState, toCollectionId: string, toPath: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  /**
   * Drop-target handlers for a folder row or collection header. `toFolder`
   * is "" for the collection root. Returns nothing while no drag is in
   * flight or when dropping here would be a no-op, so invalid targets never
   * highlight or accept the drop.
   */
  function dropProps(key: string, toCollectionId: string, toFolder: string) {
    if (!drag) return {};
    const destination = dropDestination(drag, toCollectionId, toFolder);
    if (destination === null) return {};
    return {
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropKey(key);
      },
      onDragLeave: () => setDropKey((current) => (current === key ? null : current)),
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const from = drag;
        setDrag(null);
        setDropKey(null);
        onMoveRequest(from, toCollectionId, destination);
      },
    };
  }

  const filtering = filter.trim() !== "";
  const single = workspace.mode === "collection";

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openMenu(event: React.MouseEvent, items: MenuItem[]) {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 4, items });
  }

  function newMenuItems(): MenuItem[] {
    const items: MenuItem[] = [];
    if (!single) {
      items.push({ label: "New collection…", onSelect: () => onAction({ type: "new-collection" }) });
    }
    const target = activeCollectionId;
    if (target !== null) {
      items.push(
        { label: "New request…", onSelect: () => onAction({ type: "new-request", collectionId: target }) },
        { label: "New folder…", onSelect: () => onAction({ type: "new-folder", collectionId: target }) },
        { label: "New environment…", onSelect: () => onAction({ type: "new-environment", collectionId: target }) },
      );
    }
    return items;
  }

  function collectionMenuItems(collection: CollectionSummary): MenuItem[] {
    const id = collection.id;
    const items: MenuItem[] = [
      { label: "▶ Run collection", onSelect: () => onAction({ type: "run-collection", collectionId: id }) },
      { label: "Add request…", onSelect: () => onAction({ type: "new-request", collectionId: id }) },
      { label: "Add folder…", onSelect: () => onAction({ type: "new-folder", collectionId: id }) },
      { label: "Add environment…", onSelect: () => onAction({ type: "new-environment", collectionId: id }) },
      {
        label: "Rename…",
        onSelect: () => onAction({ type: "rename-collection", collectionId: id, currentName: collection.name }),
      },
    ];
    if (!single) {
      items.push({
        label: "Delete…",
        danger: true,
        onSelect: () => onAction({ type: "delete-collection", collectionId: id, name: collection.name }),
      });
    }
    return items;
  }

  function folderMenuItems(collectionId: string, path: string): MenuItem[] {
    return [
      { label: "Add request…", onSelect: () => onAction({ type: "new-request", collectionId, folderPrefix: path }) },
      { label: "Add folder…", onSelect: () => onAction({ type: "new-folder", collectionId, parent: path }) },
      { label: "Rename…", onSelect: () => onAction({ type: "rename-folder", collectionId, path }) },
      { label: "Delete…", danger: true, onSelect: () => onAction({ type: "delete-folder", collectionId, path }) },
    ];
  }

  function requestMenuItems(collectionId: string, path: string): MenuItem[] {
    return [
      { label: "Rename file…", onSelect: () => onAction({ type: "rename-request", collectionId, path }) },
      { label: "Delete…", danger: true, onSelect: () => onAction({ type: "delete-request", collectionId, path }) },
    ];
  }

  function environmentMenuItems(collectionId: string, name: string): MenuItem[] {
    return [
      { label: "Rename…", onSelect: () => onAction({ type: "rename-environment", collectionId, name }) },
      { label: "Delete…", danger: true, onSelect: () => onAction({ type: "delete-environment", collectionId, name }) },
    ];
  }

  function renderNodes(collectionId: string, nodes: TreeNode[], depth: number) {
    return (
      <ul className="tree-level">
        {nodes.map((node) => {
          if (node.type === "folder") {
            const key = `f:${collectionId}:${node.path}`;
            // While filtering, always show matches inside collapsed folders.
            const isCollapsed = !filtering && collapsed.has(key);
            return (
              <li key={key}>
                <div
                  className={dropKey === key ? "tree-row drop-target" : "tree-row"}
                  style={{ paddingLeft: depth * 14 }}
                  {...dropProps(key, collectionId, node.path)}
                >
                  <button className="folder-header" onClick={() => toggle(key)}>
                    <span className={`chevron ${isCollapsed ? "" : "open"}`}>▶</span>
                    {node.name}
                  </button>
                  <button
                    className="row-menu"
                    aria-label={`Folder ${node.path} menu`}
                    onClick={(e) => openMenu(e, folderMenuItems(collectionId, node.path))}
                  >
                    ⋯
                  </button>
                </div>
                {!isCollapsed && renderNodes(collectionId, node.children, depth + 1)}
              </li>
            );
          }
          const request = node.request;
          const isSelected =
            selection?.kind === "request" &&
            selection.collectionId === collectionId &&
            selection.path === request.relativePath;
          // An unsaved draft has no file on disk yet, so there is nothing to move.
          const isDraft =
            draft?.collectionId === collectionId && draft.path === request.relativePath;
          const isDragging =
            drag?.collectionId === collectionId && drag.path === request.relativePath;
          return (
            <li key={request.relativePath}>
              <div
                className={isDragging ? "tree-row dragging" : "tree-row"}
                style={{ paddingLeft: depth * 14 }}
                draggable={!isDraft}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", request.relativePath);
                  event.dataTransfer.effectAllowed = "move";
                  setDrag({ collectionId, path: request.relativePath });
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setDropKey(null);
                }}
              >
                <button
                  className={isSelected ? "request-row selected" : "request-row"}
                  onClick={() => onSelectRequest(collectionId, request.relativePath)}
                >
                  <MethodBadge method={request.method} />
                  <span className="request-name">{request.name}</span>
                </button>
                <button
                  className="row-menu"
                  aria-label={`Request ${request.name} menu`}
                  onClick={(e) => openMenu(e, requestMenuItems(collectionId, request.relativePath))}
                >
                  ⋯
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  const trees = useMemo(() => {
    const map = new Map<string, TreeNode[]>();
    for (const collection of workspace.collections) {
      const draftPath =
        draft && draft.collectionId === collection.id ? draft.path : undefined;
      map.set(
        collection.id,
        filterTree(buildTree(collection.requests, collection.folders, draftPath), filter),
      );
    }
    return map;
  }, [workspace, draft, filter]);

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <input
          className="sidebar-search"
          type="search"
          placeholder="Filter requests"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="new-request"
          onClick={(e) => openMenu(e, newMenuItems())}
          title="New collection, request, folder, or environment"
        >
          + New
        </button>
      </div>
      <div className="sidebar-tree">
        {workspace.collections.length === 0 && (
          <p className="sidebar-empty">
            No collections yet — use <strong>+ New</strong> to create your first.
          </p>
        )}
        {workspace.collections.map((collection) => {
          const key = `c:${collection.id}`;
          const isCollapsed = !filtering && collapsed.has(key);
          const nodes = trees.get(collection.id) ?? [];
          const matchesName = collection.name.toLowerCase().includes(filter.trim().toLowerCase());
          if (filtering && nodes.length === 0 && !matchesName) return null;
          const isActive = collection.id === activeCollectionId;
          const dropTargetKey = `c:drop:${collection.id}`;
          return (
            <section key={collection.id} className={isActive ? "collection active" : "collection"}>
              <div
                className={
                  dropKey === dropTargetKey
                    ? "tree-row collection-row drop-target"
                    : "tree-row collection-row"
                }
                {...(collection.error ? {} : dropProps(dropTargetKey, collection.id, ""))}
              >
                <button
                  className="collection-header"
                  title={collection.id === "." ? undefined : collection.id}
                  onClick={() => {
                    onActivateCollection(collection.id);
                    toggle(key);
                  }}
                >
                  <span className={`chevron ${isCollapsed ? "" : "open"}`}>▶</span>
                  <span className="collection-title">{collection.name}</span>
                  <span className="tab-count">{collection.requests.length}</span>
                </button>
                {!collection.error && (
                  <button
                    className="row-menu"
                    aria-label={`Collection ${collection.name} menu`}
                    onClick={(e) => {
                      onActivateCollection(collection.id);
                      openMenu(e, collectionMenuItems(collection));
                    }}
                  >
                    ⋯
                  </button>
                )}
              </div>
              {collection.error && (
                <p className="sidebar-error" title={collection.error}>
                  Broken collection.yaml — fix it in your editor. {collection.error}
                </p>
              )}
              {!isCollapsed && !collection.error && (
                <>
                  {collection.environments.length > 0 && !filtering && (
                    <div className="env-section">
                      <span className="env-section-label">Environments</span>
                      <ul className="tree-level">
                        {collection.environments.map((name) => {
                          const isSelected =
                            selection?.kind === "environment" &&
                            selection.collectionId === collection.id &&
                            selection.name === name;
                          return (
                            <li key={name}>
                              <div className="tree-row" style={{ paddingLeft: 14 }}>
                                <button
                                  className={isSelected ? "request-row selected" : "request-row"}
                                  onClick={() => onSelectEnvironment(collection.id, name)}
                                >
                                  <span className="env-badge">env</span>
                                  <span className="request-name">{name}</span>
                                </button>
                                <button
                                  className="row-menu"
                                  aria-label={`Environment ${name} menu`}
                                  onClick={(e) => openMenu(e, environmentMenuItems(collection.id, name))}
                                >
                                  ⋯
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {nodes.length === 0 ? (
                    <p className="sidebar-empty">
                      {filtering ? "No requests match." : "No requests yet."}
                    </p>
                  ) : (
                    renderNodes(collection.id, nodes, 1)
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}
