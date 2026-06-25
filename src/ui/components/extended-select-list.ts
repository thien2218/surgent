import {
  getSelectListTheme,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, SelectList, matchesKey, type SelectItem } from "@earendil-works/pi-tui";
import { Frame } from "./frame.js";
import { Lines } from "./lines.js";

export type SelectEntry<TData = unknown> = SelectItem & {
  data: TData;
};

type Options<TData = unknown> = {
  title: string;
  items: SelectEntry<TData>[];
  addLabel: string;
  maxVisibleRows?: number;
  canDelete?: (item: SelectEntry<TData>) => boolean;
};

export class ExtendedSelectList<TData = unknown> extends Frame {
  onAdd?: () => void;
  onSelect?: (item: SelectEntry<TData>) => void;
  onDelete?: (item: SelectEntry<TData>) => void;
  onDeleteBlocked?: (item: SelectEntry<TData>) => void;
  onCancel?: () => void;

  private readonly title: string;
  private readonly items: [SelectItem, ...SelectEntry<TData>[]];
  private readonly canDeleteItem: (item: SelectEntry<TData>) => boolean;

  private selectList: SelectList;
  private deleteArmed = false;

  constructor(
    private readonly keybindings: KeybindingsManager,
    theme: Theme,
    options: Options<TData>,
  ) {
    super(theme);

    this.title = options.title;
    this.items = [{ value: "__add__", label: `[${options.addLabel}]` }, ...options.items];
    this.canDeleteItem = options.canDelete ?? (() => true);

    this.selectList = new SelectList(this.items, options.maxVisibleRows ?? 7, getSelectListTheme());
  }

  override invalidate() {
    super.invalidate();
    this.selectList.invalidate();
  }

  handleInput(data: string) {
    if (this.isCancelInput(data)) {
      this.deleteArmed = false;
      this.onCancel?.();
      return;
    }

    if (this.isDeleteInput(data)) {
      this.armDeletion();
      return;
    }

    if (this.isConfirmInput(data)) {
      this.confirmSelection();
      return;
    }

    if (this.deleteArmed) {
      this.deleteArmed = false;
    }

    this.selectList.handleInput(data);
  }

  override getHints(): [string, string][] {
    const enterLabel = this.deleteArmed ? "confirm delete" : "select";
    return [
      ["↑↓", "move"],
      ["Enter", enterLabel],
      ["Ctrl+D", "delete"],
      ["Esc", "cancel"],
    ];
  }

  protected override children(width: number): string[] {
    const lines = new Lines(width);

    lines.add(this.theme.bold(this.title));
    lines.space();

    for (const renderedLine of this.selectList.render(width)) {
      lines.add(renderedLine);
    }

    if (this.deleteArmed) {
      lines.space();
      lines.add(this.theme.fg("warning", "Delete selected item: press Enter to confirm"));
    }

    return lines.get();
  }

  private isConfirmInput(data: string): boolean {
    return this.keybindings.matches(data, "tui.select.confirm") && data !== "\n";
  }

  private isCancelInput(data: string): boolean {
    return this.keybindings.matches(data, "tui.select.cancel");
  }

  private isDeleteInput(data: string): boolean {
    return matchesKey(data, Key.ctrl("d"));
  }

  private confirmSelection() {
    const selectedItem = this.selectList.getSelectedItem() as SelectEntry<TData>;
    if (!selectedItem) return;

    if (this.deleteArmed) {
      this.confirmDeletion(selectedItem);
      return;
    }

    this.deleteArmed = false;
    if (this.isAddRow(selectedItem)) {
      this.onAdd?.();
      return;
    }

    this.onSelect?.(selectedItem);
  }

  private armDeletion() {
    const selectedItem = this.selectList.getSelectedItem() as SelectEntry<TData>;
    if (!selectedItem || this.isAddRow(selectedItem)) {
      this.deleteArmed = false;
      return;
    }

    if (!this.canDeleteItem(selectedItem)) {
      this.deleteArmed = false;
      this.onDeleteBlocked?.(selectedItem);
      return;
    }

    this.deleteArmed = true;
  }

  private confirmDeletion(selectedItem: SelectEntry<TData>) {
    if (this.isAddRow(selectedItem)) {
      this.deleteArmed = false;
      return;
    }

    if (!this.canDeleteItem(selectedItem)) {
      this.deleteArmed = false;
      this.onDeleteBlocked?.(selectedItem);
      return;
    }

    const selectedItemIndex = this.items.findIndex((item) => item === selectedItem);
    if (selectedItemIndex < 0) {
      this.deleteArmed = false;
      return;
    }

    const deletedItem = this.items[selectedItemIndex] as SelectEntry<TData>;
    if (!deletedItem) {
      this.deleteArmed = false;
      return;
    }

    this.items.splice(selectedItemIndex, 1);
    this.deleteArmed = false;
    this.onDelete?.(deletedItem);
  }

  private isAddRow(item: SelectEntry<TData>): boolean {
    return item.value === "__add__";
  }
}
