import { useMemo, useState } from "react";
import type { RequestSummary } from "./api.js";

export function MethodBadge({ method }: { method: string }) {
  const label = method === "DELETE" ? "DEL" : method === "OPTIONS" ? "OPT" : method;
  return <span className={`method method-${method.toLowerCase()}`}>{label}</span>;
}

export function Sidebar({
  requests,
  selected,
  draft,
  onSelect,
  onNew,
}: {
  requests: RequestSummary[];
  selected: string | null;
  /** Path of an unsaved new request, shown in the tree until first save. */
  draft: string | null;
  onSelect: (path: string) => void;
  onNew: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const all = [...requests];
    if (draft && !all.some((r) => r.relativePath === draft)) {
      all.push({ relativePath: draft, name: "(unsaved request)", method: "GET" });
      all.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
    }
    const needle = filter.trim().toLowerCase();
    const visible = needle
      ? all.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            r.relativePath.toLowerCase().includes(needle) ||
            r.method.toLowerCase() === needle,
        )
      : all;
    const byDir = new Map<string, RequestSummary[]>();
    for (const request of visible) {
      const slash = request.relativePath.lastIndexOf("/");
      const dir = slash === -1 ? "" : request.relativePath.slice(0, slash);
      byDir.set(dir, [...(byDir.get(dir) ?? []), request]);
    }
    return [...byDir.entries()];
  }, [requests, draft, filter]);

  function toggleFolder(dir: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }

  const filtering = filter.trim() !== "";

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
        <button className="new-request" onClick={onNew} title="New request">
          + New
        </button>
      </div>
      <div className="sidebar-tree">
        {groups.length === 0 && (
          <p className="sidebar-empty">
            {filtering ? "No requests match the filter." : "No requests yet — create one."}
          </p>
        )}
        {groups.map(([dir, items]) => {
          // While filtering, always show matches even inside collapsed folders.
          const isCollapsed = !filtering && collapsed.has(dir);
          return (
            <section key={dir}>
              {dir && (
                <button className="folder-header" onClick={() => toggleFolder(dir)}>
                  <span className={`chevron ${isCollapsed ? "" : "open"}`}>▶</span>
                  {dir}
                  <span className="tab-count">{items.length}</span>
                </button>
              )}
              {!isCollapsed && (
                <ul>
                  {items.map((request) => (
                    <li key={request.relativePath}>
                      <button
                        className={
                          request.relativePath === selected ? "selected" : undefined
                        }
                        onClick={() => onSelect(request.relativePath)}
                      >
                        <MethodBadge method={request.method} />
                        <span className="request-name">{request.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
