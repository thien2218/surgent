# Benchmark

## Overview

This directory contains a small, repeatable coding benchmark for comparing CLI coding agents on the same set of implementation tasks, under the same prompt sequence, with the same scoring method.

The benchmark exists to answer practical questions such as:

- Can an agent follow narrowly scoped implementation instructions across multiple turns?
- Can it modify code incrementally without solving extra work that was not requested?
- Does it generalize beyond visible tests and still pass hidden cases?
- How much time, token usage, cache reuse, and estimated cost does it take to finish each task?

Today, the harness supports two runners:

- `surgent`
- `copilot`

Each run executes the same task manifest, captures usage data from the runner session, runs visible and hidden tests, and writes one CSV row per runner/task pair.

## Goal of this benchmark

The primary goal is to compare agent behavior on focused software engineering work rather than open-ended conversation quality.

These tasks are intentionally small, but they are not trivial. They require an agent to:

- read an unfamiliar workspace,
- implement only the requested function for each step,
- preserve existing exports and file boundaries,
- avoid editing tests,
- keep behavior correct across multiple related functions,
- and finish with strong hidden-test performance, not only visible-test performance.

This makes the benchmark useful for measuring coding discipline, execution accuracy, and robustness under constrained instructions.

It is also designed to be easy to rerun. Each task is copied into a temporary workspace before execution, so one run does not contaminate the next. Hidden tests run outside the copied workspace and import the task code through `BENCHMARK_WORKSPACE`, which helps prevent accidental leakage between visible and hidden evaluation.

## What this benchmark evaluates

The benchmark measures both correctness and efficiency.

### 1. Functional correctness

Each task has:

- **4 visible test cases** in `benchmark/tasks/<task>/tests/visible.test.mjs`
- **6 hidden test cases** in `benchmark/hidden/<task>/hidden.test.mjs`

Visible tests establish expected baseline behavior. Hidden tests check edge cases, anti-overfitting behavior, and integration behavior that is easy to miss if an agent implements only the obvious path.

The final benchmark score for a run is the combined pass rate across both sets of tests:

- `testsPassedPercent = (visible passed + hidden passed) / (visible total + hidden total) * 100`

### 2. Instruction following across turns

Tasks are not sent as one large prompt. Instead, each task contains a sequence of prompts in `benchmark/tasks.json`.

For example, a task may ask the agent to:

1. implement one helper,
2. then implement one dependent function,
3. then implement the public entry point,
4. then run tests and fix only remaining functional bugs.

This structure evaluates whether the agent can stay within scope at each step instead of solving the whole task prematurely.

### 3. Engineering robustness

The tasks cover several common implementation patterns:

- recursive object merging,
- markdown parsing,
- route matching and precedence,
- immutable game-state transitions,
- bounded-concurrency task scheduling.

Together, they exercise branching logic, state handling, parser-like behavior, ordering rules, and API contract preservation.

### 4. Runtime efficiency

For each completed run, the harness records:

- completion time,
- input tokens,
- output tokens,
- total tokens,
- cache hit rate,
- total estimated cost.

These metrics make the benchmark useful not only for “did it pass,” but also for “how efficiently did it pass.”

## What this benchmark does not try to measure

This benchmark is intentionally narrow.

It does **not** try to measure:

- broad product design ability,
- long-form explanation quality,
- interactive clarification behavior,
- UI design,
- system architecture for large codebases.

In fact, the setup prompt explicitly makes the environment restrictive and tells the agent not to ask clarifying questions. That is deliberate: the benchmark is optimized for controlled comparison of implementation behavior.

## Directory structure

```text
benchmark/
├── hidden/          # Hidden tests, one directory per task
├── sessions/        # Persisted runner session logs after each run
├── tasks/           # Benchmark task workspaces with visible tests
├── init.sh          # Creates per-task .pi settings for benchmark runs
├── run.mjs          # Main benchmark runner
├── tasks.json       # Task manifest and prompt sequence
└── usage.mjs        # Usage metric parsers for runner session logs
```

## How the benchmark runs

At a high level, each planned run works like this:

1. Load `benchmark/tasks.json`.
2. Select runner(s) and task(s).
3. Copy the task workspace into a fresh temporary directory.
4. Send the setup prompt, then the task prompt sequence, to the selected runner.
5. Run visible tests inside the copied workspace.
6. Run hidden tests from `benchmark/hidden/<task>` with `BENCHMARK_WORKSPACE` pointing at the copied workspace.
7. Parse usage metrics from runner session artifacts.
8. Append one result row to the output CSV.
9. Persist session logs under `benchmark/sessions/<task>/<runner>/`.

This flow helps keep runs isolated and reproducible.

## Metrics written to CSV

The default output file is `benchmark/results.csv`.

Each row contains:

- `agent`
- `task`
- `completionTime`
- `testsPassedPercent`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `cacheHit`
- `totalCost`

`completionTime` is recorded in seconds. `cacheHit` is written as a percentage value derived from the runner-specific usage logs. `totalCost` is left blank when the runner does not expose enough cost information to compute it reliably.

## Prerequisites

Before running the benchmark, make sure:

1. dependencies are installed for this repository,
2. Node.js is available,
3. the CLI runner you want to test is installed and authenticated,
4. task-local benchmark settings have been initialized.

Initialize task settings with:

```bash
bash benchmark/init.sh
```

This creates `.pi/settings.json` inside each task workspace with benchmark-friendly settings.

## How to run the benchmark

### Basic command

From the repository root:

```bash
node benchmark/run.mjs --runner surgent --model gpt-5
```

Supported runner values:

- `surgent`
- `copilot`
- `both`

### Common options

```text
--runner <name>   Runner to use: surgent, copilot, or both
--model <name>    Logical model name for both CLIs
--tasks <path>    Manifest path (default: benchmark/tasks.json)
--output <path>   Output CSV path (default: benchmark/results.csv)
--task <id>       Task id filter. Repeat flag to run more than one task
--help            Show help text
```

### Example: run both runners on every task

```bash
node benchmark/run.mjs --runner both --model gpt-5
```

### Example: run one task only

```bash
node benchmark/run.mjs --runner surgent --model gpt-5 --task mini-router-match
```

### Example: run multiple tasks and write to a custom CSV

```bash
node benchmark/run.mjs \
  --runner copilot \
  --model gpt-5 \
  --task deep-merge-config \
  --task task-queue-concurrency \
  --output benchmark/copilot-gpt5-results.csv
```

## Interpreting results

A strong run is not only one that passes visible tests. The more meaningful result is strong combined performance across visible and hidden tests while keeping time and token usage reasonable.

When reviewing results, useful questions include:

- Which tasks pass visible tests but fail hidden tests?
- Which runner reaches similar correctness with fewer tokens?
- Which tasks cause the largest completion-time variance?
- Are failures concentrated in parsing, state updates, ordering rules, or validation logic?

Because every task has 10 total cases, per-task reporting is straightforward and consistent.

## Tasks

The benchmark currently contains five tasks. Each task is intentionally compact, but each one targets a different engineering skill.

### 1. `snake-game-engine`

**Public API**

- `createGameState(config)`
- `setDirection(gameState, nextDirection)`
- `tickGame(gameState)`

**What the task is about**

This task asks the agent to build core logic for a grid-based snake game engine. The implementation must manage movement, food, score, collisions, and direction changes while keeping state updates immutable.

**What the agent must get right**

- create valid initial game state,
- reject opposite direction changes when the snake has more than one segment,
- allow direction changes when legal,
- move the snake correctly on each tick,
- grow the snake after eating food,
- spawn the next food in first-free-cell row-major order,
- return `null` food when the board becomes full,
- mark game over on wall collision or self collision,
- preserve immutability of state transitions.

**Why it is useful**

This task evaluates state-machine logic, coordinate updates, branch correctness, and safe immutable updates across related functions.

### 2. `markdown-toc-generator`

**Public API**

- `buildTableOfContents(markdownText, options)`

**What the task is about**

This task implements a markdown table-of-contents generator for ATX headings. The agent must extract headings, ignore fenced code blocks, normalize slugs, and assign duplicate suffixes correctly.

**What the agent must get right**

- parse headings from level 1 through 6 only,
- require a space after the heading markers,
- ignore headings inside triple-backtick fenced code blocks,
- support `minLevel` and `maxLevel` filtering,
- lowercase slugs,
- remove punctuation while preserving meaningful word boundaries,
- collapse spaces and repeated hyphens,
- append `-2`, `-3`, and so on for duplicate normalized slugs.

**Why it is useful**

This task exercises parser-style logic, text normalization, repeated-state tracking, and the ability to implement edge-case-heavy behavior from a concise contract.

### 3. `deep-merge-config`

**Public API**

- `deepMergeConfig(baseConfig, overrideConfig)`

**What the task is about**

This task implements a safe deep configuration merge. It combines nested plain objects recursively, preserves immutability, handles `undefined` and `null` correctly, and avoids unsafe prototype-related keys.

**What the agent must get right**

- reject non-plain top-level inputs with `TypeError`,
- merge plain objects recursively,
- keep base values when the override value is `undefined`,
- allow `null` to replace a base value,
- replace arrays rather than merging them,
- clone returned containers instead of mutating inputs,
- ignore unsafe keys such as `__proto__`, `prototype`, and `constructor`.

**Why it is useful**

This task evaluates recursive logic, mutation safety, input validation, and secure object-handling behavior that is common in real configuration code.

### 4. `mini-router-match`

**Public API**

- `matchBestRoute(routePatterns, requestPath)`

**What the task is about**

This task implements a small path router. The agent must normalize paths, compile route patterns, match static/param/wildcard segments, decode parameters, and choose the best route according to precedence rules.

**What the agent must get right**

- normalize repeated slashes and trailing slash,
- match exact static segments,
- capture `:param` segments,
- support final `*` wildcard segments via `params.splat`,
- decode captured path segments,
- return `null` when nothing matches,
- prefer static matches over param matches,
- prefer param matches over wildcard matches,
- keep first pattern order as tie-breaker.

**Why it is useful**

This task measures rule ordering, parser-like matching behavior, and whether an agent can preserve precise precedence semantics rather than only basic matching.

### 5. `task-queue-concurrency`

**Public API**

- `runTasksWithConcurrency(taskFactories, concurrency)`

**What the task is about**

This task implements a bounded-concurrency task runner with `Promise.allSettled`-style output. The agent must validate input, schedule work without exceeding concurrency, preserve input order, and continue after failures.

**What the agent must get right**

- reject invalid `taskFactories` input with `TypeError`,
- reject non-positive or non-integer concurrency values,
- keep active task count at or below the concurrency limit,
- start the next task as soon as one settles,
- preserve input order in results,
- keep running after rejections,
- capture synchronous throws as rejected results,
- support both synchronous and asynchronous task factories.

**Why it is useful**

This task evaluates asynchronous control flow, scheduling correctness, failure isolation, and stable output semantics.

## Task manifest

Task definitions live in `benchmark/tasks.json`.

Each task entry defines:

- task id,
- workspace directory,
- hidden test directory,
- visible test command,
- hidden test command,
- prompt sequence.

The prompt sequence matters. It is part of the benchmark contract, not only implementation detail. If you change prompt order, requested scope, or test commands, you are changing the benchmark.

## Session artifacts

After each run, session data is copied into:

```text
benchmark/sessions/<task>/<runner>/
```

These artifacts are useful for:

- debugging failures,
- checking prompt-by-prompt behavior,
- validating usage accounting,
- reviewing runner output when a result looks suspicious.

## Extending the benchmark

When adding a new task, keep the design consistent with existing ones:

- use a small, self-contained workspace,
- expose one clear public API,
- split work across sequential prompts,
- keep visible tests representative but not exhaustive,
- keep hidden tests focused on edge cases and anti-overfitting,
- prefer tasks that stress implementation accuracy rather than framework setup.

For consistency with the current suite, new tasks should also follow the same reporting-friendly structure of **4 visible** and **6 hidden** test cases.

## Summary

This benchmark is a controlled comparison harness for coding agents. It focuses on incremental implementation quality, hidden-test robustness, and usage efficiency across a compact but diverse task set.

If you want to compare two runners on the same model under the same constraints, this benchmark is designed to give results that are easy to rerun, inspect, and report.
