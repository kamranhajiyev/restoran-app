// The Android till's offline database (lib/android-till.ts): the exe's till
// code from lib/till-store/, run in the page over three SQL calls on
// window.PosAndroid. Here those calls are a fake TillDb.java over node:sqlite,
// answering in the same JSON, so the tests run the real shared code.

import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@/types';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

type Answer = (id: string, error: string | null, result: string | null) => void;

const C = 'company-1';
const SITE = 'https://www.possiblle.com';

/** TillDb.java, in TypeScript: one statement per call, JSON answers, never throws. */
function fakeTillDb() {
  const db = new DatabaseSync(':memory:');
  const wrap = (fn: () => unknown) => {
    try { return JSON.stringify(fn() ?? {}); } catch (e) { return JSON.stringify({ error: (e as Error).message }); }
  };
  const statementsRun: string[] = [];
  return {
    statementsRun,
    sqlExec: (sql: string) => wrap(() => {
      statementsRun.push(sql);
      // Java's execSQL runs one statement; a second one would be ignored there.
      if (sql.replace(/;\s*$/, '').includes(';')) throw new Error('more than one statement');
      db.exec(sql);
    }),
    sqlQuery: (sql: string, params: string) => wrap(() => ({ rows: db.prepare(sql).all(...JSON.parse(params)) })),
    sqlRun: (sql: string, params: string) => wrap(() => ({ changes: Number(db.prepare(sql).run(...JSON.parse(params)).changes) })),
  };
}

function android(opts: { hasTill?: boolean; oldApk?: boolean } = {}) {
  const requests: { url: string; method: string; headers: Record<string, string>; body: string | null }[] = [];
  const sql = fakeTillDb();
  const bridge: Record<string, unknown> = {
    print: () => {},
    scan: () => {},
  };
  if (!opts.oldApk) {
    Object.assign(bridge, sql, {
      hasTill: () => opts.hasTill ?? true,
      appUrl: () => SITE,
      http(id: string, url: string, method: string, headers: string, body: string | null) {
        requests.push({ url, method, headers: JSON.parse(headers), body });
        queueMicrotask(() => (win.__posAndroid as Answer)(id, null, JSON.stringify({ ok: true, status: 200, body: '[]' })));
      },
      cacheImages(id: string, urls: string) {
        queueMicrotask(() => (win.__posAndroid as Answer)(id, null, String(JSON.parse(urls).length)));
      },
    });
  }
  const win: Record<string, unknown> = { btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'), PosAndroid: bridge };
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', {});
  return { win, requests, sql };
}

type Till = NonNullable<NonNullable<Window['posNative']>['till']>;

async function till(win: Record<string, unknown>): Promise<Till | undefined> {
  await import('@/lib/desktopPrint');
  return (win.posNative as { till?: Till }).till;
}

function order(id: string): Order {
  return {
    id,
    status: 'gözləyir',
    createdAt: new Date().toISOString(),
    items: [{ menuItem: { id: 'm1', name: 'Americano', price: 4.5 }, quantity: 1 }],
  } as unknown as Order;
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('the Android till database', () => {
  it('gives the page inside the APK the same till the exe has', async () => {
    const { win } = android();
    const t = await till(win);
    expect(t).toBeDefined();
    expect(await t!.origin()).toEqual({ origin: SITE });
  });

  it('gives a page from the site no database, so it reads through the site', async () => {
    expect(await till(android({ hasTill: false }).win)).toBeUndefined();
  });

  it('leaves an APK from before the offline till printing as it did', async () => {
    const { win } = android({ oldApk: true });
    expect(await till(win)).toBeUndefined();
    expect((win.posNative as { isDesktop: boolean }).isDesktop).toBe(true);
  });

  it('sends Java one statement at a time, the way execSQL runs them', async () => {
    const { win, sql } = android();
    await till(win);
    expect(sql.statementsRun.some(s => s.startsWith('create table if not exists orders'))).toBe(true);
    expect(sql.statementsRun.every(s => !s.includes(';'))).toBe(true);
  });

  it('keeps an order made offline, with its payment queued after it', async () => {
    const { win } = android();
    const t = (await till(win))!;
    const { ADD_ORDER } = await import('@/lib/till-store/write');

    expect(await t.write('order:A', ADD_ORDER, order('A'), C)).toEqual({ ok: true });
    expect(await t.write('pay:A', '/api/update-order-status', { orderId: 'A', status: 'ödənilib', cashAmount: 4.5 }, C))
      .toEqual({ ok: true });

    const { entries } = await t.outboxList();
    expect(entries.map(e => e.id)).toEqual(['order:A', 'pay:A']);
    const orders = await t.orders(C) as { orders?: Order[] } | Order[];
    const list = Array.isArray(orders) ? orders : orders.orders ?? [];
    expect(list.find(o => o.id === 'A')?.status).toBe('ödənilib');
  });

  it('numbers orders on from the highest it holds, with numbers as numbers', async () => {
    const { win } = android();
    const t = (await till(win))!;
    const { ADD_ORDER } = await import('@/lib/till-store/write');
    const first = (await t.nextOrderNumber(C)).orderNumber;
    await t.write('order:A', ADD_ORDER, { ...order('A'), orderNumber: first }, C);
    expect((await t.nextOrderNumber(C)).orderNumber).toBe(first + 1);
  });

  it('asks the site only on its /api routes, with the till token on a read', async () => {
    const { win, requests } = android();
    const t = (await till(win))!;
    await t.setLink(JSON.stringify({ token: 'tok', companyId: C }));

    await t.api(`/api/public-menu?companyId=${C}`);
    expect(requests[0].url).toBe(`${SITE}/api/public-menu?companyId=${C}`);
    expect(requests[0].headers['x-till-token']).toBe('tok');

    await expect(t.api('https://evil.test/api/x')).rejects.toThrow('bad path');
    await expect(t.api('//evil.test/api/x')).rejects.toThrow('bad path');
    expect(requests).toHaveLength(1);
  });
});
