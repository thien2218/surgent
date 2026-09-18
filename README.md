# surgent

**A terminal coding agent that keeps context focused, delegates specialized work, and puts you in control of every change.**

surgent works inside an existing repository. Give it an engineering task and it can inspect the codebase, make a plan, edit files, run commands and tests, research the web, and report the result without forcing you to manage the agent's internal machinery.

It is designed for software engineers who want an agent that feels at home in a terminal: direct enough for quick fixes, structured enough for multi-step work, and careful enough for real repositories.

## Why surgent

- **More useful context.** surgent navigates code structurally and reduces repetitive tool output so the model can spend more of its context on the task.
- **Repository-grounded work.** Project instructions, source files, command output, and session history stay connected to the work at hand.
- **Specialists when they help.** Built-in agents cover implementation, planning, codebase research, and documentation. The main agent can delegate focused work instead of filling one conversation with every detail.
- **Plans that do not crowd the coding session.** Explore and refine a plan in a separate session, then hand the finished plan back for implementation.
- **Explicit safety controls.** Review actions as they happen, save reusable permission rules, block sensitive paths, or switch modes when you need more or less autonomy.
- **Recoverable edits.** In Git repositories, surgent checkpoints edits made through its file tools and can restore the corresponding code state when you rewind or fork a session.
- **Model freedom.** Use models from Google, Anthropic, OpenAI, OpenRouter, Bedrock, and many other supported providers.
- **Extensible tooling.** Connect local or remote MCP servers and give the agent access to web search and URL fetching.

## What you can do

surgent is useful anywhere the task is easier to describe than to execute manually:

```text
Find the race condition behind the flaky queue tests, fix the root cause,
and run the smallest test set that proves the behavior.
```

```text
Trace how authentication state reaches the API client. Explain the current
design and identify places where an expired token can still be used.
```

```text
Add CSV export to the reporting command. Follow existing CLI conventions,
update tests, and document the new flag.
```

```text
Review this branch for correctness regressions. Do not modify files.
```

## Requirements

- Node.js 22.19 or newer

## Install

Install surgent globally from npm:

```bash
npm install -g surgent
```

Confirm the command is available:

```bash
surgent --version
```

**Starting surgent**

From the repository you want to work on, run:

```bash
cd /path/to/your-project
surgent
```

**Update or remove**

```bash
npm install -g surgent@latest  # update
npm uninstall -g surgent       # remove
```

## Optimizer package

surgent includes [`pi-context-optimizer`](https://www.npmjs.com/package/pi-context-optimizer), a standalone Pi extension for structural code navigation and automatic context cleanup. Install it separately when using Pi without surgent; package page covers features and setup.

## Connect a model

surgent defaults to the Google provider. The quickest setup is a Gemini API key:

```bash
export GEMINI_API_KEY="your-api-key"
surgent --provider google
```

Other common choices work the same way:

| Provider   | Environment variable | Start command                   |
| ---------- | -------------------- | ------------------------------- |
| Anthropic  | `ANTHROPIC_API_KEY`  | `surgent --provider anthropic`  |
| OpenAI     | `OPENAI_API_KEY`     | `surgent --provider openai`     |
| OpenRouter | `OPENROUTER_API_KEY` | `surgent --provider openrouter` |

List models available to your current installation:

```bash
surgent --list-models
```

Select a model directly with a provider-qualified model ID:

```bash
surgent --model <provider>/<model-id>
```

Provider keys are secrets. Keep them in your shell environment or a secret manager, never in the repository.

## Quick start

For a new repository, initialize concise project instructions first:

```text
/init
```

`/init` inspects the repository and creates or updates `AGENTS.md` with verified commands, architecture notes, conventions, and project-specific guidance. Future sessions automatically benefit from those instructions.

Then describe the outcome you want:

```text
Add input validation to the user creation endpoint. Match the existing error
format, add focused tests, and run them.
```

surgent will inspect the relevant code, ask for permission where required, make the changes, validate them, and summarize the result.

## Everyday workflows

### Start with a task

Open the interactive TUI with an initial request:

```bash
surgent "Find and fix the failing type check in the billing module"
```

Name a longer-running session so it is easy to find later:

```bash
surgent --name "Refactor billing retries"
```

### Plan before editing

Use a separate planning session for work that spans components or has unclear tradeoffs:

```text
/plan Replace the in-memory job scheduler with a durable queue
```

You can review the plan, send feedback, save it for later, or forward the final version into the main session for implementation.

Run `/plan` with no arguments to list saved plans. Resume one by selecting it or passing its plan ID:

```text
/plan <plan-id>
```

### Run a one-shot task

Use print mode in scripts or for short, non-interactive work:

```bash
surgent -p "Summarize the public API exposed by src/client"
```

### Perform a read-only review

Limit the active tools to read-only operations:

```bash
surgent --tools read,grep,find,ls -p \
	"Review src/auth for correctness and security regressions"
```

### Include files in the first message

Prefix a path with `@` to attach text, images, or other relevant files:

```bash
surgent @spec.md @architecture.png "Implement the first milestone"
```

### Resume previous work

Continue the most recent session:

```bash
surgent --continue
```

Choose from saved sessions:

```bash
surgent --resume
```

Sessions can also be forked, exported to HTML, or started without persistence. Run `surgent --help` for the complete set of session options.

### Run shell commands from the TUI

Start input with `!` to run a shell command and include its result in the conversation:

```text
!npm test
```

Start with `!!` to run a command without adding its result to model context:

```text
!!git status
```

Use `Ctrl+Alt+B` to cycle persistently between prompt input, context-included shell input, and regular shell input.

## Interactive commands

| Command                 | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `/init`                 | Create or update repository-specific `AGENTS.md` instructions |
| `/plan [request]`       | Start, refine, save, or resume an isolated planning session   |
| `/agent`                | Select, create, edit, or remove agent profiles                |
| `/permissions`          | View and manage file, shell, web, and MCP permission rules    |
| `/mcp`                  | Add, edit, enable, disable, or remove MCP servers             |
| `/web-login [provider]` | Configure credentials for web search and fetch providers      |

The bundled agent profiles cover these common roles:

| Agent        | Best for                                                            |
| ------------ | ------------------------------------------------------------------- |
| `general`    | Implementation, debugging, tests, and command-heavy repository work |
| `planner`    | Repository-grounded plans for complex changes                       |
| `scout`      | Read-only codebase research and execution tracing                   |
| `documenter` | User-facing Markdown and project documentation                      |

Use `/agent` to start a new session with a specialist or create a project-specific or global profile. Profiles can constrain tools, files, shell commands, MCP servers, models, and thinking levels.

## Command-line essentials

| Option                    | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `-p`, `--print`           | Process a prompt non-interactively and exit   |
| `-c`, `--continue`        | Continue the previous session                 |
| `-r`, `--resume`          | Select a saved session                        |
| `--name <name>`           | Give a session a memorable name               |
| `--provider <name>`       | Select a model provider                       |
| `--model <pattern>`       | Select a model or provider-qualified model ID |
| `--thinking <level>`      | Set the model thinking level                  |
| `--tools <names>`         | Enable only the listed tools                  |
| `--exclude-tools <names>` | Disable selected tools                        |
| `--no-session`            | Run without saving session history            |
| `--offline`               | Disable startup network operations            |
| `--export <file>`         | Export a session as HTML                      |

Run `surgent --help` for all options, supported credential environment variables, and examples.

## Permissions and safety

surgent has three permission modes. Press `Alt+M` to cycle between them:

| Mode       | Behavior                                                           |
| ---------- | ------------------------------------------------------------------ |
| Assistant  | Prompts when an action is not already covered by a permission rule |
| YOLO       | Runs actions allowed by the active agent without prompting         |
| Restricted | Limits actions to explicitly allowed access                        |

Use `/permissions` to manage reusable rules for:

- File reads and writes
- Shell commands
- Web requests
- MCP tool calls

Rules can apply to the current session, the current project, all projects, or permanently. More specific rules take precedence.

### Keep paths out of agent reach

Add sensitive or irrelevant paths to `.piignore`:

```gitignore
.env*
secrets/**
production-data/**
```

Negated patterns can re-include a safe example:

```gitignore
secrets/**
!secrets/example.env
```

On the first run in a repository, surgent uses an existing `.gitignore` as the starting point for `.piignore`. Ignored paths are blocked from file access even in YOLO mode.

surgent also keeps its project-local `.pi` working data out of Git through the repository's local exclude file. Checkpoints complement Git; they are not a replacement for commits, branches, or backups.

## MCP and web access

### Connect MCP servers

Run `/mcp` and choose **Add MCP server**. surgent supports:

- Local servers launched over standard input/output
- Remote servers reached over HTTP
- Project-scoped or global configurations

New servers are disabled until you enable them. In the MCP list, press `Tab` to enable or disable a server; surgent checks the connection before enabling it.

### Configure web providers

surgent can search the web and fetch public URLs when a task needs current documentation or external context. Run `/web-login` to configure optional provider credentials for Tavily, Brave Search, Firecrawl, or Jina.

Web and MCP actions pass through the same permission system as file and shell operations.

## Tips for better results

- Describe the outcome, constraints, and validation you expect. A task such as "fix login" leaves more ambiguity than "reject expired refresh tokens, preserve the existing error shape, and run the auth tests."
- Let surgent inspect before prescribing a patch. Existing abstractions and tests often point to a smaller solution.
- Use `/plan` when a change spans several systems or needs a design decision.
- Use a read-only tool set for audits and reviews.
- Put stable repository facts in `AGENTS.md`; keep one-off task details in the prompt.
- Commit or stash valuable work before enabling YOLO mode or requesting broad changes.

## Troubleshooting

### `surgent: command not found`

Confirm npm's global binary directory is on your `PATH`, then open a new shell.

### No models are available

Check that the provider's environment variable is set in the same shell, then inspect matching models:

```bash
surgent --list-models <search>
```

You can also check whether a configured provider is ready:

```bash
surgent auth check --provider <provider>
```

### A file cannot be read or edited

Check `.piignore`, the active agent's file limits, the current permission mode, and saved rules under `/permissions`. Path blocks in `.piignore` remain active in every mode.

### An MCP server has no tools

Open `/mcp`, verify the command or URL, and enable the server with `Tab`. A server must pass its connection check before surgent makes its tools available.

## Development

For source development, install dependencies and link the local command:

```bash
pnpm install
npm link
```

`pnpm build` builds only the distributable optimizer package in `dist/optimizers`. npm runs this build automatically through `prepack` when packaging surgent.

To publish the standalone optimizer artifact after building it:

```bash
npm publish ./dist/optimizers --access public
```

## Reference

surgent is built on [Pi](https://github.com/earendil-works/pi), created by [Mario Zechner](https://github.com/badlogic) and developed by its maintainers and contributors. Pi provides the agent runtime, TUI, model integration, extension system, and SDK that make surgent possible.

Refer to the upstream repository for Pi installation, configuration, providers, extension APIs, SDK usage, and other runtime documentation.

- [Pi repository](https://github.com/earendil-works/pi)
- [Pi coding agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
- [Pi documentation](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs)
- [Pi contributors](https://github.com/earendil-works/pi/graphs/contributors)

## License

surgent is available under the [MIT License](LICENSE).
