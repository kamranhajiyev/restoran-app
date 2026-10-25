import fs from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PICTURE_MAX, shrunkSize } from '@/lib/shrink-picture';
import { formatOf, shrinkPictureBuffer } from '@/lib/shrink-picture-node';

// Full-size menu photographs sent to every till were most of the storage egress
// (Supabase, 2026-10-22: 369 MB in a day).

// A photograph-like picture: noise does not compress, like a real photo.
async function photo(width: number, height: number, orientation?: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  const img = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 });
  return (orientation ? img.withMetadata({ orientation }) : img).toBuffer();
}

describe('shrunkSize', () => {
  it('brings the longest side down to the limit and keeps the shape', () => {
    expect(shrunkSize(1200, 675, 500_000)).toEqual({ width: PICTURE_MAX, height: 225 });
    expect(shrunkSize(675, 1200, 500_000)).toEqual({ width: 225, height: PICTURE_MAX });
  });

  it('leaves a small picture alone', () => {
    expect(shrunkSize(300, 200, 20_000)).toBeNull();
  });

  it('re-saves a picture that is small on screen but heavy', () => {
    expect(shrunkSize(400, 300, 900_000)).toEqual({ width: 400, height: 300 });
  });

  it('does not divide by a missing size', () => {
    expect(shrunkSize(0, 0, 500_000)).toBeNull();
  });
});

describe('shrinkPictureBuffer', () => {
  it('gives a smaller picture no wider than the limit, in the format asked', async () => {
    const big = await photo(1200, 675);
    const small = await shrinkPictureBuffer(big, 'jpeg');
    expect(small).not.toBeNull();
    expect(small!.type).toBe('image/jpeg');
    expect(small!.body.length).toBeLessThan(big.length / 4);
    const meta = await sharp(small!.body).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([400, 225, 'jpeg']);
  });

  it('keeps a phone photo standing the way it was taken', async () => {
    const small = await shrinkPictureBuffer(await photo(1200, 675, 6), 'webp');
    const meta = await sharp(small!.body).metadata();
    expect([meta.width, meta.height]).toEqual([225, 400]);
  });

  it('gives nothing back for a picture that is already small', async () => {
    expect(await shrinkPictureBuffer(await photo(200, 150), 'jpeg')).toBeNull();
  });
});

describe('formatOf', () => {
  it('keeps the format the stored name says', () => {
    expect(formatOf('a/1.JPG')).toBe('jpeg');
    expect(formatOf('a/1.png')).toBe('png');
    expect(formatOf('a/1.webp')).toBe('webp');
    expect(formatOf('a/1.gif')).toBeNull();
  });
});

describe('every menu picture upload shrinks first', () => {
  const read = (f: string) => fs.readFileSync(f, 'utf8');

  it('admin menu picture and modifier picture', () => {
    const admin = read('app/admin/page.tsx');
    const menu = admin.slice(admin.indexOf('async function handleImageFile'), admin.indexOf('async function handleLogoFile'));
    expect(menu).toMatch(/shrinkPicture\(picked\)[\s\S]*\.upload\(/);
    expect(read('components/ModifiersPanel.tsx')).toMatch(/shrinkPicture\(picked\)[\s\S]*\.upload\(/);
  });

  it('the menu-images script', () => {
    expect(read('scripts/menu-images.ts')).toMatch(/shrinkPictureBuffer\([\s\S]*\.upload\(/);
  });
});
