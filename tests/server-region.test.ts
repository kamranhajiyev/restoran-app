import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// A terminal-link till saves through our routes, and each route asks the
// database five times in a row. With the routes in Virginia and the database
// in Asia that was ~850 ms a time: five seconds an order, five a payment
// (restoran testing logs, 2026-10-30). The routes now run beside production's
// database in Seoul (ap-northeast-2); testing's, in Singapore, is next door.

describe('where the server routes run', () => {
  it('is Seoul, beside the production database', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(config.regions).toEqual(['icn1']);
  });
});
