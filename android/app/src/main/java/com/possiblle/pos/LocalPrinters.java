package com.possiblle.pos;

// A receipt printer on the phone itself: a USB cable (OTG) or Bluetooth.
// PrinterBridge's usbList/usbPrint/btList/btPrint call in here; the page picks
// one in "Yazıcı seç" (lib/printer.ts) and remembers it.
//
// Sunmi and similar tills with a printer built in show it as a paired Bluetooth
// device ("InnerPrinter"), so the Bluetooth path covers those too.
//
// Both take the printer for one print and let go after, like the exe
// (lib/printer.ts): nothing else on the device is ever locked out.

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

class LocalPrinters {
    // The serial-port profile every Bluetooth receipt printer speaks.
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String USB_PERMISSION = "com.possiblle.pos.USB_PERMISSION";
    private static final Pattern MAC = Pattern.compile("^([0-9A-F]{2}:){5}[0-9A-F]{2}$");
    private static final Pattern USB_KEY = Pattern.compile("^[0-9a-f]{4}:[0-9a-f]{4}$");
    private static final int USB_CHUNK = 16 * 1024;
    private static final int USB_TIMEOUT_MS = 5_000;
    // Long enough for the cashier to read Android's question and answer it.
    private static final int ASK_MS = 60_000;
    static final int BT_PERMISSION_REQUEST = 7301;

    private final Activity activity;
    private volatile CountDownLatch btAsked;

    LocalPrinters(Activity activity) {
        this.activity = activity;
    }

    // ── USB ────────────────────────────────────────────────────────────────

    private UsbManager usb() {
        return (UsbManager) activity.getSystemService(Context.USB_SERVICE);
    }

    static String usbKey(UsbDevice d) {
        return String.format(Locale.ROOT, "%04x:%04x", d.getVendorId(), d.getProductId());
    }

    /** The interface and bulk-out endpoint to print on, or null when it is not a printer. */
    private static Object[] printPipe(UsbDevice d) {
        Object[] fallback = null;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface intf = d.getInterface(i);
            // A memory stick or a hub has bulk-out too; they are not printers.
            int cls = intf.getInterfaceClass();
            if (cls == UsbConstants.USB_CLASS_MASS_STORAGE || cls == UsbConstants.USB_CLASS_HUB) continue;
            for (int e = 0; e < intf.getEndpointCount(); e++) {
                UsbEndpoint ep = intf.getEndpoint(e);
                if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK || ep.getDirection() != UsbConstants.USB_DIR_OUT) continue;
                if (cls == UsbConstants.USB_CLASS_PRINTER) return new Object[] { intf, ep };
                // Many cheap printers call themselves vendor-specific.
                if (fallback == null) fallback = new Object[] { intf, ep };
            }
        }
        return fallback;
    }

    String usbList() throws Exception {
        JSONArray out = new JSONArray();
        for (UsbDevice d : usb().getDeviceList().values()) {
            if (printPipe(d) == null) continue;
            String name = null;
            try { name = d.getProductName(); } catch (Exception ignored) { /* needs permission on some phones */ }
            out.put(new JSONObject()
                .put("id", usbKey(d))
                .put("name", name != null && !name.trim().isEmpty() ? name.trim() : "USB printer " + usbKey(d)));
        }
        return out.toString();
    }

    // The device's own path changes every time the cable is plugged in, so the
    // printer is found by its vendor and product ID instead.
    private UsbDevice findUsb(String key) {
        for (UsbDevice d : usb().getDeviceList().values()) {
            if (usbKey(d).equals(key)) return d;
        }
        return null;
    }

    /** Asks Android for this printer once per plug-in, as it requires. */
    private boolean usbAllowed(UsbDevice d) throws InterruptedException {
        UsbManager um = usb();
        if (um.hasPermission(d)) return true;
        final CountDownLatch done = new CountDownLatch(1);
        final boolean[] granted = { false };
        BroadcastReceiver answer = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                granted[0] = i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                done.countDown();
            }
        };
        IntentFilter filter = new IntentFilter(USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(answer, filter, Context.RECEIVER_NOT_EXPORTED);
        else activity.registerReceiver(answer, filter);
        try {
            // Mutable so Android can add its answer; addressed to this app only.
            Intent intent = new Intent(USB_PERMISSION).setPackage(activity.getPackageName());
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            um.requestPermission(d, PendingIntent.getBroadcast(activity, 0, intent, flags));
            done.await(ASK_MS, TimeUnit.MILLISECONDS);
            return granted[0] || um.hasPermission(d);
        } finally {
            try { activity.unregisterReceiver(answer); } catch (Exception ignored) { /* already gone */ }
        }
    }

    void usbPrint(String key, byte[] bytes) throws Exception {
        if (key == null || !USB_KEY.matcher(key).matches()) throw new Exception("bad usb printer");
        UsbDevice d = findUsb(key);
        if (d == null) throw new Exception("USB printer not plugged in");
        Object[] pipe = printPipe(d);
        if (pipe == null) throw new Exception("USB device has no print channel");
        if (!usbAllowed(d)) throw new Exception("USB permission refused");
        UsbInterface intf = (UsbInterface) pipe[0];
        UsbEndpoint ep = (UsbEndpoint) pipe[1];
        UsbDeviceConnection c = usb().openDevice(d);
        if (c == null) throw new Exception("USB printer would not open");
        try {
            if (!c.claimInterface(intf, true)) throw new Exception("USB printer busy");
            try {
                for (int off = 0; off < bytes.length; ) {
                    int n = Math.min(USB_CHUNK, bytes.length - off);
                    int sent = c.bulkTransfer(ep, bytes, off, n, USB_TIMEOUT_MS);
                    if (sent <= 0) throw new Exception("USB printer did not take the data");
                    off += sent;
                }
            } finally {
                c.releaseInterface(intf);
            }
        } finally {
            c.close();
        }
    }

    // ── Bluetooth ──────────────────────────────────────────────────────────

    private BluetoothAdapter bluetooth() {
        BluetoothManager m = (BluetoothManager) activity.getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    /** Android 12+ asks the cashier before an app may talk to paired devices. */
    private boolean btAllowed() throws InterruptedException {
        if (Build.VERSION.SDK_INT < 31) return true;
        if (activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) return true;
        CountDownLatch done = new CountDownLatch(1);
        btAsked = done;
        activity.runOnUiThread(() -> activity.requestPermissions(new String[] { Manifest.permission.BLUETOOTH_CONNECT }, BT_PERMISSION_REQUEST));
        done.await(ASK_MS, TimeUnit.MILLISECONDS);
        return activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    /** MainActivity passes Android's answer on here. */
    void permissionAnswered() {
        CountDownLatch done = btAsked;
        if (done != null) done.countDown();
    }

    String btList() throws Exception {
        BluetoothAdapter a = bluetooth();
        if (a == null) throw new Exception("no bluetooth");
        if (!btAllowed()) throw new Exception("bluetooth permission refused");
        if (!a.isEnabled()) throw new Exception("bluetooth off");
        // Only paired devices: pairing is done once in Android's own settings,
        // where the printer's PIN is asked. Printers first.
        List<JSONObject> printers = new ArrayList<>();
        List<JSONObject> others = new ArrayList<>();
        for (BluetoothDevice d : a.getBondedDevices()) {
            String name = d.getName();
            JSONObject row = new JSONObject()
                .put("id", d.getAddress())
                .put("name", name != null && !name.trim().isEmpty() ? name.trim() : d.getAddress());
            BluetoothClass k = d.getBluetoothClass();
            boolean printer = (k != null && k.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING)
                || (name != null && name.toLowerCase(Locale.ROOT).matches(".*(print|pos|innerprinter|xp-|rpp|mtp).*"));
            (printer ? printers : others).add(row);
        }
        JSONArray out = new JSONArray();
        for (JSONObject r : printers) out.put(r);
        for (JSONObject r : others) out.put(r);
        return out.toString();
    }

    void btPrint(String mac, byte[] bytes) throws Exception {
        if (mac == null || !MAC.matcher(mac).matches()) throw new Exception("bad bluetooth printer");
        BluetoothAdapter a = bluetooth();
        if (a == null) throw new Exception("no bluetooth");
        if (!btAllowed()) throw new Exception("bluetooth permission refused");
        if (!a.isEnabled()) throw new Exception("bluetooth off");
        BluetoothDevice d = a.getRemoteDevice(mac);
        try (BluetoothSocket socket = d.createRfcommSocketToServiceRecord(SPP)) {
            socket.connect();
            OutputStream out = socket.getOutputStream();
            out.write(bytes);
            out.flush();
            // write() returns once Android has the bytes, not once the printer
            // does; closing at once cuts the end of a long receipt off. About
            // 20 KB a second is what cheap printers take.
            Thread.sleep(300 + bytes.length / 20);
        }
    }
}
