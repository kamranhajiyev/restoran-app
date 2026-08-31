# Possiblle POS — Windows app

The same web app in a native window. It exists for one reason: a browser is not
allowed to open a socket to a printer on `192.168.x.x`, so kitchen tickets could
never leave the page. This shell can, and that is all it adds.

```
waiter presses "Sifariş ver"
  → DB trigger splits the order by sex → print_jobs rows
  → this app claims its own restaurant's rows (RLS, as the logged-in waiter)
  → sends each to its station's printer over TCP:9100
```

The register's USB receipt printer is unaffected — that still goes over WebUSB
straight from the page.

## For the restaurant

1. Install `PossibllePOS-Setup.exe`.
2. Open it, log in as normal.
3. Admin → Menyu → Sexlər: give each sex its printer IP.

That is the whole setup. No keys, no Node, no config file — the app is signed in
as a person, and RLS keeps it to that restaurant's tickets. This is what replaced
`agent/`, which needed a service-role key on site and could therefore never be
shipped to a customer.

Printers should be **Ethernet with a static IP** (or a DHCP reservation). Wi-Fi
in a kitchen is metal and steam, and a dropped packet is a dish nobody cooks.

## Running many registers

Safe. Each ticket is claimed by exactly one machine before it prints
(`claim_print_jobs()`, `FOR UPDATE SKIP LOCKED`), so two registers cannot both
send the same slip. A register that dies mid-print releases its claim after two
minutes and another picks the ticket up.

The one thing you must not do is run the old `agent/` alongside it — that reads
`pending` directly and would double every ticket.

## Development

```bash
npm run desktop                              # against the live site
POS_APP_URL=http://localhost:3000 npm run desktop   # against a dev server
```

## Building the installer

Only Windows can produce the `.exe`. Push to `main` (or run the workflow by
hand) and **Actions → Desktop (Windows)** builds it; the installer is under the
run's Artifacts. Tagging `v1.0.0` also attaches it to a GitHub Release, which is
a permanent link you can send a restaurant.

Until the `.exe` is code-signed, Windows SmartScreen shows a warning on first
run — "More info" → "Run anyway". A code-signing certificate removes it.
