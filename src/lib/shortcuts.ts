/** Shared metadata for help and app-owned keyboard handlers. TipTap implements its standard editing bindings. */
export const SHORTCUTS = [
  { id: 'publish', label: 'Publish or update', key: 'Enter', mod: true, shift: false },
  { id: 'bold', label: 'Bold', key: 'b', mod: true, shift: false },
  { id: 'italic', label: 'Italic', key: 'i', mod: true, shift: false },
  { id: 'underline', label: 'Underline', key: 'u', mod: true, shift: false },
  { id: 'link', label: 'Add link', key: 'k', mod: true, shift: false },
  { id: 'undo', label: 'Undo', key: 'z', mod: true, shift: false },
  { id: 'redo', label: 'Redo', key: 'z', mod: true, shift: true },
  { id: 'find', label: 'Find', key: 'f', mod: true, shift: false },
  { id: 'replace', label: 'Replace', key: 'h', mod: true, shift: false },
  { id: 'pastePlain', label: 'Paste plain text', key: 'v', mod: true, shift: true },
  { id: 'escape', label: 'Close menu / exit focus', key: 'Escape', mod: false, shift: false },
] as const;
export type ShortcutId = typeof SHORTCUTS[number]['id'];
export type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;
export function matchesShortcut(event: ShortcutEvent, id: ShortcutId): boolean {
  const shortcut = SHORTCUTS.find(value => value.id === id)!;
  return event.key.toLowerCase() === shortcut.key.toLowerCase()
    && (event.ctrlKey || event.metaKey) === shortcut.mod
    && event.shiftKey === shortcut.shift && !event.altKey;
}
export function shortcutKeys(id: ShortcutId, platform: 'mac' | 'other' = 'other'): string[] {
  const shortcut = SHORTCUTS.find(value => value.id === id)!;
  return [...(shortcut.mod ? [platform === 'mac' ? '⌘' : 'Ctrl'] : []), ...(shortcut.shift ? ['Shift'] : []), shortcut.key === 'Escape' ? 'Esc' : shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key];
}
