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

import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
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
    private volatile boolean trusted = false;

    PrinterBridge(WebView web) {
        this.web = web;
    }

    void setTrusted(boolean trusted) {
        this.trusted = trusted;
    }

    void shutdown() {
        printing.shutdownNow();
        knocking.shutdownNow();
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
