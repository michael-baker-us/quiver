import { afterEach, describe, expect, it } from "vitest";
import {
  MissingVariableError,
  resolveDeep,
  resolveString,
} from "../src/variables.js";

describe("resolveString", () => {
  it("substitutes simple variables", () => {
    expect(resolveString("{{base}}/users", { base: "http://x" })).toBe(
      "http://x/users",
    );
  });

  it("tolerates whitespace inside braces", () => {
    expect(resolveString("{{ base }}", { base: "v" })).toBe("v");
  });

  it("resolves nested variables in values", () => {
    expect(
      resolveString("{{url}}", { url: "{{host}}/api", host: "http://x" }),
    ).toBe("http://x/api");
  });

  it("throws listing every missing variable", () => {
    expect(() => resolveString("{{a}} {{b}}", {})).toThrowError(
      MissingVariableError,
    );
    try {
      resolveString("{{a}} {{b}}", {});
    } catch (error) {
      expect((error as MissingVariableError).names).toEqual(["a", "b"]);
    }
  });

  describe("$env variables", () => {
    afterEach(() => {
      delete process.env.QUIVER_TEST_TOKEN;
    });

    it("reads from process.env", () => {
      process.env.QUIVER_TEST_TOKEN = "secret";
      expect(resolveString("{{$env.QUIVER_TEST_TOKEN}}", {})).toBe("secret");
    });

    it("throws when the env var is unset", () => {
      expect(() => resolveString("{{$env.QUIVER_TEST_TOKEN}}", {})).toThrow(
        /QUIVER_TEST_TOKEN/,
      );
    });
  });
});

describe("resolveDeep", () => {
  it("resolves strings nested in objects and arrays", () => {
    const input = { list: ["{{a}}", { key: "{{b}}" }], n: 3, ok: true };
    expect(resolveDeep(input, { a: "1", b: "2" })).toEqual({
      list: ["1", { key: "2" }],
      n: 3,
      ok: true,
    });
  });
});
