import { extname, relative, resolve } from "node:path";
import type { SyntaxNode } from "tree-sitter";
import { getLanguageByExt } from "../../grammar/index.js";
import { collectSymbols } from "../../grammar/symbols.js";
import { findFiles } from "../../mapper/files.js";
import { resolveCalls } from "./resolve.js";
import type { Call, Callable, SourceFile } from "./types.js";

const CALL_TYPES = new Set([
  "call_expression",
  "call",
  "method_invocation",
  "invocation_expression",
]);
const MEMBER_FIELDS: Record<string, [string, string]> = {
  member_expression: ["object", "property"],
  attribute: ["object", "attribute"],
  selector_expression: ["operand", "field"],
  field_expression: ["argument", "field"],
  member_access_expression: ["expression", "name"],
  scoped_identifier: ["path", "name"],
  qualified_identifier: ["scope", "name"],
};
const BINDING_TYPES = new Set([
  "variable_declarator",
  "assignment",
  "var_spec",
  "short_var_declaration",
  "let_declaration",
  "parameter",
  "required_parameter",
  "optional_parameter",
  "parameter_declaration",
  "formal_parameter",
  "function_declaration",
  "function_definition",
  "class_declaration",
  "class_definition",
]);

function readCall(node: SyntaxNode): Call | undefined {
  if (
    node.type === "method_invocation" ||
    (node.type === "call" && node.childForFieldName("method"))
  ) {
    const name = node.childForFieldName("name") ?? node.childForFieldName("method");
    const receiver = node.childForFieldName("object") ?? node.childForFieldName("receiver");

    return name ? { name: name.text, receiver: receiver?.text } : undefined;
  }

  const callee =
    node.childForFieldName("function") ??
    (node.type === "call_expression" ? node.firstNamedChild : null);
  if (!callee) return;
  if (["identifier", "simple_identifier"].includes(callee.type)) return { name: callee.text };

  if (callee.type === "navigation_expression") {
    const receiver = callee.firstNamedChild;
    const name = callee.lastNamedChild;

    return name && receiver ? { name: name.text, receiver: receiver.text } : undefined;
  }

  const fields = MEMBER_FIELDS[callee.type];
  if (!fields) return;

  // Rust and Zig use value/object instead of C's argument for field receivers.
  const receiver =
    callee.childForFieldName(fields[0]) ??
    callee.childForFieldName("value") ??
    callee.childForFieldName("object");
  const name = callee.childForFieldName(fields[1]) ?? callee.childForFieldName("member");

  return name && receiver
    ? { name: name.text, receiver: receiver.text.replaceAll("::", ".") }
    : undefined;
}

function collectCalls(file: SourceFile, signal?: AbortSignal) {
  const root = file.symbols[0]?.node.tree.rootNode;
  if (!root) return;

  const owners = new Map(file.callables.map((callable) => [callable.symbol.node.id, callable]));
  const pending: Array<{ node: SyntaxNode; owner?: Callable }> = [{ node: root }];

  while (pending.length) {
    signal?.throwIfAborted();
    const { node, owner: parentOwner } = pending.pop()!;
    const owner = owners.get(node.id) ?? parentOwner;

    if (owner) {
      if (CALL_TYPES.has(node.type)) {
        const call = readCall(node);
        if (call) owner.calls.push(call);
        else owner.unresolved += 1;
      }

      if (node.id !== owner.symbol.node.id && BINDING_TYPES.has(node.type)) {
        const binding =
          node.childForFieldName("name") ??
          node.childForFieldName("left") ??
          node.childForFieldName("pattern");

        if (binding) {
          for (const identifier of [binding, ...binding.descendantsOfType("identifier")]) {
            if (["identifier", "simple_identifier"].includes(identifier.type))
              owner.bindings.add(identifier.text);
          }
        }
      }

      if (["formal_parameters", "parameters", "lambda_parameters"].includes(node.type)) {
        for (const parameter of node.namedChildren) {
          if (parameter.type === "identifier") owner.bindings.add(parameter.text);
        }
      }

      if (
        file.language === "python" &&
        ["import_statement", "import_from_statement"].includes(node.type)
      ) {
        const module = node.childForFieldName("module_name");

        for (const child of node.namedChildren) {
          if (child.id === module?.id) continue;

          const name = child.childForFieldName("alias") ?? child.childForFieldName("name") ?? child;
          owner.bindings.add(name.text.split(".")[0]!);
        }
      }
    }

    for (let index = node.namedChildCount - 1; index >= 0; index -= 1) {
      pending.push({ node: node.namedChild(index)!, owner });
    }
  }
}

export async function buildGraph(cwd: string, target: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const targetPath = resolve(cwd, target);
  if (!getLanguageByExt(extname(targetPath).toLowerCase()).profile) {
    throw new Error(`unsupported language: ${extname(targetPath) || "no extension"}`);
  }

  const listed = await findFiles(cwd, ["."], undefined, signal);
  const paths = new Set([targetPath, ...Array.from(listed.files, (path) => resolve(cwd, path))]);
  const files = new Map<string, SourceFile>();
  const skipped: string[] = [...listed.failed];

  for (const path of paths) {
    signal?.throwIfAborted();

    try {
      const symbols = await collectSymbols(cwd, path);
      const file: SourceFile = {
        path,
        language: getLanguageByExt(extname(path).toLowerCase()).name!,
        symbols,
        callables: [],
        imports: new Map(),
        exports: new Map(),
      };

      file.callables = symbols
        .filter((symbol) => symbol.kind === "func" || symbol.kind === "method")
        .map((symbol) => ({
          symbol,
          file,
          calls: [],
          bindings: new Set<string>(),
          unresolved: 0,
          incoming: new Set<Callable>(),
          outgoing: new Set<Callable>(),
        }));

      collectCalls(file, signal);
      files.set(path, file);
    } catch (error) {
      signal?.throwIfAborted();
      if (path === targetPath) throw error;

      skipped.push(relative(cwd, path));
    }
  }

  resolveCalls(files, cwd, signal);

  return { files, target: files.get(targetPath)!, skipped };
}
