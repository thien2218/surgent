import {
  createBashToolDefinition,
  createLocalBashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import Type from "typebox";

const localBash = createLocalBashOperations();

// 7-bit escapes only: in Latin-1 text, 0x9B may be a UTF-8 continuation byte rather than a CSI.
const ANSI_ESCAPE = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()*+][ -~]|[0-~])/g;

// Keep what a terminal leaves on the line: no escape codes, the last carriage-return overwrite, no trailing blanks.
function render(body: string) {
  const segments = body.replace(ANSI_ESCAPE, "").split("\r");
  const shown = segments.findLast((segment) => segment.length > 0) ?? "";
  return shown.replace(/[ \t]+$/, "");
}

class BashResultReducer {
  private readonly onData: (data: Buffer) => void;
  private currentLine = "";
  private previous = "";
  private repeats = 0;

  constructor(onData: (data: Buffer) => void) {
    this.onData = onData;
  }

  append(data: Buffer) {
    // Latin-1 is a reversible byte mapping, including invalid/split UTF-8.
    const text = data.toString("latin1");
    let start = 0;
    let newline = text.indexOf("\n");
    while (newline !== -1) {
      this.emit(this.currentLine + text.slice(start, newline + 1));
      this.currentLine = "";
      start = newline + 1;
      newline = text.indexOf("\n", start);
    }
    this.currentLine += text.slice(start);
  }

  finish() {
    this.flushRepeats();
    // Never fold an unterminated final line into a terminated run.
    if (this.currentLine.length > 0) {
      this.write(render(this.currentLine));
      this.currentLine = "";
    }
  }

  private emit(line: string) {
    const ending = line.endsWith("\r\n") ? "\r\n" : "\n";
    const rendered = render(line.slice(0, -ending.length)) + ending;
    if (rendered === this.previous) {
      this.repeats++;
      return;
    }
    this.flushRepeats();
    this.previous = rendered;
    this.write(rendered);
  }

  private flushRepeats() {
    if (this.repeats === 0) return;
    const unit = this.repeats === 1 ? "time" : "times";
    const marker = `[above line repeated ${this.repeats} more ${unit}]\n`;
    const repeated = this.previous.repeat(this.repeats);
    this.write(marker.length < repeated.length ? marker : repeated);
    this.repeats = 0;
  }

  private write(text: string) {
    this.onData(Buffer.from(text, "latin1"));
  }
}

export default function bash(pi: ExtensionAPI) {
  const bashTool = createBashToolDefinition(process.cwd(), {
    operations: {
      async exec(command, cwd, options) {
        const reducer = new BashResultReducer(options.onData);
        try {
          return await localBash.exec(command, cwd, {
            ...options,
            onData: (data) => reducer.append(data),
          });
        } finally {
          reducer.finish();
        }
      },
    },
  });

  pi.registerTool({
    ...bashTool,
    prepareArguments: undefined,
    parameters: Type.Object({
      ...bashTool.parameters.properties,
      purpose: Type.String({
        description: "What the command does and why, briefly",
        maxLength: 256,
        pattern: "\\S",
      }),
    }),
  });
}
