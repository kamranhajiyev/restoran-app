package com.possiblle.pos;

// The page runs in the phone's own browser engine (Android System WebView, or
// Chrome on Android 7-9), not one the APK carries the way the exe does. The
// APK's copy of the page is built for Chrome ANDROID_CHROME and newer
// (lib/android-browsers.mjs); on an older one it would open to "This page
// couldn't load" and nothing else.
//
// So before the page loads, the engine's version is read, and a phone that is
// too old gets a screen saying what to do instead of a crash.

import android.content.pm.PackageInfo;
import android.webkit.WebView;

final class WebViewCheck {
    /** ANDROID_CHROME in lib/android-browsers.mjs. */
    static final int MIN_CHROME = 91;

    private WebViewCheck() {}

    /** "101.0.4951.61" → 101; anything unreadable → 0. */
    static int major(String versionName) {
        if (versionName == null) return 0;
        int end = 0;
        while (end < versionName.length() && Character.isDigit(versionName.charAt(end))) end++;
        if (end == 0) return 0;
        try {
            return Integer.parseInt(versionName.substring(0, end));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /**
     * The engine in use, when it is too old for the page; null when it is fine.
     * An engine that cannot be read is let through: better a page that might
     * work than a till locked out by this check.
     */
    static PackageInfo tooOld() {
        PackageInfo p = WebView.getCurrentWebViewPackage();
        if (p == null) return null;
        int v = major(p.versionName);
        return v > 0 && v < MIN_CHROME ? p : null;
    }

    /** The screen shown instead of the page. Plain HTML: this engine is old. */
    static String page(PackageInfo p) {
        String store = "market://details?id=" + p.packageName;
        return "<!doctype html><html lang=az><head><meta charset=utf-8>"
            + "<meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<style>body{font-family:sans-serif;background:#f7f3ed;color:#292524;margin:0;padding:32px 24px;}"
            + "div{max-width:420px;margin:12vh auto 0;}h1{font-size:20px;margin:0 0 12px;}"
            + "p{font-size:15px;line-height:1.5;color:#57534e;margin:0 0 16px;}"
            + "a{display:block;text-align:center;background:#0f3d34;color:#fff;text-decoration:none;"
            + "padding:14px;border-radius:12px;font-size:16px;margin:24px 0 16px;}"
            + "small{color:#a8a29e;font-size:12px;}</style></head><body><div>"
            + "<h1>Bu cihazda brauzer çox köhnədir</h1>"
            + "<p>Proqram işləmək üçün telefonun brauzerindən istifadə edir, və bu cihazdakı versiya çox köhnədir.</p>"
            + "<p>Play Store-da yeniləyin və proqramı yenidən açın. «Yenilə» düyməsi yoxdursa, bu cihaz proqram üçün çox köhnədir — daha yeni telefon və ya planşet istifadə edin.</p>"
            + "<a href='" + store + "'>Play Store-da yenilə</a>"
            + "<small>" + p.packageName + " " + p.versionName + " · lazımdır: " + MIN_CHROME + "+</small>"
            + "</div></body></html>";
    }
}
