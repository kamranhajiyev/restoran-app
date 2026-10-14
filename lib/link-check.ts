// How often an open terminal link asks whether it is still valid.
//
// It used to ask every 40 s: about 2,000 Vercel calls per till per day, only to
// notice a rotated link or a paid renewal (usage review, 2026-10-14). Every
// five minutes, plus whenever the window gets focus, catches both soon enough.
export const LINK_CHECK_MS = 5 * 60_000;
