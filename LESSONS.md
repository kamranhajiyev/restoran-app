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
- Keep it short. Add a lesson only after a real bug, with the date and customer.
- Write the lesson as a general question that would catch the next bug of the
  same kind, not only this one. The real bug is the example under it.

---

## 0. Every change

**Fixed or built one side? Check the other side.**
Nağd and Kart, kassa and admin, exe and browser, first and second, before and
after. Latte Art, 2026-10-06: Tarixçə was fixed but admin still counted shifts
its own way; Kart filled itself from Nağd, but clicking Kart first left Nağd
empty ("Çatışmır 8.00").

**Can what a person types be longer than you planned for?**
Notes, names, addresses: no spaces, hundreds of characters. Test Restoran,
2026-10-06: a note with no spaces pushed the order list off the screen. The
ticket cut it; the screens did not.

**When something is turned off or deleted, is it gone from every list, and still
there where history needs it?**
Pickers, tabs, filters, reports, old orders. One shared rule decides each list
(`lib/couriers`). Test Restoran, 2026-10-06: a deactivated courier was gone from
the new-order picker but still in the seller's Kuryerlər tab, and a courier with
orders could not be deleted at all.

**When an account or a restaurant is switched off, is it off everywhere, or only
on the screen?**
Logging the screen out is not taking the key back. Code review, 2026-10-08:
a deactivated user or restaurant was logged out of the app, but the database
and the server routes still took its token (`get_my_company_id` never checked
"active"). Now the database finds no company for an account that is off
(`20261010_inactive_accounts_closed.sql`) and `requireAuth` refuses it too.

**Does the database know who may do this, or only the screen?**
Hiding a button is not a rule. Code review, 2026-10-08: cashier and kitchen
logins only saw their own screens, but the database checked "same restaurant",
never "owner", so either could change prices, tables, couriers and stock, or
delete orders, from the browser. Setup writes now need the owner
(`20261011_owner_only_writes.sql`). A new admin-only table or function goes on
that list, and `tests/owner-only-writes.test.ts` fails if the till starts to
need one.

**Does the screen say "saved" only after the save said so?**
Supabase returns its errors, it does not throw them; a `try/catch` around it
catches nothing. Code review, 2026-10-08: table edits, hall moves and drags
showed "saved" while the write had failed.

**When an update leaves something out, does that mean "clear it" or "not
given"?**
Only a field the sender really sent may change. Code review, 2026-10-08: a menu
import with only name and price wiped every matched dish's cost and sizes and
showed hidden dishes again, because a missing column read as empty.
The other way round: a save that sends back the whole list writes old values
over what someone else changed meanwhile. The same day, admin's station save
undid a printer IP just set at the till, and kitchen tickets stopped.

**When something is restored, does everything that left with it come back?**
And is the only copy kept until the new one is saved? Code review, 2026-10-08:
deleting a dish deleted its recipe (cascade); "Bərpa et" brought the dish back
without it, so it sold without taking stock and nothing said so. Restore also
threw the trash copy away before saving the dish, and a link to a deleted
modifier set made the menu save drop every dish's sets. Deleting from the trash
removed the photo before the row, so a failed delete left a dish with a broken
picture, and the photo of a duplicate's original went with it.

**Does the code read a column or function that only a new migration adds? Is
that migration on production before the code reaches main?**
A failed read shows an empty list, not an error. İXLAS CAFE, 2026-10-07: the
courier list asked for `deleted_at`, the migration was only on testing, and
every courier vanished from the seller page, admin and exe.

## 1. Bad internet (most of our bugs)

Restaurants' internet drops for a few seconds at a time, often mid-action.

**Can this write arrive before something it depends on?**
A payment reached the server before its order and was refused (Latte Art
№4171/№4172, 2026-10-04; №3867, 2026-09-26). If an earlier write for the same
order is still waiting, a later one usually has to wait behind it.

**Can what this write points to be gone by the time it arrives?**
A queued write is sent minutes or hours later; the owner may have deleted the
table, dish or courier meanwhile. Code review, 2026-10-08: an order on a deleted
table was refused, retried forever, and held every payment behind it. It now
arrives without the table (or deleted seller, or courier). Losing a detail
beats losing the sale.

**If this fails, does the till save the failure and stop trying?**
A saved "no" was replayed forever, so the order could never be paid. Only save
an answer that will not change. "Order not found yet" can change.

**Is it safe if this runs twice?**
Lost replies mean the till sends the same thing again. Paying twice must not
charge twice, and adding items twice must not double them.

**Did it happen, but the "done" got lost?**
Paper cannot be taken back. Code review, 2026-10-08: a kitchen ticket printed,
its "printed" report was lost, and two minutes later it printed again. Remember
the done thing locally before telling the server (`lib/printed-jobs`).

**If the internet drops halfway through, what is left behind?**
A send that died halfway was told it had already arrived, and an order reached
the server with no dishes (Test Restoran, 2026-09-14).

**Can anything get lost?**
An outage once deleted the orders it was meant to hold. A queued order must
never be thrown away silently.

**When does a waiting write get sent again?**
Sales sat for minutes waiting for the next timer. Anything queued needs a retry
that keeps going until it is sent.

**If this read fails, does the screen take the failure as the answer?**
"Failed" is not "empty" and not "closed". Keep what is on screen, and keep where
the seller is (`lib/keep-on-fail`). Test Restoran, 2026-10-06: on a blip the till
jumped to Sifarişlər, showed "Növbəni aç", lost the category the seller was in,
or blanked the menu. Code review, 2026-10-08: a route that answers its own
failure with 200 and an empty list is the same bug on the server — the exe saved
an empty staff list over its own, and nobody could sign in with a PIN.
The same day, worse: admin's menu reload failed, the menu became [], and the
next edit saved that list, which deletes every dish not in it. A failed read
must never reach a save that removes what is missing (`saveMenu` now refuses).
Statistics showed 0 ₼ for a failed day and cached it; the kitchen screen stayed
empty after a failed first load and never tried again. A filter against a list
that failed to load is the same bug: saving a dish dropped every modifier set
not in the (empty) list of sets.

**Is a server that failed read as a server that said no?**
A 5xx, a timeout, a revoked link or an unknown company will change; a refusal
will not. Code review, 2026-10-08: the queue dropped payments on a 502, on a
new till link, and every write of a signed-in exe (`lib/sync.ts`); closing a
shift on a failed sales read saved 0 ₼ as its takings. Code review, 2026-10-09:
the signed-in path still took a failed courier card read as 0, and the shift
closed with its Terminal figure short. Every part of a sum must load, not just
the first.

**Whose clock says when this happened?**
A write that waited in the queue arrives late. Stamped on arrival, a sale paid
offline at 23:50 counted in the next shift and the next day. Code review,
2026-10-08: the till now sends its own time (`lib/client-time`).

**What does "online" mean here?**
`navigator.onLine` says "wifi exists", not "the server is reachable". Every
network call needs a timeout, or one hung request freezes everything behind it.
Code review, 2026-10-08: the queue's send, the direct send and "Növbəni aç" had
none, and two drains could run at once and send each write twice.

## 2. Exe and browser

**Does this work in both the exe and the browser till?**
They take different paths (the exe has a local database and a `pay:` key
replay; the browser has its own IndexedDB queue). A fix in one path often
misses the other.

**When data refreshes in the background, does a screen someone is reading start
over?**
A re-read that says the same thing must not count as a change. Exe, 2026-10-08:
every 5-minute pull re-read the company settings into a new object, and Tarixçə
reloaded on it — "Yüklənir...", back to the top (`keepSettings`).

## 3. Money

**Can the screen calculate a total from data that has not loaded yet?**
A bill that had not loaded could be paid at 0.00.

**Are amounts rounded to 0.01 before comparing?**
6.40 + 1.20 could not be paid at its own total.

**Does every way money moves show up in the shift and day totals?**
Cash, card, courier cash, courier card, courier debt, deletes and refunds.
Courier money once never reached the day's cash.

**Does this machine hold all of it, or only its own part?**
The exe's database has every order but only the courier payments it took.
Code review, 2026-10-08: with two tills, a shift's Terminal figure counted on
the machine was short; it now asks the server when nothing is unsent.

**Is this number counted by the one shared function, or worked out again here?**
A sale belongs to the shift or range it was made in; a courier paying back an
older order is money arriving (drawer, terminal), not a sale. Every sales box
counts with `lib/history-shifts`. Test Restoran, 2026-10-06: a 28 ₼ delivery
paid back in cash was Nağd in Tarixçə but still Kuryer in Kassa (seller and
admin), which had its own formula; Statistika had a third.

**Does the export add up to the same money as the screen?**
An owner sums the columns. Code review, 2026-10-08: Excel's total counted
deleted orders, and its Nağd and Kart left out courier money, which the screen
counts (`excelMoney`).

**Is a label naming the number it really shows?**
Latte Art, 2026-10-06: the Terminal box said "kart satışı" but holds courier
card payments for older shifts too, so it is "kart məbləği".

**Does an "all good" mark check everything it sums up?**
A badge on a collapsed row stands for the whole row. Latte Art, 2026-10-07: a
closed shift said "Dəqiq ✓" because cash matched, while the terminal was 1 ₼
short on card; it showed only after opening the row. `lib/shift-check` checks
both.

**Once something is finished, can a late copy of it write over the result?**
Paid orders and closed shifts are final. Code review, 2026-10-09: a second close
of a shift (another till, or one that was offline) replaced the counted cash of
the first. Write only while it is still open, and answer the late one "done".

**Which day does this belong to?**
A business day ends at the company's `work_close` in its own timezone, not at
midnight or in UTC.

## 4. Database

**Has this been run on "restoran testing" first?**
Production only when the owner says so, each time.

**Does a trigger hide its own errors?**
`apply_stock_on_payment` swallowed exceptions, so damage arrived with nothing in
any log. Code review, 2026-10-08: it still lets the payment through, but now
raises a warning ("stock not applied"). Catching is fine; catching silently is
not. And a log nobody reads is still silent: the same day the order got
`stock_error`, shown in Anbar with a retry. Who will see this failure, and what
can they do about it?

**Can a save that lost its reply be pressed again?**
Not only the till retries: an owner presses Save again too. Code review,
2026-10-08: a stock receipt, write-off or transfer was recorded twice; each
screen now sends one id, and the database keeps the first.

**Who can call this without logging in, and what does it give them?**
The public anon key is in every browser; treat it as anyone. It gets only what
the QR menu needs. Every new table, column or function is closed to it (RLS on,
`revoke execute ... from public, anon`); a till goes through a server route
that checks its link. Four holes on 2026-10-08 were each one of these forgotten.
A company id is not a secret — it sits in links and pages. Code review,
2026-10-08: the /api/public-* reads checked the till link only when one was
sent, so the id alone gave out orders, phone numbers and staff
(`READS_NEED_TOKEN`). A safety switch left off is no safety. The same day: the
link itself, `companies.seller_token`, was readable by anyone through the
public key, because the table is open for the slug lookup. A secret must not
sit in a column the browser can read. And a check that runs only "if someone is
signed in" lets the public key straight past it: `add_courier_payment` and
`cancel_courier_order` worked on any restaurant for anon. The QR menu inserted
orders with the public key, so anyone could post a paid order at any price
into any restaurant; a guest now sends only what they picked, and the server
sets the price and the status (`/api/guest-order`). Signed-in is not trusted
either: `staff.pin_hash` was readable by every employee, and a four-digit
PIN's hash is guessed in seconds. Storage is a table too: the photo bucket let
anyone upload, replace or delete every restaurant's photos and logos. Files go
under their company's folder, and the policies check that folder.
Finding these one at a time kept missing some, so they were closed all at once
(`20261009_close_anon_doors.sql`): anon keeps reading companies and three QR
menu functions. Is what you open on the list, with a reason? Run
`supabase/checks/anon_reach.sql`; empty is the only good answer.

**Is every query and every queued write scoped to one company?**
A till moved to another restaurant must not send the first one's orders.

**If ten changes arrive at once, does the screen download ten times?**
One sale is several realtime changes (order, dishes, payment). Gather them
(`lib/coalesce`) and refresh once. Production logs, 2026-10-07: admin, the
browser till and the kitchen screen re-downloaded 200 orders on every change;
it was most of the egress, and the reads, with no company filter, timed out.

**Can the public key read or change this table? And does anything that needs
it run as the caller?**
Code review, 2026-10-08: `company_order_counters` had no row level security,
so anyone could reset order numbers; locking it alone broke numbering, because
the trigger ran as the person inserting the order. Lock the table and make the
trigger `security definer` together.

**Could this break when two tills work offline at once?**
Order numbers are guessed on the device while offline, so two tills can pick
the same number. Test Restoran, №3436, 2026-09-19: the taken number refused the
sale; now the server renumbers it (`app/api/add-order`, tested 2026-10-08).
A renumbered order no longer matches its paper, so the exes also tell each
other their highest number over the Wi-Fi (`electron/till-peers`). Does a
number the till picks on its own have a way to hear what the other tills used?

## 5. Before shipping, try it like a restaurant would

- Turn the internet off in the middle of the action, then back on.
- Press the button twice quickly.
- Reload the page halfway through.
- Do it in the exe and in the browser.
- Check that the shift total still matches the orders.
