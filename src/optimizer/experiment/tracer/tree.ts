import { relative } from "node:path";
import { buildGraph } from "./graph.js";
import type { Callable, TreeInput, TreeNode } from "./types.js";

const MAX_NODES = 500;
const MAX_BYTES = 32 * 1024;

export async function buildCallTree(cwd: string, input: TreeInput, signal?: AbortSignal) {
  const maxDepth = input.maxDepth ?? 3;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    throw new Error("maxDepth must be an integer of at least 1");
  }
  if (input.mode !== "incoming" && input.mode !== "outgoing") throw new Error("invalid mode");

  const graph = await buildGraph(cwd, input.file, signal);
  const symbol = graph.target.symbols.find((candidate) => candidate.name === input.symbol);
  if (!symbol) {
    throw new Error("symbol not found; use code_map to verify file and inspect symbol name");
  }

  const callable = graph.target.callables.find((candidate) => candidate.symbol === symbol);
  if (!callable) throw new Error("symbol must be a function or method");

  const root: TreeNode = { callable, children: [], depth: 0, cycle: false };
  const queue = [root];
  let truncated = false;
  let byteLimit = false;
  const filePaths = new Set([callable.file.path]);
  let bytes = 512 + Buffer.byteLength(relative(cwd, callable.file.path) + callable.symbol.name);
  if (bytes > MAX_BYTES) throw new Error("root symbol/path exceeds 32 KiB output budget");

  const expanded = new Set<Callable>();

  traverse: for (let cursor = 0; cursor < queue.length; cursor += 1) {
    signal?.throwIfAborted();
    const node = queue[cursor]!;
    if (node.cycle || node.depth >= maxDepth) continue;

    expanded.add(node.callable);

    const neighbors = [...node.callable[input.mode]].sort((left, right) => {
      if (left.file.path !== right.file.path) return left.file.path < right.file.path ? -1 : 1;
      return (
        left.symbol.startIndex - right.symbol.startIndex ||
        left.symbol.name.localeCompare(right.symbol.name)
      );
    });

    for (const neighbor of neighbors) {
      if (queue.length >= MAX_NODES) {
        truncated = true;
        break traverse;
      }

      // Reserve the longest branch prefix and label, including a possible cycle marker.
      const cost =
        Buffer.byteLength(
          `${neighbor.symbol.name} (F500 L${neighbor.symbol.range[0]}-L${neighbor.symbol.range[1]}) [cycle]\n`,
        ) +
        (node.depth + 1) * 5 +
        8 +
        (filePaths.has(neighbor.file.path)
          ? 0
          : Buffer.byteLength(relative(cwd, neighbor.file.path)) + 12);

      if (bytes + cost > MAX_BYTES) {
        byteLimit = true;
        break traverse;
      }

      bytes += cost;
      filePaths.add(neighbor.file.path);

      let ancestor: TreeNode | undefined = node;
      while (ancestor && ancestor.callable !== neighbor) ancestor = ancestor.parent;

      const child: TreeNode = {
        callable: neighbor,
        parent: node,
        children: [],
        depth: node.depth + 1,
        cycle: ancestor !== undefined,
      };

      node.children.push(child);
      queue.push(child);
    }
  }

  const files = new Map<string, string>();

  for (const node of queue) {
    if (!files.has(node.callable.file.path))
      files.set(node.callable.file.path, `F${files.size + 1}`);
  }

  const label = (node: TreeNode) => {
    const { symbol, file } = node.callable;

    return `${symbol.name} (${files.get(file.path)} L${symbol.range[0]}-L${symbol.range[1]})${node.cycle ? " [cycle]" : ""}`;
  };

  const lines = [
    "Files:",
    ...Array.from(files, ([path, id]) => `${id} - ${relative(cwd, path).replaceAll("\\", "/")}`),
    "",
    "Tree:",
    `${label(root)} (${input.mode})`,
  ];
  const pending = root.children
    .map((node, index) => ({ node, prefix: "", last: index === root.children.length - 1 }))
    .reverse();

  while (pending.length) {
    const { node, prefix, last } = pending.pop()!;
    lines.push(`${prefix}${last ? "└─" : "├─"} ${label(node)}`);
    const childPrefix = `${prefix}${last ? "   " : "│  "}`;

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        node: node.children[index]!,
        prefix: childPrefix,
        last: index === node.children.length - 1,
      });
    }
  }

  const unresolved = [...expanded].reduce((total, owner) => total + owner.unresolved, 0);
  lines.push("", `Heuristic results; maxDepth ${maxDepth}. Module-level calls excluded.`);
  if (!callable[input.mode].size)
    lines.push(`No ${input.mode === "incoming" ? "callers" : "callees"} resolved heuristically.`);
  if (unresolved) lines.push(`${unresolved} unresolved call(s) in expanded symbols.`);
  if (graph.skipped.length)
    lines.push(
      `Partial search: ${graph.skipped.length} file/discovery error(s). Missing grammars or unreadable files may hide calls.`,
    );
  if (truncated) lines.push(`Tree truncated at ${MAX_NODES} nodes.`);
  if (byteLimit) lines.push(`Tree truncated to fit ${MAX_BYTES / 1024} KiB output budget.`);

  return lines.join("\n");
}
