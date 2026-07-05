import { describe, expect, it } from "vitest";
import type { RequestSummary } from "../src/api.js";
import { buildTree, filterTree, type TreeNode } from "../src/sidebarTree.js";

function req(relativePath: string, name = relativePath, method = "GET"): RequestSummary {
  return { relativePath, name, method: method as RequestSummary["method"] };
}

/** Renders a tree as indented text — easier to assert whole shapes. */
function sketch(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.type === "folder"
      ? [`${"  ".repeat(depth)}${node.name}/`, ...sketch(node.children, depth + 1)]
      : [`${"  ".repeat(depth)}${node.request.relativePath.split("/").pop()!}`],
  );
}

describe("buildTree", () => {
  it("nests folders and requests in alphabetical path order", () => {
    const tree = buildTree(
      [
        req("ping.request.yaml"),
        req("users/01-list.request.yaml"),
        req("users/admin/ban.request.yaml"),
        req("auth/01-login.request.yaml"),
      ],
      ["auth", "users", "users/admin"],
    );
    expect(sketch(tree)).toEqual([
      "auth/",
      "  01-login.request.yaml",
      "ping.request.yaml",
      "users/",
      "  01-list.request.yaml",
      "  admin/",
      "    ban.request.yaml",
    ]);
  });

  it("shows empty folders from the folders list", () => {
    const tree = buildTree([req("a.request.yaml")], ["drafts", "drafts/wip"]);
    expect(sketch(tree)).toEqual(["a.request.yaml", "drafts/", "  wip/"]);
  });

  it("creates folder nodes implied by request paths even if unlisted", () => {
    const tree = buildTree([req("users/get.request.yaml")], []);
    expect(sketch(tree)).toEqual(["users/", "  get.request.yaml"]);
  });

  it("injects an unsaved draft row", () => {
    const tree = buildTree([req("a.request.yaml")], [], "users/new.request.yaml");
    expect(sketch(tree)).toEqual(["a.request.yaml", "users/", "  new.request.yaml"]);
    const users = tree[1];
    if (users?.type !== "folder") throw new Error("expected folder");
    const draft = users.children[0];
    if (draft?.type !== "request") throw new Error("expected request");
    expect(draft.request.name).toBe("(unsaved request)");
  });

  it("does not duplicate a draft that already exists as a request", () => {
    const tree = buildTree([req("a.request.yaml")], [], "a.request.yaml");
    expect(sketch(tree)).toEqual(["a.request.yaml"]);
  });
});

describe("filterTree", () => {
  const tree = buildTree(
    [
      req("auth/01-login.request.yaml", "Login", "POST"),
      req("users/01-list.request.yaml", "List users"),
      req("users/admin/ban.request.yaml", "Ban user", "DELETE"),
    ],
    ["auth", "users", "users/admin", "empty"],
  );

  it("keeps matches and their ancestor folders", () => {
    expect(sketch(filterTree(tree, "ban"))).toEqual([
      "users/",
      "  admin/",
      "    ban.request.yaml",
    ]);
  });

  it("matches on name, path, and exact method", () => {
    expect(sketch(filterTree(tree, "login"))).toEqual(["auth/", "  01-login.request.yaml"]);
    expect(sketch(filterTree(tree, "delete"))).toEqual([
      "users/",
      "  admin/",
      "    ban.request.yaml",
    ]);
  });

  it("a matching folder name keeps its whole subtree", () => {
    expect(sketch(filterTree(tree, "admin"))).toEqual([
      "users/",
      "  admin/",
      "    ban.request.yaml",
    ]);
  });

  it("empty needle returns the tree unchanged; no match returns nothing", () => {
    expect(filterTree(tree, "  ")).toBe(tree);
    expect(filterTree(tree, "zzz")).toEqual([]);
  });
});
