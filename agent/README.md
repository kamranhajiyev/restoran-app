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
| items added to an open order | **ELAVE** — only the new items |
| item removed, or order cancelled | **\*\*\* LEGV \*\*\*** — stop cooking these |

No prices: a cook needs the quantity and the dish, and nothing else competing
for the eye.

Azerbaijani letters are transliterated (`Balıq` → `Baliq`) because the printer's
character set has no `ə`, `ğ`, `ı`, `ş`.

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
