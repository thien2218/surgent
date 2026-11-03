# Symbol kinds

Every symbol listed by `code_map` and fetched by `inspect` has a kind, except import and export groups. Shared kinds apply across languages; each language adds its own.

Symbols sit at module level, where namespace and module bodies count as module level. Methods and nested types also sit one level deeper, directly inside a module-level type or type-like container. They are listed under their container, or as `Container.name` when defined apart from it; `inspect` takes `Container.name`.

Only definitions are listed. Functions and methods without a body, such as prototypes and interface or abstract methods, are skipped, along with `extern` and TS `declare` values. Inside TS `declare` blocks, interfaces and type aliases are listed, and a `declare module` or `declare namespace` only when it holds one.

A declaration of several names (`int x, y;`) lists each name; `inspect` on any of them returns the whole declaration.

Unnamed TS/JS default exports are listed as `default`: `export default () => {}` is `[func] default`, and a new value such as `export default { … }` is `[decl] default`. A default export of an existing name (`export default config`) stays in `(exports)`.

## Shared kinds

Usable by any language, used only where they fit (e.g. no `func` in Java).

| Kind | Definition |
| --- | --- |
| `func` | Named callable owned by no type, at module level. |
| `method` | Callable owned by a type or type-like container. |
| `decl` | Module-level variable or constant whose value is not a function, type, or import. |

## Imports and exports

Imports, includes, uses, and requires of another file, module, or package have no kind. They are listed only at the top level of a file, outside any block: imports inside `if`, `try`, `#ifdef`, or a namespace are skipped, while a C/C++ include guard and a Java module declaration don't count as blocks. Top-level imports separated only by blank lines or comments are listed as one `(imports)` entry, and export lists or statements (`export { a, b }`, Python `__all__`, Java `exports`) as one `(exports)` entry; any other code between them starts a new entry. Both appear only when `code_map` is called without `kinds`; `inspect` fetches them by name (`(imports)`, `(imports)#1`).

## Language kinds

Constructs only some languages have. Same name, same meaning across languages.

| Kind | Definition |
| --- | --- |
| `class` | Type declared with `class`, incl. abstract, data, sealed, annotation classes, or bound from a Ruby class factory (`Point = Struct.new(:x)`). |
| `interface` | Contract type declared with `interface`, incl. Java `@interface`, Kotlin `fun interface`. |
| `struct` | Aggregate type declared with `struct`. |
| `union` | Type declared with `union`; fields share storage. |
| `enum` | Type declared with `enum` or `enum class`. |
| `record` | Type declared with `record`. |
| `trait` | Rust `trait`. |
| `object` | Kotlin `object`: named singleton. |
| `module` | Named module body: Rust `mod`, Ruby `module`. |
| `namespace` | Namespace block: C++ `namespace`, TypeScript `namespace` or `declare module`. |
| `type` | Type alias, or named type no more specific kind covers (Go `type Celsius float64`, C# delegate, Zig opaque type or error set). |
| `macro` | Macro definition: C/C++ `#define` with a value or parameters, Rust `macro_rules!`. |

## Kinds per language

Shared kinds that fit, plus:

| Language | Language kinds |
| --- | --- |
| TypeScript, JavaScript | `class`, `interface`, `type`, `enum`, `namespace` |
| Python | `class`, `type` |
| Go | `struct`, `interface`, `type` |
| Java | `class`, `interface`, `enum`, `record` |
| Rust | `struct`, `enum`, `union`, `trait`, `type`, `module`, `macro` |
| C | `struct`, `union`, `enum`, `type`, `macro` |
| C++ | `class`, `struct`, `union`, `enum`, `namespace`, `type`, `macro` |
| C# | `class`, `struct`, `interface`, `record`, `enum`, `type` |
| Ruby | `class`, `module` |
| Kotlin | `class`, `interface`, `object`, `enum`, `type` |
| Zig | `struct`, `enum`, `union`, `type` |

## Changing the vocabulary

Shared kinds: `SHARED_KINDS` in `../types.ts`. Language kinds: `<LANG>_KINDS` at the top of each language file. Define new kinds here first; reuse a name only when its definition fits.
