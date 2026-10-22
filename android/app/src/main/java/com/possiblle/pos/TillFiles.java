package com.possiblle.pos;

// The till's page and its menu pictures, served off the phone.
//
// The page ships inside the APK (assets/till/, the same static export as the
// exe's, scripts/build-desktop.mjs) and is served on a host of its own,
// https://appassets.androidplatform.net — the address Android keeps for exactly
// this. A real https origin, not file://, because the till needs localStorage
// that survives a restart and crypto.subtle for the offline PIN.
//
// Pictures are electron/images.ts again: the page asks for /_img?src=<remote
// url> (lib/till-image.ts), answered from the phone, fetched once and kept.

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

class TillFiles {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    private static final String ROOT = "till";
    private static final String IMG_PATH = "/_img";
    /** Big enough for a menu photo, small enough that a wrong URL cannot fill the phone. */
    private static final int MAX_BYTES = 8 * 1024 * 1024;

    private static final Map<String, String> TYPES = new HashMap<>();
    static {
        TYPES.put("html", "text/html");
        TYPES.put("js", "text/javascript");
        TYPES.put("css", "text/css");
        TYPES.put("json", "application/json");
        TYPES.put("webmanifest", "application/manifest+json");
        // Next's page data for client-side navigation.
        TYPES.put("txt", "text/plain");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("png", "image/png");
        TYPES.put("jpg", "image/jpeg");
        TYPES.put("jpeg", "image/jpeg");
        TYPES.put("webp", "image/webp");
        TYPES.put("gif", "image/gif");
        TYPES.put("avif", "image/avif");
        TYPES.put("ico", "image/x-icon");
        TYPES.put("woff2", "font/woff2");
        TYPES.put("woff", "font/woff");
        TYPES.put("ttf", "font/ttf");
        TYPES.put("mp3", "audio/mpeg");
        TYPES.put("wav", "audio/wav");
    }

    private final AssetManager assets;
    private final File images;

    TillFiles(Context context) {
        assets = context.getAssets();
        images = new File(context.getFilesDir(), "images");
        //noinspection ResultOfMethodCallIgnored
        images.mkdirs();
    }

    /** Whether this APK carries the page at all. */
    boolean hasBundle() {
        return exists(ROOT + "/seller/index.html");
    }

    /** The answer for a request on our host. Never null: nothing on it goes to the network. */
    WebResourceResponse serve(Uri url) {
        String path = url.getPath() == null ? "/" : url.getPath();
        if (path.equals(IMG_PATH)) return image(url.getQueryParameter("src"));

        // A path that climbs out of the page is not ours to serve.
        if (path.contains("..")) return notFound();
        String file = resolve(path);
        if (file == null) return notFound();
        try {
            return response(200, type(file), assets.open(file));
        } catch (Exception e) {
            return notFound();
        }
    }

    /** As electron/main.ts resolveBundleFile: a directory address is its index.html. */
    private String resolve(String path) {
        String rel = ROOT + path;
        if (rel.endsWith("/")) rel += "index.html";
        if (exists(rel)) return rel;
        // A client-side route arriving without its slash.
        String asPage = rel + "/index.html";
        if (exists(asPage)) return asPage;
        return null;
    }

    private boolean exists(String asset) {
        try (InputStream ignored = assets.open(asset)) {
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private WebResourceResponse notFound() {
        try {
            return response(404, "text/html", assets.open(ROOT + "/404.html"));
        } catch (Exception e) {
            return response(404, "text/plain", new java.io.ByteArrayInputStream(new byte[0]));
        }
    }

    private static String type(String file) {
        String ext = MimeTypeMap.getFileExtensionFromUrl(file).toLowerCase();
        String known = TYPES.get(ext);
        if (known != null) return known;
        String guess = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return guess != null ? guess : "application/octet-stream";
    }

    private static WebResourceResponse response(int status, String type, InputStream body) {
        boolean text = type.startsWith("text/") || type.contains("json") || type.contains("javascript") || type.contains("svg");
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", ORIGIN);
        return new WebResourceResponse(type, text ? "utf-8" : null, status, status == 200 ? "OK" : "Not Found", headers, body);
    }

    // ── Pictures ────────────────────────────────────────────────────────────

    private static boolean usable(String url) {
        return url != null && (url.startsWith("https://") || url.startsWith("http://"));
    }

    private File fileFor(String url) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(url.getBytes("UTF-8"));
        StringBuilder name = new StringBuilder();
        for (byte b : hash) name.append(String.format("%02x", b));
        return new File(images, name.toString());
    }

    private WebResourceResponse image(String src) {
        try {
            if (!usable(src) || !fetchImage(src)) return response(404, "text/plain", new java.io.ByteArrayInputStream(new byte[0]));
            String ext = MimeTypeMap.getFileExtensionFromUrl(Uri.parse(src).getPath() == null ? "" : Uri.parse(src).getPath()).toLowerCase();
            String type = TYPES.containsKey(ext) && TYPES.get(ext).startsWith("image/") ? TYPES.get(ext) : "image/jpeg";
            WebResourceResponse r = response(200, type, new FileInputStream(fileFor(src)));
            Map<String, String> headers = new HashMap<>(r.getResponseHeaders());
            // Named by the hash of its source, so a cached answer is never the wrong picture.
            headers.put("Cache-Control", "public, max-age=31536000, immutable");
            r.setResponseHeaders(headers);
            return r;
        } catch (Exception e) {
            return response(404, "text/plain", new java.io.ByteArrayInputStream(new byte[0]));
        }
    }

    /** Put one picture on the phone. Quiet on failure: no picture is never worth an error. */
    boolean fetchImage(String url) {
        if (!usable(url)) return false;
        try {
            File file = fileFor(url);
            if (file.exists()) return true;

            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(10_000);
            c.setReadTimeout(20_000);
            try {
                if (c.getResponseCode() != 200) return false;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[16 * 1024];
                    for (int n; (n = in.read(buf)) > 0; ) {
                        out.write(buf, 0, n);
                        if (out.size() > MAX_BYTES) return false;
                    }
                }
                if (out.size() == 0) return false;
                // Written beside the target and renamed, so a download cut off
                // halfway cannot leave a truncated file that every later read trusts.
                File part = new File(file.getPath() + ".part");
                try (FileOutputStream f = new FileOutputStream(part)) {
                    out.writeTo(f);
                    f.getFD().sync();
                }
                return part.renameTo(file);
            } finally {
                c.disconnect();
            }
        } catch (Exception e) {
            return false;
        }
    }

    /** Warm the cache for a whole menu, a few at a time. Returns how many are on the phone. */
    int cacheImages(List<String> urls) throws InterruptedException {
        final List<String> todo = Collections.synchronizedList(new java.util.ArrayList<>(new java.util.LinkedHashSet<>(urls)));
        final int[] cached = {0};
        Thread[] workers = new Thread[4];
        for (int w = 0; w < workers.length; w++) {
            workers[w] = new Thread(() -> {
                while (true) {
                    String u;
                    synchronized (todo) {
                        if (todo.isEmpty()) return;
                        u = todo.remove(todo.size() - 1);
                    }
                    if (fetchImage(u)) synchronized (cached) { cached[0]++; }
                }
            });
            workers[w].start();
        }
        for (Thread t : workers) t.join();
        return cached[0];
    }
}
