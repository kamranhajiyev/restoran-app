// A line already sent to the kitchen had only a "−" in Əlavə, so a seller
// wanting one more Fanta looked for a "+" that wasn't there (Test Restoran,
// 2026-10-19). The "+" adds one more as a new line, the same as tapping the
// product in the menu, and never brings back a product taken off the menu.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { addAgainLine, mergeLines, rowToGiveBack, rowToTakeFrom, submitButton, takeBackOne } from '@/lib/add-again';
import { CartItems } from '@/components/seller/CartItems';
import type { MenuItem, Order, OrderItem } from '@/types';
import { itemLines } from '@/lib/printer';

const fanta: MenuItem = {
  id: 'f', name: 'Fanta', price: 1, category: 'İçki', available: true,
  variants: [{ id: 'v33', name: '0.33 L', price: 1 }, { id: 'v5', name: '0.5 L', price: 1.5 }],
} as MenuItem;
const ayran: MenuItem = { id: 'a', name: 'Ayran', price: 1.2, category: 'İçki', available: true };

describe('adding one more of a line already on the order', () => {
  it('adds the product as the menu has it today', () => {
    const oi: OrderItem = { id: 'r1', menuItem: { ...ayran, price: 1 }, quantity: 1 };
    expect(addAgainLine(oi, [ayran])).toEqual({ item: ayran });
  });

  it('keeps the size and options the seller picked', () => {
    const oi: OrderItem = { id: 'r2', menuItem: { ...fanta, price: 1 }, quantity: 1, modifiers: '0.33 L', variantId: 'v33' };
    expect(addAgainLine(oi, [fanta])).toEqual({
      item: { ...fanta, price: 1 }, mods: '0.33 L', variantId: 'v33', detail: undefined,
    });
  });

  it('is not offered for a product switched off or deleted since', () => {
    const oi: OrderItem = { id: 'r3', menuItem: ayran, quantity: 1 };
    expect(addAgainLine(oi, [{ ...ayran, available: false }])).toBeNull();
    expect(addAgainLine(oi, [])).toBeNull();
  });

  it('is not offered for a size the product no longer has', () => {
    const oi: OrderItem = { id: 'r4', menuItem: fanta, quantity: 1, modifiers: '1 L', variantId: 'gone' };
    expect(addAgainLine(oi, [fanta])).toBeNull();
  });

  it('shows a + beside the line only when it can be added', () => {
    const render = (addAgain: (oi: OrderItem) => (() => void) | null) => renderToStaticMarkup(createElement(CartItems, {
      cart: [], existingItems: [{ id: 'r1', menuItem: ayran, quantity: 1 }],
      addToCart: () => {}, removeFromCart: () => {}, onDecrementExisting: () => {}, addAgain,
    }));
    expect(render(() => () => {})).toContain('title="Bir ədəd əlavə et"');
    expect(render(() => null)).not.toContain('title="Bir ədəd əlavə et"');
  });
});

// One Fanta was taken off, then "+" pressed ten times: the kitchen would have
// got a cancel slip for one and a new ticket for ten (Test Restoran, 2026-10-19).
describe('"+" on a line with a removal waiting', () => {
  it('takes back one waiting removal at a time', () => {
    expect(takeBackOne({ r1: 2, r2: 1 }, 'r1')).toEqual({ r1: 1, r2: 1 });
    expect(takeBackOne({ r1: 1, r2: 1 }, 'r1')).toEqual({ r2: 1 });
  });

  it('undoes the removal instead of adding a new line', () => {
    const added: string[] = [];
    const taken: string[] = [];
    const oi: OrderItem = { id: 'r1', menuItem: ayran, quantity: 1 };
    const el = CartItems({
      cart: [], existingItems: [oi], pendingRemovals: { r1: 1 },
      addToCart: () => {}, removeFromCart: () => {}, onDecrementExisting: () => {},
      onTakeBackOne: o => taken.push(o.id!),
      addAgain: o => () => added.push(o.id!),
    });
    const plus = findByTitle(el, 'Bir ədəd əlavə et');
    expect(plus).toBeTruthy();
    plus!.props.onClick();
    expect(taken).toEqual(['r1']);
    expect(added).toEqual([]);
  });

  // A separate undo button beside − and + did what "+" already does, and left
  // the seller guessing which of three to press (Test Restoran, 2026-10-20).
  it('is the only undo: the row has just − and +', () => {
    // Every handler the seller page has, including the old undo one.
    const handlers = { onTakeBackOne: () => {}, addAgain: () => () => {}, onUnstageRemoval: () => {} };
    const html = renderToStaticMarkup(createElement(CartItems, {
      cart: [], existingItems: [{ id: 'r1', menuItem: ayran, quantity: 3 }], pendingRemovals: { r1: 2 },
      addToCart: () => {}, removeFromCart: () => {}, onDecrementExisting: () => {},
      ...(handlers as object),
    }));
    const row = html.slice(html.indexOf('Ayran'), html.indexOf('</li>'));
    expect(row.match(/<button/g)).toHaveLength(2);
    expect(html).not.toContain('Silinməni ləğv et');
  });
});

// Limonad 5 on the order with 3 more read "+3 … 5 əd", while Ayran with 2 taken
// off read "−2 … 3 əd": one count left the change out, the other took it in
// (Test Restoran, 2026-10-20). The count is what the order will hold.
describe('the count on a line in Mövcud', () => {
  const limonad: MenuItem = { id: 'l', name: 'Limonad', price: 2, category: 'İçki', available: true };
  const render = (props: Partial<Parameters<typeof CartItems>[0]>) => renderToStaticMarkup(createElement(CartItems, {
    cart: [], addToCart: () => {}, removeFromCart: () => {}, ...props,
  }));

  it('includes units being added', () => {
    const html = render({ existingItems: [{ id: 'r1', menuItem: limonad, quantity: 5 }], cart: [{ menuItem: limonad, quantity: 3 }] });
    expect(html).toContain('8 əd');
  });

  it('leaves out units being taken off', () => {
    const html = render({ existingItems: [{ id: 'r1', menuItem: limonad, quantity: 5 }], pendingRemovals: { r1: 2 } });
    expect(html).toContain('3 əd');
  });
});

// A red "Silinməni əlavə et" sat above the green "Əlavə et": two "add" buttons,
// and the red one took things off (Test Restoran, 2026-10-20). The green one
// already sent removals too, so it is now the only button.
describe('one button sends the whole edit', () => {
  const base = { appending: true, cartCount: 0, removals: 0, noteChanged: false, busy: false };

  it('has no red button in the panel', () => {
    const limonad: MenuItem = { id: 'l', name: 'Limonad', price: 2, category: 'İçki', available: true };
    const html = renderToStaticMarkup(createElement(CartItems, {
      cart: [], existingItems: [{ id: 'r1', menuItem: limonad, quantity: 5 }], pendingRemovals: { r1: 2 },
      addToCart: () => {}, removeFromCart: () => {},
      ...({ onCommitRemovals: () => {} } as object),
    }));
    expect(html).not.toContain('Silinməni əlavə et');
    expect(html).not.toContain('bg-red-600');
  });

  it('can be pressed with only removals, and says "Yadda saxla"', () => {
    expect(submitButton({ ...base, removals: 2 })).toEqual({ label: 'Yadda saxla', disabled: false });
  });

  it('says "Əlavə et" when something is added, removals or not', () => {
    expect(submitButton({ ...base, cartCount: 1, removals: 2 }).label).toBe('Əlavə et');
  });

  it('still sends a changed note on its own', () => {
    expect(submitButton({ ...base, noteChanged: true })).toEqual({ label: 'Qeydi göndər', disabled: false });
  });

  it('cannot be pressed with nothing to send, or while sending', () => {
    expect(submitButton(base).disabled).toBe(true);
    expect(submitButton({ ...base, cartCount: 1, busy: true })).toEqual({ label: 'Göndərilir...', disabled: true });
  });

  it('on a new order needs something in the cart', () => {
    expect(submitButton({ ...base, appending: false })).toEqual({ label: 'Sifariş ver', disabled: true });
    expect(submitButton({ ...base, appending: false, cartCount: 1 }).disabled).toBe(false);
  });
});

// Walks a rendered tree (no DOM in these tests) to find a button by its title.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findByTitle(node: any, title: string): any {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const f = findByTitle(n, title); if (f) return f; }
    return null;
  }
  if (node.props?.title === title) return node;
  return findByTitle(node.props?.children, title);
}

// Fanta showed three times — once under Mövcud at "1 əd", twice below — and the
// seller couldn't tell what was already in the kitchen (Test Restoran, 2026-10-19).
describe('telling the kitchen\'s lines from the new ones', () => {
  const small: OrderItem = { id: 'r1', menuItem: fanta, quantity: 1, modifiers: '0.33 L', variantId: 'v33' };
  const cart: OrderItem[] = [
    { menuItem: fanta, quantity: 2, modifiers: '0.33 L', variantId: 'v33' },
    { menuItem: { ...fanta, price: 2 }, quantity: 3, modifiers: '0.5 L', variantId: 'v5' },
  ];

  it('puts new units of a dish on its line, and only other dishes under YENİ', () => {
    const { lines, extra } = mergeLines([small], cart, {});
    expect(lines).toHaveLength(1);
    expect(lines[0].added.reduce((s, ci) => s + ci.quantity, 0)).toBe(2);
    expect(extra).toEqual([]);
    expect(lines[0].newSizes.map(ci => ci.modifiers)).toEqual(['0.5 L']);
  });

  it('marks the old line +2 and heads the new lines YENİ', () => {
    const html = renderToStaticMarkup(createElement(CartItems, {
      cart: [...cart, { menuItem: ayran, quantity: 1 }], existingItems: [small], addToCart: () => {}, removeFromCart: () => {},
    }));
    expect(html).toContain('+2<');
    expect(html).toContain('YENİ');
    expect(html.indexOf('YENİ')).toBeGreaterThan(html.indexOf('Mövcud'));
    // Fanta 0.33 L is on the order, so it is not listed again under YENİ.
    expect(html.slice(html.indexOf('YENİ'))).not.toContain('0.33 L');
  });

  it('has no YENİ heading on a fresh order, where everything is new', () => {
    const html = renderToStaticMarkup(createElement(CartItems, {
      cart, addToCart: () => {}, removeFromCart: () => {},
    }));
    expect(html).not.toContain('YENİ');
  });
});

// Beer ordered in five batches showed as "Piva 1 əd" five times; the seller
// counted by hand (customer till, 2026-10-19).
describe('one line per dish in Mövcud', () => {
  const piva: MenuItem = { id: 'p', name: 'Piva NZS 0.4 ml', price: 1.7, category: 'İçki', available: true };
  const batches: OrderItem[] = [1, 2, 3, 4, 5].map(n => ({ id: 'b' + n, menuItem: piva, quantity: 1 }));

  it('adds up the batches into one line', () => {
    const { lines } = mergeLines(batches, [], {});
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(5);
  });

  it('keeps a dish at another price on its own line', () => {
    const { lines } = mergeLines([...batches, { id: 'b6', menuItem: { ...piva, price: 2 }, quantity: 1 }], [], {});
    expect(lines.map(l => l.quantity)).toEqual([5, 1]);
  });

  it('takes "−" from the newest row with something left, and gives back to the newest waiting', () => {
    const staged = { b5: 1 };
    const [line] = mergeLines(batches, [], staged).lines;
    expect(line.off).toBe(1);
    expect(rowToTakeFrom(line, staged)?.id).toBe('b4');
    expect(rowToGiveBack(line, staged)?.id).toBe('b5');
  });

  it('shows "5 əd" once on the screen', () => {
    const html = renderToStaticMarkup(createElement(CartItems, {
      cart: [], existingItems: batches, addToCart: () => {}, removeFromCart: () => {},
    }));
    expect(html.match(/Piva NZS/g)).toHaveLength(1);
    expect(html).toContain('5 əd');
  });

  it('"−" takes back a new unit before touching what the kitchen has', () => {
    const removed: string[] = [];
    const decremented: string[] = [];
    const el = CartItems({
      cart: [{ menuItem: piva, quantity: 1 }], existingItems: batches,
      addToCart: () => {}, removeFromCart: id => removed.push(id),
      onDecrementExisting: o => decremented.push(o.id!),
    });
    findByTitle(el, 'Bir ədəd azalt')!.props.onClick();
    expect(removed).toEqual(['p']);
    expect(decremented).toEqual([]);
  });
});

// The "+1" sat inside the name, and a long "Fanta (0.5 L)" cut it off, so the
// seller saw nothing happen; then bigger letters cut names to "Fan…" (Test
// Restoran, 2026-10-20). The name now wraps instead of being cut.
describe('a long name in Mövcud', () => {
  it('is shown whole, with the +N beside it', () => {
    const fanta5: OrderItem = { id: 'r1', menuItem: { ...fanta, price: 2 }, quantity: 1, modifiers: '0.5 L', variantId: 'v5' };
    const html = renderToStaticMarkup(createElement(CartItems, {
      cart: [{ menuItem: { ...fanta, price: 2 }, quantity: 1, modifiers: '0.5 L', variantId: 'v5' }],
      existingItems: [fanta5], addToCart: () => {}, removeFromCart: () => {},
    }));
    const mövcud = html.slice(html.indexOf('Mövcud'), html.indexOf('</ul>'));
    expect(mövcud).not.toContain('truncate');
    expect(mövcud).toMatch(/text-green-600[^"]*">\+1</);
    expect(mövcud).toContain('0.5 L');
  });
});

// Fanta 2 L landed under YENİ, far from the Fanta 0.5 L already on the order
// (Test Restoran, 2026-10-20). Another size of a product on the order sits
// right under it; YENİ is only for products not on the order at all.
describe('a new size of a product already on the order', () => {
  const half: OrderItem = { id: 'r1', menuItem: { ...fanta, price: 1.5 }, quantity: 1, modifiers: '0.5 L', variantId: 'v5' };
  const big: OrderItem = { menuItem: { ...fanta, price: 4 }, quantity: 1, modifiers: '2 L', variantId: 'v2' };
  const ayranNew: OrderItem = { menuItem: ayran, quantity: 1 };

  it('goes under that product, not under YENİ', () => {
    const { lines, extra } = mergeLines([half], [big, ayranNew], {});
    expect(lines[0].newSizes).toEqual([big]);
    expect(extra).toEqual([ayranNew]);
  });

  it('is shown right after the old line, before YENİ', () => {
    const html = renderToStaticMarkup(createElement(CartItems, {
      cart: [big, ayranNew], existingItems: [half], addToCart: () => {}, removeFromCart: () => {},
    }));
    expect(html.indexOf('2 L')).toBeGreaterThan(html.indexOf('0.5 L'));
    expect(html.indexOf('2 L')).toBeLessThan(html.indexOf('YENİ'));
    expect(html.slice(html.indexOf('YENİ'))).toContain('Ayran');
  });
});

// Limonad ordered 5, then 3 more, printed as "Limonad 5x" and "Limonad 3x" on
// the guest's receipt (Test Restoran, 2026-10-20).
describe('the guest receipt and bill', () => {
  const limonad: MenuItem = { id: 'l', name: 'Limonad', price: 2, category: 'İçki', available: true };
  const order = (items: OrderItem[]) => ({ items } as Order);

  it('prints one line per dish, as the till shows it', () => {
    const lines = itemLines(order([
      { id: 'r1', menuItem: limonad, quantity: 5 },
      { id: 'r2', menuItem: ayran, quantity: 3 },
      { id: 'r3', menuItem: limonad, quantity: 3 },
    ])).map(l => l.text);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Limonad\s+8x\s+16\.00m$/);
  });

  it('keeps another price or size on its own line', () => {
    const lines = itemLines(order([
      { id: 'r1', menuItem: limonad, quantity: 5 },
      { id: 'r2', menuItem: { ...limonad, price: 2.5 }, quantity: 1 },
      { id: 'r3', menuItem: fanta, quantity: 1, modifiers: '0.33 L', variantId: 'v33' },
      { id: 'r4', menuItem: fanta, quantity: 1, modifiers: '0.5 L', variantId: 'v5' },
    ]));
    expect(lines).toHaveLength(4);
  });
});
