import type { SyntaxNode } from "tree-sitter";
import { describe, expect, it } from "vitest";
import { getLanguageProfile, getSupportedExtensions } from "../../../src/optimizer/grammar/index.js";

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
      ".c", ".cc", ".cjs", ".cpp", ".cs", ".cxx", ".gemspec", ".go", ".h", ".hh", ".hpp", ".hxx",
      ".java", ".js", ".jsx", ".kt", ".kts", ".mjs", ".py", ".rake", ".rb", ".rs", ".ts",
      ".tsx", ".zig",
    ]);
    for (const extension of [".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(getLanguageProfile(extension)).toBe(getLanguageProfile(".ts"));
    }
    for (const extension of [".cc", ".cxx", ".h", ".hh", ".hpp", ".hxx"]) {
      expect(getLanguageProfile(extension)).toBe(getLanguageProfile(".cpp"));
    }
    expect(getLanguageProfile(".c")).not.toBe(getLanguageProfile(".cpp"));
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
    [".c", "function_definition", ["preproc_ifdef", "translation_unit"], "func"],
    [".c", "preproc_include", ["declaration_list", "linkage_specification", "preproc_ifdef", "translation_unit"], "deps"],
    [".cpp", "function_definition", ["declaration_list", "namespace_definition", "translation_unit"], "func"],
    [".cpp", "function_definition", ["field_declaration_list", "struct_specifier", "template_declaration", "translation_unit"], "method"],
    [".cpp", "alias_declaration", ["template_declaration", "translation_unit"], "class"],
    [".cs", "method_declaration", ["declaration_list", "interface_declaration", "compilation_unit"], "method"],
    [".cs", "using_directive", ["declaration_list", "namespace_declaration", "compilation_unit"], "deps"],
    [".rb", "module", ["program"], "class"],
    [".rb", "method", ["program"], "func"],
    [".rb", "method", ["body_statement", "singleton_class", "body_statement", "class", "program"], "method"],
    [".rb", "singleton_method", ["body_statement", "module", "program"], "method"],
    [".kt", "function_declaration", ["source_file"], "func"],
    [".kt", "function_declaration", ["class_body", "companion_object", "class_body", "class_declaration", "source_file"], "method"],
    [".kt", "object_declaration", ["source_file"], "class"],
    [".kt", "import", ["source_file"], "deps"],
    [".zig", "function_declaration", ["source_file"], "func"],
    [".zig", "function_declaration", ["struct_declaration", "variable_declaration", "source_file"], "method"],
    [".zig", "function_declaration", ["struct_declaration", "return_expression", "block", "function_declaration", "source_file"], "method"],
    [".zig", "test_declaration", ["struct_declaration", "variable_declaration", "source_file"], "func"],
    [".zig", "using_namespace_declaration", ["source_file"], "deps"],
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
    [".c", "declaration", ["compound_statement", "function_definition", "translation_unit"]],
    [".cpp", "field_declaration", ["field_declaration_list", "class_specifier", "translation_unit"]],
    [".rb", "method", ["body_statement", "method", "program"]],
    [".kt", "property_declaration", ["block", "function_body", "function_declaration", "source_file"]],
    [".zig", "using_namespace_declaration", ["struct_declaration", "variable_declaration", "source_file"]],
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
    expect(language.readNodeName(makeNode("function_expression"))).toBe("<anonymous>");
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

  it("names C functions through pointer declarators while keeping function pointers as variables", () => {
    const language = profile(".c");
    const declare = (type: string, declarator: SyntaxNode) => makeNode(type, { fields: { declarator } });
    const callable = (name: string) => makeNode("function_declarator", {
      fields: { declarator: makeNode("identifier", { text: name }) },
    });
    const definition = declare("function_definition", makeNode("pointer_declarator", {
      fields: { declarator: callable("name_of") },
    }));
    const prototype = declare("declaration", callable("api"));
    const pointer = declare("declaration", makeNode("function_declarator", { fields: {
      declarator: makeNode("parenthesized_declarator", { children: [makeNode("pointer_declarator", {
        fields: { declarator: makeNode("identifier", { text: "on_exit" }) },
      })] }),
    } }));
    makeNode("translation_unit", { children: [definition, prototype, pointer] });

    expect(language.readNodeName(definition)).toBe("name_of");
    expect(language.resolveSymbolKind(definition)).toBe("func");
    expect(language.resolveSymbolKind(prototype)).toBe("func");
    expect(language.readNodeName(pointer)).toBe("on_exit");
    expect(language.resolveSymbolKind(pointer)).toBe("decl");
    expect(language.readNodeName(makeNode("preproc_include", {
      fields: { path: makeNode("system_lib_string", { text: "<stdio.h>" }) },
    }))).toBe("stdio.h");
  });

  it("lists forward-declared functions, typedef'd structs, and guard macros at most once", () => {
    const language = profile(".c");
    const declare = (type: string, name: string) => makeNode(type, { fields: {
      declarator: makeNode("function_declarator", { fields: { declarator: makeNode("identifier", { text: name }) } }),
    } });
    const definition = declare("function_definition", "helper");
    const forward = declare("declaration", "helper");
    const external = declare("declaration", "api");
    const root = makeNode("translation_unit", { children: [forward, external, definition] });
    const tree = { rootNode: { descendantsOfType: () => [definition] } };
    for (const node of [root, definition, forward, external]) Object.assign(node, { tree });
    const struct = (name: string, typedef?: string) => {
      const specifier = makeNode("struct_specifier", { fields: {
        name: makeNode("type_identifier", { text: name }),
        body: makeNode("field_declaration_list"),
      } });
      if (typedef) {
        makeNode("type_definition", { fields: {
          type: specifier, declarator: makeNode("type_identifier", { text: typedef }),
        } });
      }
      return specifier;
    };
    const macro = (value?: SyntaxNode) => makeNode("preproc_def", { fields: {
      name: makeNode("identifier", { text: "LIB_H" }), ...(value ? { value } : {}),
    } });

    expect(language.shouldSkipSymbol(forward)).toBe(true);
    expect(language.shouldSkipSymbol(external)).toBe(false);
    expect(language.shouldSkipSymbol(struct("Point", "Point"))).toBe(true);
    expect(language.shouldSkipSymbol(struct("node", "node_t"))).toBe(false);
    expect(language.shouldSkipSymbol(makeNode("struct_specifier", {
      fields: { name: makeNode("type_identifier", { text: "Node" }) },
    }))).toBe(true);
    expect(language.shouldSkipSymbol(macro())).toBe(true);
    expect(language.shouldSkipSymbol(macro(makeNode("preproc_arg", { text: "1" })))).toBe(false);
  });

  it("names out-of-line C++ members by their qualified scope", () => {
    const language = profile(".cpp");
    const qualified = makeNode("qualified_identifier", { text: "app::Widget::~Widget", fields: {
      scope: makeNode("namespace_identifier", { text: "app" }),
      name: makeNode("qualified_identifier", { text: "Widget::~Widget", fields: {
        scope: makeNode("namespace_identifier", { text: "Widget" }),
        name: makeNode("destructor_name", { text: "~Widget" }),
      } }),
    } });
    const outOfLine = makeNode("function_definition", { fields: {
      declarator: makeNode("function_declarator", { fields: { declarator: qualified } }),
    } });
    const member = makeNode("field_declaration", { fields: {
      declarator: makeNode("function_declarator", {
        fields: { declarator: makeNode("field_identifier", { text: "draw" }) },
      }),
    } });
    makeNode("class_specifier", { fields: {
      name: makeNode("type_identifier", { text: "Widget" }),
      body: makeNode("field_declaration_list", { children: [member] }),
    } });
    makeNode("translation_unit", { children: [outOfLine] });

    expect(language.resolveSymbolKind(outOfLine)).toBe("method");
    expect(language.readNodeName(outOfLine)).toBe("~Widget");
    expect(language.readContainerName(outOfLine)).toBe("app::Widget");
    expect(language.resolveSymbolKind(member)).toBe("method");
    expect(language.readContainerName(member)).toBe("Widget");
    expect(language.readNodeName(makeNode("using_declaration", { text: "using namespace std;" })))
      .toBe("namespace std");
  });

  it("names C# destructors, operators, and usings while skipping auto-properties", () => {
    const language = profile(".cs");
    const property = (fields: Record<string, SyntaxNode>) => makeNode("property_declaration", { fields });
    const accessors = (...bodies: Array<SyntaxNode | undefined>) => makeNode("accessor_list", {
      children: bodies.map((body) => makeNode("accessor_declaration", body ? { fields: { body } } : {})),
    });

    expect(language.shouldSkipSymbol(property({ accessors: accessors(undefined, undefined) }))).toBe(true);
    expect(language.shouldSkipSymbol(property({ accessors: accessors(makeNode("block")) }))).toBe(false);
    expect(language.shouldSkipSymbol(property({ value: makeNode("arrow_expression_clause") }))).toBe(false);
    expect(language.readNodeName(makeNode("destructor_declaration", {
      fields: { name: makeNode("identifier", { text: "Circle" }) },
    }))).toBe("~Circle");
    expect(language.readNodeName(makeNode("operator_declaration", {
      fields: { operator: makeNode("+", { text: "+" }) },
    }))).toBe("operator+");
    expect(language.readNodeName(makeNode("using_directive", { text: "global using static System.Math;" })))
      .toBe("static System.Math");
    expect(language.isPublicSymbol(makeNode("method_declaration", {
      children: [makeNode("modifier", { text: "public" })],
    }))).toBe(true);
  });

  it("indexes Ruby requires and constants while naming struct block methods by their constant", () => {
    const language = profile(".rb");
    const call = (method: string, argument: string, receiver?: SyntaxNode) => makeNode("call", { fields: {
      method: makeNode("identifier", { text: method }),
      arguments: makeNode("argument_list", { children: [makeNode("string", { text: argument })] }),
      ...(receiver ? { receiver } : {}),
    } });
    const assign = (left: SyntaxNode, children: SyntaxNode[] = []) => makeNode("assignment", { fields: { left }, children });
    const required = call("require_relative", '"support/helper"');
    const mixin = call("include", "Comparable");
    const scoped = call("require", '"json"', makeNode("constant", { text: "Kernel" }));
    const constant = assign(makeNode("constant", { text: "VERSION" }));
    const local = assign(makeNode("identifier", { text: "value" }));
    const method = makeNode("method", { fields: { name: makeNode("identifier", { text: "to_s" }) } });
    const struct = assign(makeNode("constant", { text: "Point" }), [makeNode("call", { children: [
      makeNode("do_block", { children: [makeNode("body_statement", { children: [method] })] }),
    ] })]);
    makeNode("program", { children: [required, mixin, scoped, constant, local, struct] });

    expect(language.resolveSymbolKind(required)).toBe("deps");
    expect(language.readNodeName(required)).toBe("support/helper");
    expect(language.resolveSymbolKind(mixin)).toBeUndefined();
    expect(language.resolveSymbolKind(scoped)).toBeUndefined();
    expect(language.resolveSymbolKind(constant)).toBe("decl");
    expect(language.readNodeName(constant)).toBe("VERSION");
    expect(language.resolveSymbolKind(local)).toBeUndefined();
    expect(language.resolveSymbolKind(method)).toBe("method");
    expect(language.readContainerName(method)).toBe("Point");
  });

  it("names Kotlin extension functions by receiver and skips plain member properties", () => {
    const language = profile(".kt");
    const placed = (node: SyntaxNode, startIndex: number) => Object.assign(node, { startIndex, endIndex: startIndex + 1 });
    const declare = (name: string, children: SyntaxNode[]) => makeNode("function_declaration", {
      fields: { name: placed(makeNode("identifier", { text: name }), 10) }, children,
    });
    const extension = declare("second", [
      placed(makeNode("nullable_type", { text: "List<T>?" }), 4),
      placed(makeNode("user_type", { text: "T" }), 20),
    ]);
    const plain = declare("helper", [placed(makeNode("user_type", { text: "Int" }), 20)]);
    const property = (accessor: SyntaxNode) => makeNode("property_declaration", { children: [
      makeNode("variable_declaration", { children: [makeNode("identifier", { text: "label" })] }), accessor,
    ] });
    const stored = property(makeNode("setter"));
    const custom = property(makeNode("getter", { children: [makeNode("function_body")] }));
    makeNode("source_file", { children: [extension, plain, makeNode("class_declaration", {
      fields: { name: makeNode("identifier", { text: "Shape" }) },
      children: [makeNode("class_body", { children: [stored, custom] })],
    })] });

    expect(language.resolveSymbolKind(extension)).toBe("method");
    expect(language.readContainerName(extension)).toBe("List");
    expect(language.resolveSymbolKind(plain)).toBe("func");
    expect(language.shouldSkipSymbol(stored)).toBe(true);
    expect(language.shouldSkipSymbol(custom)).toBe(false);
    expect(language.readNodeName(custom)).toBe("label");
    expect(language.readContainerName(custom)).toBe("Shape");
    expect(language.readNodeName(makeNode("import", { text: "import com.example.Thing as Alias" })))
      .toBe("com.example.Thing as Alias");
    expect(language.readNodeName(makeNode("type_alias", {
      fields: { type: makeNode("identifier", { text: "Handler" }) },
    }))).toBe("Handler");
  });

  it("lists Zig struct constants as types, import aliases as deps, and tests by label", () => {
    const language = profile(".zig");
    const token = (type: string) => Object.assign(makeNode(type, { text: type }), { isNamed: false });
    const bind = (name: string, value: SyntaxNode, isPublic = false) => {
      const identifier = Object.assign(makeNode("identifier", { text: name }), { isNamed: true });
      const binding = makeNode("variable_declaration", { children: [identifier, value] });
      Object.assign(value, { isNamed: true });
      const keywords = isPublic ? [token("pub"), token("const")] : [token("const")];
      return Object.assign(binding, { children: [...keywords, identifier, token("="), value, token(";")] });
    };
    const method = makeNode("function_declaration", { fields: { name: makeNode("identifier", { text: "init" }) } });
    const point = bind("Point", makeNode("struct_declaration", { children: [method] }), true);
    const std = bind("std", makeNode("builtin_function", {
      children: [makeNode("builtin_identifier", { text: "@import" })],
    }));
    const alias = bind("Allocator", makeNode("field_expression", { fields: {
      object: makeNode("field_expression", { fields: { object: makeNode("identifier", { text: "std" }) } }),
    } }));
    const computed = bind("limit", makeNode("field_expression", { fields: { object: makeNode("call_expression") } }));
    const member = bind("origin", makeNode("field_expression", {
      fields: { object: makeNode("identifier", { text: "Point" }) },
    }));
    const constant = bind("max", makeNode("integer"));
    const local = bind("count", makeNode("integer"));
    makeNode("function_declaration", { children: [makeNode("block", { children: [local] })] });
    const labelled = makeNode("test_declaration", {
      children: [makeNode("string", { text: '"parses input"' }), makeNode("block")],
    });
    const bare = makeNode("test_declaration", { children: [makeNode("block")] });
    makeNode("source_file", {
      children: [point, alias, std, computed, member, constant, labelled, bare],
    });

    expect(language.resolveSymbolKind(point)).toBe("class");
    expect(language.readNodeName(point)).toBe("Point");
    expect(language.isPublicSymbol(point)).toBe(true);
    expect(language.resolveSymbolKind(method)).toBe("method");
    expect(language.readContainerName(method)).toBe("Point");
    expect(language.resolveSymbolKind(std)).toBe("deps");
    expect(language.resolveSymbolKind(alias)).toBe("deps");
    expect(language.resolveSymbolKind(computed)).toBe("decl");
    expect(language.resolveSymbolKind(member)).toBe("decl");
    expect(language.resolveSymbolKind(constant)).toBe("decl");
    expect(language.isPublicSymbol(constant)).toBe(false);
    expect(language.resolveSymbolKind(local)).toBeUndefined();
    expect(language.readNodeName(labelled)).toBe('test "parses input"');
    expect(language.readNodeName(bare)).toBe("test");
  });

  it("collapses only the block types each language lists", () => {
    const braced = Object.assign(makeNode("struct_declaration"), {
      namedChildCount: 0, children: [makeNode("{"), makeNode("}")],
    });
    const keyword = Object.assign(makeNode("else"), { namedChildCount: 0, children: [] });
    const branch = Object.assign(makeNode("else", { children: [makeNode("call")] }), {
      namedChildCount: 1, children: [],
    });

    expect(profile(".zig").isBlockNode(braced)).toBe(true);
    expect(profile(".cs").isBlockNode(braced)).toBe(false);
    expect(profile(".rb").isBlockNode(branch)).toBe(true);
    expect(profile(".rb").isBlockNode(keyword)).toBe(false);
  });

  it("finds the body a signature ends before", () => {
    const token = (type: string) => Object.assign(makeNode(type), { isNamed: false });
    const block = makeNode("statement_block");
    const method = makeNode("method_definition", { fields: { body: block } });
    const functionBody = makeNode("function_body");
    const kotlinFunction = makeNode("function_declaration", {
      children: [makeNode("modifiers"), functionBody],
    });
    const opening = token("{");
    const struct = Object.assign(makeNode("struct_declaration"), {
      isNamed: true, children: [token("struct"), opening, token("}")],
    });
    const count = Object.assign(makeNode("integer"), { isNamed: true });
    const bind = (value: SyntaxNode) => Object.assign(makeNode("variable_declaration", { children: [value] }), {
      children: [token("const"), token("="), value],
    });

    expect(profile(".ts").findBodyNode(method)).toBe(block);
    expect(profile(".ts").findBodyNode(makeNode("variable_declarator"))).toBeUndefined();
    expect(profile(".kt").findBodyNode(kotlinFunction)).toBe(functionBody);
    expect(profile(".zig").findBodyNode(bind(struct))).toBe(opening);
    expect(profile(".zig").findBodyNode(bind(count))).toBeUndefined();
  });

  it("inspects the statement holding an import symbol rather than its enclosing block", () => {
    const specifier = makeNode("import_specifier");
    const statement = makeNode("import_statement", { children: [makeNode("import_clause", {
      children: [makeNode("named_imports", { children: [specifier] })],
    })] });
    makeNode("program", { children: [statement] });
    const spec = makeNode("import_spec");
    const declaration = makeNode("import_declaration", {
      children: [makeNode("import_spec_list", { children: [spec] })],
    });
    const use = makeNode("use_declaration");
    makeNode("mod_item", { children: [makeNode("declaration_list", { children: [use] })] });
    const include = makeNode("preproc_include");
    makeNode("preproc_ifdef", { children: [include] });

    expect(profile(".ts").findImportNode(specifier)).toBe(statement);
    expect(profile(".go").findImportNode(spec)).toBe(declaration);
    expect(profile(".rs").findImportNode(use)).toBe(use);
    expect(profile(".h").findImportNode(include)).toBe(include);
  });
});
