import { dirname, join, resolve } from "node:path";
import type { Binding, Call, Callable, SourceFile } from "./types.js";

function unique(callables: Callable[]) {
  return callables.length === 1 ? callables[0] : undefined;
}

function isStatic(callable: Callable) {
  return callable.symbol.node.children.some((child) => child.type === "static");
}

function qualified(callable: Callable | undefined) {
  if (!callable) return;

  const { file, symbol } = callable;
  if (
    file.language === "typescript" &&
    file.symbols.some(
      (candidate) => candidate.kind === "class" && candidate.name === symbol.container,
    ) &&
    !isStatic(callable)
  )
    return;

  return callable;
}

function modulePath(files: Map<string, SourceFile>, file: SourceFile, source: string, cwd: string) {
  if (file.language === "typescript") {
    if (!source.startsWith(".")) return;

    const base = resolve(dirname(file.path), source);
    const stem = base.replace(/\.(?:mjs|cjs|jsx|js)$/, "");
    const candidates = [
      base,
      ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${stem}${extension}`),
      ...["index.ts", "index.tsx", "index.js", "index.jsx"].map((name) => join(base, name)),
    ];

    return candidates.find((candidate) => files.has(candidate));
  }

  if (file.language === "python") {
    const dots = source.match(/^\.+/)?.[0].length ?? 0;
    let base = dots ? dirname(file.path) : cwd;
    for (let level = 1; level < dots; level += 1) base = dirname(base);

    const suffix = source.slice(dots).replaceAll(".", "/");

    return [resolve(base, `${suffix}.py`), resolve(base, suffix, "__init__.py")].find((candidate) =>
      files.has(candidate),
    );
  }
}

function readBindings(file: SourceFile, files: Map<string, SourceFile>, cwd: string) {
  const root = file.symbols[0]?.node.tree.rootNode;
  if (!root) return;

  for (const node of root.namedChildren) {
    const source = node.childForFieldName("source");
    const target = source ? modulePath(files, file, source.text.slice(1, -1), cwd) : undefined;

    if (file.language === "typescript" && node.type === "import_statement") {
      const clause = node.namedChildren.find((child) => child.type === "import_clause");

      for (const child of clause?.namedChildren ?? []) {
        if (child.type === "identifier") {
          file.imports.set(child.text, { file: target ?? "", name: "default" });
        } else if (child.type === "namespace_import") {
          file.imports.set(child.lastNamedChild!.text, { file: target ?? "", name: "*" });
        } else if (child.type === "named_imports") {
          for (const specifier of child.namedChildren) {
            const name = specifier.childForFieldName("name");
            const alias = specifier.childForFieldName("alias") ?? name;

            if (name && alias)
              file.imports.set(alias.text, { file: target ?? "", name: name.text });
          }
        }
      }
    }

    if (file.language === "typescript" && node.type === "export_statement") {
      const clause = node.namedChildren.find((child) => child.type === "export_clause");

      if (clause) {
        for (const specifier of clause.namedChildren) {
          const name = specifier.childForFieldName("name");
          const alias = specifier.childForFieldName("alias") ?? name;

          if (name && alias)
            file.exports.set(alias.text, {
              file: source ? (target ?? "") : file.path,
              name: name.text,
            });
        }
      } else {
        const declaration =
          node.childForFieldName("declaration") ?? node.childForFieldName("value");
        const isDefault = node.children.some((child) => child.type === "default");
        const declared = file.symbols.filter(
          (symbol) =>
            declaration &&
            symbol.node.startIndex >= declaration.startIndex &&
            symbol.node.endIndex <= declaration.endIndex,
        );

        for (const symbol of declared) {
          file.exports.set(isDefault && !symbol.container ? "default" : symbol.name, {
            file: file.path,
            name: symbol.name,
          });
        }

        if (isDefault && declaration?.type === "identifier") {
          file.exports.set("default", { file: file.path, name: declaration.text });
        }
      }
    }

    if (file.language === "python" && node.type === "import_from_statement") {
      const module = node.childForFieldName("module_name");
      const path = module ? modulePath(files, file, module.text, cwd) : undefined;

      for (const child of node.namedChildren) {
        if (child.id === module?.id || !["dotted_name", "aliased_import"].includes(child.type))
          continue;

        const name = child.childForFieldName("name") ?? child;
        const alias = child.childForFieldName("alias") ?? name;
        const submodule = module
          ? modulePath(
              files,
              file,
              `${module.text}${module.text.endsWith(".") ? "" : "."}${name.text}`,
              cwd,
            )
          : undefined;

        file.imports.set(
          alias.text,
          path ? { file: path, name: name.text, submodule } : { file: submodule ?? "", name: "*" },
        );
      }
    }

    if (file.language === "python" && node.type === "import_statement") {
      for (const child of node.namedChildren) {
        const name = child.childForFieldName("name") ?? child;
        const alias = child.childForFieldName("alias") ?? name;

        file.imports.set(alias.text, {
          file: modulePath(files, file, name.text, cwd) ?? "",
          name: "*",
        });
      }
    }
  }
}

function imported(
  files: Map<string, SourceFile>,
  binding: Binding,
  member?: string,
  seen = new Set<string>(),
): Callable | undefined {
  const file = files.get(binding.file);
  if (!file) return;

  const name = binding.name === "*" ? member : [binding.name, member].filter(Boolean).join(".");
  if (!name) return;

  const key = `${file.path}:${name}`;
  if (seen.has(key)) return;
  seen.add(key);

  const [head, ...tail] = name.split(".");
  const exported = file.exports.get(name) ?? (tail.length ? file.exports.get(head!) : undefined);
  if (file.language === "typescript" && !exported) return;

  const memberName =
    !file.exports.has(name) && exported && tail.length ? tail.join(".") : undefined;
  if (exported && exported.file !== file.path) return imported(files, exported, memberName, seen);

  const localName = exported ? [exported.name, memberName].filter(Boolean).join(".") : name;
  const local = unique(
    file.callables.filter((callable) => callable.symbol.name.replace(/#\d+$/, "") === localName),
  );
  if (local) return name.includes(".") ? qualified(local) : local;

  const alias = file.imports.get(localName);
  if (alias) return imported(files, alias, undefined, seen);
  if (binding.submodule && member)
    return imported(files, { file: binding.submodule, name: "*" }, member, seen);
}

function resolveCall(owner: Callable, call: Call, files: Map<string, SourceFile>) {
  const { file, symbol } = owner;
  const receiver = call.receiver;

  if (receiver) {
    if (["this", "self", "cls"].includes(receiver)) {
      if (!symbol.container) return;

      return unique(
        file.callables.filter(
          (target) =>
            target.symbol.container === symbol.container &&
            target.symbol.baseName === call.name &&
            (file.language !== "typescript" || isStatic(target) === isStatic(owner)),
        ),
      );
    }

    if (!/^[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u.test(receiver)) return;

    const [head, ...tail] = receiver.split(".");
    if (owner.bindings.has(head!)) return;

    const exact = file.imports.get(receiver);
    if (exact) return imported(files, exact, call.name);

    const binding = file.imports.get(head!);
    if (binding) return imported(files, binding, [...tail, call.name].join("."));

    return qualified(
      unique(
        file.callables.filter(
          (target) => target.symbol.container === receiver && target.symbol.baseName === call.name,
        ),
      ),
    );
  }

  if (owner.bindings.has(call.name)) return;

  const binding = file.imports.get(call.name);
  if (binding) return imported(files, binding);

  const local = file.callables.filter(
    (target) =>
      target.symbol.baseName === call.name &&
      target.symbol.kind === "func" &&
      (!target.symbol.container ||
        (symbol.kind === "func" && target.symbol.container === symbol.container)),
  );
  if (local.length) return unique(local);

  if (!["typescript", "python"].includes(file.language) && symbol.container) {
    return unique(
      file.callables.filter(
        (target) =>
          target.symbol.container === symbol.container && target.symbol.baseName === call.name,
      ),
    );
  }
}

export function resolveCalls(files: Map<string, SourceFile>, cwd: string, signal?: AbortSignal) {
  for (const file of files.values()) readBindings(file, files, cwd);

  for (const file of files.values()) {
    for (const owner of file.callables) {
      signal?.throwIfAborted();

      for (const call of owner.calls) {
        const target = resolveCall(owner, call, files);
        if (!target) {
          owner.unresolved += 1;
          continue;
        }

        owner.outgoing.add(target);
        target.incoming.add(owner);
      }
    }
  }
}
