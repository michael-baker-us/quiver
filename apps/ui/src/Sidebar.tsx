import { useMemo } from "react";
import type { RequestSummary } from "./api.js";

export function MethodBadge({ method }: { method: string }) {
  return <span className={`method method-${method.toLowerCase()}`}>{method}</span>;
}

export function Sidebar({
  requests,
  selected,
  onSelect,
}: {
  requests: RequestSummary[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const groups = useMemo(() => {
    const byDir = new Map<string, RequestSummary[]>();
    for (const request of requests) {
      const slash = request.relativePath.lastIndexOf("/");
      const dir = slash === -1 ? "" : request.relativePath.slice(0, slash);
      byDir.set(dir, [...(byDir.get(dir) ?? []), request]);
    }
    return [...byDir.entries()];
  }, [requests]);

  return (
    <aside className="sidebar">
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
