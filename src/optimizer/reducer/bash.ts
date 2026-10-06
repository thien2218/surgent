// Literal braces are doubled; only generated value lists use single braces.
function escapeLiteral(text: string) {
  return text.replaceAll("{", "{{").replaceAll("}", "}}");
}

export class BashResultReducer {
  private readonly onData: (data: Buffer) => void;
  private currentLine = "";
  private lines: string[][] = [];
  private ending = "\n";
  private varying = -1;
  private size = 0;

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
    this.flushPending();
    // Never fold an unterminated final line into a terminated group.
    if (this.currentLine.length > 0) {
      this.onData(Buffer.from(escapeLiteral(this.currentLine), "latin1"));
      this.currentLine = "";
    }
  }

  private emit(line: string) {
    const ending = line.endsWith("\r\n") ? "\r\n" : "\n";
    const body = line.slice(0, -ending.length);
    const tokens = body.split(/([A-Za-z0-9]+)/);
    // Terminal controls and tokenless lines pass through without factoring.
    if (/[\x00-\x1f\x7f]/.test(body) || tokens.length < 3) {
      this.flushPending();
      this.onData(Buffer.from(escapeLiteral(line), "latin1"));
      return;
    }

    const first = this.lines[0];
    if (first) {
      let varying = this.varying;
      let matches = ending === this.ending && tokens.length === first.length;
      if (matches) {
        for (let index = 0; index < tokens.length; index++) {
          if (tokens[index] === first[index]) continue;
          if (index % 2 === 0 || (varying !== -1 && varying !== index)) {
            matches = false;
            break;
          }
          varying = index;
        }
      }
      // Bound group buffering even for an endless run of matching lines.
      if (!matches || this.size + line.length > 64 * 1024) {
        this.flushPending();
      } else {
        this.varying = varying;
      }
    }
    this.lines.push(tokens);
    this.ending = ending;
    this.size += line.length;
  }

  private flushPending() {
    const first = this.lines[0];
    if (!first) return;

    const original = this.lines.map((tokens) => tokens.join("") + this.ending).join("");
    let output = escapeLiteral(original);
    if (this.lines.length > 1) {
      // Exact repeats use the last alphanumeric token and retain every value.
      const varying = this.varying === -1 ? first.length - 2 : this.varying;
      const values = this.lines.map((tokens) => tokens[varying]);
      const template = first.map((token, index) => index === varying ? `{${values.join(", ")}}` : escapeLiteral(token)).join("");
      const compressed = template + this.ending;
      if (compressed.length < original.length) output = compressed;
    }
    this.onData(Buffer.from(output, "latin1"));
    this.lines = [];
    this.varying = -1;
    this.size = 0;
  }
}
