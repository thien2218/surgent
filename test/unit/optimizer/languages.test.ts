import type { SyntaxNode } from "tree-sitter";
import { describe, expect, it } from "vitest";
import { getLanguageProfile, getSupportedExtensions } from "../../../src/optimizer/languages/index.js";

// Profile tests use only Tree-sitter's node boundary, not a substitute parser.
function makeNode(
  type: string,
  options: { text?: string; fields?: Record<string, SyntaxNode>; children?: SyntaxNode[] } = {},
): SyntaxNode {
  const fields = options.fields ?? {};
  const children = [...new Set([...Object.values(fields), ...(options.children ?? [])])];
  const node = {
    type,
    text: options.text ?? "",
    parent: null as SyntaxNode | null,
    namedChildren: children,
    namedChild: (index: number) => children[index] ?? null,
    childForFieldName: (name: string) => fields[name] ?? null,
  } as unknown as SyntaxNode;
  for (const child of children) Object.assign(child, { parent: node });
  return node;
}

function profile(extension: string) {
  const result = getLanguageProfile(extension);
  if (!result) throw new Error(`Missing profile: ${extension}`);
  return result;
}

describe("language profiles", () => {
  it("supports script variants without treating unknown extensions as code", () => {
    expect([...getSupportedExtensions()].sort()).toEqual([
      ".cjs", ".go", ".java", ".js", ".jsx", ".mjs", ".py", ".rs", ".ts", ".tsx",
    ]);
    for (const extension of [".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(getLanguageProfile(extension)).toBe(getLanguageProfile(".ts"));
    }
    expect(getLanguageProfile(".txt")).toBeUndefined();
  });

  it.each([
    [".ts", "function_declaration", ["program"], "func"],
    [".ts", "class_declaration", ["program"], "class"],
    [".ts", "method_definition", ["class_body", "class_declaration", "program"], "method"],
    [".ts", "variable_declarator", ["lexical_declaration", "program"], "decl"],
    [".ts", "identifier", ["import_clause", "import_statement", "program"], "deps"],
    [".ts", "export_statement", ["program"], "public"],
    [".py", "class_definition", ["module"], "class"],
    [".py", "function_definition", ["decorated_definition", "module"], "func"],
    [".py", "function_definition", ["decorated_definition", "block", "class_definition", "module"], "method"],
    [".py", "assignment", ["expression_statement", "module"], "decl"],
    [".py", "import_from_statement", ["module"], "deps"],
    [".go", "function_declaration", ["source_file"], "func"],
    [".go", "method_elem", ["interface_type", "type_spec", "type_declaration", "source_file"], "method"],
    [".go", "type_alias", ["type_declaration", "source_file"], "class"],
    [".go", "var_spec", ["var_spec_list", "var_declaration", "source_file"], "decl"],
    [".go", "import_spec", ["import_spec_list", "import_declaration", "source_file"], "deps"],
    [".rs", "function_item", ["declaration_list", "mod_item", "source_file"], "func"],
    [".rs", "function_item", ["declaration_list", "impl_item", "source_file"], "method"],
    [".rs", "function_signature_item", ["declaration_list", "trait_item", "source_file"], "method"],
    [".rs", "struct_item", ["source_file"], "class"],
    [".rs", "const_item", ["source_file"], "decl"],
    [".rs", "use_declaration", ["source_file"], "deps"],
    [".java", "record_declaration", ["program"], "class"],
    [".java", "constructor_declaration", ["class_body", "class_declaration", "program"], "method"],
    [".java", "method_declaration", ["interface_body", "interface_declaration", "program"], "method"],
    [".java", "import_declaration", ["program"], "deps"],
    [".java", "exports_module_directive", ["module_body", "module_declaration", "program"], "public"],
  ] as const)("%s classifies %s through %j as %s", (extension, type, ancestors, kind) => {
    const node = makeNode(type);
    let parent = node;
    for (const ancestor of ancestors) parent = makeNode(ancestor, { children: [parent] });

    expect(profile(extension).resolveSymbolKind(node)).toBe(kind);
  });

  it.each([
    [".ts", "function_declaration", ["statement_block", "function_declaration", "program"]],
    [".ts", "variable_declarator", ["lexical_declaration", "statement_block", "function_declaration", "program"]],
    [".ts", "identifier", ["expression_statement", "program"]],
    [".py", "function_definition", ["block", "function_definition", "module"]],
    [".py", "assignment", ["expression_statement", "block", "function_definition", "module"]],
    [".go", "var_spec", ["var_declaration", "block", "function_declaration", "source_file"]],
    [".go", "method_elem", ["interface_type", "source_file"]],
    [".rs", "function_item", ["block", "function_item", "source_file"]],
    [".java", "method_declaration", ["program"]],
  ] as const)("%s excludes %s in invalid context %j", (extension, type, ancestors) => {
    const node = makeNode(type);
    let parent = node;
    for (const ancestor of ancestors) parent = makeNode(ancestor, { children: [parent] });

    expect(profile(extension).resolveSymbolKind(node)).toBeUndefined();
  });

  it("names exported arrows from bindings and suppresses duplicate declarations", () => {
    const arrow = makeNode("arrow_function");
    const binding = makeNode("variable_declarator", {
      fields: { name: makeNode("identifier", { text: "fetchData" }), value: arrow },
    });
    const declaration = makeNode("lexical_declaration", { children: [binding] });
    const exported = makeNode("export_statement", { fields: { declaration } });
    makeNode("program", { children: [exported] });
    const language = profile(".ts");

    expect(language.resolveSymbolKind(arrow)).toBe("func");
    expect(language.readNodeName(arrow)).toBe("fetchData");
    expect(language.isPublicSymbol(arrow)).toBe(true);
    expect(language.shouldSkipSymbol(arrow)).toBe(false);
    expect(language.shouldSkipSymbol(binding)).toBe(true);
    expect(language.shouldSkipSymbol(exported)).toBe(true);
    expect(language.isPublicSymbol(makeNode("function_declaration"))).toBe(false);
  });

  it("keeps re-exports while giving unnamed functions an inspectable base name", () => {
    const language = profile(".ts");
    const exported = makeNode("export_statement", { children: [makeNode("export_clause")] });

    expect(language.readNodeName(exported)).toBe("exports");
    expect(language.shouldSkipSymbol(exported)).toBe(false);
    expect(language.readNodeName(makeNode("function_expression"))).toBe("anonymous");
    expect(language.shouldSkipSymbol(makeNode("function_expression", {
      fields: { name: makeNode("identifier", { text: "localName" }) },
    }))).toBe(true);
  });

  it("uses import aliases and class containers for navigation names", () => {
    const language = profile(".ts");
    const imported = makeNode("import_specifier", {
      fields: {
        name: makeNode("identifier", { text: "original" }),
        alias: makeNode("identifier", { text: "local" }),
      },
    });
    const method = makeNode("method_definition", { fields: { name: makeNode("property_identifier", { text: "run" }) } });
    makeNode("class_declaration", {
      fields: { name: makeNode("type_identifier", { text: "Worker" }) },
      children: [makeNode("class_body", { children: [method] })],
    });

    expect(language.readNodeName(imported)).toBe("local");
    expect(language.readNodeName(method)).toBe("run");
    expect(language.readContainerName(method)).toBe("Worker");
    expect(language.readNodeName(makeNode("namespace_import", {
      children: [makeNode("identifier", { text: "utilities" })],
    }))).toBe("utilities");
  });

  it("recognizes Python __all__ only at module scope", () => {
    const exported = makeNode("assignment", { fields: { left: makeNode("identifier", { text: "__all__" }) } });
    makeNode("module", { children: [makeNode("expression_statement", { children: [exported] })] });
    const language = profile(".py");

    expect(language.resolveSymbolKind(exported)).toBe("public");
    expect(language.readNodeName(exported)).toBe("__all__");
    makeNode("module", { children: [makeNode("function_definition", {
      children: [makeNode("block", { children: [makeNode("expression_statement", { children: [exported] })] })],
    })] });
    expect(language.resolveSymbolKind(exported)).toBeUndefined();
  });

  it("uses Go import aliases and strips receiver pointers from method containers", () => {
    const language = profile(".go");
    const imported = makeNode("import_spec", { fields: { path: makeNode("interpreted_string_literal", { text: '"net/http"' }) } });
    const aliased = makeNode("import_spec", { fields: {
      name: makeNode("package_identifier", { text: "web" }),
      path: makeNode("interpreted_string_literal", { text: '"net/http"' }),
    } });
    const method = makeNode("method_declaration", { fields: {
      name: makeNode("field_identifier", { text: "Serve" }),
      receiver: makeNode("parameter_list", { children: [makeNode("parameter_declaration", {
        fields: { type: makeNode("pointer_type", { text: "*Server" }) },
      })] }),
    } });

    expect(language.readNodeName(imported)).toBe("net/http");
    expect(language.readNodeName(aliased)).toBe("web");
    expect(language.readNodeName(method)).toBe("Serve");
    expect(language.readContainerName(method)).toBe("Server");
  });

  it("uses Rust impl types for methods without emitting duplicate class symbols", () => {
    const method = makeNode("function_item", {
      fields: { name: makeNode("identifier", { text: "run" }) },
      children: [makeNode("visibility_modifier", { text: "pub(crate)" })],
    });
    const implementation = makeNode("impl_item", {
      fields: { type: makeNode("type_identifier", { text: "Worker" }) },
      children: [makeNode("declaration_list", { children: [method] })],
    });
    const language = profile(".rs");

    expect(language.readContainerName(method)).toBe("Worker");
    expect(language.shouldSkipSymbol(implementation)).toBe(true);
    expect(language.shouldSkipSymbol(method)).toBe(false);
    expect(language.isPublicSymbol(method)).toBe(true);
    expect(language.isPublicSymbol(makeNode("function_item"))).toBe(false);
    expect(language.readNodeName(makeNode("use_declaration", {
      fields: { argument: makeNode("scoped_identifier", { text: " std::\n  collections " }) },
    }))).toBe("std::   collections");
  });

  it("names Java static imports and exported packages without syntax wrappers", () => {
    const language = profile(".java");

    expect(language.readNodeName(makeNode("import_declaration", {
      text: "import static java.util.Collections.emptyList;",
    }))).toBe("static java.util.Collections.emptyList");
    expect(language.readNodeName(makeNode("exports_module_directive", {
      fields: { package: makeNode("scoped_identifier", { text: "com.example.api" }) },
    }))).toBe("com.example.api");
    expect(language.readNodeName(makeNode("identifier", { text: " \n " }))).toBeUndefined();
  });
});
