# Print agent — sex printerləri

Sends each order's items to the printer of the station (**sex**) that prepares
them: the fish to the kitchen, the wine to the bar.

## Why an agent at all

The app runs in the cloud, so it cannot reach `192.168.1.x` inside the
restaurant. A browser cannot open a raw TCP socket either. So one machine on the
restaurant's own network has to carry the tickets to the printers. That's this.

```
waiter presses "Sifariş ver"
  → DB trigger splits the order by sex → print_jobs rows
  → agent (this) → kitchen printer 192.168.1.50
                 → bar printer     192.168.1.51
```

The register's own USB receipt printer is **not** involved and keeps working
exactly as before.

## Setup

**1. The printers.** Ethernet, not Wi-Fi — a kitchen is full of metal and steam,
and a dropped Wi-Fi packet is a dish nobody cooks. Give each printer a **static
IP** (or a DHCP reservation), or the router will hand it a new address one day
and printing will stop with no warning. Port is almost always **9100**.

**2. The app.** Admin → Menyu → Sexlər: create the stations, enter each one's
printer IP, and assign every product to a station.

**3. This agent.** On the register PC:

```bash
cp agent/.env.example agent/.env    # fill in the values
npm install
npm run agent
```

You should see `Print agent up` and `realtime: SUBSCRIBED`. Place a test order.

**4. Autostart.** It must come back after a power cut, or the kitchen goes dark
and nobody notices until the complaints start. On Windows, the simplest reliable
option is a shortcut to `npm run agent` in the Startup folder
(`Win+R` → `shell:startup`).

## What prints

| when | ticket |
|---|---|
| new order | **YENI SIFARIS** — only that station's items |
| items added to an open order | **ƏLAVƏ** — only the new items |
| item removed, or order cancelled | **\*\*\* LƏĞV \*\*\*** — stop cooking these |

No prices: a cook needs the quantity and the dish, and nothing else competing
for the eye.

Tickets print in CP857 (Turkish), selected with `ESC t 13` at the top of every
job, so `ç ğ ı İ ö ş ü` come out as themselves. `ə` is the one exception — no
ESC/POS codepage contains it — so `Şəkərbura` prints as `Şekerbura`. If accented
letters ever come back as garbage, the printer's CP857 index has changed: run
`printCodepageTest()` from `lib/printer.ts` and set `CODEPAGE_CP857` in
`lib/escpos.ts` to whichever index prints correctly.

## When something doesn't print

Every ticket is a row in `print_jobs`, so nothing is ever lost in the air:

- `pending` — queued. A station with no IP set stays here until you set one.
- `printed` — done.
- `failed` — five attempts, all refused. **The seller screen shows a red badge on
  that order**, so the waiter knows the kitchen never got it. Fix the printer and
  press reprint.

Retries back off (2s, 4s, 8s, 16s, 32s), so a printer that's briefly unplugged
recovers on its own instead of being declared dead.

Run only **one** agent per restaurant. Two would race and print duplicate
tickets, and a cook can't tell a duplicate from a real second order.
