# Lessons from real customer bugs

These are **questions to ask**, not rules to obey. Each one comes from a bug a
restaurant actually hit. Before finishing a change, go through the questions
that touch it.

How to use this file:

- A question that does not fit the change is skipped. Say so in one line
  ("not relevant: no network write").
- If following a lesson would break something else, **stop and ask** instead of
  forcing it. A lesson describes a past bug, not every future case.
- If a lesson turns out to be wrong or outdated, fix or delete it here.

How to write one:

- Three parts: the question in bold, one example line (customer, date, what
  broke), and `Guard:` the test or `lib/` function that stops it, or
  `none yet`.
- The question is general, so it catches the next bug of the same kind.
- The full story goes in `LESSONS-HISTORY.md`, not here.
- A new bug that fits an old question gets no new lesson: its story goes in the
  history, and the example changes only if the new one is clearer.
- `Guard: none yet` is a test still to write.

---

## 0. Every change

**Fixed or built one side? Check the other side.**
Nağd and Kart, kassa and admin, exe and browser, screen and paper, first and second, before and after.
Latte Art, 2026-10-06: Kart filled itself from Nağd, but Kart first left Nağd empty.
Guard: `tests/pay-split.test.ts`, `tests/same-numbers-every-screen.test.ts`, `tests/add-again.test.ts`

**Can what a person types be longer than you planned for?**
Test Restoran, 2026-10-06: a note with no spaces pushed the order list off the screen.
Guard: `tests/long-note.test.ts`

**When something is turned off or deleted, is it gone from every list, and still
there where history needs it?**
Test Restoran, 2026-10-06: a deactivated courier was still in the Kuryerlər tab.
Guard: `lib/couriers`, `tests/courier-lists.test.ts`, `tests/login-events-keep-name.test.ts`, `tests/stock-trash.test.ts`

**When something points at an item deleted since, does the screen say so, or
quietly leave it out?**
Natiq, Test Restoran, 2026-10-29: Set 1 held a deleted Dolma; the menu list hid it and the kitchen never got it.
Guard: `tests/set-stations.test.ts`

**When an account or a restaurant is switched off, is it off everywhere, or only
on the screen?**
Code review, 2026-10-08: a switched-off account was logged out, but the database still took its token.
Guard: `tests/inactive-account-closed.test.ts`

**Does the database know who may do this, or only the screen?**
Code review, 2026-10-08: a cashier login could change prices from the browser.
Guard: `tests/owner-only-writes.test.ts`, `tests/shift-owner-lock.test.ts`

**Does the screen say "saved" only after the save said so?**
Code review, 2026-10-08: table edits showed "saved" while the write had failed (Supabase returns errors, it does not throw).
Guard: `tests/table-writes.test.ts`

**When an update leaves something out, does that mean "clear it" or "not
given"? And does a save of the whole list write over what someone else changed?**
Code review, 2026-10-08: a menu import with only name and price wiped every dish's cost and sizes.
Guard: `tests/menu-import-columns.test.ts`, `tests/station-ip-kept.test.ts`

**When something is restored, does everything that left with it come back? Is
the only copy kept until the new one is saved?**
Code review, 2026-10-08: a restored dish came back without its recipe and sold without taking stock.
Guard: `tests/trash-restore.test.ts`, `tests/modifier-links-kept.test.ts`

**Does the code read a column or function that only a new migration adds? Is
that migration on production before the code reaches main?**
İXLAS CAFE, 2026-10-07: the courier list read `deleted_at`, only on testing, and every courier vanished.
Guard: none yet

**Can the button be reached? Does the list it sits in ever show the thing it is for?**
Natiq, Test Restoran, 2026-10-24: "Qaytarıldı" was only for paid courier orders, on a list that shows only open ones; the Hesabat line it fed always read 0.
Guard: `tests/history-report.test.ts`

## 1. Bad internet (most of our bugs)

Restaurants' internet drops for a few seconds at a time, often mid-action.

**Can this write arrive before something it depends on?**
Latte Art, 2026-10-04: a payment reached the server before its order and was refused.
Guard: `tests/offline-net.test.ts`, `tests/exe-till.test.ts`

**Can what this write points to be gone by the time it arrives?**
Code review, 2026-10-08: an order on a deleted table was refused forever and held every payment behind it.
Guard: `tests/deleted-table-order.test.ts`

**If this fails, does the till save the failure and stop trying?**
A saved "no" was replayed forever, so the order could never be paid. Save only an answer that will not change.
Guard: `tests/update-order-status.test.ts`

**Is it safe if this runs twice?**
Lost replies mean the till sends the same thing again; paying twice must not charge twice.
Guard: `tests/exe-till.test.ts`, `tests/stock-safety.test.ts`

**Did it happen, but the "done" got lost?**
Code review, 2026-10-08: a kitchen ticket printed, the report was lost, and it printed again.
Guard: `lib/printed-jobs`, `tests/print-once.test.ts`

**If the internet drops halfway through, what is left behind?**
Test Restoran, 2026-09-14: an order reached the server with no dishes.
Guard: none yet

**Can anything get lost?**
An outage once deleted the orders it was meant to hold. A queued order is never thrown away silently.
Guard: none yet

**When does a waiting write get sent again?**
Sales sat for minutes waiting for the next timer; a queue needs a retry that keeps going.
Guard: none yet

**If this read fails, does the screen take the failure as the answer?**
Code review, 2026-10-08: admin's menu reload failed, became [], and the next edit deleted every dish.
Guard: `lib/keep-on-fail`, `tests/keep-on-fail.test.ts`, `tests/failed-read-not-empty.test.ts`, `tests/menu-wipe.test.ts`

**Is a server that failed read as a server that said no? Does every part of a
sum load, not just the first?**
Code review, 2026-10-08: the queue dropped payments on a 502.
Guard: `tests/sync-server-error.test.ts`, `tests/shift-close-money.test.ts`

**Whose clock says when this happened?**
Code review, 2026-10-08: a sale paid offline at 23:50 counted in the next day, stamped on arrival.
Guard: `lib/client-time`, `tests/client-time.test.ts`

**What does "online" mean here? Does every network call have a timeout?**
Code review, 2026-10-08: "Növbəni aç" had no timeout, and two drains sent each write twice.
Guard: `tests/sync-server-error.test.ts`

## 2. Exe and browser

**Does this work in both the exe and the browser till?**
They take different paths (exe: local database and `pay:` replay; browser: IndexedDB queue).
Guard: `tests/exe-till.test.ts`, `tests/link-order-via-server.test.ts`, `tests/browser-usb-kitchen.test.ts`

**When the exe comes back to the front, can the page take a click?**
Latte Art, 2026-10-09: Kart would not take a click until the payment sheet was reopened.
Guard: `lib/exe-focus`, `tests/exe-focus.test.ts`

**Can every printer be connected the ways the hardware comes: USB and LAN?**
Customer, 2026-10-30: the sexes printed by IP, but the exe's receipt printer was USB only.
Guard: `tests/android-print.test.ts` ("the exe")

**When data refreshes in the background, does a screen someone is reading start
over?**
Exe, 2026-10-08: every 5-minute pull reloaded Tarixçə back to the top.
Guard: `keepSettings`, `tests/keep-settings.test.ts`

**Does something made on this screen look the same as it will after a reload?**
Test Restoran, 2026-10-14: a quick-added set opened in Düzəlt with no Set button until refresh.
Guard: `tests/set-items.test.ts`

**Does a new screen or printout use the same words the till already uses?**
Test Restoran, 2026-10-24: the Hesabat printed "Ləğv" and "Qaytarma" for orders the till calls "ödənişsiz bağlanan".
Guard: `tests/history-report.test.ts`

**When a safety rule blocks an action, does the screen offer to do the blocked part too (after saying what it will remove), instead of sending the user to do it by hand?**
Test Restoran, 2026-10-24: a hall with tables could not be deleted; the owner had to remove every table one by one.
Guard: `tests/hall-delete.test.ts`

**A screen keeps its own copy of the menu (or any list). When it meets an id
that copy does not hold, does it fetch again, or hide the thing?**
Natiq, Test Restoran, 2026-10-29: a set made after the sex screen opened showed at no sex.
Guard: `tests/set-stations.test.ts`

**Does an action on one device reach the others on the same login? When the
server stops taking a login, does the screen say so?**
Natiq, Test Restoran, 2026-10-21: Çıxış on the laptop logged out the phone till too; its kitchen tickets stopped with no message.
Guard: `tests/login-lost.test.ts`

**Does this lean on something only some devices have — a font, a driver, a
codepage, a newer browser? Does the page bring its own?**
Natiq, Test Restoran, 2026-10-21: the Android phone printed "Pivə" as "Piv□"; its font has no ə. (2026-10-22: a Chrome 101 phone could not load the APK at all. 2026-10-23: a Huawei tablet would not even install it.)
Guard: `lib/ticket-font`, `tests/ticket-font.test.ts`, `lib/dates.ts`, `tests/dates.test.ts`, `lib/android-browsers.mjs`, `tests/android-old-phones.test.ts`, `tests/android-update.test.ts`

## 3. Money

**Can the screen calculate a total from data that has not loaded yet?**
A bill that had not loaded could be paid at 0.00.
Guard: none yet

**Are amounts rounded to 0.01 before comparing?**
6.40 + 1.20 could not be paid at its own total.
Guard: `tests/order-format.test.ts`, `tests/pay-split.test.ts`

**Does every way money moves show up in the shift and day totals?**
Cash, card, courier cash, courier card, courier debt, deletes, refunds. Courier money once never reached the day's cash.
Guard: `tests/history-totals.test.ts`, `tests/kassa-courier.test.ts`

**Does this machine hold all of it, or only its own part?**
Code review, 2026-10-08: with two tills, a shift's Terminal figure counted on the machine was short.
Guard: `tests/shift-sales-source.test.ts`

**Is this number counted by the one shared function, or worked out again here?**
Test Restoran, 2026-10-06: a delivery paid back in cash was Nağd in Tarixçə but Kuryer in Kassa.
Guard: `lib/history-shifts`, `tests/history-shifts.test.ts`, `tests/same-numbers-every-screen.test.ts`, `tests/one-order-total.test.ts`

**Does the export add up to the same money as the screen?**
Code review, 2026-10-08: Excel's total counted deleted orders.
Guard: `excelMoney`, `tests/one-order-total.test.ts`

**Is a label naming the number it really shows?**
Latte Art, 2026-10-06: the Terminal box said "kart satışı" but holds older courier card payments too.
Guard: none yet

**Does an "all good" mark check everything it sums up?**
Latte Art, 2026-10-07: a shift said "Dəqiq ✓" while the terminal was 1 ₼ short.
Guard: `lib/shift-check`, `tests/shift-check.test.ts`

**Once something is finished, can a late copy of it write over the result?**
Code review, 2026-10-09: a second close of a shift replaced the counted cash of the first.
Guard: `tests/shift-close-money.test.ts`, `tests/shift-owner-lock.test.ts`

**Which day does this belong to?**
A business day ends at the company's `work_close` in its own timezone, not at midnight or in UTC.
Guard: `lib/business-day`, `tests/keep-settings.test.ts`

## 4. Database

**Has this been run on "restoran testing" first?**
Production only when the owner says so, each time.
Guard: none (a rule, see `AGENTS.md`)

**Does a trigger hide its own errors? Who will see the failure, and what can
they do about it?**
Code review, 2026-10-08: `apply_stock_on_payment` swallowed errors, so stock damage left no trace.
Guard: `tests/stock-failures.test.ts`, `tests/stock-safety.test.ts`

**Can a save that lost its reply be pressed again?**
Code review, 2026-10-08: a stock receipt pressed twice was recorded twice.
Guard: `tests/stock-safety.test.ts`

**Who can call this without logging in, and what does it give them?**
Code review, 2026-10-08: a company id alone gave out orders, phone numbers and staff through /api/public-*.
Guard: `supabase/checks/anon_reach.sql` (must be empty), `tests/anon-doors.test.ts`, `tests/closed-by-default.test.ts`, `tests/public-rpcs-closed.test.ts`, `tests/till-read-auth.test.ts`

**When a door closes to anon, who was still walking through it?**
Parviz, 2026-10-17: the browser link till still inserted orders with the public key; every new order failed.
Guard: `tests/link-order-via-server.test.ts`

**Is every query, queued write and live listener scoped to one company?**
Usage review, 2026-10-14: the till and admin heard every restaurant's changes.
Guard: `lib/company-changes`, `tests/company-changes.test.ts`

**If ten changes arrive at once, does the screen download ten times? Does it
read only the part that changed?**
Production logs, 2026-10-07: every change re-downloaded 200 orders; most of the egress.
Guard: `lib/coalesce`, `lib/data-refresh`, `tests/refresh-burst.test.ts`, `tests/data-refresh.test.ts`

**Can the public key read or change this table? And does anything that needs
it run as the caller?**
Code review, 2026-10-08: anyone could reset order numbers; locking the table alone broke numbering.
Guard: `tests/order-counters-locked.test.ts`

**Could this break when two tills work offline at once? Does a number a till
picks alone hear what the others used?**
Test Restoran, №3436, 2026-09-19: two tills picked the same order number and the sale was refused.
Guard: `tests/order-number-taken.test.ts`, `tests/till-peers.test.ts`

**When a screen hides a field for one kind of item, does the database still
refuse it?**
Test Restoran, 2026-10-14: Ayran (Məhsul) kept an old recipe and never appeared in Anbar.
Guard: `tests/product-takes-itself.test.ts`

**When a change sets something up by itself, does changing it back take that
down?**
Natiq, Test Restoran, 2026-10-16: Dolma turned back into a Yemək kept its Anbar row.
Guard: `tests/kind-change.test.ts`

**Does every shape of a sale reach the stock: alone and inside a set, with
sizes and without, Məhsul and Yemək?**
Owner question, 2026-10-17: "Fanta 0.5L" inside a set took no stock.
Guard: `tests/set-variants.test.ts`, `tests/set-stock.test.ts`, `tests/set-items.test.ts`

## 5. Before shipping, try it like a restaurant would

- Turn the internet off in the middle of the action, then back on.
- Press the button twice quickly.
- Reload the page halfway through.
- Do it in the exe and in the browser.
- Check that the shift total still matches the orders.
