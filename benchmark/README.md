# Benchmark layout

`benchmark/tasks.json` freezes run order and task inputs.

- `runnerOrder` is outer loop.
- `tasks` array order is inner loop.
- CSV row order is `runnerOrder x tasks order`.
- `workspaceDir` and `hiddenDir` are repo-root relative paths.
- Runner copies `workspaceDir` to fresh temp work dir before each session.
- `visibleTestCommand` runs with cwd set to copied workspace.
- `hiddenTestCommand` runs with cwd set to `hiddenDir`.
- Hidden tests read copied workspace path from `BENCHMARK_WORKSPACE`.
- Visible and hidden test commands must print only `{"passed":number,"total":number}` to stdout.

Task layout:

- `benchmark/tasks/<task-id>/workspace/` — files agent can see and edit.
- `benchmark/hidden/<task-id>/` — tests runner can execute after session ends.
