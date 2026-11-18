// Yeməyin tərkibi (20261115_menu_ingredients.sql, lib/ingredients): the owner
// types what a dish is made of in admin, and guests see it on the QR / online
// menu only. One text per dish, its sizes share it. A shop has no box
// (the user, 2026-11-18).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanIngredients, INGREDIENTS_MAX, takesIngredients } from '@/lib/ingredients';
import { menuRowBatches } from '@/lib/set-items';

const read = (p: string) => readFileSync(p, 'utf8');

describe('Yeməyin tərkibi', () => {
  it('saves trimmed text, and nothing for an empty box', () => {
    expect(cleanIngredients('  Düyü, quzu əti  ')).toBe('Düyü, quzu əti');
    expect(cleanIngredients('   ')).toBeNull();
    expect(cleanIngredients('')).toBeNull();
    expect(cleanIngredients(null)).toBeNull();
    expect(cleanIngredients('a'.repeat(INGREDIENTS_MAX + 50))).toHaveLength(INGREDIENTS_MAX);
  });

  it('the limit is the database\'s', () => {
    expect(read('supabase/migrations/20261115_menu_ingredients.sql')).toContain(`char_length(ingredients) <= ${INGREDIENTS_MAX}`);
  });

  it('is offered in a restaurant, not in a shop', () => {
    expect(takesIngredients('restaurant')).toBe(true);
    expect(takesIngredients('shop')).toBe(false);
    expect(read('app/admin/page.tsx')).toMatch(/\{takesIngredients\(kind\) && ingredientsLoaded && \(/);
  });

  it('a dish whose text never loaded keeps the database\'s on save', () => {
    const known = { id: 'a', ingredients: 'Düyü' };
    const unknown = { id: 'b' };
    expect(menuRowBatches([known, unknown])).toEqual([[known], [unknown]]);
    expect(read('lib/store.ts')).toMatch(/\.\.\.\(m\.ingredients !== undefined \? \{ ingredients: cleanIngredients\(m\.ingredients\) \} : \{\}\)/);
    expect(read('lib/store.ts')).toMatch(/ingredients: r\.ingredients === undefined \? undefined : \(r\.ingredients \?\? null\)/);
    expect(read('app/admin/page.tsx')).toMatch(/menu\.find\(m => m\.id === editingId\)\?\.ingredients !== undefined\) \? form\.ingredients : undefined/);
  });

  it('a new restaurant\'s first dish gets the box: the column is asked of the database', () => {
    expect(read('app/admin/page.tsx')).toMatch(/menuHasIngredients\(\)\.then\(setIngredientsLoaded\)/);
  });

  it('reaches the QR menu through get_public_menu_items, still without the cost', () => {
    const sql = read('supabase/migrations/20261115_menu_ingredients.sql');
    expect(sql).toMatch(/null::numeric, image, cooking_station, "position", ingredients/);
    expect(sql).toMatch(/-- anon: [^\n]+\ngrant execute on function public\.get_public_menu_items\(uuid\) to anon;/);
    const qr = read('app/[slug]/menu/page.tsx');
    expect(qr).toMatch(/ingredients: \(r\.ingredients as string \| null\) \?\? undefined/);
    expect(qr).toMatch(/\{item\.ingredients && \(/);
  });

  it('the temporary preview is gone', () => {
    expect(read('app/admin/page.tsx')).not.toContain('temp-ingredients');
    expect(read('app/[slug]/menu/page.tsx')).not.toContain('temp-ingredients');
  });
});
