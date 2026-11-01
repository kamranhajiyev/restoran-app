// Dish photos, for real, on "restoran testing" (20261008_menu_images_per_company):
// a restaurant's logins put photos only in its own folder of the bucket, nobody
// else can add, replace or delete them there, the public key writes nothing,
// only pictures up to 5 MB go in, and anyone can still open a photo by its
// link (the QR menu shows them). The test's files are removed at the end.

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { admin, anon, companyA, companyB, ownerA, ownerB, sellerA } from './setup';

const BUCKET = 'menu-images';
const run = `autotest-${randomUUID().slice(0, 8)}`;
const mine = `${companyA.id}/${run}.png`;
// The smallest PNG there is: one transparent pixel.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = { contentType: 'image/png', upsert: false };

const exists = async (path: string) => {
  const folder = path.slice(0, path.lastIndexOf('/'));
  const { data } = await admin.storage.from(BUCKET).list(folder, { search: path.slice(path.lastIndexOf('/') + 1) });
  return (data ?? []).length > 0;
};

afterAll(async () => {
  const { data: a } = await admin.storage.from(BUCKET).list(companyA.id, { search: run });
  const { data: b } = await admin.storage.from(BUCKET).list(companyB.id, { search: run });
  const paths = [...(a ?? []).map(f => `${companyA.id}/${f.name}`), ...(b ?? []).map(f => `${companyB.id}/${f.name}`)];
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
});

describe('dish photos', () => {
  it('go into the restaurant\'s own folder, from the owner or the seller', async () => {
    expect((await ownerA.storage.from(BUCKET).upload(mine, PIXEL, png)).error).toBeNull();
    expect((await sellerA.storage.from(BUCKET).upload(`${companyA.id}/${run}-seller.png`, PIXEL, png)).error).toBeNull();
    expect(await exists(mine)).toBe(true);
  });

  it('can be opened by anyone with the link', async () => {
    const { data } = anon.storage.from(BUCKET).getPublicUrl(mine);
    const res = await fetch(data.publicUrl);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PIXEL)).toBe(true);
  });

  it('never go into another restaurant\'s folder, or outside one', async () => {
    expect((await ownerA.storage.from(BUCKET).upload(`${companyB.id}/${run}.png`, PIXEL, png)).error).not.toBeNull();
    expect((await ownerA.storage.from(BUCKET).upload(`${run}.png`, PIXEL, png)).error).not.toBeNull();
    expect(await exists(`${companyB.id}/${run}.png`)).toBe(false);
  });

  it('are not replaced or deleted by another restaurant or a stranger', async () => {
    for (const who of [ownerB, anon]) {
      expect((await who.storage.from(BUCKET).upload(mine, Buffer.from('x'), { contentType: 'image/png', upsert: true })).error).not.toBeNull();
      await who.storage.from(BUCKET).remove([mine]);
    }
    expect(await exists(mine)).toBe(true);
    const { data } = anon.storage.from(BUCKET).getPublicUrl(mine);
    expect(Buffer.from(await (await fetch(data.publicUrl)).arrayBuffer()).equals(PIXEL)).toBe(true);
  });

  it('take nothing from the public key', async () => {
    expect((await anon.storage.from(BUCKET).upload(`${companyA.id}/${run}-anon.png`, PIXEL, png)).error).not.toBeNull();
    expect((await anon.storage.from(BUCKET).list(companyA.id)).data ?? []).toEqual([]);
  });

  it('are pictures only, up to 5 MB', async () => {
    expect((await ownerA.storage.from(BUCKET).upload(`${companyA.id}/${run}.html`, Buffer.from('<script>alert(1)</script>'), { contentType: 'text/html' })).error).not.toBeNull();
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    PIXEL.copy(big);
    expect((await ownerA.storage.from(BUCKET).upload(`${companyA.id}/${run}-big.png`, big, png)).error).not.toBeNull();
  });

  it('are deleted by their own restaurant', async () => {
    const extra = `${companyA.id}/${run}-gone.png`;
    expect((await ownerA.storage.from(BUCKET).upload(extra, PIXEL, png)).error).toBeNull();
    expect((await ownerA.storage.from(BUCKET).remove([extra])).error).toBeNull();
    expect(await exists(extra)).toBe(false);
  });
});
