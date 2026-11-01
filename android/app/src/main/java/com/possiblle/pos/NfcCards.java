package com.possiblle.pos;

// A manager's card on the phone's own NFC (2026-11-01).
//
// A till with a USB reader gets cards as typed keys (lib/card-reader.ts). A
// phone has no such reader, only NFC, which reads 13.56 MHz cards (Mifare,
// NFC tags) — never the 125 kHz EM-Marine ones. The page turns this on only
// while the approval box waits for a card, so the rest of the time the phone
// behaves as it always did. The card's id goes to the page as hex
// ("04:A2:3B:1C") through window.__posAndroidNfc; the page makes it the same
// number admin saves (cardNumber).

import android.app.Activity;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.webkit.WebView;

final class NfcCards implements NfcAdapter.ReaderCallback {
    private static final int FLAGS = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B
        | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;

    private final Activity activity;
    private final WebView web;
    private final NfcAdapter adapter;
    // What the page asked for, and whether the app is in front to do it.
    private boolean wanted = false;
    private boolean resumed = false;
    private boolean on = false;

    NfcCards(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        this.adapter = NfcAdapter.getDefaultAdapter(activity);
    }

    /** A phone with NFC, switched on in its settings. */
    boolean available() {
        return adapter != null && adapter.isEnabled();
    }

    void listen(boolean want) {
        activity.runOnUiThread(() -> { wanted = want; apply(); });
    }

    void resume() { resumed = true; apply(); }

    void pause() { resumed = false; apply(); }

    // Reader mode only works while the activity is in front, so it follows
    // both the page's wish and onResume/onPause.
    private void apply() {
        if (adapter == null) return;
        boolean should = wanted && resumed;
        if (should == on) return;
        try {
            if (should) adapter.enableReaderMode(activity, this, FLAGS, null);
            else adapter.disableReaderMode(activity);
            on = should;
        } catch (Exception ignored) {
            // NFC switched off meanwhile: the card simply is not read.
        }
    }

    @Override
    public void onTagDiscovered(Tag tag) {
        byte[] id = tag.getId();
        if (id == null || id.length == 0) return;
        StringBuilder hex = new StringBuilder();
        for (byte b : id) {
            if (hex.length() > 0) hex.append(':');
            hex.append(String.format("%02X", b & 0xff));
        }
        final String js = "window.__posAndroidNfc && window.__posAndroidNfc('" + hex + "')";
        web.post(() -> web.evaluateJavascript(js, null));
    }
}
