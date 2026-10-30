# Benchmark

This benchmark measures how much context and cost surgent saves compared with codex and opencode. All three agents run the same model, at the same reasoning effort, through the same ChatGPT subscription, so any difference comes from the harness. Score is reported too, as a check that surgent doesn't make the model perform worse.

Tasks come from two [Harbor](https://github.com/harbor-framework/harbor) datasets: DeepSWE (`datacurve/deep-swe`, 104 tasks) and Terminal-Bench 4.0 (`terminal-bench/terminal-bench@4.0.0`, 66 tasks).

## Quick start

You need Docker, Node.js, and `pnpm install` run at the repo root. DeepSWE blocks network access with nftables, so Docker's kernel needs `CONFIG_NFT_FIB_INET` (on WSL, run `wsl --update`).

### Set up

```bash
cd bench
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

### Log in

Trials install their own pinned versions of codex and opencode, so their CLIs are only used to sign in. Install them, or run them through `npx` without installing.

```bash
# Installed
npm install -g @openai/codex opencode-ai
codex login                   # Sign in with ChatGPT
opencode auth login           # OpenAI → ChatGPT Plus/Pro

# Without installing
npx @openai/codex login       # Sign in with ChatGPT
npx opencode-ai auth login    # OpenAI → ChatGPT Plus/Pro

surgent                       # /login → OpenAI Codex (legacy)
```

### Run the benchmark

```bash
surgent-bench preflight    # checks Docker and logins, builds surgent
nohup surgent-bench run > run.log 2>&1 &
surgent-bench collect      # writes results/*.csv
surgent-bench plot         # draws results/session.png
```

Run `preflight` again whenever you change the surgent checkout. `run --limit N` runs only the first N rounds, and `quota` shows how much of the weekly quota each round used.

## How a run works

- **Task selection.** Each suite's tasks are shuffled into a fixed order based on `run.seed`. Excluded tasks are removed, and the run takes `limit` tasks starting at position `offset`. A suite with `limit = 0` is skipped.
- **Trials.** Every agent attempts every task up to `run.max_trials` times, 3 by default. A round is one task attempted once by all three agents at the same time, each in its own Harbor trial. The run goes through all tasks once before starting the next attempt.
- **Output.** Each trial gets its own folder in `jobs/<suite>/<task>/`: `codex`, `codex-2`, `codex-3` and so on, and likewise for `opencode` and `surgent-<version>-<build>`.
- **Stalled agents.** An agent that produces no output for 20 minutes (`run.stall_minutes`) is stopped and graded on what it has done so far, recorded as `AgentStalledError`. Normal trials have gone at most about 10 minutes without output.
- **Surgent builds.** Surgent runs from this repository. `preflight` packs the checkout into `surgent-<version>-<build>.tgz`, where `<version>` is surgent's package version and `<build>` is a hash of its contents. Changing the checkout creates a new build: only surgent's trials run again, and results from earlier builds are kept for comparison.
- **Stopping and resuming.** The run continues until the subscription quota runs out. To stop it earlier, press Ctrl+C or run `kill <pid>`; trials in progress are cleaned up and run again on restart. Press Ctrl+C twice to stop immediately. A restarted run skips finished trials and reruns trials that failed for infrastructure reasons (sandbox, network, login or quota) or before the agent's first model call.

## Configuration

Everything is set in `config.toml`:

| Section      | What it controls                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[model]`    | Model name and reasoning effort.                                                                                                                                                                                                                 |
| `[agents]`   | Pinned codex and opencode versions.                                                                                                                                                                                                              |
| `[auth]`     | Where each agent's login file is on the host.                                                                                                                                                                                                    |
| `[run]`      | Jobs folder, concurrency, time limits, stall limit, allowed network hosts, shuffle seed, trials per task, retries, and an instruction added to every task.                                                                                       |
| `[[suites]]` | Dataset, which tasks to run (`offset` and `limit`), time limits, [excluded tasks](#excluded-tasks) (`exclude`), environment fixes (`setup_commands`), and whether tests written by the agent are set aside before grading (`strip_agent_tests`). |

## Running on several machines

Give each machine its own range of tasks and keep the rest of `config.toml` identical, including `exclude`. For example, to split DeepSWE's first 80 tasks across two machines, set `offset = 0` and `limit = 40` on one, and `offset = 40` and `limit = 40` on the other. Use the same surgent checkout everywhere, so every machine builds the same surgent.

Log in on each machine instead of copying login files; otherwise one machine refreshing its token can sign the other out. Machines signed in to the same ChatGPT account share its quota, so splitting a run only makes it faster when the quota isn't the limit.

To combine results, copy every machine's `jobs/<suite>/<task>/` folders into one `jobs/` folder and run `collect` there. The ranges don't overlap, so no folders clash.

## Results

`collect` writes its reports to `results/`. On each task, it compares the same number of trials for every agent: as many as all of them have finished. It reports a single surgent build: the one `preflight` built, or the one given with `--surgent-build`, either by version or by the start of its hash.

| File                  | Contents                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `results/summary.csv` | Per agent: score, cache hit rate, and cost and tokens as totals, as averages per task, and as the 90th percentile cost per task. |
| `results/trials.csv`  | One row per trial.                                                                                                               |
| `results/calls.csv`   | One row per model call.                                                                                                          |
| `results/session.png` | How context grows over a session: median context size per turn, with a band for the middle 50% of trials.                        |

| Metric         | Meaning                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context usage  | Prompt size, in tokens, of each main-agent turn.                                                                                                                 |
| Cost           | Tokens priced at API rates from pi's `openai` model catalog. The subscription isn't billed per token, so this is what the same usage would cost through the API. |
| Cache hit rate | Share of input tokens read from the prompt cache.                                                                                                                |
| Tokens         | Totals across all model calls, including compaction. Output tokens include reasoning.                                                                            |
| Per task       | A task's cost or token count is the mean over its trials. Averages and the 90th percentile are then taken across tasks.                                          |
| Score          | Mean verifier reward across trials. It shows whether the harness hurts the model; differences of a few points between agents are within run-to-run noise.        |

## Fairness

- All agents use the same model, reasoning effort, subscription and backend. `collect` checks each agent's logs to confirm the model and effort.
- Each agent runs as shipped: surgent's `general` agent, codex's default agent and opencode's `build` agent.
- No agent can use subagents or web tools.
- All agents get the same added instruction, time limits and allowed network hosts.
- Every agent attempts every task the same number of times, and every trial is graded and reported.
- Installs and environment fixes run before the agent starts, with network access and no time limit. After that, the task's own network rules apply to both the agent and the grader.
- Test files an agent writes for itself are moved aside before grading, so they can't collide with the hidden tests and only the agent's actual changes are graded. Terminal-Bench is the exception.

## Excluded tasks

Some tasks are left out because the task itself is flawed, never because it's hard. A task is excluded when it has:

- **Flaky tests**: the reference solution itself sometimes fails.
- **Overly strict tests**: the tests reject behavior the instruction allows.
- **An underspecified prompt**: the tests require behavior the instruction never asks for.
- **A grader issue**: grading can fail a correct solution for reasons outside the agent's work.

A task that fails only because its environment is incomplete, such as a dependency missing from the image that the offline grader can't download, is fixed instead of excluded. Its `setup_commands` in `config.toml` install or pin what's missing before the agent starts, and each fix has a comment explaining it.

### DeepSWE

| Task                                           | Classification        | Reason                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code-by-agents-recursive-delegation`   | Overly strict tests   | The instruction only requires that the delegating agent can see the sub-agent's `tool_result` when it runs again. But 5 of 7 tests accept the result only in the request's `context` field, and fail when it's passed as `message`, which is how every provider in the repo hands it to the model. The repo's claude-code provider, used whenever no Anthropic API key is set, even drops `context`.                             |
| `eicrud-keyset-pagination-cursor`              | Flaky tests           | When a logged-in user's request fails, the repo updates their error count without waiting for it, and the hidden test shuts the app down right after its last failing request. If the shutdown happens first, Node crashes with `DriverException: Operation interrupted because client was closed`. The reference solution fails 2 of 6 runs.                                                                                    |
| `happy-dom-deterministic-intersectionobserver` | Overly strict tests   | The instruction asks for a real IntersectionObserver implementation, but 3 tests expect targets that are detached, or outside the root, to count as intersecting, which the W3C spec rules out.                                                                                                                                                                                                                                  |
| `ink-grid-box-layout`                          | Underspecified prompt | The instruction uses CSS Grid properties without saying where its layout differs from CSS Grid, yet 3 tests expect non-CSS behavior: an item with only `gridColumn` set stays in row 1, and `auto` tracks don't stretch.                                                                                                                                                                                                         |
| `meriyah-explicit-resource-declarations`       | Overly strict tests   | One test expects `for (using of of [1,2])` to declare a variable named `of`, but the proposal's grammar makes `using` an ordinary identifier there, as test262, TypeScript and Babel agree. Another test expects `using` directly inside a `case` clause to parse, which ECMA-262 now rejects.                                                                                                                                   |
| `fd-deterministic-multi-key-sorting`           | Flaky tests           | A test creates `c.txt`, `a.txt` and `b.txt` in that order and expects `--sort created --sort name` to list them as `a b c`. That only holds when all three files get the same creation time, but the container's filesystem records creation times in steps of about 4 ms. The reference solution fails 5 of 40 runs.                                                                                                            |
| `kcp-go-multiplexed-kcp-streams`               | Flaky tests           | A test waits for a stream to close, then expects `MuxBytesSent` to already be 27. The mux counts a frame's bytes only after the write returns, so the check can run first. The reference solution fails 5 of 30 runs.                                                                                                                                                                                                            |
| `go-critic-doc-link-checker`                   | Grader issue          | The grader checks every fixture in the checker's `testdata` folder, including fixtures the agent wrote, using a hidden version of the test harness that reads fixture annotations differently. A fixture that passes with the repo's harness can fail at grading, even when the agent's checker is correct. Setup commands can't fix this, because the agent's fixtures always compile into the same package as the hidden ones. |
| `happy-dom-abort-pending-body-reads`           | Flaky tests           | After `abort()`, an existing test waits 10 ms and expects both pending requests to have finished. With other trials running in parallel, they can take up to 24 ms, and the reference solution fails 4 of 15 runs. Lengthening that wait, as the upstream project later did, isn't enough: 13 other 50 ms deadlines remain in the request and response tests, and one of them also timed out under load.                         |

## Troubleshooting

When the driver stops on its own, its exit code says why:

- **2**: A login was rejected. Log in again with that agent's CLI, then restart.
- **3**: The quota ran out. Restart once it resets.
- **4**: Surgent isn't built (run `preflight`), or a setting differs from the one used by trials already recorded. Change the setting back, or set a new `run.jobs_dir`.
- **5**: Harbor couldn't start a trial. Its error is printed just above.
- **130**: The run was stopped with Ctrl+C or `kill`.

Docker keeps every task image it pulls, so run `docker image prune -a` if disk space runs low. Trial folders can contain credentials an agent wrote, so check `jobs/` before sharing it.
