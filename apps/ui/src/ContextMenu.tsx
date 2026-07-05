import { useEffect } from "react";

export interface MenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * A small anchored menu (the ⋯ menus in the sidebar). The transparent
 * backdrop catches outside clicks; Escape also closes.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const top = Math.min(y, window.innerHeight - items.length * 34 - 16);
  const left = Math.min(x, window.innerWidth - 220);

  // The backdrop never holds focus, so Escape must be caught document-wide.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="menu-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="context-menu" style={{ top, left }} role="menu">
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            className={item.danger ? "danger" : undefined}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
