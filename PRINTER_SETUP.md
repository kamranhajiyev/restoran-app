# Printer Setup — Xprinter XP-Q806K

## How it works
The web app uses **WebUSB** (built into Chrome/Edge) to send raw ESC/POS commands directly to the printer — no drivers or extra software needed, except the one-time Zadig step below.

## One-time setup on the POS computer

### 1. Install Zadig (replace USB driver)
1. Download **Zadig** from [zadig.akeo.ie](https://zadig.akeo.ie)
2. Run as **Administrator**
3. Go to **Options → List All Devices**
4. Select **"USB printer driver for VID_1fc9&PID_2016"**
5. Set target driver to **WinUSB**
6. Click **Replace Driver** (or Reinstall Driver if already WinUSB)

> ⚠️ After this step, Poster POS will lose access to the printer because Poster requires the original Windows USB driver. You must choose one or the other.

### 2. Pair printer in the browser
1. Open the app in **Chrome or Edge** (WebUSB is not supported in Firefox)
2. Go to **Admin → Profile → Printer section**
3. Click **"Yazıcı seç"**
4. A browser dialog appears — select **"USB Printer P"**
5. Click **Bağlan**

The browser remembers this choice. On next page load, the printer reconnects automatically.

## To restore Poster (revert to original driver)
1. Open **Device Manager** (right-click Start)
2. Expand **Устройства USB / USB Devices**
3. Right-click **"USB printer driver for VID_1fc9&PID_2016"**
4. Click **Удалить устройство** (Delete device) — check "delete driver software"
5. Unplug the USB cable → wait 5 seconds → plug back in
6. Windows installs the original driver automatically → Poster works again

> After restoring, our app's WebUSB printing will no longer work until Zadig is run again.

## Cash drawer
The cash drawer connects to the printer's RJ11 port. It opens automatically when a cash payment is made on the seller page, or via the **"Pul çəkməcəsi"** button on the admin page.

## Troubleshooting
- **"Yazıcı tapılmadı" after page reload** → click "Yazıcı seç" again to re-pair
- **"Çap alınmadı"** → unplug/replug USB cable, then re-pair
- **Browser dialog is empty** → Zadig step was not done or driver was reverted
- **Only works in Chrome/Edge** — Firefox and Safari do not support WebUSB
