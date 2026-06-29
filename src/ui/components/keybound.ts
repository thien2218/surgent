import { Key, matchesKey, type KeyId } from "@earendil-works/pi-tui";

type NavigationKey = {
  navigation: "vertical" | "horizontal" | "page";
  metakey?:
    | typeof Key.ctrl
    | typeof Key.shift
    | typeof Key.alt
    | typeof Key.super
    | typeof Key.ctrlShift
    | typeof Key.shiftCtrl
    | typeof Key.ctrlAlt
    | typeof Key.altCtrl
    | typeof Key.shiftAlt
    | typeof Key.altShift
    | typeof Key.ctrlSuper
    | typeof Key.superCtrl
    | typeof Key.shiftSuper
    | typeof Key.superShift
    | typeof Key.altSuper
    | typeof Key.superAlt
    | typeof Key.ctrlShiftAlt
    | typeof Key.ctrlShiftSuper;
};

export type Keybindings = Array<
  | { key: KeyId; handler: (data: string) => void; hint?: string }
  | { key: NavigationKey; navigate: (data: string) => void; hint?: string }
>;

export class Keybound {
  private locked = false;
  private bindings = new Map<
    KeyId,
    { handler: (data: string) => void; hintIdx: number | null; accessible: boolean }
  >();
  private keyHints: [string, string][] = [];

  private getArrowKeyIds(key: NavigationKey) {
    const isVertical = key.navigation === "vertical";
    const isHorizontal = key.navigation === "horizontal";
    const firstNav = isVertical ? "up" : isHorizontal ? "left" : "pageUp";
    const secondNav = isVertical ? "down" : isHorizontal ? "right" : "pageDown";
    return [firstNav, secondNav] as [typeof firstNav, typeof secondNav];
  }

  private registerNormalKb(key: KeyId, handler: (data: string) => void, hint?: string) {
    if (this.bindings.has(key)) {
      throw new Error(`key already registered: ${key}`);
    }
    this.bindings.set(key, { handler, hintIdx: this.keyHints.length, accessible: true });
    this.keyHints.push([key, hint ?? ""]);
  }

  private registerArrowKb(key: NavigationKey, navigate: (data: string) => void, hint?: string) {
    if (this.locked) throw new Error("key registry locked");

    const [firstNav, secondNav] = this.getArrowKeyIds(key);
    const first = key.metakey ? key.metakey(Key[firstNav]) : Key[firstNav];
    const second = key.metakey ? key.metakey(Key[secondNav]) : Key[secondNav];
    const firstArrow = firstNav === "up" ? "↑" : firstNav === "left" ? "←" : "pgUp";
    const secondArrow = secondNav === "down" ? "↓" : secondNav === "right" ? "→" : "pgDown";

    const keyParts = first.split("+");
    const metakey = keyParts.slice(0, -1).join("+");
    const hintKey = metakey
      ? `${metakey}+${firstArrow}/${secondArrow}`
      : `${firstArrow}/${secondArrow}`;

    const hintIdx = this.keyHints.length;
    this.keyHints.push([hintKey, hint ?? ""]);

    this.bindings.set(first, { handler: () => navigate(firstNav), hintIdx, accessible: true });
    this.bindings.set(second, { handler: () => navigate(secondNav), hintIdx, accessible: true });
  }

  protected registerKeybindings(keybindings: Keybindings) {
    if (this.locked) throw new Error("key registry locked");

    for (const keybinding of keybindings) {
      if ("handler" in keybinding) {
        this.registerNormalKb(keybinding.key, keybinding.handler, keybinding.hint);
        continue;
      }
      this.registerArrowKb(keybinding.key, keybinding.navigate, keybinding.hint);
    }

    this.locked = true;
  }

  protected setKeyAccess(key: KeyId, accessible: boolean) {
    const binding = this.bindings.get(key);
    if (!binding) {
      throw new Error(`key not registered: ${key}`);
    }
    binding.accessible = accessible;
  }

  protected setArrowKeyAccess(key: NavigationKey, accessible: boolean) {
    const [firstNav, secondNav] = this.getArrowKeyIds(key);
    const first = key.metakey ? key.metakey(Key[firstNav]) : Key[firstNav];
    const second = key.metakey ? key.metakey(Key[secondNav]) : Key[secondNav];
    this.setKeyAccess(first, accessible);
    this.setKeyAccess(second, accessible);
  }

  protected updateHint(key: KeyId, hint: string) {
    const binding = this.bindings.get(key);
    if (!binding) {
      throw new Error(`key not registered: ${key}`);
    }
    if (binding.hintIdx === null) {
      throw new Error(`key has no hint slot: ${key}`);
    }

    const hintEntry = this.keyHints[binding.hintIdx];
    if (!hintEntry) {
      throw new Error(`hint index out of bounds for key: ${key}`);
    }

    this.keyHints[binding.hintIdx] = [hintEntry[0], hint];
  }

  protected handleKb(data: string): boolean {
    for (const [keyId, binding] of this.bindings) {
      if (!binding.accessible) continue;
      if (matchesKey(data, keyId)) {
        binding.handler(data);
        return true;
      }
    }
    return false;
  }

  protected get hints(): [string, string][] {
    const visible: [string, string][] = [];
    const visibleIndexes = new Set<number>();

    for (const binding of this.bindings.values()) {
      if (!binding.accessible || binding.hintIdx === null) continue;
      if (visibleIndexes.has(binding.hintIdx)) continue;

      const hintEntry = this.keyHints[binding.hintIdx];
      if (!hintEntry) continue;

      visibleIndexes.add(binding.hintIdx);
      visible.push(hintEntry);
    }

    return visible;
  }
}
