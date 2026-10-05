// An order's note as people read it: the guest's phone and address first, each
// on its own line, then whatever else was written, under "Qeyd:".
//
// An online order arrives as one string — "Tel: … · Ünvan: … · <guest's note>"
// — and was shown that way on screen while the ticket already put Tel and Ünvan
// first (Latte Art, 2026-10-05). The ticket and every screen use this one split
// so they cannot disagree again.

export function noteLines(note: string): string[] {
  const parts = note.split(/\n| · /).map(s => s.trim()).filter(Boolean);
  const isContact = (s: string) => /^(Tel|Ünvan):/.test(s);
  const rest = parts.filter(s => !isContact(s)).join(' · ');
  return [...parts.filter(isContact), ...(rest ? [`Qeyd: ${rest}`] : [])];
}
