import type { RequestSummary } from "./api.js";

/**
 * The sidebar's view of one collection: real nesting (unlike the flat
 * dir→requests grouping the single-collection UI used), built from the
 * request list plus the server's folder list — so folders that exist on
 * disk but hold no requests yet still appear.
 */
export type TreeNode =
  | { type: "folder"; path: string; name: string; children: TreeNode[] }
  | { type: "request"; request: RequestSummary };

interface FolderNode {
  type: "folder";
  path: string;
  name: string;
  children: TreeNode[];
}

export function buildTree(
  requests: RequestSummary[],
  folders: string[],
  draftPath?: string,
): TreeNode[] {
  const root: TreeNode[] = [];
  const byPath = new Map<string, FolderNode>();

  function ensureFolder(path: string): FolderNode {
    const existing = byPath.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const node: FolderNode = {
      type: "folder",
      path,
      name: slash === -1 ? path : path.slice(slash + 1),
      children: [],
    };
    byPath.set(path, node);
    const parent = slash === -1 ? root : ensureFolder(path.slice(0, slash)).children;
    parent.push(node);
    return node;
  }

  for (const folder of folders) ensureFolder(folder);

  const all = [...requests];
  if (draftPath && !all.some((r) => r.relativePath === draftPath)) {
    all.push({ relativePath: draftPath, name: "(unsaved request)", method: "GET" });
  }
  for (const request of all) {
    const slash = request.relativePath.lastIndexOf("/");
    const parent =
      slash === -1 ? root : ensureFolder(request.relativePath.slice(0, slash)).children;
    parent.push({ type: "request", request });
  }

  // Sort each level by segment name, folders and requests together — the
  // same alphabetical-path order the runner executes in.
  function nodeKey(node: TreeNode): string {
    if (node.type === "folder") return node.name;
    const rel = node.request.relativePath;
    const slash = rel.lastIndexOf("/");
    return slash === -1 ? rel : rel.slice(slash + 1);
  }
  function sortLevel(nodes: TreeNode[]): void {
    nodes.sort((a, b) => nodeKey(a).localeCompare(nodeKey(b), "en"));
    for (const node of nodes) {
      if (node.type === "folder") sortLevel(node.children);
    }
  }
  sortLevel(root);
  return root;
}

function requestMatches(request: RequestSummary, needle: string): boolean {
  return (
    request.name.toLowerCase().includes(needle) ||
    request.relativePath.toLowerCase().includes(needle) ||
    request.method.toLowerCase() === needle
  );
}

/**
 * Keeps requests matching the needle plus every ancestor folder; a folder
 * whose own name matches keeps its whole subtree.
 */
export function filterTree(nodes: TreeNode[], needle: string): TreeNode[] {
  const trimmed = needle.trim().toLowerCase();
  if (!trimmed) return nodes;
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "request") {
      if (requestMatches(node.request, trimmed)) result.push(node);
      continue;
    }
    if (node.name.toLowerCase().includes(trimmed)) {
      result.push(node);
      continue;
    }
    const children = filterTree(node.children, trimmed);
    if (children.length > 0) result.push({ ...node, children });
  }
  return result;
}
