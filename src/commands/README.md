# commands

## Purpose

The `commands` extension provides the user-facing `/plan` and `/review` workflows on top of reusable subsessions.

## Public surface

Commands:

- `/plan`
- `/review`

Hook:

- `tool_call` handoff for `questionnaire`

This extension does not register tools.

## How it works

### `/plan`

Input behavior:

- no arguments lists existing planning subsessions
- a UUIDv7 argument resumes the matching planning subsession
- any other text starts a new planning subsession with that text as the prompt

Flow:

1. The command parses the input.
2. It resolves or creates the planner subsession.
3. It renders a snapshot widget while the child session runs.
4. It enters the shared subsession loop.
5. The user can forward the plan to the main agent, revise it with feedback, discard it, or exit.

### `/review`

Input behavior:

- when arguments are present, the command starts a review from a freeform prompt
- when no arguments are present, it asks whether to review an open pull request or resume a prior review

Flow:

1. The command resolves the review source.
2. The optional pull request path calls `gh pr list --state open --json number,title`.
3. It builds a prompt such as “Review pull request #N. Focus on correctness, regressions, and actionable fixes.”
4. It starts or resumes the reviewer subsession.
5. It enters the shared subsession loop.

### Shared loop

Both commands use a helper loop that:

- resolves pending interaction handoff from the child session
- shows the action UI when the child session is done
- can forward child output to the main agent
- can feed follow-up input back into the child session
- can discard a stored subsession

## Key files

- `index.ts` — command registration and questionnaire handoff hook
- `plan.ts` — plan command parsing and planner subsession setup
- `review.ts` — review command flow and pull request picker
- `helpers.ts` — shared subsession loop, forwarding, discard, and picker helpers

## Data and persistence

This extension does not own storage directly.

It relies on `subsession` storage for:

- subsession metadata
- resume identifiers
- subsession output

## Dependencies and integration

- built on `subsession`
- uses `questionnaire` handoff through `emitInteractionHandoff`
- the pull request picker depends on `gh`
- forwarded output returns to the main agent flow

## Edge cases and guardrails

- both commands require an interactive UI
- an invalid or missing subsession ID produces a user-visible error
- pull request listing errors are surfaced through UI notifications
- the command loop always clears the widget on exit or error paths

## Manual test checklist

- run `/plan` with a prompt and continue the planner with follow-up feedback
- run `/plan` with no arguments and resume an older planner subsession
- run `/review` with a direct prompt
- run `/review` with no arguments and choose the pull request picker path
- forward planner or reviewer output to the main agent
- discard a stored subsession from the loop UI
