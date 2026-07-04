import { describe, expect, it } from "vitest";
import { computeSplitRatio, DEFAULT_SPLIT, MAX_SPLIT, MIN_SPLIT } from "../src/SplitPane.js";

const rect = { top: 100, left: 50, width: 800, height: 600 };

describe("computeSplitRatio", () => {
  it("uses the vertical position for stacked (column) panes", () => {
    expect(computeSplitRatio("column", rect, 0, 100 + 300)).toBeCloseTo(0.5);
    expect(computeSplitRatio("column", rect, 9999, 100 + 150)).toBeCloseTo(0.25);
  });

  it("uses the horizontal position for side-by-side (row) panes", () => {
    expect(computeSplitRatio("row", rect, 50 + 200, 0)).toBeCloseTo(0.25);
    expect(computeSplitRatio("row", rect, 50 + 600, 9999)).toBeCloseTo(0.75);
  });

  it("clamps so neither pane can be dragged shut", () => {
    expect(computeSplitRatio("column", rect, 0, -5000)).toBe(MIN_SPLIT);
    expect(computeSplitRatio("column", rect, 0, 5000)).toBe(MAX_SPLIT);
    expect(computeSplitRatio("row", rect, -5000, 0)).toBe(MIN_SPLIT);
    expect(computeSplitRatio("row", rect, 5000, 0)).toBe(MAX_SPLIT);
  });

  it("falls back to the default ratio when the container has no size yet", () => {
    expect(computeSplitRatio("column", { ...rect, height: 0 }, 0, 300)).toBe(DEFAULT_SPLIT);
    expect(computeSplitRatio("row", { ...rect, width: 0 }, 300, 0)).toBe(DEFAULT_SPLIT);
  });
});
