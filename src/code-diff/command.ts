import type { CommandRunner } from "./types.js";

export async function resolvePreferredRemoteName(runCommand: CommandRunner): Promise<string> {
  const result = await runCommand("git", ["remote"], "Failed to list git remotes.");

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
  runCommand: CommandRunner,
  reference: string,
): Promise<string | null> {
  const result = await runCommand("git", [
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
  runCommand: CommandRunner,
  remoteName: string,
  remoteReference: string,
  label: string,
): Promise<void> {
  await runCommand(
    "git",
    ["fetch", "--no-tags", "--quiet", remoteName, remoteReference],
    `Failed to fetch ${label} from remote ${remoteName}`,
  );
}

export async function resolveHashCommit(
  runCommand: CommandRunner,
  hashInput: string,
  hashLabel: string,
  remoteName: string,
): Promise<string> {
  const localCommitHash = await resolveLocalCommit(runCommand, hashInput);
  if (localCommitHash) {
    return localCommitHash;
  }

  await fetchFromRemote(runCommand, remoteName, hashInput, `${hashLabel} ${hashInput}`);
  const fetchedCommitHash =
    (await resolveLocalCommit(runCommand, hashInput)) ??
    (await resolveLocalCommit(runCommand, "FETCH_HEAD"));

  if (!fetchedCommitHash) {
    throw new Error(`Unable to resolve ${hashLabel}: ${hashInput}.`);
  }

  return fetchedCommitHash;
}

export async function getGithubRepoWithOwner(runCommand: CommandRunner): Promise<string> {
  const result = await runCommand(
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
  runCommand: CommandRunner,
  repoWithOwner: string,
  prNumber: number,
): Promise<string[]> {
  const result = await runCommand(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${repoWithOwner}/pulls/${prNumber}/files`,
      "--jq",
      '.[] | "\\(.additions)\\t\\(.deletions)\\t\\(.filename)"',
    ],
    `Failed to fetch file summary for PR #${prNumber} with gh`,
  );

  return result.stdout
    .split(/\r?\n/)
    .map((lineText) => lineText.trim())
    .filter(Boolean);
}

export async function getPrPatch(runCommand: CommandRunner, prNumber: number): Promise<string> {
  const result = await runCommand(
    "gh",
    ["pr", "diff", String(prNumber), "--color", "never", "--patch"],
    `Failed to fetch patch for PR #${prNumber} with gh`,
  );

  return result.stdout;
}
