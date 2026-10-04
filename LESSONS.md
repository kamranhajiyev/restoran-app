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

---

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

**Could this break when two tills work offline at once?**
Order numbers are guessed on the device while offline, so two tills can pick
the same number.

## 5. Before shipping, try it like a restaurant would

- Turn the internet off in the middle of the action, then back on.
- Press the button twice quickly.
- Reload the page halfway through.
- Do it in the exe and in the browser.
- Check that the shift total still matches the orders.
