// Menu array order is the saved position, so a copy goes right after its
// original instead of at the end of the menu.
export function insertCopyAfter<T extends { id: string; name: string }>(menu: T[], id: string, newId: string): T[] {
  const i = menu.findIndex(m => m.id === id);
  if (i < 0) return menu;
  const copy = { ...menu[i], id: newId, name: `${menu[i].name} (kopya)` };
  return [...menu.slice(0, i + 1), copy, ...menu.slice(i + 1)];
}
