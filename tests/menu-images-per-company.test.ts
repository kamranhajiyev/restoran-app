// Code review, 2026-10-08: the photo bucket let the public anon key upload,
// replace and delete any restaurant's dish photos and logos (the logo shows on
// the public QR menu), at any size and of any type. Photos now go under their
// company's folder, and only that company's signed-in users may write there.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { imagePath, setCompanyContext } from '@/lib/store';

const sql = readFileSync('supabase/migrations/20261008_menu_images_per_company.sql', 'utf8');
const uploads = ['app/admin/page.tsx', 'components/ModifiersPanel.tsx'].map(f => readFileSync(f, 'utf8')).join('\n');

describe('photo uploads', () => {
  it('go under the company folder', () => {
    setCompanyContext('c1');
    expect(imagePath('menu', 'latte.JPG')).toMatch(/^c1\/\d+-[0-9a-f]{8}\.JPG$/);
    expect(imagePath('logo', 'x.png')).toMatch(/^c1\/logos\//);
    expect(imagePath('modifier', 'a b?.webp')).toMatch(/^c1\/modifiers\/.*\.webp$/);
    setCompanyContext(null);
    expect(imagePath('menu', 'x.png')).toBeNull();
  });

  it('are all made through imagePath', () => {
    const paths = [...uploads.matchAll(/upload\((\w+), file/g)].map(m => m[1]);
    expect(paths.length).toBe(3);
    for (const name of paths) expect(uploads).toMatch(new RegExp(`const ${name} = imagePath\\(`));
  });

  it('are closed to the public key and to other companies', () => {
    for (const old of ['Anon upload menu images', 'Anon update menu images', 'Anon delete menu images', 'Public read menu images']) {
      expect(sql).toContain(`drop policy if exists "${old}"`);
    }
    for (const cmd of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`for ${cmd} to authenticated`));
    }
    expect(sql).not.toMatch(/to (anon|public)\b/);
    expect(sql.match(/\(storage\.foldername\(name\)\)\[1\] = public\.get_my_company_id\(\)::text/g)!.length).toBe(5);
    expect(sql).toMatch(/file_size_limit = 5242880/);
  });
});
