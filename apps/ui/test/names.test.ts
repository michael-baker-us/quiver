import { describe, expect, it } from "vitest";
import {
  toCollectionDirName,
  toEnvironmentName,
  toFolderPath,
  toRequestPath,
} from "../src/names.js";

describe("toRequestPath", () => {
  it("normalizes plain names and folder paths", () => {
    expect(toRequestPath("users/create user")).toBe("users/create-user.request.yaml");
    expect(toRequestPath("ping")).toBe("ping.request.yaml");
  });

  it("strips existing extensions instead of doubling them", () => {
    expect(toRequestPath("ping.request.yaml")).toBe("ping.request.yaml");
    expect(toRequestPath("ping.yml")).toBe("ping.request.yaml");
  });

  it("rejects traversal, empty, and hidden-file inputs", () => {
    expect(toRequestPath("../evil")).toBeNull();
    expect(toRequestPath("a/../b")).toBeNull();
    expect(toRequestPath("   ")).toBeNull();
    expect(toRequestPath("users/.hidden")).toBeNull();
  });

  it("tolerates leading slashes and dots", () => {
    expect(toRequestPath("/users/list")).toBe("users/list.request.yaml");
  });
});

describe("toFolderPath", () => {
  it("normalizes and rejects the reserved environments dir", () => {
    expect(toFolderPath("users/admin team")).toBe("users/admin-team");
    expect(toFolderPath("users/")).toBe("users");
    expect(toFolderPath("environments")).toBeNull();
    expect(toFolderPath("environments/sub")).toBeNull();
    expect(toFolderPath("../up")).toBeNull();
    expect(toFolderPath("")).toBeNull();
  });
});

describe("toEnvironmentName", () => {
  it("accepts single segments and turns spaces into dashes", () => {
    expect(toEnvironmentName("staging")).toBe("staging");
    expect(toEnvironmentName("eu west")).toBe("eu-west");
  });

  it("rejects slashes, dots-first, and empties", () => {
    expect(toEnvironmentName("a/b")).toBeNull();
    expect(toEnvironmentName(".hidden")).toBeNull();
    expect(toEnvironmentName("")).toBeNull();
    expect(toEnvironmentName("../evil")).toBeNull();
  });
});

describe("toCollectionDirName", () => {
  it("derives a slug from a display name", () => {
    expect(toCollectionDirName("My Orders API")).toBe("my-orders-api");
    expect(toCollectionDirName("  Payments!!  ")).toBe("payments");
  });

  it("allows nesting up to three segments", () => {
    expect(toCollectionDirName("team/apis/orders")).toBe("team/apis/orders");
    expect(toCollectionDirName("a/b/c/d")).toBeNull();
  });

  it("rejects names that reduce to nothing", () => {
    expect(toCollectionDirName("!!!")).toBeNull();
    expect(toCollectionDirName("")).toBeNull();
  });
});
