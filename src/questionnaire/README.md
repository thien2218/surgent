# questionnaire

## Purpose

The `questionnaire` extension gives the agent a structured way to ask focused clarifying questions through the interactive UI instead of guessing.

## Public surface

Tool:

- `questionnaire`

This extension does not register commands.

## How it works

1. The tool validates the incoming question list against a TypeBox schema.
2. If no interactive UI is available, it returns a cancelled-style result rather than attempting to render the UI.
3. The question list is normalized into an internal form with resolved defaults.
4. The interactive component supports:
   - freeform text answers
   - single-select options
   - multi-select options
   - exclusive options
   - minimum and maximum selection limits
   - recommended option counts
5. After completion, the tool returns:
   - `cancelled`
   - ordered `questions`
   - ordered `answers`
6. The tool content also includes readable `Qn` and `An` text for model context.

## Key files

- `index.ts` — tool definition, prompt guidance, and result rendering
- `types.ts` — public schemas and internal question-state types
- `helpers.ts` — normalization, validation, toggle behavior, answer serialization, and summarization
- `component.ts` — interactive questionnaire UI component

## Data and persistence

This extension has no dedicated persistence.

## Dependencies and integration

- `commands` and `subsession` can hand questionnaire interactions back to the parent UI
- pairs with the main agent flow when the answer changes the next step or scope

## Edge cases and guardrails

- non-UI sessions return a safe text result instead of throwing
- cancellation is explicit in the result details
- multi-select validation enforces minimum and maximum constraints
- exclusive options clear other selections when chosen

## Manual test checklist

- run a single freeform question
- run a single single-select question
- run a single multi-select question with an exclusive option
- configure minimum and maximum selections and verify the validation messages
- cancel the questionnaire and verify that a cancelled result is returned
