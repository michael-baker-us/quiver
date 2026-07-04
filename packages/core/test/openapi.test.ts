import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { importOpenApi, loadOpenApiFile } from "../src/openapi/import.js";
import { exampleFromSchema } from "../src/openapi/example.js";
import { requestFileSchema, type RequestDefinition } from "../src/schema.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "petstore.yaml",
);

async function importFixture() {
  return importOpenApi(await loadOpenApiFile(fixturePath));
}

function parseRequest(files: Map<string, string>, name: string): RequestDefinition {
  const raw = files.get(name);
  expect(raw, `${name} should exist; got ${[...files.keys()].join(", ")}`).toBeDefined();
  return requestFileSchema.parse(parseYaml(raw!));
}

describe("importOpenApi", () => {
  it("rejects non-OpenAPI-3 documents", () => {
    expect(() => importOpenApi({ swagger: "2.0" })).toThrow(/Swagger 2.0/);
    expect(() => importOpenApi({ hello: true })).toThrow(/OpenAPI 3/);
  });

  it("every generated request file round-trips through the request schema", async () => {
    const result = await importFixture();
    const requestFiles = [...result.files.keys()].filter((f) =>
      f.endsWith(".request.yaml"),
    );
    expect(requestFiles).toHaveLength(4);
    for (const file of requestFiles) {
      parseRequest(result.files, file); // throws (fails test) if invalid
    }
  });

  it("generates collection.yaml and an environment with the server baseUrl", async () => {
    const result = await importFixture();
    expect(result.collectionName).toBe("Petstore");
    const env = parseYaml(result.files.get("environments/default.yaml")!) as {
      variables: Record<string, string>;
    };
    expect(env.variables.baseUrl).toBe("https://petstore.example.com/v2");
  });

  it("groups by tag and names files from operationId", async () => {
    const result = await importFixture();
    expect(result.files.has("pets/list-pets.request.yaml")).toBe(true);
    expect(result.files.has("pets/create-pet.request.yaml")).toBe(true);
    // no operationId/tags → method-path fallback, grouped by first segment
    expect(result.files.has("store/post-store-orders.request.yaml")).toBe(true);
  });

  it("fills path params from examples and required query params", async () => {
    const result = await importFixture();
    const request = parseRequest(result.files, "pets/get-pet-by-id.request.yaml");
    expect(request.url).toBe("{{baseUrl}}/pets/7");

    const list = parseRequest(result.files, "pets/list-pets.request.yaml");
    expect(list.query).toEqual({ limit: "20" }); // optional "status" omitted
  });

  it("maps security schemes to auth with $env placeholders", async () => {
    const result = await importFixture();
    const list = parseRequest(result.files, "pets/list-pets.request.yaml");
    expect(list.auth).toEqual({
      type: "bearer",
      token: "{{$env.BEARER_AUTH_TOKEN}}",
    });

    const order = parseRequest(
      result.files,
      "store/post-store-orders.request.yaml",
    );
    expect(order.auth).toEqual({
      type: "apikey",
      header: "X-API-Key",
      value: "{{$env.API_KEY_AUTH_KEY}}",
    });
  });

  it("builds example JSON bodies through $refs, allOf, and enums", async () => {
    const result = await importFixture();
    const create = parseRequest(result.files, "pets/create-pet.request.yaml");
    expect(create.body).toEqual({
      type: "json",
      content: {
        name: "doggie",
        category: { name: "dogs", parent: null }, // circular Category ref degrades to null
      },
    });
  });

  it("derives status tests from the responses map", async () => {
    const result = await importFixture();
    const create = parseRequest(result.files, "pets/create-pet.request.yaml");
    expect(create.tests[0]).toEqual({ status: 201 });
    expect(create.tests[1]).toEqual({
      header: "content-type",
      contains: "application/json",
    });
  });
});

describe("exampleFromSchema", () => {
  it("prefers example, then default, then enum", () => {
    expect(exampleFromSchema({}, { type: "string", example: "x" })).toBe("x");
    expect(exampleFromSchema({}, { type: "integer", default: 5 })).toBe(5);
    expect(exampleFromSchema({}, { enum: ["a", "b"] })).toBe("a");
  });

  it("synthesizes values by type and format", () => {
    expect(exampleFromSchema({}, { type: "string", format: "email" })).toBe(
      "user@example.com",
    );
    expect(exampleFromSchema({}, { type: "boolean" })).toBe(true);
    expect(
      exampleFromSchema({}, { type: "array", items: { type: "integer" } }),
    ).toEqual([0]);
  });

  it("survives circular refs by degrading to null", () => {
    const doc = {
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: { next: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
    };
    expect(
      exampleFromSchema(doc, { $ref: "#/components/schemas/Node" }),
    ).toEqual({ next: null });
  });
});
