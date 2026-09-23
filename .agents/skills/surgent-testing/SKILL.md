---
name: surgent-testing
description: Standards for writing and reviewing tests in surgent. Use when adding, changing, debugging, or reviewing tests.
---

# Testing surgent

## Prove behavior worth protecting

Treat a test as the cheapest executable proof of a meaningful behavior. Start by naming a plausible regression and the observable guarantee that would catch it. If there is no clear, meaningful regression, skip the test. More tests are not automatically better: every test adds execution time, review work, and future maintenance.

Prefer tests that survive refactoring. Observe values returned through public functions, extension registrations, emitted results, persisted files, process status, or other supported boundaries. Do not preserve private call sequences, incidental object shapes, or the current decomposition of modules unless those details are themselves a compatibility contract.

Use the lowest sufficient layer. A focused test usually gives faster and more diagnostic failures than a broad one. When it fails, its name and assertions should identify the broken guarantee without requiring the reader to reconstruct the implementation.

Before writing a test, answer:

1. What realistic defect would this test catch?
2. What can a caller or user observe when the behavior is correct?
3. What is the lowest layer that proves that guarantee faithfully?
4. Will the proof remain useful after an internal refactor?
5. Is its diagnostic value worth its maintenance cost?

## Select one primary layer per behavior

Assign a testing layer to each behavior, not to a feature, module, source file, or test file. One module or feature can need unit, contract, and integration tests for different guarantees. Split the coverage plan into observable behaviors first, then choose the lowest sufficient layer for each behavior from the boundary it crosses, not from the source directory being changed.

- **Unit:** Use for deterministic functions or small components whose dependencies can be supplied directly. This is the default for parsing, matching, normalization, transformations, and state transitions without meaningful I/O.
- **Contract:** Use when surgent registers or communicates through Pi's `ExtensionAPI`. Exercise the registered tool, command, event handler, metadata, result shape, or lifecycle through the public Pi-facing shape.
- **Integration:** Use when correctness depends on real local I/O or collaboration among several surgent modules. Exercise a temporary filesystem, disposable Git repository, child process, loopback HTTP server, or local MCP transport.
- **End to end (E2E):** Use only when the guarantee depends on launching the CLI as a user would. Keep these tests few because process and terminal boundaries make failures slower and less precise.

Do not repeat the same behavioral guarantee at multiple layers. Similar assertions can appear at different layers when they prove distinct guarantees, such as a parser returning a denial and a registered Pi handler propagating that denial. Name that distinction explicitly in coverage plans. Add a higher-layer test only when it proves wiring, serialization, lifecycle, process behavior, or another guarantee unavailable below. If a defect can be reproduced completely in a unit test, an E2E test alone is too broad.

**Note**: surgent extensions mostly work in isolation, each extension are made up of one or more modules that can depend on one another. So a module does not refer to an extension.

## Write clear Vitest tests

Name test files `*.test.ts`. Import Vitest APIs explicitly; globals are not configured.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
```

Follow the repository's NodeNext ESM setup. Use ESM syntax and include `.js` extensions in relative source imports, even when importing a TypeScript source file.

Use behavior-focused test names that state the condition and result, such as “blocks a write outside the allowed root.” Do not use only a function name, implementation detail, or issue number. Keep each test about one behavior; multiple assertions are appropriate when together they describe one outcome.

Arrange inputs and resources, perform the action, then assert the result. Blank lines usually communicate arrange/act/assert more clearly than comments. Use table tests when cases share setup, action, and rule. Split them when distinct setup or explanations would make failures easier to diagnose.

Assert only the contract-relevant fields of large values. Prefer direct assertions for small values, decisions, and errors. Keep inputs explicit and use unmistakably fake credentials and secrets.

## Control boundaries without recreating systems

Mock boundaries outside surgent when a unit test needs control: Pi capabilities, provider SDKs, remote `fetch` calls, remote transports, or process execution. Avoid mocking neighboring surgent modules merely to isolate the subject. Such mocks bind a test to module wiring and can allow broken collaboration to pass.

For Pi contracts, load the extension with a typed fake `ExtensionAPI`. Capture the tools, commands, and event handlers it registers, then invoke them through the public shapes Pi uses. Type the fake against the installed Pi API where practical so upstream type changes are visible.

A fake `ExtensionAPI` is a recording boundary, not a second Pi runtime. Give it only the capabilities the extension needs, such as command registration, event subscription, UI responses, or message dispatch. Fail unexpected calls with a useful message. Do not imitate Pi's routing, schema validation, or lifecycle engine.

Use real local boundaries in integration tests:

- a fresh temporary directory for filesystem behavior;
- a disposable Git repository with repository-local identity;
- a loopback server on an operating-system-assigned port for HTTP;
- a local MCP server or transport for MCP behavior;
- a real child process when process behavior is the contract.

Never operate on the checkout running the suite. Never contact an external service.

## Make isolation and cleanup unavoidable

Tests must produce the same result independently of order and under concurrent execution. Do not depend on the contributor's machine, home directory, credentials, locale, or wall-clock speed.

Restore environment variables exactly, preserving whether each value was absent or empty. Isolate `cwd` and `HOME` when code reads process or user state, and always restore `cwd`. Avoid mutable module-level fixtures.

Use fake timers for retries, debounce, expiry, and delayed cleanup, then restore real timers. Supply deterministic IDs only when exact values form the contract; otherwise assert their shape. Let the operating system select ports.

Never use sleeps to coordinate readiness or concurrency. Synchronize with promises, barriers, listening events, stream events, or another observable completion signal. For cancellation, coordinate active work, abort explicitly, and verify both propagation and disposal. Also cover cancellation before work starts when the API supports it.

Register teardown immediately after acquiring a resource. Release temporary directories, handles, servers, MCP clients, streams, subscriptions, and child processes after setup or assertion failures. Cleanup must tolerate partial initialization and must not hide the original failure.

## Keep test data intentional

Use a small static fixture when an input is clearer as a file. Fixtures must be inert and independent of absolute paths, time, network access, credentials, and the contributor's home directory.

Use a factory for variations or mutable state. Give it valid defaults and override only fields relevant to the behavior. Do not build universal factories whose defaults conceal required setup or important distinctions.

Prefer the smallest input that demonstrates the rule. Include edge cases at meaningful partitions, not arbitrary combinations. When malformed input, unavailable dependencies, partial writes, or interruption matter, verify the resulting state and cleanup as well as the error.

Assert a stable error category or a durable message fragment. Avoid exact stack traces and incidental wording. A negative-path test should prove what is rejected, what remains unchanged, and which resources are released.

## Enforce security fail-closed

Permission and redactor tests must demonstrate fail-closed behavior. Ambiguous, malformed, missing, or unavailable security state must not grant access or expose content.

For permissions, distinguish allowed, blocked, and ask outcomes where applicable. Cover precedence, path boundaries, unresolved commands, and mixed operations when they can change the decision. A parser failure or unknown operation must not become implicit permission.

For redaction, prove that supported outputs do not reveal secrets and that secret-bearing writes or edits are blocked where required. Test relevant encoding or boundary variations without placing real secrets in source, output, failure messages, or snapshots. Security decisions should use targeted assertions, not broad snapshots.

## Limit snapshots

Use a snapshot only when a stable, structured, multi-line representation is clearer than focused assertions. Do not snapshot large object graphs, sessions, error stacks, security decisions, or raw secrets.

Normalize volatile values before comparison, including ANSI sequences, line endings, temporary paths, path separators, ports, timestamps, and random IDs. Review a snapshot change as a behavior change. Never update snapshots merely to make a failure disappear.

## Keep E2E offline; check TUI behavior manually

Launch E2E processes in a temporary workspace with explicit `cwd` and isolated `HOME`. Force offline operation, including `PI_OFFLINE=1` when the launched Pi runtime recognizes it. Remove provider API keys and stored credential paths from the child environment. E2E tests must not require an account or make provider calls.

Keep full interactive TUI validation manual. For a TUI change, use a disposable repository and check only affected concerns: keyboard navigation, focus restoration, cancellation, permission prompts, scrolling, narrow layouts, ANSI rendering, and clean shutdown. Automate the stable state and contracts beneath the UI instead of terminal timing.

## Capture regressions economically

For a defect, first reduce it to the smallest input that reproduces the user-visible failure. Add a failing test at the lowest sufficient layer, fix the defect, and confirm the test passes. Name the regression after the protected guarantee, not the issue or the old implementation. Add a boundary-level test only if boundary wiring contributed to the defect.

Run the complete suite:

```bash
pnpm test
```

The script runs `vitest run --passWithNoTests`. The flag lets intentionally empty selections succeed; it is not a reason to omit a meaningful test.

Run one file or directory while iterating:

```bash
pnpm exec vitest run test/unit/permission
```

Type-check separately:

```bash
pnpm tsc --noEmit
```

## Avoid brittle tests

Do not write tests that:

- replace adjacent surgent modules and assert mock call order;
- depend on execution order, shared mutable state, the checkout, or the real `HOME`;
- wait with sleeps, bind fixed ports, or rely on timing thresholds;
- contact providers or consume developer credentials;
- assert private methods or incidental object details;
- use broad snapshots where direct assertions explain the guarantee;
- catch an error without checking state and cleanup;
- pass only because an empty selection is accepted.

## Review checklist

- Does the test protect a plausible regression and observable guarantee?
- Is it at the lowest layer that proves the behavior without duplicate assertions elsewhere?
- Will it survive an internal refactor and fail diagnostically?
- Are external boundaries controlled without mocking neighboring surgent modules?
- Are filesystem, environment, `cwd`, `HOME`, time, ports, and credentials isolated?
- Does teardown run after setup or assertion failure?
- Are errors, cancellation, concurrency, or fail-closed cases covered when relevant?
- Are fixtures and factories minimal, explicit, and free of hidden state?
- Are snapshots limited, normalized, reviewed, and secret-free?
- Can the test run offline, concurrently, and independently?
