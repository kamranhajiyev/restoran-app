// Production is only ever read by our scripts (scripts/check-money). A query
// goes through only as one plain statement with no word that writes, and it
// runs inside a read-only transaction, so Postgres itself refuses a write that
// got past the words.

const WRITES = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|reindex|cluster|comment|set|reset|lock|notify|prepare|execute|begin|commit|rollback|savepoint|refresh|security)\b/i;
// Functions that act rather than read: settings, sequences, other sessions, links out.
const ACTS = /\b(set_config|nextval|setval|dblink\w*|lo_\w+|pg_(terminate|cancel|reload|rotate|promote|switch|advisory|create|drop|replication|file|read|ls|stat_reset)\w*)\s*\(/i;

/** The body to send, or an error when the query is not a plain read. */
export function readOnlySql(query: string): string {
  if (query.includes(';')) throw new Error('refused: more than one statement');
  if (WRITES.test(query) || ACTS.test(query)) throw new Error(`refused, not a plain read: ${query.trim().slice(0, 80)}`);
  return `begin transaction read only; ${query}; commit;`;
}
