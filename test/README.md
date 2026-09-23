# Testing surgent

This guide helps contributors choose, place, and run tests for surgent. Tests should provide confidence in behavior that users or integrations depend on while remaining fast, diagnostic, and resilient to internal refactoring.

## Testing approach

Start with the risk, not the implementation. Name the plausible regression, identify what a caller or user can observe, and choose the cheapest test that proves it. High-risk behavior—especially permission enforcement, secret redaction, lifecycle cleanup, persistence, and external boundaries—deserves stronger failure coverage than low-impact internals.

Use the **lowest sufficient test layer**:

- **Unit:** deterministic behavior with directly supplied dependencies.
- **Contract:** the public shape through which Pi interacts with an extension.
- **Integration:** real local I/O or collaboration among surgent modules.
- **End to end (E2E):** behavior that requires launching the CLI as a user would.

Do not repeat the same assertion at every layer. Higher layers should prove wiring, serialization, lifecycle, process behavior, or another guarantee unavailable below. Observe returned decisions, registrations, emitted results, files, or process status—not private methods or incidental call sequences.

## Test tree and ownership

The `test/` tree separates suites from reusable assets:

- **`helpers/`** owns shared utilities and focused factories. Do not hide behavior-relevant defaults in them.
- **`fixtures/`** owns small, static, portable inputs that are clearer as files. They must be inert and credential-free.
- **`unit/`** owns deterministic logic and small component suites. Mirror `src/` areas when useful.
- **`contracts/`** owns Pi-facing registrations, metadata, handlers, event responses, and lifecycle hooks.
- **`integration/`** owns real local-boundary and multi-module suites.
- **`e2e/`** owns process-level CLI startup and shutdown suites.

Keep suite-specific setup nearby. Promote only genuinely shared code to `helpers/`.

## Choosing a layer

### Unit tests

Use unit tests for parsing, matching, normalization, transformations, state transitions, and small UI components. surgent examples include resolving a permission decision from rules, checking path boundaries, parsing command input, or replacing detected secrets in text.

Supply dependencies directly. When control is needed, mock an external boundary such as a provider SDK, remote `fetch`, process execution, or Pi capability. Do not mock adjacent surgent modules merely to isolate the subject; that can hide broken collaboration.

### Contract tests

Use contract tests for Pi extensions. Load the extension with a typed recording fake for `ExtensionAPI`, capture the tools, commands, shortcuts, or event handlers it registers, and invoke them through the public shapes Pi uses. Examples include verifying that the MCP extension registers its command and tools, that a permission hook blocks a denied tool call, or that the redactor transforms supported tool results.

Use `helpers/extension.ts` to record registrations and retrieve required tools, commands, shortcuts, and individual event handlers. Supply additional Pi capabilities explicitly; unsupported calls and missing registrations fail. Keep extension-specific contexts and expected registration names in suite-specific setup. The helper does not dispatch events or recreate Pi's runtime.

### Integration tests

Use integration tests when correctness depends on real local I/O or cross-module behavior. Appropriate boundaries include a temporary filesystem workspace, a disposable Git repository, a child process, a loopback HTTP server, or a local MCP server or transport. For example, verify that persisted settings are read back correctly, that checkpoint behavior operates in a temporary repository, or that an MCP client connects and disposes through a local transport.

Keep remote services out. Use operating-system-assigned ports and readiness events rather than sleeps.

### E2E tests

Use E2E tests sparingly for guarantees that require the packaged entry point or full process lifecycle. CLI startup, argument handling, offline startup failure, exit status, and clean shutdown are suitable examples. Prefer contract or integration coverage for behavior below the process boundary, especially interactive TUI details that would otherwise depend on terminal timing.

## Writing durable tests

Name files `*.test.ts`. Use behavior-focused names that state the condition and result, such as `blocks a write outside the allowed root`. Test one observable guarantee at a time.

Import Vitest APIs explicitly:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
```

surgent uses NodeNext ESM. Include `.js` extensions in relative imports, including imports of TypeScript source files:

```ts
import { resolvePermission } from "../../src/permission/resolution.js";
```

Assert contract-relevant outcomes directly. Keep expected values small and explicit; avoid capturing entire sessions, object graphs, or error stacks. Never include real secrets in expected output.

## Isolation and cleanup

Every test must run offline, independently, and in any order. Isolate `HOME`, `cwd`, and a temporary workspace when code reads user or process state. Never modify the checkout.

Do not make provider calls, read credentials, or pass API keys to child processes. Use and restore fake timers for time-dependent behavior. Let the operating system choose ports. Register cleanup when acquiring resources, and release directories, servers, clients, streams, subscriptions, and child processes after failures too.

## Security regressions

Permission and redactor behavior is security-critical and must fail closed: ambiguous, malformed, missing, or unavailable state must not grant access or expose content. Permission tests should distinguish allowed, blocked, and ask outcomes, including precedence and path boundaries. Redactor tests should prove that outputs conceal fake secrets and secret-bearing writes or edits are blocked.

Place regressions at the lowest layer that reproduces the defect. Add boundary coverage only when wiring, persistence, or transport contributed. Assert security decisions directly rather than with snapshots.

## Run tests

Run the full suite:

```bash
pnpm test
```

Run a focused file or directory while iterating:

```bash
pnpm exec vitest run <path>
```

Type-check separately from the test run:

```bash
pnpm tsc --noEmit
```

## Contributor checklist

Before submitting a test change:

1. State the realistic regression and observable guarantee.
2. Choose the lowest layer that proves it without duplicate coverage.
3. Put the suite and supporting assets in their owning directories.
4. Control external boundaries without mocking neighboring surgent modules.
5. Cover relevant failures, cleanup, and fail-closed behavior.
6. Remove dependence on network access, credentials, machine state, fixed ports, and wall-clock timing.
7. Run the focused suite, the full suite, and the separate type-check.
