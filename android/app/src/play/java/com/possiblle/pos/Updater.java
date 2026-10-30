package com.possiblle.pos;

// The Google Play app has no updater: Play bans an app that installs its own
// new version, and Play itself updates it. This stand-in only lets
// MainActivity and PrinterBridge compile; create() never makes one, so the
// page shows no "Yeni versiyanı yüklə" (PrinterBridge.hasUpdater is false).
// The real one is in src/direct/.

import android.app.Activity;
import android.webkit.WebView;

class Updater {
    static Updater create(Activity activity, WebView web) {
        return null;
    }

    void start() {}

    void shutdown() {}

    String status() {
        return "null";
    }

    void install() {}
}
