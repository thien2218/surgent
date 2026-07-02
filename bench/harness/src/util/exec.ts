import { spawn } from "node:child_process";

export interface CommandExecutionRequest {
  commandName: string;
  commandArgs: string[];
  cwdPath: string;
  timeoutMs: number;
  stdinText: string | null;
  envVars: NodeJS.ProcessEnv | null;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  errorMessage: string | null;
}

export async function executeCommand(request: CommandExecutionRequest): Promise<CommandExecutionResult> {
  return new Promise((resolveOutput) => {
    const startedAtMs = Date.now();
    let stdoutOutput = "";
    let stderrOutput = "";
    let timedOut = false;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const childProcess = spawn(request.commandName, request.commandArgs, {
      cwd: request.cwdPath,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: request.envVars ? { ...process.env, ...request.envVars } : process.env,
    });

    const finalize = (exitCode: number, errorMessage: string | null) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      resolveOutput({
        stdout: stdoutOutput,
        stderr: stderrOutput,
        exitCode,
        durationMs: Date.now() - startedAtMs,
        timedOut,
        errorMessage,
      });
    };

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdoutOutput += chunk.toString();
    });

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    childProcess.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!stderrOutput.includes(message)) {
        stderrOutput = `${stderrOutput}${stderrOutput.endsWith("\n") || stderrOutput.length === 0 ? "" : "\n"}${message}`;
      }
      finalize(127, message);
    });

    childProcess.on("close", (code: number | null) => {
      finalize(code ?? 0, null);
    });

    if (request.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        childProcess.kill("SIGTERM");
        setTimeout(() => {
          childProcess.kill("SIGKILL");
        }, 5000);
      }, request.timeoutMs);
    }

    if (request.stdinText !== null) {
      childProcess.stdin.end(request.stdinText);
      return;
    }

    childProcess.stdin.end();
  });
}
