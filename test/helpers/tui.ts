import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export const testTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  dim: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  strikethrough: (text: string) => text,
} as unknown as Theme;

export const testTui = {
  requestRender: () => undefined,
} as unknown as TUI;

export const testKeybindings = {
  matches: () => false,
} as unknown as KeybindingsManager;

export const testKey = {
  enter: "\r",
  escape: "\x1b",
  tab: "\t",
  shiftTab: "\x1b[Z",
  up: "\x1b[A",
  down: "\x1b[B",
  ctrlD: "\x04",
  ctrlS: "\x13",
} as const;
