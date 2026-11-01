// The phone's own NFC as a card reader, in the Android app only
// (android/…/NfcCards.java). The approval box turns it on while it waits for
// a manager's card and off when it closes; anywhere else this does nothing,
// and a USB reader still types its cards as keys (lib/card-reader.ts).

interface NfcWindow {
  PosAndroid?: { hasNfc?: () => boolean; nfcListen?: (on: boolean) => void };
  __posAndroidNfc?: (hex: string) => void;
}

/** Listen for one card after another until the returned stop is called. */
export function listenNfc(onCard: (hex: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const win = window as unknown as NfcWindow;
  const bridge = win.PosAndroid;
  // An APK from before NFC has no hasNfc.
  if (!bridge?.hasNfc?.() || !bridge.nfcListen) return () => {};
  win.__posAndroidNfc = onCard;
  bridge.nfcListen(true);
  return () => {
    if (win.__posAndroidNfc === onCard) delete win.__posAndroidNfc;
    bridge.nfcListen?.(false);
  };
}
