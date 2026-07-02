# Benchmark spec

## Scope

Standalone benchmark harness under `bench/harness`.

- Not registered as pi extension.
- Task format lives under `bench/tasks/<task-id>/`.
- Harness validates task files at startup.
- Invalid `prompts.yaml` exits non-zero with clear error.

## CLI entrypoint

Build output entrypoint: `bench/harness/dist/run.js`.

Help command:

```bash
node bench/harness/dist/run.js --help
```

## Task contract

Each task folder must contain:

- `repo/`
- `prompts.yaml`
- `visible-tests.sh`
- `hidden-tests.sh`
- `rubric.yaml` (optional)

`prompts.yaml` shape:

```yaml
session_goal: Resolve task
turns:
  - id: t1
    prompt: "Understand codebase and propose plan in 5 bullets. No edits yet."
```
