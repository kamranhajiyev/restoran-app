package com.possiblle.pos;

// window.PosAndroid: what lib/android-bridge.ts turns into posNative.
//
// The Android twin of the exe's printer:send and printer:scan (lib/tcp-print.ts,
// electron/printer-scan.ts): raw ESC/POS on TCP, and a knock on port 9100 at
// every address in this device's /24. Both answer later, through
// window.__posAndroid(id, error, result), so the page never waits on a socket.
//
// Only private addresses: the page decides what to print, but this must not be
// a way for any script to open sockets to the internet.
//
// On the copy of the page inside the APK it also carries the till's database
// (TillDb), its requests to the site, and its menu pictures (TillFiles) — what
// lib/android-till.ts turns into posNative.till.

import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Pattern;

public class PrinterBridge {
    private static final int SCAN_PORT = 9100;
    private static final int KNOCK_MS = 1_200;
    private static final Pattern DOTTED = Pattern.compile("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$");

    private final WebView web;
    // One print at a time, in order: two tickets on one printer at once come
    // out as one unreadable slip.
    private final ExecutorService printing = Executors.newSingleThreadExecutor();
    private final ExecutorService knocking = Executors.newFixedThreadPool(64);
    // Requests to the site and picture downloads: a few at once, never on the
    // thread the page's calls arrive on.
    private final ExecutorService network = Executors.newFixedThreadPool(4);
    private volatile boolean trusted = false;
    // The database only for the page the APK carries, never for a page from
    // anywhere else (the debug build's dev server reads through the site).
    private final TillDb till;
    private final TillFiles files;
    private volatile boolean tillPage = false;
    // Null in the debug build, which has nothing to update.
    private volatile Updater updater;

    PrinterBridge(WebView web, TillDb till, TillFiles files) {
        this.web = web;
        this.till = till;
        this.files = files;
    }

    void setUpdater(Updater updater) {
        this.updater = updater;
    }

    // ── A new version (Updater) ────────────────────────────────────────────
    // The page's posNative.update, as the exe's (components/DesktopUpdate.tsx).

    @JavascriptInterface
    public boolean hasUpdater() {
        return trusted && updater != null;
    }

    @JavascriptInterface
    public String updateStatus() {
        Updater u = updater;
        return trusted && u != null ? u.status() : "null";
    }

    @JavascriptInterface
    public void updateInstall() {
        Updater u = updater;
        if (trusted && u != null) u.install();
    }

    void setTrusted(boolean trusted, boolean tillPage) {
        this.trusted = trusted;
        this.tillPage = trusted && tillPage && till != null;
    }

    void shutdown() {
        printing.shutdownNow();
        knocking.shutdownNow();
        network.shutdownNow();
    }

    // ── The till's database ────────────────────────────────────────────────
    // Answered at once (lib/android-till.ts): the till's reads and writes are
    // synchronous in the exe too, and a transaction relies on it.

    @JavascriptInterface
    public boolean hasTill() {
        return tillPage;
    }

    @JavascriptInterface
    public String appUrl() {
        return BuildConfig.POS_URL;
    }

    @JavascriptInterface
    public String sqlExec(String sql) {
        if (!tillPage) return "{\"error\":\"not allowed on this page\"}";
        return till.exec(sql);
    }

    @JavascriptInterface
    public String sqlQuery(String sql, String params) {
        if (!tillPage) return "{\"error\":\"not allowed on this page\"}";
        return till.query(sql, params);
    }

    @JavascriptInterface
    public String sqlRun(String sql, String params) {
        if (!tillPage) return "{\"error\":\"not allowed on this page\"}";
        return till.run(sql, params);
    }

    // ── The site ───────────────────────────────────────────────────────────
    // The page is on the phone's own host and the site is another, so its
    // fetch would be refused for CORS; the exe's main process makes these
    // requests for the same reason (lib/till-store/handlers.ts). Only the
    // site's /api routes — never an address the page makes up.
    @JavascriptInterface
    public void http(final String id, final String url, final String method, final String headers, final String body) {
        String site = BuildConfig.POS_URL.replaceAll("/+$", "");
        if (!tillPage) { answer(id, "not allowed on this page", null); return; }
        if (url == null || !url.startsWith(site + "/api/")) { answer(id, "bad path", null); return; }
        network.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15_000);
                c.setReadTimeout(30_000);
                c.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
                JSONObject h = new JSONObject(headers == null || headers.isEmpty() ? "{}" : headers);
                for (Iterator<String> keys = h.keys(); keys.hasNext(); ) {
                    String k = keys.next();
                    c.setRequestProperty(k, h.getString(k));
                }
                if (body != null) {
                    c.setDoOutput(true);
                    byte[] bytes = body.getBytes("UTF-8");
                    c.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
                }
                int status = c.getResponseCode();
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                ByteArrayOutputStream text = new ByteArrayOutputStream();
                if (in != null) {
                    try (InputStream stream = in) {
                        byte[] buf = new byte[16 * 1024];
                        for (int n; (n = stream.read(buf)) > 0; ) text.write(buf, 0, n);
                    }
                }
                // The status comes back, not an error: "the server refused" and
                // "there was no server" are different answers to the outbox.
                JSONObject res = new JSONObject()
                    .put("ok", status >= 200 && status < 300)
                    .put("status", status)
                    .put("body", text.toString("UTF-8"));
                answer(id, null, res.toString());
            } catch (Exception e) {
                answer(id, "network: " + e.getMessage(), null);
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    @JavascriptInterface
    public void cacheImages(final String id, final String urls) {
        if (!tillPage) { answer(id, "not allowed on this page", null); return; }
        network.execute(() -> {
            try {
                JSONArray list = new JSONArray(urls);
                List<String> todo = new ArrayList<>();
                for (int i = 0; i < list.length() && i < 2000; i++) todo.add(list.getString(i));
                answer(id, null, String.valueOf(files.cacheImages(todo)));
            } catch (Exception e) {
                answer(id, null, "0");
            }
        });
    }

    static boolean isPrivate(String ip) {
        if (ip == null || !DOTTED.matcher(ip).matches()) return false;
        int[] o = new int[4];
        String[] parts = ip.split("\\.");
        for (int i = 0; i < 4; i++) {
            o[i] = Integer.parseInt(parts[i]);
            if (o[i] > 255) return false;
        }
        return o[0] == 10 || (o[0] == 192 && o[1] == 168) || (o[0] == 172 && o[1] >= 16 && o[1] <= 31);
    }

    @JavascriptInterface
    public void print(final String id, final String ip, final int port, final String base64, final int timeoutMs) {
        if (!trusted) { answer(id, "not allowed on this page", null); return; }
        if (!isPrivate(ip)) { answer(id, "bad printer ip", null); return; }
        if (port < 1 || port > 65535) { answer(id, "bad printer port", null); return; }
        final int wait = timeoutMs >= 500 && timeoutMs <= 10_000 ? timeoutMs : 5_000;
        printing.execute(() -> {
            // A printer that is off never refuses, it just never answers — the
            // timeout is what turns that into an error the queue can retry.
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(ip, port), wait);
                socket.setSoTimeout(wait);
                OutputStream out = socket.getOutputStream();
                out.write(Base64.decode(base64, Base64.DEFAULT));
                out.flush();
                socket.shutdownOutput();
                answer(id, null, null);
            } catch (Exception e) {
                answer(id, "printer " + ip + ":" + port + ": " + e.getMessage(), null);
            }
        });
    }

    @JavascriptInterface
    public void scan(final String id) {
        if (!trusted) { answer(id, "not allowed on this page", null); return; }
        new Thread(() -> {
            try {
                List<String> own = ownAddresses();
                Set<String> prefixes = new LinkedHashSet<>();
                for (String ip : own) prefixes.add(ip.substring(0, ip.lastIndexOf('.')));

                List<String> candidates = new ArrayList<>();
                for (String p : prefixes) {
                    for (int i = 1; i <= 254; i++) {
                        String ip = p + "." + i;
                        if (!own.contains(ip)) candidates.add(ip);
                    }
                }
                List<Future<Boolean>> knocks = new ArrayList<>();
                for (String ip : candidates) knocks.add(knocking.submit(() -> knock(ip)));

                JSONArray found = new JSONArray();
                for (int i = 0; i < candidates.size(); i++) {
                    if (knocks.get(i).get()) found.put(candidates.get(i));
                }
                answer(id, null, found.toString());
            } catch (Exception e) {
                answer(id, "scan failed: " + e.getMessage(), null);
            }
        }).start();
    }

    // Only connected, never written to: nothing prints.
    private static boolean knock(String ip) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, SCAN_PORT), KNOCK_MS);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** This device's private IPv4 addresses — the networks worth searching. */
    private static List<String> ownAddresses() throws Exception {
        List<String> out = new ArrayList<>();
        for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!ni.isUp() || ni.isLoopback()) continue;
            for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                if (a instanceof Inet4Address && isPrivate(a.getHostAddress())) out.add(a.getHostAddress());
            }
        }
        return out;
    }

    private void answer(String id, String error, String result) {
        final String js = "window.__posAndroid && window.__posAndroid("
            + JSONObject.quote(id) + ","
            + (error == null ? "null" : JSONObject.quote(error)) + ","
            + (result == null ? "null" : JSONObject.quote(result)) + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }
}
