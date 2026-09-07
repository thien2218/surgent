import Parser, { type SyntaxNode } from "tree-sitter";
import Bash from "tree-sitter-bash";
import type { BashCommand } from "./types.js";

const parser = new Parser();
parser.setLanguage(Bash as unknown as Parser.Language);

const DYNAMIC_TYPES = new Set([
  "ansi_c_string",
  "arithmetic_expansion",
  "command_substitution",
  "expansion",
  "process_substitution",
  "simple_expansion",
]);

function containsDynamic(node: SyntaxNode): boolean {
  if (DYNAMIC_TYPES.has(node.type)) return true;
  for (const child of node.namedChildren) {
    if (containsDynamic(child)) return true;
  }
  return false;
}

function decodeCommandName(value: string): string | null {
  if (value.startsWith("$'")) return null;

  let result = "";
  let quote: "single" | "double" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote === "single") {
      if (char === "'") quote = null;
      else result += char;
      continue;
    }
    if (quote === "double") {
      if (char === '"') {
        quote = null;
      } else if (char === "\\" && index + 1 < value.length) {
        const escaped = value[index + 1]!;
        if ('$`"\\\n'.includes(escaped)) {
          result += escaped;
          index += 1;
        } else {
          result += char;
        }
      } else {
        result += char;
      }
      continue;
    }
    if (char === "'") {
      quote = "single";
    } else if (char === '"') {
      quote = "double";
    } else if (char === "\\" && index + 1 < value.length) {
      result += value[index + 1]!;
      index += 1;
    } else {
      result += char;
    }
  }

  return quote === null ? result : null;
}

function commandFromNode(node: SyntaxNode): BashCommand {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) {
    return { text: node.text.trim(), unresolved: true };
  }

  const args = node.childrenForFieldName("argument").map((argument) => argument.text);
  return {
    text: [nameNode.text, ...args].join(" "),
    unresolved: containsDynamic(nameNode) || decodeCommandName(nameNode.text) === null,
  };
}

function patternFromNode(node: SyntaxNode): string {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return node.text.trim();

  const commandName = decodeCommandName(nameNode.text) ?? nameNode.text;
  const args = node.childrenForFieldName("argument");
  if (!args.length) return commandName;

  if (commandName === "git" && !containsDynamic(args[0]!)) {
    return `${commandName} ${args[0]!.text} *`;
  }
  return `${commandName} *`;
}

export function extractBashCommands(source: string): BashCommand[] {
  const trimmed = source.trim();
  if (!trimmed) return [];

  const tree = parser.parse(trimmed);
  if (tree.rootNode.hasError) {
    return [{ text: trimmed, unresolved: true }];
  }

  const commands = new Map<string, BashCommand>();
  for (const node of tree.rootNode.descendantsOfType("command")) {
    const command = commandFromNode(node);
    const existing = commands.get(command.text);
    if (!existing || command.unresolved) commands.set(command.text, command);
  }

  return [...commands.values()];
}

export function bashToPattern(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";

  const tree = parser.parse(trimmed);
  if (tree.rootNode.hasError) return trimmed;

  const commandNode = tree.rootNode.descendantsOfType("command")[0];
  return commandNode ? patternFromNode(commandNode) : trimmed;
}
