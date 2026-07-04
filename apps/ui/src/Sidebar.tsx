import { useMemo } from "react";
import type { RequestSummary } from "./api.js";

export function MethodBadge({ method }: { method: string }) {
  return <span className={`method method-${method.toLowerCase()}`}>{method}</span>;
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
  const groups = useMemo(() => {
    const all = [...requests];
    if (draft && !all.some((r) => r.relativePath === draft)) {
      all.push({ relativePath: draft, name: "(unsaved request)", method: "GET" });
      all.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
    }
    const byDir = new Map<string, RequestSummary[]>();
    for (const request of all) {
      const slash = request.relativePath.lastIndexOf("/");
      const dir = slash === -1 ? "" : request.relativePath.slice(0, slash);
      byDir.set(dir, [...(byDir.get(dir) ?? []), request]);
    }
    return [...byDir.entries()];
  }, [requests, draft]);

  return (
    <aside className="sidebar">
      <button className="new-request" onClick={onNew}>
        + New request
      </button>
      {groups.map(([dir, items]) => (
        <section key={dir}>
          {dir && <h2>{dir}</h2>}
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
        </section>
      ))}
    </aside>
  );
}
