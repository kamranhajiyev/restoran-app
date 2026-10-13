-- Maliyyə: cash that left the drawer between two shifts, unwritten.
--
-- A shift counted 133 ₼, someone took it, the next shift opened with 0: the
-- account went on counting the 133. The admin page now shows the gap between
-- what one shift counted and what the next opened with (lib/finance.ts) and
-- asks the owner where it went. The answer is an ordinary transaction that
-- names the shift whose opening showed the gap.
alter table public.finance_transactions
  add column if not exists gap_shift_id uuid references public.cash_shifts(id) on delete set null;
