# surgent bench

Benchmarks surgent against codex and opencode on [Harbor](https://github.com/harbor-framework/harbor) datasets. All three agents run the same model, at the same reasoning effort, through the same ChatGPT subscription. For each agent the bench reports score, cost, cache hit rate, and token usage, and charts how context grows over a session.

Suites: DeepSWE (`datacurve/deep-swe`, 113 tasks) and Terminal-Bench 4.0 (`terminal-bench/terminal-bench@4.0.0`, 66 tasks).

## How a run works

- Each suite shuffles its tasks into a fixed order derived from `run.seed`, drops excluded ones, and runs the `limit` tasks starting at position `offset`. A suite with `limit = 0` doesn't run.
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

A task is excluded when the task itself is flawed, never for difficulty: it is broken, its tests are flaky, overly strict, or its prompt is underspecified or misleading. A task whose environment alone is broken is repaired with `setup_commands` instead.

| Task                                           | Classification        | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code-by-agents-recursive-delegation`   | Overly strict tests   | The instruction asks only that the delegating agent see the sub-agent's `tool_result` when re-invoked, but 5 of 7 tests accept it only in the request's `context`. Passing it as `message`, which every provider in the repo sends to the model, fails them, yet `context` is the field the repo's claude-code provider drops, and the orchestrator uses that provider when no Anthropic API key is set.                                                                      |
| `eicrud-keyset-pagination-cursor`              | Flaky tests           | When a logged-in user's request fails, the repo bumps their error count without awaiting it, and the hidden spec closes the app right after its last failing request. When the close wins, Node crashes with `DriverException: Operation interrupted because client was closed`, so the reference solution fails 2 of 6 runs.                                                                                                                                                 |
| `happy-dom-deterministic-intersectionobserver` | Overly strict tests   | The instruction asks for a real IntersectionObserver engine, but 3 tests expect detached targets, or targets outside the root, to intersect, which the W3C spec rules out.                                                                                                                                                                                                                                                                                                    |
| `ink-grid-box-layout`                          | Underspecified prompt | The instruction uses CSS Grid properties but never states its own rules for placing items or sizing `auto` tracks, and 3 tests expect what CSS Grid wouldn't give: an item with only `gridColumn` stays in row 1, and auto tracks don't stretch.                                                                                                                                                                                                                              |
| `meriyah-explicit-resource-declarations`       | Overly strict tests   | A test expects `for (using of of [1,2])` to declare `of`, but the proposal's `[lookahead ≠ using of]` rule makes `using` an identifier there, as test262, TypeScript and Babel agree. Another test expects `using` directly in a `case` clause to parse, which ECMA-262 now rejects.                                                                                                                                                                                          |
| `fd-deterministic-multi-key-sorting`           | Flaky tests           | A test creates `c.txt`, `a.txt` and `b.txt` in that order and expects `--sort created --sort name` to list them `a b c`, which holds only when all three get the same creation time. The container's filesystem records creation times in steps of about 4 ms, so the reference solution fails the new tests in 5 of 40 runs.                                                                                                                                                 |
| `kcp-go-multiplexed-kcp-streams`               | Flaky tests           | A test waits only until a stream has closed, then expects `MuxBytesSent` to already be 27, but the mux counts a frame's bytes after its write returns, so the check can run first. The reference solution fails 5 of 30 runs of the grader's tests.                                                                                                                                                                                                                           |
| `go-critic-doc-link-checker`                   | Grader issue          | The grader checks every fixture in the checker's testdata, including ones the agent writes, with a hidden `linttest.go` that drops `/*!` comments the original keeps. In all 4 failing trials the hidden fixtures passed and only the agent's own fixtures failed, though each agent's patch passed the checker's test under the original harness. Filtering fixtures in setup still leaves agent fixtures compiling into the same `checker_test` package as the hidden ones. |
| `happy-dom-abort-pending-body-reads`           | Flaky tests           | After `abort()`, an existing test waits a real 10 ms and expects both pending fetches finished, but under load from parallel trials they take up to 24 ms, so the reference solution fails 4 of 15 runs of the grader's tests. Upstream raised the wait to 100 ms, but 13 other 50 ms deadlines in `Request.test.ts` and `Response.test.ts` remain, and one of them also timed out under load.                                                                                |

## Results

`collect` compares, on each task, as many trials as every agent has finished there, and reports one surgent build: the prebuilt one, or the one given by `--surgent-build`.

| File                  | Holds                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `results/summary.csv` | Per agent: score, cache hit rate, cost and tokens as totals and as average per task, and p90 cost per task. |
| `results/trials.csv`  | One row per trial.                                                                                          |
| `results/calls.csv`   | One row per model call.                                                                                     |
| `results/session.png` | Median context size per turn, with quartile band.                                                           |

| Metric         | Definition                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Score          | Sum of verifier rewards over the number of trials.                                                  |
| Cost           | Tokens priced at API rates from pi's `openai` catalog; the subscription has no per-token bill.      |
| Cache hit rate | Cache-read tokens over all input tokens.                                                            |
| Context usage  | Prompt tokens of each main-agent turn.                                                              |
| Tokens         | Totals over every call, including compaction; output includes reasoning.                            |
| Per task       | A task's cost or tokens is the mean over its trials; the average and p90 cost are taken over tasks. |

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
