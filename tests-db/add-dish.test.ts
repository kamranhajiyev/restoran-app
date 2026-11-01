// Adding a dish, for real, on "restoran testing": only the owner may add,
// change or delete one, and no other restaurant or stranger may see it.
// "Autotest plov" is left in Kamran test ucun's menu to look at; each run
// takes the last run's out first.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon, companyA, ownerA, ownerB, sellerA } from './setup';

const CATEGORY = 'Autotest';
const id = randomUUID();
const dish = { id, name: 'Autotest plov', price: 5, category: CATEGORY, position: 0, kind: 'product', company_id: companyA.id };
const throwaway = { ...dish, id: randomUUID(), name: 'Autotest silinən', position: 1 };

async function priceOf(dishId: string): Promise<number | null> {
  const { data } = await admin.from('menu_items').select('price').eq('id', dishId).maybeSingle();
  return data ? Number(data.price) : null;
}
const priceNow = () => priceOf(id);

// Only the test's own rows: the restaurant may hold a real menu.
beforeAll(async () => {
  await admin.from('menu_items').delete().eq('company_id', companyA.id).eq('category', CATEGORY);
  const { data } = await admin.from('categories').select('id').eq('company_id', companyA.id).eq('name', CATEGORY).maybeSingle();
  if (!data) {
    const { error } = await ownerA.from('categories').insert({ company_id: companyA.id, name: CATEGORY });
    if (error) throw new Error(`category: ${error.message}`);
  }
});

afterAll(async () => {
  await admin.from('menu_items').delete().eq('id', throwaway.id);
});

describe('a dish', () => {
  it('is refused to the seller and to a stranger', async () => {
    const seller = await sellerA.from('menu_items').insert(dish);
    expect(seller.error).not.toBeNull();
    const stranger = await anon.from('menu_items').insert(dish);
    expect(stranger.error).not.toBeNull();
    expect(await priceNow()).toBeNull();
  });

  it('is refused to an owner adding it to another restaurant', async () => {
    const { error } = await ownerB.from('menu_items').insert(dish);
    expect(error).not.toBeNull();
    expect(await priceNow()).toBeNull();
  });

  it('is added by its owner and read back at its price', async () => {
    const { error } = await ownerA.from('menu_items').insert(dish);
    expect(error).toBeNull();
    const { data } = await ownerA.from('menu_items').select('name, price').eq('id', id).single();
    expect(data).toEqual({ name: 'Autotest plov', price: 5 });
  });

  it('is seen by its own seller, not by another restaurant or a stranger', async () => {
    expect((await sellerA.from('menu_items').select('id').eq('id', id)).data).toHaveLength(1);
    expect((await ownerB.from('menu_items').select('id').eq('id', id)).data).toEqual([]);
    expect((await anon.from('menu_items').select('id').eq('id', id)).data ?? []).toEqual([]);
  });

  it('keeps its price when the seller, another restaurant or a stranger changes it', async () => {
    await sellerA.from('menu_items').update({ price: 0.01 }).eq('id', id);
    await ownerB.from('menu_items').update({ price: 0.01 }).eq('id', id);
    await anon.from('menu_items').update({ price: 0.01 }).eq('id', id);
    expect(await priceNow()).toBe(5);
  });

  it('takes a new price from its owner', async () => {
    const { error } = await ownerA.from('menu_items').update({ price: 6.5 }).eq('id', id);
    expect(error).toBeNull();
    expect(await priceNow()).toBe(6.5);
  });

  it('stays when the seller, another restaurant or a stranger deletes it', async () => {
    await sellerA.from('menu_items').delete().eq('id', id);
    await ownerB.from('menu_items').delete().eq('id', id);
    await anon.from('menu_items').delete().eq('id', id);
    expect(await priceNow()).toBe(6.5);
  });

  it('is deleted by its owner', async () => {
    expect((await ownerA.from('menu_items').insert(throwaway)).error).toBeNull();
    const { error } = await ownerA.from('menu_items').delete().eq('id', throwaway.id);
    expect(error).toBeNull();
    expect(await priceOf(throwaway.id)).toBeNull();
  });
});
