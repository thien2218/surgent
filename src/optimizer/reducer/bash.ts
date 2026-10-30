import {
  createBashToolDefinition,
  createLocalBashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import Type from "typebox";

const localBash = createLocalBashOperations();

class BashResultReducer {
  private readonly onData: (data: Buffer) => void;
  private currentLine = "";

  constructor(onData: (data: Buffer) => void) {
    this.onData = onData;
  }

  append(data: Buffer) {
    // Latin-1 is a reversible byte mapping, including invalid/split UTF-8.
    const text = data.toString("latin1");
    let start = 0;
    let newline = text.indexOf("\n");
    while (newline !== -1) {
      this.onData(Buffer.from(this.currentLine + text.slice(start, newline + 1), "latin1"));
      this.currentLine = "";
      start = newline + 1;
      newline = text.indexOf("\n", start);
    }
    this.currentLine += text.slice(start);
  }

  finish() {
    if (this.currentLine.length > 0) {
      this.onData(Buffer.from(this.currentLine, "latin1"));
      this.currentLine = "";
    }
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
