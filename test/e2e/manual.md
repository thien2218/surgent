# Manual test checklist

Use this checklist to validate surgent's interactive workflows from a source checkout. It is for contributors and release testers who know the TUI and can inspect files in a disposable repository. These checks complement Vitest; they are not automated specifications.

> **Warning:** Never run these flows in the surgent checkout or another valuable working tree. Agent, permission, checkpoint, cleanup, and redaction checks intentionally create, edit, restore, and delete files.

## Prepare an isolated workspace

Requirements:

- Node.js 22.19 or newer, Git, and the checkout's installed dependencies.
- A terminal that can send `Alt` and `Ctrl+Alt` key combinations.
- A configured provider only for agent-driven journeys. Those journeys can contact the provider and incur usage. The local UI and MCP checks do not require real credentials.
- A usable external editor in `EDITOR` for editor checks.

From outside the surgent checkout, create a temporary home and disposable Git repository. Replace `/path/to/surgent` first.

```bash
env -i PATH="$PATH" TERM="${TERM:-xterm-256color}" EDITOR="${EDITOR:-vi}" bash --noprofile --norc
export SURGENT_ROOT=/path/to/surgent
export SURGENT_MANUAL_ROOT="$(mktemp -d)"
export HOME="$SURGENT_MANUAL_ROOT/home"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_DATA_HOME="$HOME/.local/share"
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL="$HOME/.gitconfig"
export GIT_CEILING_DIRECTORIES="$SURGENT_MANUAL_ROOT"
mkdir -p "$HOME" "$SURGENT_MANUAL_ROOT/repo"
cd "$SURGENT_MANUAL_ROOT/repo"
git init
git config user.name "Surgent Manual Test"
git config user.email "surgent-manual@example.invalid"
printf '# Manual fixture\n' > README.md
printf 'original\n' > tracked.txt
git add README.md tracked.txt
git commit -m 'test fixture'
node "$SURGENT_ROOT/bin/surgent.js"
```

The first command starts an environment-allowlisted child shell, removing inherited provider keys and Pi auth/session-directory overrides. The temporary `HOME` does not replace your normal shell environment. Before the final `node` command, explicitly configure a provider inside this child shell if you will run agent-driven checks. Do not point Pi storage overrides at your normal home or reuse a real session directory.

Use only unmistakably fake secrets; never paste a real token into the TUI or fixture files. Before each destructive flow, commit the fixture state or create a separate repository under `$SURGENT_MANUAL_ROOT`.

For each check, record the surgent revision, model, terminal, result, and unexpected output. Follow the key hints displayed by each dialog rather than relying on terminal timing or scripted keystrokes.

## Agents, modes, and initialization

### Agent profiles

1. Run `/agents`, choose **Create new agent**, select project scope, and create `manual-agent`.
2. In the external editor, give it a distinctive system prompt and valid frontmatter for `description`, `tools`, `model`, `thinking_level`, and file or Bash constraints. Use a model available in the test environment.
3. Run `/agents` again, select the profile, choose **Edit agent config**, and change its tools, model, and thinking level. Start it in a new session.
4. Ask a small question that reveals the distinctive prompt and request one allowed and one excluded tool action.
5. Restart surgent, resume that session, and confirm the selected agent and configuration still apply.
6. Open the custom profile in the external editor from `/agents`, make a valid prompt-only change, and resume again.
7. Delete the profile from `/agents`. Try to resume the session that named it, then start a fresh session.

Expected:

- The project profile is stored only in the disposable repository; edits survive restart.
- A new session shows `agent: manual-agent`, uses the configured model/thinking level when supported by that model, incorporates the prompt, and exposes only configured tools.
- External-editor changes load after restart or resume.
- Deleting a custom profile removes it from the picker. Resuming a session that explicitly named the missing profile reports an invalid agent and shuts that session down; it must not silently reuse deleted instructions. A fresh session falls back to the built-in `general` agent.
- Built-in profiles cannot be deleted.

### Permission modes

1. With no permission rule matching a disposable workspace file, press `Alt+M` through Assistant, YOLO, Restricted, and back to Assistant.
2. In each mode, request the same harmless edit. Assistant automatically allows unruled workspace writes; Restricted asks before the unruled operation; YOLO allows it unless another security constraint blocks it.
3. Leave a non-default mode selected, restart surgent, and open or resume a session.

Expected: the status and notification identify each mode, behavior changes accordingly, and the last mode persists across restart. YOLO still obeys agent constraints, `.piignore`, and hard security blocks.

### Project instructions

1. Run `/init` in the fixture repository.
2. Review the documenter activity until it finishes, then inspect `AGENTS.md`.
3. Add a small project-specific fact to the repository and run `/init` again.

Expected: the documenter creates or updates repository-grounded `AGENTS.md`, reports completion, and leaves no documenter widget behind. Review the diff; reject invented commands or facts.

## Planning

These checks require a configured provider.

1. Run `/plan Add a harmless note to tracked.txt`.
2. Review the displayed plan, enter revision feedback, and confirm a revised plan appears.
3. Choose **Open plan in external editor**, verify that the file contains the displayed plan, close it without changes, then choose **Save and exit**. Record the plan ID shown by surgent. Use planner feedback, not the external editor, for the revision check.
4. Run `/plan` and select the saved plan. Exit, then resume directly with `/plan <plan-id>`.
5. Resume once more, choose **Implement this plan**, and confirm the plan is forwarded to the parent session.
6. Start another plan and cancel its review to exercise discard.
7. Start `/plan` and cancel the picker without selecting a plan.

Expected: planning runs in a separate persistent planner session; review, revision, external editing, save, list, and both resume paths preserve the plan. Forwarding delivers the final plan to the parent and discards its planning artifact. Discard removes the temporary plan output. Cancelling a picker or action returns cleanly without forwarding or changing repository files.

## Permissions and secret handling

### Permission decisions and policy scopes

Use a committed `tracked.txt`, a second disposable file, and `git diff --exit-code` or file hashes after denied actions.

1. Switch to Restricted mode with no matching allow rules and request an unruled workspace write. Choose **Yes** once; request it again and verify it asks again.
2. At the next prompt, choose a persistent allow option. Cycle its scope as shown by the dialog and save it for the project. Repeat the action.
3. Run `/permissions`, find the rule, restart surgent, confirm it still applies, then remove it and confirm the prompt returns.
4. Repeat with **No** and with dialog cancellation. Verify the target content is unchanged.
5. Add conflicting session, project, and global rules for a harmless file or command. Exercise the matching action and verify the more specific applicable rule wins. Remove all test rules afterward.
6. Create `.piignore` with `blocked/**`, place a file under that directory, and request read and write access in every mode.
7. Create a project-scoped custom agent with narrower file/Bash allowances than the permission rules and verify agent policy remains a limit.
8. From a non-interactive invocation, request an operation whose permission cannot be resolved without asking.

Expected: one-time choices do not persist; persistent rules survive at their selected scope and can be removed. Deny and cancel block the operation without mutation. Session, project, global, agent, and `.piignore` policy are all reflected in the decision; `.piignore` remains blocked even in YOLO. An unresolved headless request fails closed with an error instead of running.

### Redaction and blocked writes

1. Create an untracked fixture containing a fake classic GitHub token without storing a credential in this document. Do not list this file in `.piignore`:

   ```bash
   printf 'ghp_%036d\n' 0 > fake-secret.txt
   ```

2. In a profile allowed to access that fixture, ask the agent to expose it separately through `read`, `grep`, and `bash`.
3. Ask the agent to create a new file containing the same value with `write`.
4. Put harmless baseline text in another file and ask the agent to insert the value with `edit`.
5. Compare both files with their baselines outside the TUI.

Expected: supported read, grep, and Bash tool results replace the token with a redaction marker. Write and edit calls report that secrets were detected; neither target contains the fake token and the edited baseline is unchanged.

## Checkpoints, subsessions, and cleanup

### Checkpoint restore and fork inheritance

1. Commit the baseline. Over at least two agent turns, make distinct edits through `write` or `edit` and note the content after each turn.
2. Use the session tree navigation to move to an earlier turn. Choose **No, keep current code** at the restore prompt.
3. Navigate again and choose **Yes, restore code to that point**.
4. Return to a later point or fork from an earlier entry. In the fork, repeat the restore choice and make another tool edit.

Expected: choosing **No** changes conversation position but preserves current files. Choosing **Yes** restores the matching snapshot and reports `Code restored to checkpoint`. A fork inherits checkpoints for its retained parent branch and can create new checkpoints. Uncommitted user changes not represented by a checkpoint must not be assumed recoverable.

### Stale state cleanup

1. In the temporary environment, create and finish a saved plan and a normal session with checkpoints. Exit cleanly and back up `$HOME/.pi` and the repository `.pi` for later comparison.
2. Create another plan/session, exit cleanly, and resume it so it is the current active state while cleanup runs.
3. Open the session picker with `node "$SURGENT_ROOT/bin/surgent.js" --resume` and delete the first owner session, leaving its plan/checkpoint data orphaned. Start surgent again.
4. Inspect the live temporary stores and compare them with the backup after startup.

Expected: data associated with the active main session or active subsession remains usable. Orphaned checkpoint and subsession data is removed asynchronously without deleting active state or making the parent session unusable.

### Subagents

1. Ask the configured main agent to delegate a bounded read-only task to `scout`; check the returned result and displayed usage.
2. Ask for a persistent planning journey with `/plan`, exit, and resume it by ID.
3. Start a deliberately longer subagent task and cancel it through the TUI.
4. Trigger a safe failure, such as naming an unavailable custom agent, then send a normal parent prompt.

Expected: successful delegation returns the specialist's result, reports usage, and cleans up its temporary subsession. Cancellation and failure terminate the child cleanly, surface an error, and leave the parent responsive. Planner subsessions, unlike temporary subagents, remain resumable until forwarded or discarded.

## Code navigation and optimization

1. Add small valid TypeScript, Python, Go, Java, or Rust fixtures with nested and public symbols, track them with `git add`, then start or restart surgent. After handling any startup grammar prompt, ask the agent to run `code_map` on them, then `inspect` an exact returned symbol.
2. Ask for an invalid or ambiguous symbol and verify the error is useful; then inspect a valid symbol to confirm recovery.
3. Produce repeated and large local command output, repeated grep matches, and overlapping reads. Continue the conversation, exit, and resume it.
4. In a repository with tracked files requiring a supported Tree-sitter grammar not already cached, start or restart surgent. Accept the startup install prompt once; repeat in a separate temporary home and decline. Then invoke `code_map` in each case. Calling `code_map` alone does not trigger installation.

Expected: with the required grammar installed, `code_map` reports matching symbols and `inspect` returns only the selected body. Repeated or large output is compacted without losing the meaningful result; overlapping old results are pruned and the resumed session remains usable. Grammar consent is remembered per repository; acceptance installs only missing grammars in the temporary home, while decline performs no install and is remembered. A declined, uncached grammar produces an unavailable-grammar error rather than an implicit install. Grammar installation can access the package registry.

## MCP

Prefer the repository's local stdio fixture. In `/mcp`, configure a project server with transport `stdio`, command `node`, arguments containing the absolute path to `$SURGENT_ROOT/test/fixtures/mcp-server.mjs`, and fake environment value `MCP_FIXTURE=manual`.

1. Add the stdio server, list its tools, and call `environment` with a small argument object.
2. Edit its arguments, working directory, environment, description, and enabled state. Restart and list/call again.
3. Start a trusted Streamable HTTP MCP fixture bound only to loopback, add it as a Remote server, then list and call one inert tool.
4. Try malformed configuration, an unreachable loopback URL, and a fixture that exits. Cancel once during add and once during edit.
5. Disable and remove both servers, then exit surgent after a connection has been used.

Expected: add, edit, enable/disable, persistence, list, call, and remove work at project scope. The stdio result reflects the fake argument, cwd, and environment. HTTP never requires an external endpoint. Invalid or unavailable transports show errors without corrupting saved configuration; cancellation leaves prior configuration unchanged. Shutdown disposes used transports and exits cleanly.

## Web tools

Use fake keys for credential UI checks. Use real credentials only in a separate optional provider journey, supplied through the supported credential store and removed afterward.

1. Run `/web-login`, select each relevant provider, and save a fake key. Confirm input and subsequent status never display the complete value.
2. Replace one key, restart, confirm its configured status persists, then clear it and confirm removal.
3. With an optional configured provider, run `web_search` and `web_fetch` for public, non-sensitive content. Fetch the same URL again to exercise cache use.
4. Exercise a configured provider fallback or unavailable-provider path, then an invalid URL or controlled provider failure.
5. Inspect TUI output and saved session text for accidental key disclosure.

Expected: set, change, masked status, persistence, and removal behave consistently. Search and fetch return normalized results; repeat fetch can use cached content. Fallback or failure is explicit and leaves the session usable. No credential appears in tool output, errors, or persisted session content. These optional calls can use external network and incur provider usage.

## Questionnaire and input modes

### Questionnaire

Ask a configured agent to call `questionnaire` with one single-choice question, one multi-choice question with limits, and one freeform question.

1. Navigate between questions and the review tab; switch between option and text input.
2. Complete valid single, multi, and freeform answers and submit from review.
3. Repeat with an incomplete required answer or an invalid number of multi-select choices.
4. Open another questionnaire and cancel it.

Expected: selections and freeform text survive tab changes, validation prevents an invalid submission, review shows all answers, valid submission returns the structured answers, and cancellation returns control without a partial answer.

### Prompt and Bash input

1. Type recognizable text without submitting it. Press `Ctrl+Alt+B` through prompt, context-included Bash, normal Bash, and back to prompt.
2. Submit a harmless command in each Bash mode, then submit a normal prompt.
3. Also test one-shot `!command` and `!!command` entry, including backspacing an empty prefix.
4. Restart after leaving a mode selected.

Expected: cycling preserves the current editor text. Included Bash output enters model context; normal Bash output does not. One-shot prefixes return to prompt after submission. The shortcut-selected mode remains active for subsequent submissions in that process; a new process starts in prompt mode.

## Dialog and terminal quality pass

Repeat representative agent, plan, permission, MCP, web-login, and questionnaire dialogs in a narrow terminal and with enough entries or content to require scrolling.

Check all of the following:

- keyboard focus moves to the active field and returns after nested dialogs;
- arrow, Tab, Enter, Escape, and documented modifier keys affect only the focused control;
- long lists and plan content scroll without hiding the selected row or input;
- narrow rendering remains readable and ANSI styling does not leak raw escape sequences;
- cancellation returns to a usable parent screen and does not save partial changes; and
- exiting from each dialog, an idle prompt, and after a cancelled child operation shuts down cleanly without a hung process or orphaned local fixture.

Do not automate this pass with sleeps or terminal timing. Observe behavior directly.

## Cleanup

Exit all surgent processes and stop local MCP or HTTP fixtures. Then remove only the temporary root created above:

```bash
cd /
rm -rf -- "$SURGENT_MANUAL_ROOT"
exit
```

If you exported provider credentials specifically for this run, unset them and verify any test key was removed through `/web-login`. Keep only the test notes needed for the report; do not preserve fake credential stores or temporary session data.
