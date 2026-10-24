export type Hunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: UpdateChunk[] };

export interface UpdateChunk {
  oldLines: string[];
  newLines: string[];
  changeContext?: string;
  isEndOfFile?: boolean;
}

export type Replacement = [start: number, length: number, lines: string[]];
export type Comparator = (actual: string, expected: string) => boolean;

export interface FileChange {
  filePath: string;
  oldContent: string;
  newContent: string;
  type: "add" | "update" | "move" | "delete";
  movePath?: string;
}

export interface Snapshot {
  content: Buffer;
  mode: number;
}

export interface PatchPlan {
  // Content each path has after the hunks planned so far; null when removed.
  files: Map<string, string | null>;
  // Disk state before the patch, used to undo a failed write; null when absent.
  originals: Map<string, Snapshot | null>;
}

export interface WriteStep {
  filePath: string;
  createdDir?: string;
}

export interface PatchedFile {
  type: FileChange["type"];
  path: string;
  diff: string;
}
