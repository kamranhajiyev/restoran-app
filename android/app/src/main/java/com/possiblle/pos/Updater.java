package com.possiblle.pos;

// Keeping the Android till up to date, the way electron/updater.ts keeps the exe.
//
// A release reaches the phones only once it is *published* on GitHub (the
// workflow makes it a draft, so a build can be tried first). The new APK is
// fetched in the background and checked against the digest GitHub publishes
// for it. Nothing is installed until a person presses "Yeni versiyanı yüklə"
// (components/DesktopUpdate.tsx): an update found mid-shift is only offered,
// and the next time the app opens it is required.
//
// Unlike the exe, Android always asks once more on its own screen before an
// app from outside Google Play replaces itself — that tap cannot be skipped.
// The first time, it also asks to allow installs from this app.
//
// Offline, nothing is found and nothing is blocked. A till must never be locked
// out by an update it cannot download or install.

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.provider.Settings;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

class Updater {
    private static final String TAG = "PossibllePOS";
    private static final String REPO = "kamranhajiyev/restoran-app";
    private static final String ASSET = "PossibllePOS.apk";
    private static final long FIRST_CHECK_MS = 30_000;
    private static final long CHECK_EVERY_MS = 3 * 60 * 60 * 1000;

    /** The one running updater, for InstallResult to report back to. */
    private static Updater current;

    private final Activity activity;
    private final WebView web;
    private final SharedPreferences prefs;
    private final File dir;
    private final Handler worker;

    // The downloaded, verified APK waiting to be installed.
    private volatile String readyVersion;
    private volatile File readyFile;
    // True when it was already waiting as the app opened: the page then
    // refuses to be used until it is installed.
    private volatile boolean required;

    Updater(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        this.prefs = activity.getSharedPreferences("update", Context.MODE_PRIVATE);
        this.dir = new File(activity.getFilesDir(), "updates");
        HandlerThread thread = new HandlerThread("updater");
        thread.start();
        this.worker = new Handler(thread.getLooper());
        current = this;
    }

    /** 1 when a is newer than b. Plain numeric x.y.z — that is all the tags use. */
    static int compare(String a, String b) {
        String[] pa = a.split("\\."), pb = b.split("\\.");
        for (int i = 0; i < 3; i++) {
            int x = i < pa.length ? parse(pa[i]) : 0, y = i < pb.length ? parse(pb[i]) : 0;
            if (x != y) return x > y ? 1 : -1;
        }
        return 0;
    }

    private static int parse(String s) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return 0; }
    }

    void start() {
        String pending = prefs.getString("version", null);
        File file = pending == null ? null : new File(dir, "PossibllePOS-" + pending + ".apk");
        if (pending != null && compare(pending, BuildConfig.VERSION_NAME) > 0 && file.exists()) {
            if (prefs.getBoolean("attempted", false)) {
                // Sent to Android last time and the app is still the old
                // version: it did not take. Start over rather than block on it.
                Log.w(TAG, "update " + pending + " did not install, discarded");
                clearDownloads();
            } else {
                // Waiting since the last session — the app is just opening, so
                // nobody is in the middle of an order. This is the moment to insist.
                readyVersion = pending;
                readyFile = file;
                required = true;
            }
        } else if (pending != null) {
            // Already on that version (or newer): the update landed.
            clearDownloads();
        }

        worker.postDelayed(new Runnable() {
            @Override public void run() {
                check();
                worker.postDelayed(this, CHECK_EVERY_MS);
            }
        }, FIRST_CHECK_MS);
    }

    void shutdown() {
        worker.getLooper().quitSafely();
        if (current == this) current = null;
    }

    /** What the page's update:status asks: null until an APK is ready. */
    String status() {
        if (readyVersion == null) return "null";
        try {
            return new JSONObject().put("version", readyVersion).put("required", required).put("reopens", false).toString();
        } catch (Exception e) {
            return "null";
        }
    }

    private void clearDownloads() {
        prefs.edit().clear().apply();
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    private void announce() {
        final String js = "window.__posAndroidUpdate && window.__posAndroidUpdate(" + status() + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    private void check() {
        if (readyVersion != null) return;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("https://api.github.com/repos/" + REPO + "/releases/latest").openConnection();
            c.setConnectTimeout(15_000);
            c.setReadTimeout(30_000);
            c.setRequestProperty("Accept", "application/vnd.github+json");
            if (c.getResponseCode() != 200) return;
            JSONObject release;
            try (InputStream in = c.getInputStream()) {
                release = new JSONObject(new String(readAll(in), "UTF-8"));
            }
            String version = release.getString("tag_name").replaceFirst("^v", "");
            if (compare(version, BuildConfig.VERSION_NAME) <= 0) return;

            JSONArray assets = release.getJSONArray("assets");
            String url = null, expected = null;
            for (int i = 0; i < assets.length(); i++) {
                JSONObject a = assets.getJSONObject(i);
                if (!ASSET.equals(a.optString("name"))) continue;
                url = a.optString("browser_download_url", null);
                String digest = a.optString("digest", "");
                // Without GitHub's digest there is no way to tell a whole
                // download from a truncated one.
                if (digest.startsWith("sha256:")) expected = digest.substring("sha256:".length());
            }
            if (url == null || expected == null) return;

            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File file = new File(dir, "PossibllePOS-" + version + ".apk");
            File part = new File(file.getPath() + ".part");
            if (!download(url, part, expected)) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                Log.w(TAG, "update " + version + " failed its checksum, discarded");
                return;
            }
            if (!part.renameTo(file)) return;

            prefs.edit().putString("version", version).putBoolean("attempted", false).apply();
            readyVersion = version;
            readyFile = file;
            Log.i(TAG, "update " + version + " downloaded");
            announce();
        } catch (Exception e) {
            // Offline, GitHub down, rate-limited: try again at the next check.
            Log.w(TAG, "update check failed: " + e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static boolean download(String url, File to, String sha256) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15_000);
        c.setReadTimeout(60_000);
        try {
            if (c.getResponseCode() != 200) return false;
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[64 * 1024];
                for (int n; (n = in.read(buf)) > 0; ) {
                    hash.update(buf, 0, n);
                    out.write(buf, 0, n);
                }
                out.getFD().sync();
            }
            return hex(hash.digest()).equals(sha256.toLowerCase());
        } finally {
            c.disconnect();
        }
    }

    /** "Yeni versiyanı yüklə": hand the APK to Android, which asks once more. */
    void install() {
        final File file = readyFile;
        if (file == null || !file.exists()) return;

        // The first time, Android must be told this app may install updates.
        // Send the waiter to that switch; pressing the button again goes on.
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            activity.runOnUiThread(() -> activity.startActivity(
                new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))));
            announce();
            return;
        }

        worker.post(() -> {
            try {
                PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(activity.getPackageName());
                int id = installer.createSession(params);
                try (PackageInstaller.Session session = installer.openSession(id)) {
                    try (InputStream in = new FileInputStream(file);
                         OutputStream out = session.openWrite("PossibllePOS.apk", 0, file.length())) {
                        byte[] buf = new byte[64 * 1024];
                        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                        session.fsync(out);
                    }
                    // Marked before the app is replaced: finding it still set on
                    // a start that is not the new version means it failed.
                    prefs.edit().putBoolean("attempted", true).commit();
                    Intent result = new Intent(activity, InstallResult.class);
                    PendingIntent pi = PendingIntent.getBroadcast(activity, id, result,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                    session.commit(pi.getIntentSender());
                }
            } catch (Exception e) {
                Log.w(TAG, "update install failed: " + e.getMessage());
                failed();
            }
        });
    }

    /** Android said no, or the waiter cancelled: offer the button again. */
    private void failed() {
        prefs.edit().putBoolean("attempted", false).apply();
        announce();
    }

    private static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String hex(byte[] bytes) {
        StringBuilder s = new StringBuilder();
        for (byte b : bytes) s.append(String.format("%02x", b));
        return s.toString();
    }

    /** Android's answer to an install: show its confirmation, or report a failure. */
    public static class InstallResult extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(confirm);
                }
                return;
            }
            if (status != PackageInstaller.STATUS_SUCCESS) {
                Log.w(TAG, "update not installed: " + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
                Updater u = current;
                if (u != null) u.failed();
            }
        }
    }
}
