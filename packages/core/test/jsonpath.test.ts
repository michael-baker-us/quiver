import { describe, expect, it } from "vitest";
import { getPath, JsonPathSyntaxError, NOT_FOUND } from "../src/jsonpath.js";

const doc = {
  data: {
    users: [
      { id: 1, name: "ada", "weird-key": "x" },
      { id: 2, name: "grace" },
    ],
    total: 2,
  },
  ok: true,
};

describe("getPath", () => {
  it("returns the root for $", () => {
    expect(getPath(doc, "$")).toBe(doc);
  });

  it("navigates dot members and array indexes", () => {
    expect(getPath(doc, "$.data.users[1].name")).toBe("grace");
    expect(getPath(doc, "$.data.total")).toBe(2);
  });

  it("supports bracket-quoted keys", () => {
    expect(getPath(doc, '$.data.users[0]["weird-key"]')).toBe("x");
  });

  it("works on array roots", () => {
    expect(getPath([{ id: 7 }], "$[0].id")).toBe(7);
  });

  it("returns NOT_FOUND for absent paths", () => {
    expect(getPath(doc, "$.data.missing")).toBe(NOT_FOUND);
    expect(getPath(doc, "$.data.users[9].id")).toBe(NOT_FOUND);
    expect(getPath(doc, "$.ok.nested")).toBe(NOT_FOUND);
  });

  it("distinguishes NOT_FOUND from null and undefined values", () => {
    expect(getPath({ a: null }, "$.a")).toBe(null);
  });

  it("rejects malformed paths", () => {
    expect(() => getPath(doc, "data.users")).toThrow(JsonPathSyntaxError);
    expect(() => getPath(doc, "$.data.users[x]")).toThrow(JsonPathSyntaxError);
  });
});
