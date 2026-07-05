import { z } from "zod";

export const httpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const stringMap = z.record(z.string(), z.string());

export const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({
    type: z.literal("basic"),
    username: z.string(),
    password: z.string(),
  }),
  z.object({
    type: z.literal("apikey"),
    header: z.string().default("X-API-Key"),
    value: z.string(),
  }),
]);

export const bodySchema = z.union([
  z.object({ type: z.literal("json"), content: z.unknown() }),
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({ type: z.literal("xml"), content: z.string() }),
  z.object({ type: z.literal("csv"), content: z.string() }),
  z.object({ type: z.literal("form"), content: stringMap }),
]);

export const assertionSchema = z.union([
  z.object({ status: z.number() }).strict(),
  z
    .object({
      header: z.string(),
      equals: z.string().optional(),
      contains: z.string().optional(),
    })
    .strict(),
  z
    .object({
      jsonpath: z.string(),
      equals: z.unknown().optional(),
      contains: z.string().optional(),
      exists: z.boolean().optional(),
    })
    .strict(),
  z.object({ bodyContains: z.string() }).strict(),
  z.object({ responseTimeBelow: z.number() }).strict(),
]);

export const requestFileSchema = z.object({
  name: z.string().optional(),
  method: httpMethodSchema,
  url: z.string(),
  headers: stringMap.default({}),
  query: stringMap.default({}),
  auth: authSchema.optional(),
  body: bodySchema.optional(),
  timeoutMs: z.number().positive().optional(),
  tests: z.array(assertionSchema).default([]),
  capture: z.record(z.string(), z.string()).default({}),
});

export const collectionFileSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  defaults: z
    .object({
      headers: stringMap.default({}),
      timeoutMs: z.number().positive().optional(),
    })
    .default({ headers: {} }),
});

export const environmentFileSchema = z.object({
  variables: stringMap.default({}),
});

export type HttpMethod = z.infer<typeof httpMethodSchema>;
export type Auth = z.infer<typeof authSchema>;
export type RequestBody = z.infer<typeof bodySchema>;
export type Assertion = z.infer<typeof assertionSchema>;
export type RequestDefinition = z.infer<typeof requestFileSchema>;
export type CollectionDefinition = z.infer<typeof collectionFileSchema>;
export type EnvironmentDefinition = z.infer<typeof environmentFileSchema>;
