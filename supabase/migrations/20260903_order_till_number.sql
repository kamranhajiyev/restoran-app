-- Which till took the order.
--
-- Order numbers come from one counter per company, and until the desktop till
-- existed that counter was the only thing issuing them, so they were unique by
-- construction. An offline till has to number an order the moment it is taken —
-- the number goes on the guest's receipt and the kitchen slip right then — and
-- it has nothing to ask. It uses its own local maximum.
--
-- With one till that is exactly right. With two, and the restaurant's line down
-- (which is the normal case: the internet dies for the whole building at once),
-- both tills reach 45 and two different guests hold a receipt saying №45.
--
-- Nothing breaks — an order is identified by its uuid, and no constraint here
-- has ever required order_number to be unique. What breaks is the conversation:
-- a waiter calling "45" is ambiguous, and so is the row in the night's report.
--
-- So each till is given a small number of its own, and it travels with the
-- order. The screen and the paper show №45/2 where it matters. Till 1 — and
-- every restaurant with a single till, which is most of them — shows №45,
-- unchanged.
--
-- Null on every order taken before this, and on every order from the web till
-- and the QR menu, which are numbered by the server and cannot collide.
alter table public.orders
  add column if not exists till_number smallint;

comment on column public.orders.till_number is
  'Which desktop till issued order_number, 1-9. Null = numbered by the server.';
