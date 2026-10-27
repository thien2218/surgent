# surgent bench

Benchmarks surgent against codex and opencode on [Harbor](https://github.com/harbor-framework/harbor) datasets. All three agents run the same model, at the same reasoning effort, through the same ChatGPT subscription. For each agent the bench reports score, cost, cache hit rate, and token usage, and charts how context grows over a session.

Suites: DeepSWE (`datacurve/deep-swe`, 113 tasks) and Terminal-Bench 4.0 (`terminal-bench/terminal-bench@4.0.0`, 66 tasks).

## How a run works

- Each suite shuffles its tasks into a fixed order derived from `run.seed` and runs the `limit` tasks starting at position `offset`, skipping excluded ones. A suite with `limit = 0` doesn't run.
- A run makes three passes over the tasks, one per trial. A round is one task in one pass, with all three agents working on it at the same time, each in its own Harbor trial.
- Results go to `jobs/<suite>/<task>/`, one folder per trial: `codex`, `codex-2`, `codex-3`, and likewise for `opencode` and `surgent-<build>`.
- An agent that writes no output for `run.stall_minutes` (20) is stopped and graded on its work so far, as `AgentStalledError`. Normal trials have gone at most about 10 minutes without output.
- Restarting skips finished trials and reruns ones that failed on infrastructure (sandbox, network, login, quota) or whose agent failed before its first model call.
- Surgent always runs this checkout, installed once by `preflight` into `surgent-<build>.tgz`, a digest of the packed checkout. A changed checkout is a new build, so only surgent reruns and earlier builds stay for comparison.
- The driver runs until the subscription quota is exhausted. Ctrl+C or `kill <pid>` stops it: Harbor removes the running trials' containers, and those trials rerun on restart. A second Ctrl+C kills the trials and removes their containers at once.

## Quick start

Requirements: Docker, Node.js, and `pnpm install` at the repo root. DeepSWE blocks network with nftables, so Docker's kernel needs `CONFIG_NFT_FIB_INET` (on WSL, run `wsl --update`).

```bash
cd bench
python3 -m venv .venv && .venv/bin/pip install -e .

codex login                  # Sign in with ChatGPT
surgent                      # /login → OpenAI Codex (legacy)
opencode auth login          # OpenAI → ChatGPT Plus/Pro

.venv/bin/surgent-bench preflight    # checks docker and logins, prebuilds surgent
nohup .venv/bin/surgent-bench run > run.log 2>&1 &
.venv/bin/surgent-bench collect      # results/*.csv
.venv/bin/surgent-bench plot         # results/session.png
```

Rerun `preflight` after changing the surgent checkout. `run --limit N` runs only the first N rounds, and `quota` shows how much of the weekly quota each round used.

## Configuration

`config.toml`:

| Section | Sets |
|---|---|
| `[model]` | Model name and reasoning effort. |
| `[agents]` | Pinned codex and opencode versions. |
| `[auth]` | Host login files. |
| `[run]` | Jobs folder, concurrency, stall limit, allowed hosts, seed, retries, and the instruction appended to every task. |
| `[[suites]]` | Dataset, `offset` and `limit` (the window of tasks to run), timeout multiplier, `exclude` (see [Excluded tasks](#excluded-tasks)), and `setup_commands` (commands that repair a task's environment before the agents start). |

## Running on several machines

Give each machine its own window of every suite and keep the rest of `config.toml` the same. For DeepSWE's first 63 tasks, one machine sets `offset = 0` and `limit = 32`, the other `offset = 32` and `limit = 31`. Run the same surgent checkout everywhere so every machine prebuilds the same build.

Log in on each machine instead of copying login files, so one machine refreshing a token can't sign out another. Machines signed in to the same ChatGPT account share its quota, so they finish sooner only when the quota isn't what limits the run.

To report, copy every machine's `jobs/<suite>/<task>/` folders into one `jobs/` folder and run `collect` there. Windows don't overlap, so no folder collides.

## Excluded tasks

A task is excluded when the task itself is flawed, never for difficulty: it is broken, its tests are overly strict or cover too little, or its prompt is underspecified or misleading.

| Task | Classification | Reason |
|---|---|---|
| `prometheus-transactional-reload-status` | Broken | The offline grader can't download Go module `grpc-gateway/v2` v2.27.7, which the image lacks, so no solution passes. |
| `pest-character-class-coalescing` | Broken | The offline grader can't download crate `proc-macro2` 1.0.106, which the image lacks, so no solution passes. |
| `claude-code-by-agents-recursive-delegation` | Overly strict tests | The instruction asks only that the delegating agent see the sub-agent's `tool_result` when re-invoked, but 5 of 7 tests accept it only in the request's `context`. Passing it as `message`, which every provider in the repo sends to the model, fails them, yet `context` is the field the repo's claude-code provider drops, and the orchestrator uses that provider when no Anthropic API key is set. |

## Results

`collect` compares, on each task, as many trials as every agent has finished there, and reports one surgent build: the prebuilt one, or the one given by `--surgent-build`.

| File | Holds |
|---|---|
| `results/summary.csv` | Per agent: score, cache hit rate, cost and tokens as totals and as average per task, and p90 cost per task. |
| `results/trials.csv` | One row per trial. |
| `results/calls.csv` | One row per model call. |
| `results/session.png` | Median context size per turn, with quartile band. |

| Metric | Definition |
|---|---|
| Score | Sum of verifier rewards over the number of trials. |
| Cost | Tokens priced at API rates from pi's `openai` catalog; the subscription has no per-token bill. |
| Cache hit rate | Cache-read tokens over all input tokens. |
| Context usage | Prompt tokens of each main-agent turn. |
| Tokens | Totals over every call, including compaction; output includes reasoning. |
| Per task | A task's cost or tokens is the mean over its trials; the average and p90 cost are taken over tasks. |

With 15–25 tasks per agent, score gaps under about 15–20 points are within noise.

## Fairness

- Same model, effort, subscription, and ChatGPT backend (`chatgpt.com`); `collect` checks model and effort against each agent's logs.
- Each agent runs as shipped: surgent's `general`, codex's default, and opencode's `build` agent.
- No subagents and no web tools for any agent.
- Same appended instruction, time limits, and host allowlist.
- Three trials per agent on every task, all graded and reported.
- Installs and environment repairs run online and untimed before the agent starts; the task's network policy then applies to the agent and the grader.
- Test files an agent creates are set aside before grading, so only its work is graded (except on Terminal-Bench).

## Troubleshooting

The driver exits with:

- **2**: a login was rejected. Log in again in that CLI, then restart.
- **3**: the quota ran out. Restart after it resets.
- **4**: surgent isn't prebuilt (run `preflight`), or a round's setup differs from recorded trials. Restore the setting, or use a new `run.jobs_dir`.
- **5**: Harbor failed to start a trial; its error is printed above.
- **130**: stopped with Ctrl+C or `kill`.

Task images are pulled per round and kept by Docker; run `docker image prune -a` if disk runs low. Trial folders may contain credentials an agent wrote, so check `jobs/` before sharing it.
