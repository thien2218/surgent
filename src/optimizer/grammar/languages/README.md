# Symbol kinds

Every symbol listed by `code_map` and fetched by `inspect` has a kind. Shared kinds apply across languages; each language adds its own.

## Shared kinds

Usable by any language, used only where they fit (e.g. no `func` in Java).

| Kind | Definition |
| --- | --- |
| `func` | Named callable owned by no type, at module level. Includes module-level bindings to function literals (`const load = () => {}`). |
| `method` | Callable owned by a type or type-like container: constructors, destructors, operators, accessors with bodies, interface/trait signatures, Go receiver methods, Kotlin extension functions, C++ out-of-line definitions (`Widget::draw`). Listed as `Container.name`. |
| `decl` | Module-level variable or constant whose value is not a function, type, or import. Excludes fields inside types. |
| `deps` | Import, include, use, or require of another file, module, or package. Consecutive ones collapse into `<imports>`. |
| `public` | Export list or statement (`export { a, b }`, Python `__all__`, Java `exports`); consecutive ones collapse into `<exports>`. Also marks any other symbol importable from another file or module (`[public func] load`). Filtering by `public` returns both. |

## Language kinds

Constructs only some languages have. Same name, same meaning across languages.

| Kind | Definition |
| --- | --- |
| `class` | Type declared with `class`, incl. abstract, data, sealed, annotation classes. |
| `interface` | Contract type declared with `interface`, incl. Java `@interface`, Kotlin `fun interface`. |
| `struct` | Aggregate type declared with `struct`. |
| `union` | Type declared with `union`; fields share storage. |
| `enum` | Type declared with `enum` or `enum class`. |
| `record` | Type declared with `record`. |
| `trait` | Rust `trait`. |
| `object` | Kotlin `object`: named singleton. |
| `module` | Named module body: Rust `mod`, Ruby `module`. |
| `namespace` | C++ `namespace` block. |
| `type` | Type alias, or named type no more specific kind covers (Go `type Celsius float64`, C# delegate, Zig opaque type or error set). |
| `macro` | Macro definition: C/C++ `#define` (object- or function-like), Rust `macro_rules!`. |
| `callback` | Module-level call passing a function literal or block (test suite, event handler, route), or such a call directly inside another callback's body. Symbol spans the whole call. |

## Kinds per language

Shared kinds that fit, plus:

| Language | Language kinds |
| --- | --- |
| TypeScript, JavaScript | `class`, `interface`, `type`, `enum`, `callback` |
| Python | `class` |
| Go | `struct`, `interface`, `type` |
| Java | `class`, `interface`, `enum`, `record` |
| Rust | `struct`, `enum`, `union`, `trait`, `type`, `module`, `macro` |
| C | `struct`, `union`, `enum`, `type`, `macro` |
| C++ | `class`, `struct`, `union`, `enum`, `namespace`, `type`, `macro` |
| C# | `class`, `struct`, `interface`, `record`, `enum`, `type` |
| Ruby | `class`, `module`, `callback` |
| Kotlin | `class`, `interface`, `object`, `enum`, `type` |
| Zig | `struct`, `enum`, `union`, `type` |

## Changing the vocabulary

Shared kinds: `SHARED_KINDS` in `../types.ts`. Language kinds: `<LANG>_KINDS` at the top of each language file. Define new kinds here first; reuse a name only when its definition fits.
