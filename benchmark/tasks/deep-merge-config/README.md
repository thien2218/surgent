# deep-merge-config

## Conventions

- Public API lives in `src/index.mjs`.
- Export name and signature are fixed:
  - `deepMergeConfig(baseConfig, overrideConfig)`

## Merge rules

- Both top-level arguments are plain objects, otherwise `TypeError`.
- Return value is new object; inputs remain unchanged.
- Plain object values merge recursively.
- Override value `undefined` keeps base value.
- Override value `null` overrides base with `null`.
- Override arrays replace base arrays using shallow copy.
- Ignore unsafe keys: `__proto__`, `prototype`, `constructor`.
