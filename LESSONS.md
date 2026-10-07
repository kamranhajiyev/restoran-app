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

## 1. Bad internet (most of our bugs)

Restaurants' internet drops for a few seconds at a time, often mid-action.

**Can this write arrive before something it depends on?**
A payment reached the server before its order and was refused (Latte Art
№4171/№4172, 2026-10-04; №3867, 2026-09-26). If an earlier write for the same
order is still waiting, a later one usually has to wait behind it.

**If this fails, does the till save the failure and stop trying?**
A saved "no" was replayed forever, so the order could never be paid. Only save
an answer that will not change. "Order not found yet" can change.

**Is it safe if this runs twice?**
Lost replies mean the till sends the same thing again. Paying twice must not
charge twice, and adding items twice must not double them.

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
or blanked the menu.

**What does "online" mean here?**
`navigator.onLine` says "wifi exists", not "the server is reachable". Every
network call needs a timeout, or one hung request freezes everything behind it.

## 2. Exe and browser

**Does this work in both the exe and the browser till?**
They take different paths (the exe has a local database and a `pay:` key
replay; the browser has its own IndexedDB queue). A fix in one path often
misses the other.

## 3. Money

**Can the screen calculate a total from data that has not loaded yet?**
A bill that had not loaded could be paid at 0.00.

**Are amounts rounded to 0.01 before comparing?**
6.40 + 1.20 could not be paid at its own total.

**Does every way money moves show up in the shift and day totals?**
Cash, card, courier cash, courier card, courier debt, deletes and refunds.
Courier money once never reached the day's cash.

**Is this number counted by the one shared function, or worked out again here?**
A sale belongs to the shift or range it was made in; a courier paying back an
older order is money arriving (drawer, terminal), not a sale. Every sales box
counts with `lib/history-shifts`. Test Restoran, 2026-10-06: a 28 ₼ delivery
paid back in cash was Nağd in Tarixçə but still Kuryer in Kassa (seller and
admin), which had its own formula; Statistika had a third.

**Is a label naming the number it really shows?**
Latte Art, 2026-10-06: the Terminal box said "kart satışı" but holds courier
card payments for older shifts too, so it is "kart məbləği".

**Does an "all good" mark check everything it sums up?**
A badge on a collapsed row stands for the whole row. Latte Art, 2026-10-07: a
closed shift said "Dəqiq ✓" because cash matched, while the terminal was 1 ₼
short on card; it showed only after opening the row. `lib/shift-check` checks
both.

**Which day does this belong to?**
A business day ends at the company's `work_close` in its own timezone, not at
midnight or in UTC.

## 4. Database

**Has this been run on "restoran testing" first?**
Production only when the owner says so, each time.

**Does a trigger hide its own errors?**
`apply_stock_on_payment` swallows exceptions, so damage arrives with nothing in
any log.

**Is every query and every queued write scoped to one company?**
A till moved to another restaurant must not send the first one's orders.

**If ten changes arrive at once, does the screen download ten times?**
One sale is several realtime changes (order, dishes, payment). Gather them
(`lib/coalesce`) and refresh once. Production logs, 2026-10-07: admin, the
browser till and the kitchen screen re-downloaded 200 orders on every change;
it was most of the egress, and the reads, with no company filter, timed out.

**Could this break when two tills work offline at once?**
Order numbers are guessed on the device while offline, so two tills can pick
the same number.

## 5. Before shipping, try it like a restaurant would

- Turn the internet off in the middle of the action, then back on.
- Press the button twice quickly.
- Reload the page halfway through.
- Do it in the exe and in the browser.
- Check that the shift total still matches the orders.
