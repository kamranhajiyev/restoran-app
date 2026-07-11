'use client';
import { use, useEffect, useState } from 'react';
import { ShoppingCart, X, Plus, Minus, Coffee } from 'lucide-react';
import { fetchCompanyBySlug, setCompanyContext, addOrder, fetchTablesEnabled, fetchQrEnabled, fetchMenuOnly } from '@/lib/store';
import { applyBrand } from '@/lib/branding';
import { supabase } from '@/lib/supabase';
import { MenuItem, MenuItemVariant, RestaurantTable } from '@/types';

type Screen = 'menu' | 'confirm';

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  variantName?: string;
  variantId?: string;
}

export default function CustomerMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ table?: string }>;
}) {
  const { slug } = use(params);
  const { table: tableParam } = use(searchParams);
  const tableId = tableParam ? parseInt(tableParam) : null;

  const [screen, setScreen] = useState<Screen>('menu');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [table, setTable] = useState<RestaurantTable | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<{ name: string; available: boolean }[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderNote, setOrderNote] = useState('');
  const [noteOpen, setNoteOpen]   = useState(false);
  const [menuOnly, setMenuOnly] = useState(false);

  // Variant picker state
  const [variantItem, setVariantItem] = useState<MenuItem | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<MenuItemVariant | null>(null);

  useEffect(() => {
    async function load() {
      const company = await fetchCompanyBySlug(slug);
      if (!company) { setError('Restoran tapılmadı.'); setLoading(false); return; }
      setCompanyName(company.name);
      setLogoUrl(company.logoUrl);
      applyBrand(company.brandColor);
      setCompanyContext(company.id);
      const [menuRes, catRes, tableRes, tablesEnabled, qrEnabled, menuOnlyVal] = await Promise.all([
        supabase.rpc('get_public_menu_items', { p_company_id: company.id }),
        supabase.rpc('get_public_categories', { p_company_id: company.id }),
        tableId ? supabase.rpc('get_public_table', { p_company_id: company.id, p_table_id: tableId }) : Promise.resolve({ data: [], error: null }),
        fetchTablesEnabled(),
        fetchQrEnabled(),
        fetchMenuOnly(),
      ]);

      if (!qrEnabled && !menuOnlyVal || (tableId && !tablesEnabled)) {
        setError('QR sifariş hal-hazırda aktiv deyil.');
        setLoading(false);
        return;
      }

      const m = (menuRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        name: r.name as string,
        price: Number(r.price),
        category: r.category as string,
        available: r.available as boolean,
        variants: (r.variants as MenuItem['variants']) ?? undefined,
        costPrice: r.cost_price ? Number(r.cost_price) : undefined,
        image: (r.image as string) ?? undefined,
      }));
      const c: { name: string; available: boolean }[] = (catRes.data ?? []).map((r: Record<string, unknown>) => ({
        name: r.name as string,
        available: r.available as boolean,
      }));
      const availableCats = c.filter((cat: { name: string; available: boolean }) => cat.available);
      const tableRow = tableId ? ((tableRes.data ?? []) as Record<string, unknown>[])[0] ?? null : null;
      if (tableId && !tableRow) { setError('Masa tapılmadı.'); setLoading(false); return; }
      const t: RestaurantTable | null = tableRow ? {
        id: tableRow.id as number,
        name: (tableRow.name as string) ?? `Masa ${tableRow.id}`,
        capacity: (tableRow.capacity as number) ?? 4,
        x: tableRow.x as number | undefined,
        y: tableRow.y as number | undefined,
        w: (tableRow.w as number) ?? 100,
        h: (tableRow.h as number) ?? 70,
        shape: ((tableRow.shape as string) ?? 'rect') as RestaurantTable['shape'],
      } : null;

      setTable(t);
      setMenu(m.filter((item: MenuItem) => item.available));
      setCategories(availableCats);
      const firstCat = availableCats.find((cat: { name: string }) => m.some((i: MenuItem) => i.category === cat.name));
      if (firstCat) setActiveCategory(firstCat.name);
      setMenuOnly(menuOnlyVal);
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, tableId]);

  function handleTapItem(item: MenuItem) {
    if ((item.variants?.length ?? 0) > 0) {
      setSelectedVariant(item.variants![0]);
      setVariantItem(item);
    } else {
      addToCart(item);
    }
  }

  function confirmVariant() {
    if (!variantItem || !selectedVariant) return;
    addToCart({ ...variantItem, price: selectedVariant.price }, selectedVariant.name, selectedVariant.id);
    setVariantItem(null);
    setSelectedVariant(null);
  }

  function addToCart(item: MenuItem, variantName?: string, variantId?: string) {
    const key = item.id + (variantName ?? '');
    setCart(prev => {
      const ex = prev.find(c => c.menuItem.id === item.id && (c.variantName ?? '') === (variantName ?? ''));
      if (ex) return prev.map(c =>
        c.menuItem.id === item.id && (c.variantName ?? '') === (variantName ?? '')
          ? { ...c, quantity: c.quantity + 1 } : c
      );
      return [...prev, { menuItem: item, quantity: 1, variantName, variantId }];
    });
    void key;
  }

  function removeFromCart(itemId: string, variantName?: string) {
    setCart(prev => {
      const ex = prev.find(c => c.menuItem.id === itemId && (c.variantName ?? '') === (variantName ?? ''));
      if (!ex) return prev;
      if (ex.quantity === 1) return prev.filter(c => !(c.menuItem.id === itemId && (c.variantName ?? '') === (variantName ?? '')));
      return prev.map(c =>
        c.menuItem.id === itemId && (c.variantName ?? '') === (variantName ?? '')
          ? { ...c, quantity: c.quantity - 1 } : c
      );
    });
  }

  const cartTotal = cart.reduce((s, c) => s + c.menuItem.price * c.quantity, 0);
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);
  const visibleItems = menu.filter(i => i.category === activeCategory);

  async function placeOrder() {
    if (cart.length === 0) return;
    setSubmitting(true);
    await addOrder({
      id: crypto.randomUUID(),
      orderNumber: 0,
      tableNumber: table?.id ?? 0,
      sellerName: 'Müştəri',
      status: 'gözləyir',
      createdAt: new Date().toISOString(),
      note: orderNote.trim() || undefined,
      items: cart.map(c => ({
        menuItem: c.menuItem,
        quantity: c.quantity,
        modifiers: c.variantName,
        variantId: c.variantId,
      })),
    });
    setSubmitting(false);
    setCart([]);
    setCartOpen(false);
    setOrderNote('');
    setNoteOpen(false);
    setScreen('confirm');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-primary-800 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Coffee className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (screen === 'confirm') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center max-w-xs">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✓</span>
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Sifarişiniz qəbul edildi!</h1>
          <p className="text-sm text-gray-500 mb-6">
            {table ? `${table.name} üçün sifariş verildi.` : 'Sifariş verildi.'} Tezliklə hazırlanacaq.
          </p>
          <button
            onClick={() => setScreen('menu')}
            className="w-full bg-primary-800 hover:bg-primary-900 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
          >
            Yenidən sifariş ver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {logoUrl && (
            <img src={logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover border border-gray-100 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-semibold text-gray-800 text-sm truncate">{companyName}</p>
            {table && <p className="text-xs text-gray-400 truncate">{table.name}</p>}
          </div>
        </div>
        {!menuOnly && (
          <button
            onClick={() => setCartOpen(true)}
            className="relative w-10 h-10 flex items-center justify-center rounded-xl bg-primary-800 text-white"
          >
            <ShoppingCart className="w-5 h-5" />
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        )}
      </header>

      {/* Category tabs */}
      <div className="sticky top-14 z-30 bg-white border-b border-gray-100 px-4 overflow-x-auto">
        <div className="flex gap-1 py-2 min-w-max">
          {categories.filter(c => menu.some(i => i.category === c.name)).map(c => (
            <button
              key={c.name}
              onClick={() => setActiveCategory(c.name)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeCategory === c.name
                  ? 'bg-primary-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Menu items */}
      <main className="flex-1 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl mx-auto">
          {visibleItems.map(item => {
            const hasVariants = (item.variants?.length ?? 0) > 0;
            const inCart = cart.filter(c => c.menuItem.id === item.id);
            const totalInCart = inCart.reduce((s, c) => s + c.quantity, 0);
            return (
              <div key={item.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col">
                {item.image
                  ? <img src={item.image} alt={item.name} className="w-full aspect-[4/3] object-cover" />
                  : <div className="w-full aspect-[4/3] bg-primary-50 flex items-center justify-center"><Coffee className="w-8 h-8 text-primary-200" /></div>
                }
                <div className="p-3 flex flex-col flex-1">
                  <p className="text-sm font-semibold text-gray-800 flex-1">{item.name}</p>
                  <p className="text-xs text-primary-800 font-bold mt-1">
                    {hasVariants
                      ? `${Math.min(...item.variants!.map(v => v.price)).toFixed(2)} ₼ →`
                      : `${item.price.toFixed(2)} ₼`}
                  </p>
                  {(hasVariants || !menuOnly) && (
                    <div className="mt-2">
                      {hasVariants ? (
                        <button
                          onClick={() => handleTapItem(item)}
                          className="w-full py-1.5 rounded-lg bg-primary-800 text-white text-xs font-semibold transition-colors hover:bg-primary-900 flex items-center justify-center gap-1"
                        >
                          {totalInCart > 0 && <span className="bg-white/25 px-1.5 rounded-md">{totalInCart}</span>}
                          {menuOnly ? 'Növlər' : 'Seç'}
                        </button>
                      ) : totalInCart > 0 ? (
                        <div className="flex items-center justify-between">
                          <button onClick={() => removeFromCart(item.id)} className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-sm font-semibold">{totalInCart}</span>
                          <button onClick={() => addToCart(item)} className="w-7 h-7 rounded-lg bg-primary-800 text-white flex items-center justify-center">
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleTapItem(item)}
                          className="w-full py-1.5 rounded-lg bg-primary-800 text-white text-xs font-semibold transition-colors hover:bg-primary-900"
                        >
                          Əlavə et
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Bottom order bar */}
      {!menuOnly && cartCount > 0 && !cartOpen && (
        <div className="sticky bottom-0 p-4 bg-white border-t border-gray-100">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full max-w-2xl mx-auto flex items-center justify-between bg-primary-800 hover:bg-primary-900 text-white px-5 py-3.5 rounded-xl font-semibold transition-colors"
          >
            <span className="bg-white/20 px-2 py-0.5 rounded-lg text-sm">{cartCount}</span>
            <span>Sifarişə bax</span>
            <span className="text-sm">{cartTotal.toFixed(2)} ₼</span>
          </button>
        </div>
      )}

      {/* Cart drawer */}
      {!menuOnly && cartOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setCartOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-800">Sifariş</h3>
              <button onClick={() => setCartOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {cart.map((c, idx) => (
                <div key={`${c.menuItem.id}-${c.variantName ?? ''}-${idx}`} className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => removeFromCart(c.menuItem.id, c.variantName)} className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm font-semibold">{c.quantity}</span>
                    <button onClick={() => addToCart(c.menuItem, c.variantName)} className="w-7 h-7 rounded-lg bg-primary-800 text-white flex items-center justify-center">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{c.menuItem.name}</p>
                    {c.variantName && <p className="text-xs text-gray-400">{c.variantName}</p>}
                  </div>
                  <span className="text-sm font-semibold text-gray-800">{(c.menuItem.price * c.quantity).toFixed(2)} ₼</span>
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-gray-100 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Cəmi</span>
                <span className="font-bold text-gray-800">{cartTotal.toFixed(2)} ₼</span>
              </div>
              {!noteOpen ? (
                <button
                  onClick={() => setNoteOpen(true)}
                  className="text-xs text-stone-400 hover:text-stone-600 flex items-center gap-1 py-1"
                >
                  <span>+</span> Qeyd əlavə et
                </button>
              ) : (
                <textarea
                  autoFocus
                  value={orderNote}
                  onChange={e => setOrderNote(e.target.value)}
                  placeholder="Xüsusi istək və ya qeyd"
                  rows={3}
                  className="w-full text-sm rounded-xl border border-stone-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400 placeholder:text-stone-300"
                />
              )}
              <button
                onClick={placeOrder}
                disabled={submitting}
                className="w-full bg-primary-800 hover:bg-primary-900 disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors"
              >
                {submitting ? 'Göndərilir...' : 'Sifariş ver'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Variant picker modal */}
      {variantItem && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setVariantItem(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{variantItem.name}</h3>
              <button onClick={() => setVariantItem(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-5">
              {variantItem.variants!.map(v => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-colors ${
                    selectedVariant?.id === v.id
                      ? 'border-primary-800 bg-primary-50 text-primary-900'
                      : 'border-gray-200 text-gray-700'
                  }`}
                >
                  {v.name}
                  <span className="text-xs opacity-70">{v.price.toFixed(2)} ₼</span>
                </button>
              ))}
            </div>
            {!menuOnly && (
              <button
                onClick={confirmVariant}
                className="w-full bg-primary-800 hover:bg-primary-900 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors"
              >
                Əlavə et · {selectedVariant?.price.toFixed(2)} ₼
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
