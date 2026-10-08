// 2026-10-08: stock that failed to come off for a sale left no trace; a
// receipt, write-off or transfer was recorded twice when Save was pressed again
// after a lost reply; and a write-off could take a balance below zero.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261008_stock_safety.sql', 'utf8');
const panel = readFileSync('components/AnbarPanel.tsx', 'utf8');

describe('stock', () => {
  it('logs a sale whose stock could not be taken off, instead of hiding it', () => {
    const fn = sql.slice(sql.indexOf('function public.apply_stock_on_payment'), sql.indexOf('drop function'));
    expect(fn).not.toMatch(/exception when others then\s+NEW\.stock_applied := NEW\.stock_applied;/);
    expect(fn.match(/raise warning/g)?.length).toBe(2);
  });

  it('records a save once, however often it is sent', () => {
    for (const fn of ['record_receipt', 'record_transfer', 'record_writeoff']) {
      const body = sql.slice(sql.indexOf(`create function public.${fn}(`));
      expect(body).toMatch(/p_id uuid default null/);
      expect(body).toMatch(/if p_id is not null and exists/);
    }
    expect(panel.match(/const \[saveId\] = useState\(\(\) => crypto\.randomUUID\(\)\)/g)?.length).toBe(3);
    for (const call of ['recordWriteoff(', 'recordReceipt(', 'recordTransfer(']) {
      expect(panel).toMatch(new RegExp(`await ${call.replace('(', '\\(')}[^)]*saveId\\)`));
    }
  });

  it('refuses a write-off larger than what the warehouse holds', () => {
    const body = sql.slice(sql.indexOf('create function public.record_writeoff('));
    expect(body).toMatch(/if coalesce\(v_have, 0\) < p_qty then\s+raise exception 'insufficient_stock/);
  });
});
