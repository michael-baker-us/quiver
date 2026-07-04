import { useRef, useState, type ReactNode } from "react";

/** "column" stacks the panes (response below); "row" puts them side by side. */
export type SplitOrientation = "column" | "row";

export const MIN_SPLIT = 0.15;
export const MAX_SPLIT = 0.85;
export const DEFAULT_SPLIT = 0.55;

/** Fraction of the container the first pane gets, from a drag position. */
export function computeSplitRatio(
  orientation: SplitOrientation,
  rect: { top: number; left: number; width: number; height: number },
  clientX: number,
  clientY: number,
): number {
  const size = orientation === "row" ? rect.width : rect.height;
  if (size <= 0) return DEFAULT_SPLIT;
  const raw =
    orientation === "row"
      ? (clientX - rect.left) / size
      : (clientY - rect.top) / size;
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, raw));
}

/**
 * Two panes with a draggable divider. `second` may be null (no response
 * yet) — the wrapper elements stay mounted either way so the first pane's
 * children (the editor) never remount when a response arrives.
 */
export function SplitPane({
  orientation,
  ratio,
  onRatioChange,
  first,
  second,
}: {
  orientation: SplitOrientation;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  first: ReactNode;
  second: ReactNode | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    onRatioChange(computeSplitRatio(orientation, rect, e.clientX, e.clientY));
  }

  return (
    <div
      ref={containerRef}
      className={`split split-${orientation}${dragging ? " dragging" : ""}`}
    >
      <div
        className="split-first"
        style={{ flex: second ? `0 1 ${ratio * 100}%` : "1 1 auto" }}
      >
        {first}
      </div>
      {second !== null && (
        <>
          <div
            className="split-divider"
            role="separator"
            aria-orientation={orientation === "row" ? "vertical" : "horizontal"}
            title="Drag to resize · double-click to reset"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(true);
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDragging(false)}
            onDoubleClick={() => onRatioChange(DEFAULT_SPLIT)}
          />
          <div className="split-second">{second}</div>
        </>
      )}
    </div>
  );
}
