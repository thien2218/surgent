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

type KeyboundBinding = {
  handler: (data: string) => void;
  hintIdx: number;
  consumable: boolean;
  hinted: boolean;
};

export type Keybindings = Array<
  | { key: KeyId; handler: (data: string) => void; hint?: string }
  | { key: NavigationKey; navigate: (data: string) => void; hint?: string }
>;

export class Keybound {
  private bindings = new Map<KeyId, KeyboundBinding>();
  private keyHints: [string, string][] = [];

  private getKbConfig(key: string, hint?: string) {
    const config = { hintIdx: this.keyHints.length, consumable: true, hinted: !!hint };
    this.keyHints.push([key, hint ?? ""]);
    return config;
  }

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
    this.bindings.set(key, { handler, ...this.getKbConfig(key, hint) });
    this.keyHints.push([key, hint ?? ""]);
  }

  private registerArrowKb(key: NavigationKey, navigate: (data: string) => void, hint?: string) {
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
    const config = this.getKbConfig(hintKey, hint);

    this.bindings.set(first, { handler: () => navigate(firstNav), ...config });
    this.bindings.set(second, { handler: () => navigate(secondNav), ...config });
  }

  protected registerKeybindings(keybindings: Keybindings) {
    for (const keybinding of keybindings) {
      if ("handler" in keybinding) {
        this.registerNormalKb(keybinding.key, keybinding.handler, keybinding.hint);
        continue;
      }
      this.registerArrowKb(keybinding.key, keybinding.navigate, keybinding.hint);
    }
  }

  protected setKeyAccess(key: KeyId, access: boolean | { consumable?: boolean; hinted?: boolean }) {
    const binding = this.bindings.get(key);
    if (!binding) {
      throw new Error(`key not registered: ${key}`);
    }
    binding.consumable =
      typeof access === "boolean" ? access : (access.consumable ?? binding.consumable);
    binding.hinted = typeof access === "boolean" ? access : (access.hinted ?? binding.hinted);
  }

  protected setArrowKeyAccess(
    key: NavigationKey,
    access: boolean | { consumable?: boolean; hinted?: boolean },
  ) {
    const [firstNav, secondNav] = this.getArrowKeyIds(key);
    const first = key.metakey ? key.metakey(Key[firstNav]) : Key[firstNav];
    const second = key.metakey ? key.metakey(Key[secondNav]) : Key[secondNav];
    this.setKeyAccess(first, access);
    this.setKeyAccess(second, access);
  }

  protected setHint(key: KeyId, hint: string) {
    const binding = this.bindings.get(key);
    if (!binding) {
      throw new Error(`key not registered: ${key}`);
    }

    const hintEntry = this.keyHints[binding.hintIdx];
    if (!hintEntry) {
      throw new Error(`hint index out of bounds for key: ${key}`);
    }

    this.keyHints[binding.hintIdx] = [hintEntry[0], hint];
  }

  protected handleKb(data: string): boolean {
    for (const [keyId, binding] of this.bindings) {
      if (!binding.consumable) continue;
      if (matchesKey(data, keyId)) {
        binding.handler(data);
        return true;
      }
    }
    return false;
  }

  protected get hints(): [string, string][] {
    const visible: [string, string][] = [];
    for (const binding of this.bindings.values()) {
      if (!binding.hinted) continue;
      const hintEntry = this.keyHints[binding.hintIdx];
      if (!hintEntry) continue;
      visible.push(hintEntry);
    }
    return visible;
  }
}
