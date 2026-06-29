import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, SelectList, type SelectItem } from "@earendil-works/pi-tui";
import { Frame } from "./frame.js";
import { Lines } from "./lines.js";

export type SelectEntry<TData = unknown> = SelectItem & {
  data?: TData;
};

type Options<TData = unknown> = {
  title: string;
  items: SelectEntry<TData>[];
  addLabel?: string;
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
  private readonly items: [SelectItem, ...SelectEntry<TData>[]] | SelectEntry<TData>[];
  private readonly canDeleteItem: (item: SelectEntry<TData>) => boolean;

  private selectList: SelectList;
  private deleteArmed = false;

  constructor(theme: Theme, options: Options<TData>) {
    super(theme);

    this.title = options.title;
    this.items = options.items;
    if (options.addLabel) this.items.unshift({ value: "__add__", label: `[${options.addLabel}]` });
    this.canDeleteItem = options.canDelete ?? (() => true);
    this.selectList = new SelectList(this.items, options.maxVisibleRows ?? 7, getSelectListTheme());

    this.registerKeybindings([
      {
        key: "esc",
        hint: "cancel",
        handler: () => {
          this.deleteArmed = false;
          this.onCancel?.();
        },
      },
      { key: "enter", hint: "select", handler: (data) => this.confirmSelection(data) },
      { key: Key.ctrl("d"), hint: "delete", handler: () => this.armDeletion() },
    ]);
  }

  override invalidate() {
    super.invalidate();
    this.selectList.invalidate();
  }

  handleInput(data: string) {
    if (this.handleKb(data)) return;
    if (this.deleteArmed) {
      this.deleteArmed = false;
    }
    this.selectList.handleInput(data);
  }

  override get hints(): [string, string][] {
    return [["↑↓", "move"], ...super.hints];
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

  private confirmSelection(data: string) {
    if (data === "\n") return;
    const selected = this.selectList.getSelectedItem() as SelectEntry<TData>;
    if (!selected) return;

    if (this.deleteArmed) {
      this.confirmDeletion(selected);
      return;
    }

    this.deleteArmed = false;
    if (this.isAddRow(selected)) {
      this.onAdd?.();
      return;
    }

    this.onSelect?.(selected);
  }

  private armDeletion() {
    this.updateHint("enter", "confirm delete");
    const selected = this.selectList.getSelectedItem() as SelectEntry<TData>;
    if (!selected || this.isAddRow(selected)) {
      this.deleteArmed = false;
      return;
    }

    if (!this.canDeleteItem(selected)) {
      this.deleteArmed = false;
      this.onDeleteBlocked?.(selected);
      return;
    }

    this.deleteArmed = true;
  }

  private confirmDeletion(selected: SelectEntry<TData>) {
    if (this.isAddRow(selected)) {
      this.deleteArmed = false;
      return;
    }
    if (!this.canDeleteItem(selected)) {
      this.deleteArmed = false;
      this.onDeleteBlocked?.(selected);
      return;
    }

    const selectedItemIndex = this.items.findIndex((item) => item === selected);
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
