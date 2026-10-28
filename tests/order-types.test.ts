// Sifariş növləri: the price change every screen will share (lib/order-types).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  asksForTable, changeFor, changeLabel, cleanOrderTypes, DEFAULT_ORDER_TYPES, menuPriceColumn, NO_CHANGE, orderTypeColumns,
  orderTypeFields, orderTypeProblem, placeWithType, pricedLine, shownTypes, typeExtra, typedPrice, typedTotal, typeFlow, withSwitches, type OrderType,
} from '@/lib/order-types';

describe('typedPrice', () => {
  it('adds manat to each dish', () => {
    expect(typedPrice(2, { sign: 1, amount: 1, unit: 'azn' })).toBe(3);
  });

  it('adds a percent and rounds to the qəpik', () => {
    // 3.30 + 5% = 3.465 → 3.47
    expect(typedPrice(3.3, { sign: 1, amount: 5, unit: '%' })).toBe(3.47);
  });

  it('takes a discount off', () => {
    expect(typedPrice(10, { sign: -1, amount: 10, unit: '%' })).toBe(9);
    expect(typedPrice(10, { sign: -1, amount: 1.5, unit: 'azn' })).toBe(8.5);
  });

  it('never goes below zero', () => {
    expect(typedPrice(0.5, { sign: -1, amount: 1, unit: 'azn' })).toBe(0);
  });

  it('leaves the price alone when there is no change', () => {
    expect(typedPrice(4.2, { sign: 1, amount: 0, unit: '%' })).toBe(4.2);
  });
});

describe('typedTotal', () => {
  // 2 teas at 2 ₼ and a kebab at 10 ₼, +1 ₼ on every dish. The change lives
  // inside the dish prices, so the bill adds up with no extra line.
  const order = [{ price: 2, quantity: 2 }, { price: 10, quantity: 1 }];

  it('is the dishes at their typed prices', () => {
    expect(typedTotal(order, { sign: 1, amount: 1, unit: 'azn' })).toBe(17);
    expect(typedTotal(order, { sign: -1, amount: 10, unit: '%' })).toBe(12.6);
    expect(typedTotal(order, NO_CHANGE)).toBe(14);
  });
});

describe('changeLabel', () => {
  it('says what the admin list shows', () => {
    expect(changeLabel({ sign: 1, amount: 5, unit: '%' })).toBe('+5%');
    expect(changeLabel({ sign: -1, amount: 1, unit: 'azn' })).toBe('−1.00 ₼');
    expect(changeLabel({ sign: 1, amount: 0, unit: 'azn' })).toBe('');
  });
});

describe('cleanOrderTypes', () => {
  it('gives the three built-ins when the company never saved a list', () => {
    expect(cleanOrderTypes(null)).toEqual(DEFAULT_ORDER_TYPES);
    expect(cleanOrderTypes('junk')).toEqual(DEFAULT_ORDER_TYPES);
  });

  it('keeps the owner types after the built-ins, and a built-in price change', () => {
    const list = cleanOrderTypes([
      { id: 'b', name: 'Banket', on: true, needsTable: true, change: { sign: 1, amount: 5, unit: '%' } },
      { id: 'delivery', builtIn: 'delivery', name: 'Çatdırılma', on: true, needsTable: true, change: { sign: 1, amount: 1, unit: 'azn' } },
    ]);
    expect(list.map(t => t.id)).toEqual(['masa', 'takeaway', 'delivery', 'b']);
    expect(list[2].change).toEqual({ sign: 1, amount: 1, unit: 'azn' });
    // A built-in keeps its own table rule whatever the row says.
    expect(list[2].needsTable).toBe(false);
  });

  it('drops rows it cannot use', () => {
    const list = cleanOrderTypes([
      { id: 'x', name: '  ' },
      { name: 'No id' },
      { id: 'g', name: 'Glovo', change: { sign: -1, amount: -3, unit: '%' } },
      { id: 'g', name: 'Glovo again' },
    ]);
    expect(list.map(t => t.name)).toEqual(['Masa', 'Takeaway', 'Çatdırılma', 'Glovo']);
    expect(list[3].change).toEqual(NO_CHANGE);
  });
});

describe('withSwitches', () => {
  it('takes Masa and Çatdırılma on/off from the Masalar and Kuryerlər switches', () => {
    const list = withSwitches(DEFAULT_ORDER_TYPES, { tablesOn: false, deliveryOn: false });
    expect(list.map(t => [t.id, t.on])).toEqual([['masa', false], ['takeaway', true], ['delivery', false]]);
  });
});

describe('the seller flow', () => {
  const banket: OrderType = { id: 'b', name: 'Banket', on: true, needsTable: true, change: { sign: 1, amount: 5, unit: '%' } };
  const glovo: OrderType = { id: 'g', name: 'Glovo', on: false, needsTable: false, change: NO_CHANGE };
  const all = [...DEFAULT_ORDER_TYPES, banket, glovo];

  it('offers the types that are on, Masa and Çatdırılma by their own switches', () => {
    expect(shownTypes(all, { tablesOn: true, deliveryOn: false }).map(t => t.id)).toEqual(['masa', 'takeaway', 'b']);
  });

  it('starts the right flow for each type', () => {
    expect(typeFlow(DEFAULT_ORDER_TYPES[0], true)).toBe('masa');
    expect(typeFlow(DEFAULT_ORDER_TYPES[1], true)).toBe('takeaway');
    expect(typeFlow(DEFAULT_ORDER_TYPES[2], true)).toBe('kuryer');
    expect(typeFlow(banket, true)).toBe('masa');
    // Masalar off: Banket cannot ask for a table.
    expect(typeFlow(banket, false)).toBe('takeaway');
  });

  it('writes the type on the order only when it matters', () => {
    expect(orderTypeFields(DEFAULT_ORDER_TYPES[1])).toEqual({});
    expect(orderTypeFields(null)).toEqual({});
    expect(orderTypeFields(banket)).toEqual({ orderType: 'b', orderTypeName: 'Banket' });
    const pricedTakeaway = { ...DEFAULT_ORDER_TYPES[1], change: { sign: -1, amount: 10, unit: '%' } } as OrderType;
    expect(orderTypeFields(pricedTakeaway)).toEqual({ orderType: 'takeaway', orderTypeName: 'Takeaway' });
  });

  it('prices more lines on an open order the way the order was taken', () => {
    expect(changeFor('b', all)).toEqual(banket.change);
    expect(changeFor(undefined, all)).toEqual(NO_CHANGE);
    expect(changeFor('gone', all)).toEqual(NO_CHANGE);
  });
});

describe('a line going into the cart', () => {
  it('is charged the typed price and keeps the menu price beside it', () => {
    expect(pricedLine(10, { sign: 1, amount: 5, unit: '%' })).toEqual({ price: 10.5, menuPrice: 10 });
    expect(pricedLine(10, { sign: -1, amount: 1, unit: 'azn' })).toEqual({ price: 9, menuPrice: 10 });
  });

  it('carries no menu price when the type changes nothing', () => {
    expect(pricedLine(10, NO_CHANGE)).toEqual({ price: 10 });
  });
});

describe('what the write paths send', () => {
  // An order without a type must send exactly the columns it always did, so a
  // restaurant not using types is untouched, even on a database without them.
  it('sends no type columns for an order without a type', () => {
    expect(orderTypeColumns({})).toEqual({});
    expect(menuPriceColumn({})).toEqual({});
  });

  it('sends the type and the menu price when there are some', () => {
    expect(orderTypeColumns({ orderType: 'b', orderTypeName: 'Banket' })).toEqual({ order_type: 'b', order_type_name: 'Banket' });
    expect(menuPriceColumn({ menuPrice: 10 })).toEqual({ menu_price: 10 });
  });

  it('is used by every place that inserts orders and their lines', () => {
    const read = (f: string) => readFileSync(f, 'utf8');
    for (const f of ['lib/store.ts', 'app/api/add-order/route.ts']) expect(read(f)).toContain('...orderTypeColumns(order)');
    expect(read('lib/store.ts').match(/\.\.\.menuPriceColumn\(oi\)/g)?.length).toBe(2);
    expect(read('app/api/add-order/route.ts')).toContain('...menuPriceColumn(oi)');
    expect(read('app/api/add-order-items/route.ts')).toContain('...menuPriceColumn(oi)');
  });
});

describe('what admin shows', () => {
  // №100073 on testing: Fanta 1.00 → 1.27, Ayran 1.50 → 1.77 under Xarici +0.27 ₼.
  const xarici = [
    { menuItem: { price: 1.27 }, quantity: 1, menuPrice: 1 },
    { menuItem: { price: 1.77 }, quantity: 1, menuPrice: 1.5 },
  ];

  it('adds up what the type added or took off', () => {
    expect(typeExtra(xarici)).toBe(0.54);
    expect(typeExtra([{ menuItem: { price: 9 }, quantity: 2, menuPrice: 10 }])).toBe(-2);
    expect(typeExtra([{ menuItem: { price: 5 }, quantity: 3 }])).toBe(0);
  });

  it('puts the type in front of where the order went', () => {
    expect(placeWithType('Takeaway', { orderTypeName: 'Xarici', tableNumber: 0 })).toBe('Xarici');
    expect(placeWithType('Zal 1 · 5', { orderTypeName: 'Banket', tableNumber: 5 })).toBe('Banket · Zal 1 · 5');
    expect(placeWithType('Takeaway', { tableNumber: 0 })).toBe('Takeaway');
  });
});

describe('asksForTable', () => {
  it('opens the tables only when the type wants them and Masalar is on', () => {
    expect(asksForTable({ needsTable: true }, true)).toBe(true);
    expect(asksForTable({ needsTable: true }, false)).toBe(false);
    expect(asksForTable({ needsTable: false }, true)).toBe(false);
  });
});

describe('orderTypeProblem', () => {
  const banket: OrderType = { id: 'b', name: 'Banket', on: true, needsTable: true, change: { sign: 1, amount: 5, unit: '%' } };
  const all = [...DEFAULT_ORDER_TYPES, banket];

  it('needs a name that is not taken', () => {
    expect(orderTypeProblem({ id: 'new', name: ' ', change: banket.change }, all)).toBe('Ad yazın');
    expect(orderTypeProblem({ id: 'new', name: 'banket', change: banket.change }, all)).toBe('Bu adda sifariş növü artıq var');
    expect(orderTypeProblem({ id: 'b', name: 'Banket', change: banket.change }, all)).toBeNull();
  });

  it('refuses a discount over 100%', () => {
    expect(orderTypeProblem({ id: 'new', name: 'X', change: { sign: -1, amount: 120, unit: '%' } }, all)).toBe('Endirim 100%-dən çox ola bilməz');
  });
});
