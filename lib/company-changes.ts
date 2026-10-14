// Live changes for one restaurant only.
//
// An unfiltered postgres_changes listener makes Supabase check every change in
// every restaurant against every open screen's RLS: one sale anywhere is work
// for every till, admin page and kitchen screen of every venue. With a filter,
// only the screens of the restaurant that changed are asked.
//
// Supabase cannot filter DELETE events (they carry only the primary key), and a
// filtered '*' listener silently never hears them. So inserts and updates are
// filtered, and deletes are heard unfiltered, as before. They skip RLS anyway
// and are rare.

import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export type Change = RealtimePostgresChangesPayload<Record<string, unknown>>;

/** The filter for one restaurant's rows. `companies` is keyed by its own id. */
export function companyFilter(table: string, companyId: string): string {
  return `${table === 'companies' ? 'id' : 'company_id'}=eq.${companyId}`;
}

export function onCompanyChange(
  channel: RealtimeChannel,
  table: string,
  companyId: string,
  handler: (change: Change) => void,
): RealtimeChannel {
  const filter = companyFilter(table, companyId);
  return channel
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, handler)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, handler)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, handler);
}
