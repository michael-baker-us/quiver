import { describe, expect, it } from "vitest";
import { prepareRequest, type ResolvedRequest } from "../src/http.js";

function baseRequest(body: ResolvedRequest["body"]): ResolvedRequest {
  return {
    name: "test",
    method: "POST",
    url: "https://api.example.com/things",
    headers: {},
    query: {},
    body,
    timeoutMs: 1000,
  };
}

describe("prepareRequest body serialization", () => {
  it("serializes each body type with its default Content-Type", () => {
    const json = prepareRequest(baseRequest({ type: "json", content: { a: 1 } }));
    expect(json.headers["content-type"]).toBe("application/json");
    expect(json.bodyText).toBe('{"a":1}');

    const text = prepareRequest(baseRequest({ type: "text", content: "hello" }));
    expect(text.headers["content-type"]).toBe("text/plain");
    expect(text.bodyText).toBe("hello");

    const xml = prepareRequest(
      baseRequest({ type: "xml", content: "<note><to>Ada</to></note>" }),
    );
    expect(xml.headers["content-type"]).toBe("application/xml");
    expect(xml.bodyText).toBe("<note><to>Ada</to></note>");

    const csv = prepareRequest(baseRequest({ type: "csv", content: "id,name\n1,Ada" }));
    expect(csv.headers["content-type"]).toBe("text/csv");
    expect(csv.bodyText).toBe("id,name\n1,Ada");

    const form = prepareRequest(baseRequest({ type: "form", content: { a: "1", b: "&" } }));
    expect(form.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(form.bodyText).toBe("a=1&b=%26");
  });

  it("keeps an explicit Content-Type header over the body-type default", () => {
    const prepared = prepareRequest({
      ...baseRequest({ type: "csv", content: "a;b" }),
      headers: { "Content-Type": "text/csv; charset=utf-8; header=present" },
    });
    expect(prepared.headers["content-type"]).toBe(
      "text/csv; charset=utf-8; header=present",
    );
  });

  it("drops the body for GET requests", () => {
    const prepared = prepareRequest({
      ...baseRequest({ type: "xml", content: "<x/>" }),
      method: "GET",
    });
    expect(prepared.bodyText).toBeUndefined();
    expect(prepared.headers["content-type"]).toBeUndefined();
  });
});
