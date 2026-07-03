# Plan: Multi-turn CLI benchmark for surgent vs copilot

## Objective
Build small benchmark harness that runs same ordered multi-prompt task sessions through `surgent` and `copilot`, checks resulting code against visible and hidden tests, and writes one CSV row per run with five values: task completion time, percent of tests passed, input tokens, output tokens, and total cost (when derivable). Keep harness scriptable and repo-local so another agent can add tasks without changing runner logic.

## Out of scope
- Statistical analysis, charts, or summaries beyond raw CSV rows
- Retry logic, flaky-test handling, parallel execution, or running both CLIs at same time
- UI, TUI, or slash-command integration inside `surgent`
- Enforcing hidden-test secrecy beyond keeping hidden tests outside task workspace
- Any CSV columns beyond: completion time, `%` passed, input tokens, output tokens, total cost

## Assumptions
- `copilot` supports non-interactive prompt mode, exact session resume by session ID, and machine-readable output or telemetry that exposes token usage per session.
- At least one source exists for model pricing (CLI-emitted spend, telemetry spend, or static price map keyed by model) so total cost can be derived.
- Task fixtures can standardize test commands so runner can compute `passed` and `total` counts without scraping arbitrary test framework text.
- Benchmark can rely on fixed row order for run identity, because CSV cannot include task or runner columns.
- Logical model name can map to `surgent --model github-copilot/<model>` and `copilot --model <model>`.

## Steps

### Step #1: Freeze task manifest and fixture layout
- Goal:
  - Define one benchmark format that runner can execute without per-task code.
- Changes:
  - Add ordered manifest for tasks and runner order.
  - Define per-task workspace dir, visible test command, hidden test command, and prompt list.
  - Keep hidden tests outside task workspace so session cwd never exposes them.
  - Document that CSV row order is `runner order x task order` from manifest, since no identity columns allowed.
- Targets: `benchmark/tasks.json`, `benchmark/tasks/<task-id>/workspace/**`, `benchmark/hidden/<task-id>/**`
- Validation:
  - `node -e "const manifest=require('./benchmark/tasks.json'); console.log(Array.isArray(manifest.tasks), manifest.tasks[0])"`
- Done when:
  - Agent can point to one manifest entry and infer every input needed to execute task end-to-end.

### Step #2: Build single benchmark runner
- Goal:
  - Add one entry script that loads manifest, filters tasks/runners from CLI args, and executes runs sequentially.
- Changes:
  - Create `benchmark/run.mjs`.
  - Parse minimal args: model name, runner selection (`surgent|copilot|both`), manifest path, output CSV path.
  - Interpret `both` as sequential execution, never concurrent execution.
  - For each run, create isolated working copy of task workspace before session starts so earlier runs cannot contaminate later ones.
  - Start timer immediately before first session prompt and stop after final prompt completes.
- Targets: `benchmark/run.mjs`
- Validation:
  - `node benchmark/run.mjs --help`
- Done when:
  - Runner can enumerate planned runs and fail fast on missing manifest fields or paths.

### Step #3: Add session drivers for `surgent` and `copilot`
- Goal:
  - Drive both CLIs through same multi-turn flow and collect session-level token counts.
- Changes:
  - In `benchmark/run.mjs`, add two runner-specific functions, not extra module tree.
  - Shared flow per run:
    1. Start session in task workspace.
    2. Send setup prompt first: restrictive environment, execute instructions exactly, use bash only for running tests.
    3. Send each task prompt in order, waiting for completion before next prompt.
    4. Preserve same session ID across turns.
  - `surgent` path:
    - Spawn `surgent` in JSON mode.
    - Pass model as `github-copilot/<model>`.
    - Reuse JSONL parsing approach already present in `src/subsession/execute.ts` and `src/subsession/parser.ts` as reference for session IDs and usage totals.
  - `copilot` path:
    - Spawn `copilot -p` with `--output-format=json`, `--session-id`, `--model <model>`, `--no-ask-user`.
    - If JSON output does not include token totals, enable documented telemetry fallback and parse session totals from that source before marking implementation complete.
- Targets: `benchmark/run.mjs`
- Validation:
  - `node benchmark/run.mjs --runner surgent --model <model> --tasks benchmark/tasks.json --output benchmark/results.csv`
  - `node benchmark/run.mjs --runner copilot --model <model> --tasks benchmark/tasks.json --output benchmark/results.csv`
- Done when:
  - Each driver returns `{completionTimeMs, inputTokens, outputTokens, totalCostUsd}` where `totalCostUsd` can be `null` only if no trusted pricing source is available.

### Step #4: Evaluate visible and hidden tests after session ends
- Goal:
  - Score correctness from tests agent can see and tests agent cannot see.
- Changes:
  - Run visible and hidden test commands only after final prompt finishes.
  - Require both commands to emit machine-readable counts like `{"passed":3,"total":4}`.
  - Aggregate public + hidden counts into one percentage: `(passed / total) * 100`.
  - Fail run if either command crashes or emits invalid score payload.
- Targets: `benchmark/run.mjs`, `benchmark/tasks.json`, `benchmark/tasks/<task-id>/workspace/**`, `benchmark/hidden/<task-id>/**`
- Validation:
  - `node benchmark/run.mjs --runner surgent --model <model> --tasks benchmark/tasks.json --output benchmark/results.csv`
- Done when:
  - Runner can compute one numeric pass percentage without parsing human test output.

### Step #5: Write strict CSV output
- Goal:
  - Persist only required benchmark data, including total cost when available.
- Changes:
  - Create or overwrite output CSV with exact five headers.
  - Append one row per completed run in manifest-defined order.
  - Do not include task name, runner name, raw logs, hidden/public split, or status columns.
  - Keep `totalCostUsd` column numeric when derivable; otherwise write empty value.
  - Surface failures through process exit code and stderr, not CSV shape changes.
- Targets: `benchmark/run.mjs`, `benchmark/results.csv`
- Validation:
  - `python - <<'PY'
import csv
rows=list(csv.reader(open('benchmark/results.csv')))
print(rows[0], len(rows[0]))
PY`
- Done when:
  - Header has exactly five columns and every data row has exactly five fields.

### Step #6: Add one smoke task and verify end-to-end
- Goal:
  - Prove harness works on smallest benchmark case before adding more tasks.
- Changes:
  - Add tiny task with two or more prompts, one visible test file inside workspace, and one hidden test file outside it.
  - Run benchmark once per CLI against same logical model, one after other.
  - After file changes finish, run repo typecheck once to satisfy project rule.
- Targets: `benchmark/tasks.json`, `benchmark/tasks/smoke-task/workspace/**`, `benchmark/hidden/smoke-task/**`, `benchmark/run.mjs`
- Validation:
  - `node benchmark/run.mjs --runner both --model <model> --tasks benchmark/tasks.json --output benchmark/results.csv`  # runs sequentially, not concurrently
  - `pnpm tsc --noEmit`
- Done when:
  - One benchmark invocation produces CSV rows for both CLIs and typecheck passes.

## Risks & Mitigations
- Risk:
  - `copilot` JSON output may omit session token totals.
  - Mitigation:
    - Use documented telemetry/session-usage fallback before accepting implementation; do not guess from plain text output.
- Risk:
  - No task or runner columns makes rows ambiguous later.
  - Mitigation:
    - Keep manifest order stable and document row order contract in manifest comments or adjacent doc, not in CSV.
- Risk:
  - Hidden tests may accidentally become visible through copied workspace or broad cwd.
  - Mitigation:
    - Copy only task workspace into run directory; execute hidden tests from separate hidden path that imports or targets copied solution files.
- Risk:
  - Earlier benchmark runs can dirty later runs.
  - Mitigation:
    - Fresh workspace copy per run; never reuse modified task dir.

## Handoff Packet
- Hard constraints:
  - Benchmark target is automation script, not `surgent` extension.
  - Same logical task must run as one session with multiple prompts.
  - First prompt in every session must carry restrictive-environment instruction.
  - Generated code must be checked against visible and hidden tests.
  - CSV must contain only five columns: completion time, `%` tests passed, input tokens, output tokens, total cost.
  - `surgent` model string must be `github-copilot/<model>`.
  - Use `copilot` and `surgent` CLI commands directly.
- Acceptance criteria:
  - Runner can execute ordered prompts in one persistent session for both CLIs, sequentially.
  - Runner measures total completion time per task session.
  - Runner records session-level input and output token counts for both CLIs.
  - Runner records total cost when derivable from trusted source.
  - Runner computes combined pass percentage from visible + hidden tests.
  - Output CSV has no extra columns and no missing rows for successful runs.
  - End-to-end smoke run works with at least one benchmark task.

## Open Questions
- Does `copilot --output-format=json` already include final token totals and spend, or must implementation parse telemetry/session export for usage and cost?
- If spend is not emitted directly, what rate source should be canonical for `totalCostUsd` (CLI docs snapshot, local config map, or hardcoded table)?
- What exact score payload format should visible/hidden test commands emit: JSON on stdout or file output?
- Should failed runs stop whole benchmark immediately, or write no row and continue to next manifest entry?
