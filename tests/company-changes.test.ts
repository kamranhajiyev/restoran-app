import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { companyFilter, onCompanyChange } from '@/lib/company-changes';

// An unfiltered live listener made every change in every restaurant work for
// every open screen of every restaurant (2026-10-14, Supabase/Vercel usage).

type Listen = { event: string; table: string; filter?: string };

function fakeChannel() {
  const calls: Listen[] = [];
  const channel = {
    on(_type: string, opts: Listen) {
      calls.push({ event: opts.event, table: opts.table, filter: opts.filter });
      return channel;
    },
  };
  return { channel: channel as unknown as RealtimeChannel, calls };
}

describe('onCompanyChange', () => {
  it('filters inserts and updates to the restaurant and still hears deletes', () => {
    const { channel, calls } = fakeChannel();
    onCompanyChange(channel, 'orders', 'c1', () => {});
    expect(calls).toEqual([
      { event: 'INSERT', table: 'orders', filter: 'company_id=eq.c1' },
      { event: 'UPDATE', table: 'orders', filter: 'company_id=eq.c1' },
      // Supabase cannot filter deletes: a filtered one would never arrive.
      { event: 'DELETE', table: 'orders', filter: undefined },
    ]);
  });

  it('keys the companies table by its own id', () => {
    expect(companyFilter('companies', 'c1')).toBe('id=eq.c1');
    expect(companyFilter('menu_items', 'c1')).toBe('company_id=eq.c1');
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('every screen listens to its own restaurant only', () => {
  it('no postgres_changes listener on a company table goes without a filter', () => {
    const unfiltered: string[] = [];
    for (const file of ['app', 'lib', 'components'].flatMap(sourceFiles)) {
      if (file.endsWith('company-changes.ts')) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/'postgres_changes',\s*\{([^}]*)\}/g)) {
        const table = /table:\s*'([^']+)'/.exec(m[1])?.[1] ?? '?';
        // A filtered '*' still drops deletes; the helper is the one way to do both.
        if (!/filter:/.test(m[1]) || /event:\s*'\*'/.test(m[1])) unfiltered.push(`${file}: ${table}`);
      }
    }
    expect(unfiltered).toEqual([]);
  });
});

describe('order_items carries its restaurant', () => {
  // It had none, so its listener could not be filtered (20261025).
  it('is filled by the database from the order, never from the client', () => {
    const sql = readFileSync('supabase/migrations/20261025_order_items_company.sql', 'utf8');
    expect(sql).toMatch(/add column if not exists company_id/);
    expect(sql).toMatch(/new\.company_id := \(select o\.company_id from public\.orders o where o\.id = new\.order_id\)/);
    expect(sql).toMatch(/before insert or update on public\.order_items/);
  });
});
