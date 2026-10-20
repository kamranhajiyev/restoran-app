package com.possiblle.pos;

// The Android till: the site in a full-screen WebView, plus PrinterBridge for
// the one thing the page cannot do itself — talk to a printer on the Wi-Fi.
//
// The page is loaded from the site every time, like the browser till link, so
// a push reaches it without a new APK. Only changes in this folder need one.

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView web;
    private PrinterBridge printers;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // A till stands on the counter all day; it must not go dark mid-service.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final String site = Uri.parse(BuildConfig.POS_URL).getHost();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // The new-order sound plays without a tap.
        s.setMediaPlaybackRequiresUserGesture(false);

        printers = new PrinterBridge(web);
        web.addJavascriptInterface(printers, "PosAndroid");

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

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                printers.setTrusted(isOurs(Uri.parse(url), site));
            }
        });
        // Without a chrome client alert(), confirm() and prompt() do nothing,
        // and the till asks for the receipt printer's IP with prompt().
        web.setWebChromeClient(new WebChromeClient());

        setContentView(web);
        if (state != null) web.restoreState(state);
        // The site root, like the exe: it sends a till that was left on the
        // seller screen back there (tillHome in lib/auth.ts).
        else web.loadUrl(BuildConfig.POS_URL);
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

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        printers.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
