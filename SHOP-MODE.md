# Mağaza modu (shop mode)

A plan, not built yet. A demo exists only as a temporary `SHOP_DEMO` flag in
`app/seller/page.tsx`, which will be reverted.

## Seller page

- Tabs: **Yeni satış**, **Satışlar**, Kassa, Tarixçə, **Qaytarma** (last).
  Kuryerlər only when Çatdırılma is on.
- **Satışlar** always stays, even without delivery (then it is usually empty:
  shop sales are paid at once; only unpaid deliveries wait there).
- The till opens straight on products: no order-type row, no table map, no
  Geri button. Every sale is a plain shop sale.
- The search box on top is also the barcode box ("Barkod skan et və ya məhsul
  axtar..."), ready to type into. A scan adds the item to the cart.
- Cart and payment (Nağd / Kart) are the ones the restaurant till already has.

## Paying a shop sale

- One step: scan, pay, next customer.
- The cart has no "Qeyd" box and no "Mətbəxə çap et" switch (a shop has no
  kitchen).
- The button is **"Ödə · 6.60 ₼"**: it saves the sale and opens payment at once
  (Nağd or Kart).
- After payment the empty "Yeni satış" is back, ready for the next scan.
- Çatdırılma is the exception: it keeps "Sifariş ver" and goes to "Satışlar",
  because the courier pays later.

## Barcode scan

- A barcode reader types the code and presses Enter, like a keyboard.
- Found: the product goes into the cart as 1. Scanning it again makes the same
  line 2, not a second line.
- Not found: a red "Barkod tapılmadı" and nothing is added.
- The scan is caught even when the cursor is not in the search box (same idea
  as the manager card reader, `lib/card-reader`).
- Not possible today: search matches product names only, and products have no
  barcode. To build:
  1. A barcode field on products in the database.
  2. The owner types or scans it in the admin menu.
  3. The till's search box matches barcodes too.

## Order types

- Masa and Takeaway are not shown: a shop has no tables, and every sale is
  already "takeaway".
- Types the owner adds (like "Xarici") are left out of the first version. Later,
  if a shop asks, they could be a wholesale (topdan) price list.
- So at most two: **Mağazada** and **Çatdırılma**. Without delivery only one,
  and no switch shows at all.

## Çatdırılma

- Only when the owner turns Çatdırılma on in the admin panel. Off: no switch,
  no Kuryerlər tab.
- On: a **Mağazada | Çatdırılma** switch next to the search box. Mağazada is
  the default.
- Çatdırılma shows a "Kuryeri seçin" dropdown, red until a courier is picked.
  The cart stays as it is. The sale cannot be sent without a courier.

## Admin: Satışlar (was Sifarişlər)

- The tab is called **Satışlar**.
- Columns: Vaxt · Satış · Ödəniş · Ümumi.
- Each row: the seller and "Qəbz №" in place of the table. No closing time.
- The Ödəniş column says how it was paid: **Nağd**, **Kart** or
  **Nağd + Kart**; a delivery the courier has not paid yet says **Kuryerdə**.
- The place filter shows only when Çatdırılma is on: Mağazada / Çatdırılma.
- Still to add: **qaytarma** (a customer brings an item back and gets the money).

## Admin: Kassa and Maliyyə

- Both stay the same.
- Kassa: a qaytarma takes the money out of the drawer, so the count matches.
- Buying goods from suppliers is not done in Maliyyə: it already lives in
  **Anbar → Bazarlıqlar** (with suppliers and what is owed to them).

## Admin: Məhsullar (was Menyu)

- The tab and page heading are called **Məhsullar**.
- Each product gets a **Barkod** field (scan or type).
- Kept: categories, price, maya dəyəri, pictures, and **sets** (promo deals,
  gift baskets).
- **QR button** stays: it sets whether a product shows on the online (QR) menu.
- Hidden: modifikatorlar, Sex (kitchen station), the Sexlər and Modifikatorlar
  tabs, and "Yemək" (as a type and as a filter).
- Excel import matters most: a shop has hundreds or thousands of products. It
  needs a Barkod column.
- **Sizes (variants):** each size has its own barcode (Fanta 0.33 L and 1 L are
  different). With variants, the product has no barcode of its own; each
  variant row has a Barkod box.
- Barcodes take letters too, not only numbers.
- **Stock:** the product itself is the stock — no recipe or ingredients. Each
  sale takes 1 off it. This already works for Növ "Məhsul".
- Later: printing price labels (etiket) for the shelf.
- **Later: selling by kg** (Satılır: ədədlə / kq ilə, the kg taken off stock, an
  ədəd/kq column in Excel, weight barcodes from a market scale). Not in the
  first version.

## Low-stock warning

- The owner sets a limit per product, for example "warn below 5", **in Anbar**,
  next to the amount in stock (each size has its own). New: Anbar has no limit
  today.
- **Admin, Anbar tab:** a red number on the tab, and the items running low
  listed at the top.
- **Seller page, product card:** a small "3 qalıb" tag. The sale is never
  blocked.

## Admin: Əməkdaşlar

- Kept: **Satıcı** (cashier, PIN through the terminal link) and **Menecer**
  (approves with PIN or card). The terminal link and PINs work the same.
- Hidden: the **Ofisiant** role and **Sex əməkdaşı** (no tables, no kitchen).
- İcazələr: "Hesabdan sonra silmək" and "Hesabdan sonra əlavə etmək" hidden (a
  shop prints no bill before payment). Endirim, Tarixçə, Kassa and Kuryerlər
  kept. New: **Qaytarma**, so the owner decides who may give money back.

## Admin: Anbar

- Stays as it is: Qalıqlar, Bazarlıqlar, Tədarükçülər, Silinmələr, Transferlər,
  Anbarlar.
- **İnqrediyentlər** hidden: they are only for dishes' recipes, and a shop has
  no dishes.
- **Bazarlıq takes barcode scans**: scanning a product adds it to the purchase,
  so received goods go in fast.
- The low-stock limit is set here (see "Low-stock warning").

## "Mağazada", not "Takeaway"

- A shop sale is saved as a Takeaway order, so lists show "Takeaway" on it.
- In a shop it says **"Mağazada"** everywhere: seller Tarixçə and Satışlar,
  admin, and the printed receipt.

## Receipt

- "Sifariş #123" → **"Qəbz #123"**.
- "Takeaway" → **"Mağazada"**.
- "Ofisiant: Kamran" → **"Kassir: Kamran"**.
- The rest stays: name and logo, products, total, Endirim, Nağd/Kart and the
  change given. (Today's layout: `head()` and `receiptLines()` in
  `lib/printer.ts`.)

## Admin: Tənzimləmələr

- Only **Brendinq** and **Girişlər**.
- **Sifariş növləri** hidden: a shop has only Mağazada and Çatdırılma, and
  Çatdırılma has its own on/off switch in Kuryerlər.
- **Xidmət haqqı** hidden: shops do not charge a service fee.

## Admin: Kuryerlər

- Stays the same: the couriers, what each owes, taking money from them.
- Shown only when Çatdırılma is on.

## Admin: side menu

- **Masalar** becomes **Onlayn** (globe icon): only the online menu link,
  "QR sifariş" and "Yalnız menyu baxışı". Halls and tables are hidden.
- **Brendinq** (logo, colour) moves to **Tənzimləmələr → Brendinq**, its own
  sub-tab.

## Restaurant bug to fix (found 2026-11-14)

- "QR sifariş" and "Yalnız menyu baxışı" show only when Masa rejimi is on. A
  restaurant without tables cannot turn them on, so its online menu link opens
  "QR sifariş hal-hazırda aktiv deyil." Fix: show both switches without tables
  too. The server already takes online orders without a table
  (`app/api/guest-order/route.ts`).
- With both off, the admin still shows the link as if it works, and "Yalnız
  menyu baxışı" says "müştərilər sifariş verə bilir" — wrong while QR sifariş is
  off.

## Admin: Statistika

- **Satış tipləri** shows only when Çatdırılma is on, as Mağazada vs Çatdırılma.
  Without delivery there is only one type, so it is hidden.

## Mağaza modu switch

- The **superadmin** chooses **Restoran** or **Mağaza** when creating the
  company. The owner cannot change it: it changes the whole app (tables,
  kitchen, words, receipt).
- The superadmin can change it later. Nothing is lost: a restaurant's tables
  stay saved, only hidden, and come back if it is switched back.

## Qaytarma (returns)

- Its own tab, **last in the side menu**. It opens like Yeni satış: products,
  search, scan — with a red "Qaytarma" cart.
- **With a receipt:** scan or type the receipt number; that sale's products
  show as buttons at the price paid, and no more than was bought can go back.
- **Without a receipt:** scan the products at today's price; the cashier can
  change a line's price if the customer paid differently.
- Money back **Nağd (from Kassa)** or **Karta**. The products go back into
  Anbar, and a "Qaytarma" receipt prints with a minus total.
- **Every return needs a manager**, with or without a receipt: the Qaytarma
  rule in Əməkdaşlar → İcazələr (PIN, kart or both).
- Tarixçə shows a red **Qaytarma** box, and Cəmi is after returns.
- **Every report takes returns off**, and shows them as their own "Qaytarma"
  line: Statistika (income, profit), "Hesabat çap et" (so the cash count
  matches), Top məhsullar (a returned item is not counted as sold), Kassa.
- Seller Tarixçə stays today only; old sales are found by receipt number.
- Agreed with Natiq, 2026-11-14.

## Still to decide

Nothing open right now.
