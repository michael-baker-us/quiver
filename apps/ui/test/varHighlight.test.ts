import { describe, expect, it } from "vitest";
import { resolveVariableForDisplay, tokenizeVariables } from "../src/varHighlight.js";

describe("tokenizeVariables", () => {
  it("returns a single text token when there are no variables", () => {
    expect(tokenizeVariables("https://api.example.com/users")).toEqual([
      { kind: "text", raw: "https://api.example.com/users", start: 0 },
    ]);
  });

  it("splits variables from surrounding text with correct offsets", () => {
    expect(tokenizeVariables("{{baseUrl}}/users/{{userId}}")).toEqual([
      { kind: "var", raw: "{{baseUrl}}", name: "baseUrl", start: 0 },
      { kind: "text", raw: "/users/", start: 11 },
      { kind: "var", raw: "{{userId}}", name: "userId", start: 18 },
    ]);
  });

  it("trims whitespace inside braces for the name but keeps raw text intact", () => {
    const tokens = tokenizeVariables("x{{ baseUrl }}y");
    expect(tokens[1]).toEqual({ kind: "var", raw: "{{ baseUrl }}", name: "baseUrl", start: 1 });
  });

  it("ignores unmatched braces", () => {
    expect(tokenizeVariables("{{notclosed")).toEqual([
      { kind: "text", raw: "{{notclosed", start: 0 },
    ]);
  });

  it("handles an empty string", () => {
    expect(tokenizeVariables("")).toEqual([]);
  });
});

describe("resolveVariableForDisplay", () => {
  const vars = {
    baseUrl: "https://{{host}}/v1",
    host: "api.example.com",
    selfRef: "{{selfRef}}",
  };

  it("resolves a defined variable, expanding nested placeholders", () => {
    expect(resolveVariableForDisplay("baseUrl", vars)).toEqual({
      status: "resolved",
      value: "https://api.example.com/v1",
    });
  });

  it("reports variables missing from the environment", () => {
    expect(resolveVariableForDisplay("authToken", vars)).toEqual({ status: "missing" });
  });

  it("reports $env variables as OS-resolved without a value", () => {
    expect(resolveVariableForDisplay("$env.API_TOKEN", vars)).toEqual({
      status: "env",
      envName: "API_TOKEN",
    });
  });

  it("leaves unresolvable nested placeholders in place instead of throwing", () => {
    expect(resolveVariableForDisplay("selfRef", vars)).toEqual({
      status: "resolved",
      value: "{{selfRef}}",
    });
  });
});
