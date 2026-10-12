# Security Policy

## Supported versions

surgent is pre-1.0. Security fixes land in the latest release published to npm. Update with `npm install -g surgent@latest` before reporting.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/thien2218/surgent/security/advisories/new). Do not open a public issue, pull request, or discussion for a suspected vulnerability.

Include:

- `surgent --version` output and how you installed surgent
- The affected feature, such as a tool, command, or permission mode
- Steps to reproduce and the impact you observed
- Provider and model, if the issue depends on agent behavior

Use placeholder values instead of real API keys, tokens, or private code. Please allow time for a fix to be released before disclosing the issue publicly.

## Scope

surgent runs a model-driven agent with access to your files, shell, network, and MCP servers. Its safety controls are permission rules, permission modes, `.piignore`, and secret detection on file writes. Reports are in scope when surgent fails to enforce those controls, for example:

- File, shell, web, or MCP actions that run without a matching rule or prompt in Assistant or Restricted mode
- Reads or writes of paths blocked by `.piignore`
- Secrets written to files through the `write` or `edit` tools without being detected
- Exposure of stored credentials, such as web provider keys configured with `/web-login`
- Checkpoint restores that modify files outside the project

Out of scope:

- Actions the model takes within permissions you granted, including anything allowed in YOLO mode
- Prompt injection from files, web pages, or tool output, unless it bypasses the controls above
- Vulnerabilities in pi, model providers, or third-party MCP servers that surgent does not introduce
