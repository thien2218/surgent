import type { CommandContext, GitCommandResult } from "./types.js";

function formatCommand(command: string, argumentsList: string[]) {
  const quotedArguments = argumentsList.map((argumentValue) =>
    /\s/.test(argumentValue) ? JSON.stringify(argumentValue) : argumentValue,
  );
  return [command, ...quotedArguments].join(" ");
}

function formatCommandFailure(
  command: string,
  argumentsList: string[],
  result: GitCommandResult,
): string {
  const stderrOutput = result.stderr.trim();
  const stdoutOutput = result.stdout.trim();
  const output = stderrOutput || stdoutOutput || "No command output.";
  return `${formatCommand(command, argumentsList)} (exit ${result.code})\n${output}`;
}

export async function executeCommand(
  context: CommandContext,
  command: string,
  argumentsList: string[],
): Promise<GitCommandResult> {
  try {
    return await context.pi.exec(command, argumentsList, {
      cwd: context.cwd,
      signal: context.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to start command: ${formatCommand(command, argumentsList)}\n${message}`,
    );
  }
}

export async function executeCommandOrThrow(
  context: CommandContext,
  command: string,
  argumentsList: string[],
  actionDescription: string,
): Promise<GitCommandResult> {
  const result = await executeCommand(context, command, argumentsList);
  if (result.code !== 0) {
    throw new Error(
      `${actionDescription}\n${formatCommandFailure(command, argumentsList, result)}`,
    );
  }
  return result;
}

export async function resolvePreferredRemoteName(context: CommandContext): Promise<string> {
  const result = await executeCommandOrThrow(
    context,
    "git",
    ["remote"],
    "Failed to list git remotes.",
  );

  const remoteNames = result.stdout
    .split(/\r?\n/)
    .map((remoteName) => remoteName.trim())
    .filter(Boolean);

  if (remoteNames.length === 0) {
    throw new Error(
      "No git remotes found. Add a remote (for example: origin) before using code_diff.",
    );
  }
  if (remoteNames.includes("origin")) {
    return "origin";
  }

  return remoteNames[0] as string;
}

export async function resolveLocalCommit(
  context: CommandContext,
  reference: string,
): Promise<string | null> {
  const result = await executeCommand(context, "git", [
    "rev-parse",
    "--verify",
    "--quiet",
    `${reference}^{commit}`,
  ]);

  if (result.code !== 0) return null;
  const resolvedCommitHash = result.stdout.trim();
  return resolvedCommitHash ? resolvedCommitHash : null;
}

export async function fetchFromRemote(
  context: CommandContext,
  remoteName: string,
  remoteReference: string,
  label: string,
): Promise<void> {
  await executeCommandOrThrow(
    context,
    "git",
    ["fetch", "--no-tags", "--quiet", remoteName, remoteReference],
    `Failed to fetch ${label} from remote ${remoteName}.`,
  );
}

export async function resolveHashCommit(
  context: CommandContext,
  hashInput: string,
  hashLabel: string,
  remoteName: string,
): Promise<string> {
  const localCommitHash = await resolveLocalCommit(context, hashInput);
  if (localCommitHash) {
    return localCommitHash;
  }

  await fetchFromRemote(context, remoteName, hashInput, `${hashLabel} ${hashInput}`);
  const fetchedCommitHash =
    (await resolveLocalCommit(context, hashInput)) ??
    (await resolveLocalCommit(context, "FETCH_HEAD"));

  if (!fetchedCommitHash) {
    throw new Error(`Unable to resolve ${hashLabel}: ${hashInput}.`);
  }

  return fetchedCommitHash;
}

export async function getGithubRepoWithOwner(context: CommandContext): Promise<string> {
  const result = await executeCommandOrThrow(
    context,
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    "Failed to resolve GitHub repository with gh. Ensure gh is installed and authenticated.",
  );

  const repoWithOwner = result.stdout.trim();
  if (!repoWithOwner) {
    throw new Error("gh returned empty repository metadata for current working directory.");
  }

  return repoWithOwner;
}

export async function getPrNumstatLines(
  context: CommandContext,
  repoWithOwner: string,
  prNumber: number,
): Promise<string[]> {
  const result = await executeCommandOrThrow(
    context,
    "gh",
    [
      "api",
      "--paginate",
      `repos/${repoWithOwner}/pulls/${prNumber}/files`,
      "--jq",
      '.[] | "\\(.additions)\\t\\(.deletions)\\t\\(.filename)"',
    ],
    `Failed to fetch file summary for PR #${prNumber} with gh.`,
  );

  return result.stdout
    .split(/\r?\n/)
    .map((lineText) => lineText.trim())
    .filter(Boolean);
}

export async function getPrPatch(context: CommandContext, prNumber: number): Promise<string> {
  const result = await executeCommandOrThrow(
    context,
    "gh",
    ["pr", "diff", String(prNumber), "--color", "never", "--patch"],
    `Failed to fetch patch for PR #${prNumber} with gh.`,
  );

  return result.stdout;
}
