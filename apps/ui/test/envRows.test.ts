import { describe, expect, it } from "vitest";
import { rowsToVariables, variablesToRows } from "../src/envRows.js";

describe("environment rows", () => {
  it("round-trips variables through rows", () => {
    const variables = { baseUrl: "https://x.test", token: "{{$env.TOKEN}}" };
    expect(rowsToVariables(variablesToRows(variables))).toEqual(variables);
  });

  it("skips blank keys and lets the last duplicate win", () => {
    expect(
      rowsToVariables([
        { key: "", value: "ignored" },
        { key: "  ", value: "ignored too" },
        { key: "a", value: "first" },
        { key: "a", value: "second" },
      ]),
    ).toEqual({ a: "second" });
  });

  it("trims keys but preserves values verbatim", () => {
    expect(rowsToVariables([{ key: " url ", value: "  spaced  " }])).toEqual({
      url: "  spaced  ",
    });
  });
});
