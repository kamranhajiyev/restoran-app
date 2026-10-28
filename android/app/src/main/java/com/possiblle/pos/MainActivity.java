package com.possiblle.pos;

// The Android till: the seller page in a full-screen WebView, plus
// PrinterBridge for what the page cannot do itself — talk to a printer on the
// Wi-Fi, and keep the till's database on the phone.
//
// A release APK carries its own copy of the page (TillFiles), like the exe, so
// it opens and sells with the internet down; every page change needs a new
// APK. POS_URL is then only the site it syncs with. The debug build opens
// `npm run dev` on the Mac instead, so a change can be tried without a build.

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.window.OnBackInvokedDispatcher;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class MainActivity extends Activity {
    private WebView web;
    private PrinterBridge printers;
    private Updater updater;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // A till stands on the counter all day; it must not go dark mid-service.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final TillFiles files = new TillFiles(this);
        final boolean bundled = BuildConfig.BUNDLED && files.hasBundle();
        final String site = bundled ? TillFiles.HOST : Uri.parse(BuildConfig.POS_URL).getHost();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // The new-order sound plays without a tap.
        s.setMediaPlaybackRequiresUserGesture(false);

        printers = new PrinterBridge(web, bundled ? new TillDb(this) : null, files);
        web.addJavascriptInterface(printers, "PosAndroid");
        // Only a release replaces itself; the debug build is Android Studio's,
        // and the Google Play app is updated by Play (null).
        if (!BuildConfig.DEBUG) updater = Updater.create(this, web);
        if (updater != null) {
            printers.setUpdater(updater);
            updater.start();
        }

        web.setWebViewClient(new WebViewClient() {
            // The printer bridge is on every page the WebView shows, so the
            // WebView only shows ours. Anything else opens in the real browser.
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isOurs(url, site)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                    // No app for that link. Staying put is the right answer.
                }
                return true;
            }

            // The page's own host is answered from the APK, never the network.
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (bundled && TillFiles.HOST.equals(request.getUrl().getHost())) return files.serve(request.getUrl());
                return null;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                printers.setTrusted(isOurs(Uri.parse(url), site), bundled);
            }
        });
        // The till's service worker fetches the page too; it must get the same files.
        if (bundled) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    if (TillFiles.HOST.equals(request.getUrl().getHost())) return files.serve(request.getUrl());
                    return null;
                }
            });
        }
        // Without a chrome client alert(), confirm() and prompt() do nothing,
        // and the till asks for the receipt printer's IP with prompt().
        web.setWebChromeClient(new WebChromeClient() {
            // The page's console in `adb logcat -s PossibllePOS`: the only way to
            // see why a till on a counter shows nothing.
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i("PossibllePOS", m.messageLevel() + " " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });

        setContentView(belowSystemBars(web));
        // From Android 16 (targetSdk 36) Back no longer calls onBackPressed:
        // without this it would leave the till instead of going back a page.
        // With no page to go back to, the app goes behind, as Android's own
        // Back does since 12, rather than closing.
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> {
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            });
        }
        // An engine too old for the page gets a screen that says so, not a
        // crash. The updater above still runs: a new APK can still arrive.
        PackageInfo engine = WebViewCheck.tooOld();
        if (engine != null) {
            Log.w("PossibllePOS", "WebView too old: " + engine.packageName + " " + engine.versionName);
            web.loadDataWithBaseURL(null, WebViewCheck.page(engine), "text/html", "UTF-8", null);
        }
        else if (state != null) web.restoreState(state);
        // The bundled till opens at /seller, like the exe; the page decides
        // whether that means the PIN pad or the login screen. The site root
        // sends a till that was left on the seller screen back there (tillHome
        // in lib/auth.ts).
        else web.loadUrl(bundled ? TillFiles.ORIGIN + "/seller/" : BuildConfig.POS_URL);
    }

    // From Android 15 an app that targets 35+ is drawn under the status bar,
    // the navigation bar and the keyboard (adjustResize no longer shrinks it):
    // the till's top banner sat under the clock. The page is kept inside them;
    // the bars stay black so their white icons show. Older Android still does
    // this itself.
    static View belowSystemBars(WebView web) {
        FrameLayout frame = new FrameLayout(web.getContext());
        frame.addView(web);
        if (Build.VERSION.SDK_INT >= 35) {
            frame.setBackgroundColor(Color.BLACK);
            // The light theme asks for dark icons, which vanish on black.
            frame.post(() -> frame.getWindowInsetsController().setSystemBarsAppearance(0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS));
            frame.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        return frame;
    }

    static boolean isOurs(Uri url, String site) {
        String host = url.getHost();
        // http only in the debug build, which opens the dev server.
        boolean secure = "https".equals(url.getScheme()) || (BuildConfig.DEBUG && "http".equals(url.getScheme()));
        return secure && host != null
            && (host.equals(site) || host.equals("www." + site) || ("www." + host).equals(site));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    // Android 15 and older still call this; 16 uses the callback in onCreate.
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        printers.shutdown();
        if (updater != null) updater.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
