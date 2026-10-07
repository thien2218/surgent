import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cliPath, modelArgs, setupCli } from "../helpers/cli.js";

describe("real CLI arguments", () => {
  it("prints Surgent help without initializing the workspace", async () => {
    const fixture = await setupCli();

    const result = await fixture.run(process.execPath, [cliPath, "--help"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("surgent");
    expect(result.stdout).toContain("--mode");
    expect(result.stdout).not.toMatch(/\bpi --/);
    expect(await readdir(fixture.workspace)).not.toContain(".pi");
  }, 120_000);

  it("rejects an invalid mode with a nonzero exit and stderr diagnostic", async () => {
    const fixture = await setupCli();

    const result = await fixture.run(process.execPath, [cliPath, "--mode", "invalid"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid mode");
    expect(result.stdout).toBe("");
  }, 120_000);

  it("fails headless startup without credentials instead of hanging for login", async () => {
    const fixture = await setupCli();

    const result = await fixture.run(process.execPath, [cliPath, "--print", ...modelArgs, "--no-session", "Check credentials"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No API key found");
    expect(result.stdout).toBe("");
  }, 120_000);

  it("emits only JSON records in prompt-free JSON mode and exits cleanly", async () => {
    const fixture = await setupCli();

    const result = await fixture.run(process.execPath, [cliPath, "--mode", "json", ...modelArgs, "--no-session"]);

    expect(result.status, result.stderr).toBe(0);
    const records = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({ type: "session", cwd: fixture.workspace });
    expect(records).not.toContainEqual(expect.objectContaining({ type: "agent_start" }));
    expect(records).not.toContainEqual(expect.objectContaining({ type: "extension_error" }));
    expect(result.stderr).not.toMatch(/Failed to load|Error loading|Failed to initialize|Extension error/i);
  }, 120_000);
});
