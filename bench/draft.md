# Multi-prompt CLI benchmark build plan (agent-executable)

Goal: build standalone benchmark harness to compare `surgent` vs `copilot` on same model across multi-prompt sessions.

This plan is written for coding agent execution, not manual human orchestration.

---

## Fixed constraints (do not change)

- Benchmark is **not** a pi extension.
- Both agents run identical task repos and identical prompt turns.
- Session is persistent multi-turn per task (no reset between turns unless task says so).
- Core metrics: correctness, wall time, token usage, context usage, estimated cost.
- Default repeats: 3 per agent per task.
- Benchmark must be reproducible from one command.

Deliverable: `bench/benchmark-spec.md`.

---

## 1) Bootstrap benchmark package

### Agent actions

1. Create structure:

```txt
bench/
  benchmark-spec.md
  harness/
    package.json
    tsconfig.json
    src/
      run.ts
      config.ts
      types.ts
      runner/
        surgent.ts
        copilot.ts
        common.ts
      grade/
        grader.ts
      metrics/
        parse.ts
        cost.ts
      report/
        summary.ts
      util/
        exec.ts
        fs.ts
  tasks/
  runs/
  reports/
```

2. Keep harness isolated from extension registration and `.pi/settings.json`.
3. Make `bench/harness/src/run.ts` CLI entrypoint.

### Done when

- `node bench/harness/dist/run.js --help` works after build.

---

## 2) Define task format

### Agent actions

1. Implement task contract under `bench/tasks/<task-id>/`:

```txt
bench/tasks/task-001/
  repo/                  # seed repo (or clone script + pinned ref)
  prompts.yaml           # ordered turn prompts
  visible-tests.sh
  hidden-tests.sh
  rubric.yaml            # optional metadata
```

2. Support deterministic turn script:

```yaml
session_goal: Resolve task
turns:
  - id: t1
    prompt: "Understand codebase and propose plan in 5 bullets. No edits yet."
  - id: t2
    prompt: "Implement part A only. Add/adjust tests."
  - id: t3
    prompt: "Requirement change: ... adapt implementation."
  - id: t4
    prompt: "Failing test log: ... fix root cause."
  - id: t5
    prompt: "Polish: remove dead code, update docs."
```

3. Add schema validation in harness startup. Fail fast on invalid task files.

### Done when

- Invalid `prompts.yaml` fails with clear error and non-zero exit.

---

## 3) Build runner interface first, then adapters

### Agent actions

1. Define shared runner interface in `types.ts`:
   - open session
   - run turn
   - close session
   - return normalized turn telemetry

2. Implement `runner/surgent.ts`:
   - use `surgent` process invocation
   - capture per-turn timestamps, tokens, tool count, stop reason, context snapshot if available

3. Implement `runner/copilot.ts`:
   - capability probe first:
     - non-interactive prompt mode
     - machine-readable output mode
     - session resume/continue mode
     - context usage command support
   - prefer non-interactive machine-readable path
   - fallback to PTY interactive driver if needed

4. Normalize both outputs to one shape.

### Done when

- Same task + same prompt script can run with `--agent surgent` and `--agent copilot` without code changes.

---

## 4) Implement run orchestration

### Agent actions

1. `run.ts` must support:
   - select task set
   - select agents
   - model id
   - repeats
   - timeout / max turns
   - output dirs

2. For each run:
   - create fresh sandbox/worktree
   - execute prompt turns in order in one session
   - store per-turn raw transcript and normalized metrics
   - run grader scripts after final turn

3. Persist raw run records as JSONL under `bench/runs/`.

### Done when

- One command executes full matrix and saves run artifacts.

---

## 5) Grading + correctness scoring

### Agent actions

1. Implement `grade/grader.ts` with deterministic order:
   1. `visible-tests.sh`
   2. `hidden-tests.sh` (primary)
   3. optional quality checks from `rubric.yaml`

2. Store fields:
   - `pass_hidden`
   - `pass_visible`
   - `quality_checks_pass`
   - `grade_notes`

### Done when

- Failed hidden tests mark run unsuccessful even if visible tests pass.

---

## 6) Metrics + cost pipeline

### Agent actions

1. Define canonical run schema in `types.ts`.
2. Capture per-turn:
   - `durationMs`
   - `tokensIn`
   - `tokensOut`
   - `tokensCached` (if present)
   - `contextUsedPct` (if present)
   - `toolCalls`
   - `status`

3. Compute session totals + estimated cost with pinned pricing table in `config.ts`.
4. Mark missing telemetry explicitly as `null`, never guessed values.

### Done when

- Each run JSON has both turn-level and session-level metrics.

---

## 7) Fairness controls (mandatory)

### Agent actions

- Same task seed and prompt text for both agents.
- Same timeout, max turns, permission envelope.
- Randomize agent execution order per repeat.
- Retry only infra failures once; no retries for logic failure.
- Record harness version + git commit hash in each run.

### Done when

- Re-run on same commit produces comparable distribution.

---

## 8) Reporting

### Agent actions

1. Implement `report/summary.ts` output:
   - `bench/reports/summary.csv`
   - `bench/reports/summary.md`

2. Include:
   - hidden-test success rate
   - median/p90 completion time
   - median/p90 token totals
   - median/p90 context peak
   - estimated cost per run
   - estimated cost per successful run

### Done when

- Report generated directly from JSONL without manual edits.

---

## 9) Initial dataset + rollout

### Agent actions

1. Pilot matrix:
   - 3 tasks × 2 agents × 2 repeats = 12 runs
2. Scale matrix:
   - 12 tasks × 2 agents × 3 repeats = 72 runs

Task mix target:

- 4 bug-fix
- 4 feature-add
- 2 refactor/no-regression
- 2 tooling/build/debug

### Done when

- Pilot runs stable, then scale runs complete with summary report.

---

## 10) Definition of done

Benchmark is done only when all true:

- One command executes end-to-end benchmark matrix.
- Both agents run same multi-prompt scripts and grading flow.
- Hidden-test correctness is primary success signal.
- Tokens, context, speed, cost exported per turn and per session.
- Summary report includes medians and p90s for comparison.
- All artifacts stored under `bench/runs` and `bench/reports`.
