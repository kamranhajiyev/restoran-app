// Whether sending the outbox should be followed by a re-read of the orders.
//
// The till sends its outbox once as it opens, and re-read the orders after it
// even when nothing was sent. In a browser that re-read came straight after the
// one the page makes as it loads: the order list, the heaviest read there is,
// downloaded twice on every open (usage review, 2026-10-24).
//
// The exe and the APK always re-read: theirs is their own disk, refreshed by the
// pull that comes first.
export function rereadAfterSend(s: { opening: boolean; localDb: boolean; sent: number }): boolean {
  return s.localDb || !s.opening || s.sent > 0;
}
