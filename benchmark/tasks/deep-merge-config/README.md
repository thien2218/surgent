# deep-merge-config

Implement deep config merge in `src/`.

Exports must stay:

- `deepMergeConfig(baseConfig, overrideConfig)`

Rules:

- Both arguments must be plain objects, else throw `TypeError`.
- Return new object. Never mutate input objects or arrays.
- Merge plain object values recursively.
- `override` value `undefined` means keep base value.
- `override` value `null` overrides base with `null`.
- Arrays from override replace base arrays using shallow copy.
- Ignore unsafe keys: `__proto__`, `prototype`, `constructor`.
