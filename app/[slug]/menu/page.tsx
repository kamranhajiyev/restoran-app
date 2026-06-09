'use client';
import { use, useEffect, useState } from 'react';
import { ShoppingCart, X, Plus, Minus, Coffee } from 'lucide-react';
import { fetchCompanyBySlug, fetchMenu, fetchCategories, setCompanyContext, addOrder, fetchTables } from '@/lib/store';
import { Category, MenuItem, MenuItemVariant, RestaurantTable } from '@/types';

type Screen = 'menu' | 'confirm';

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  variantName?: string;
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
  const [table, setTable] = useState<RestaurantTable | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Variant picker state
  const [variantItem, setVariantItem] = useState<MenuItem | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<MenuItemVariant | null>(null);

  useEffect(() => {
    async function load() {
      const company = await fetchCompanyBySlug(slug);
      if (!company) { setError('Restoran tapılmadı.'); setLoading(false); return; }
      setCompanyName(company.name);
      setCompanyContext(company.id);

      const [m, c, tables] = await Promise.all([fetchMenu(), fetchCategories(), fetchTables()]);
      const availableCats = c.filter(cat => cat.available);
      const t = tableId ? tables.find(x => x.id === tableId) ?? null : null;
      if (tableId && !t) { setError('Masa tapılmadı.'); setLoading(false); return; }

      setTable(t);
      setMenu(m.filter(item => item.available));
      setCategories(availableCats);
      const firstCat = availableCats.find(cat => m.some(i => i.category === cat.name));
      if (firstCat) setActiveCategory(firstCat.name);
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
    addToCart({ ...variantItem, price: selectedVariant.price }, selectedVariant.name);
    setVariantItem(null);
    setSelectedVariant(null);
  }

  function addToCart(item: MenuItem, variantName?: string) {
    const key = item.id + (variantName ?? '');
    setCart(prev => {
      const ex = prev.find(c => c.menuItem.id === item.id && (c.variantName ?? '') === (variantName ?? ''));
      if (ex) return prev.map(c =>
        c.menuItem.id === item.id && (c.variantName ?? '') === (variantName ?? '')
          ? { ...c, quantity: c.quantity + 1 } : c
      );
      return [...prev, { menuItem: item, quantity: 1, variantName }];
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
      sellerName: table ? table.name : 'Müştəri',
      status: 'gözləyir',
      createdAt: new Date().toISOString(),
      items: cart.map(c => ({
        menuItem: c.menuItem,
        quantity: c.quantity,
        modifiers: c.variantName,
      })),
    });
    setSubmitting(false);
    setCart([]);
    setCartOpen(false);
    setScreen('confirm');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-amber-800 border-t-transparent rounded-full animate-spin" />
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
            className="w-full bg-amber-800 hover:bg-amber-900 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
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
        <div>
          <p className="font-semibold text-gray-800 text-sm">{companyName}</p>
          {table && <p className="text-xs text-gray-400">{table.name}</p>}
        </div>
        <button
          onClick={() => setCartOpen(true)}
          className="relative w-10 h-10 flex items-center justify-center rounded-xl bg-amber-800 text-white"
        >
          <ShoppingCart className="w-5 h-5" />
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {cartCount}
            </span>
          )}
        </button>
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
                  ? 'bg-amber-800 text-white'
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
                  ? <img src={item.image} alt={item.name} className="w-full h-28 object-cover" />
                  : <div className="w-full h-28 bg-amber-50 flex items-center justify-center"><Coffee className="w-8 h-8 text-amber-200" /></div>
                }
                <div className="p-3 flex flex-col flex-1">
                  <p className="text-sm font-semibold text-gray-800 flex-1">{item.name}</p>
                  <p className="text-xs text-amber-800 font-bold mt-1">
                    {hasVariants
                      ? `${Math.min(...item.variants!.map(v => v.price)).toFixed(2)} ₼ →`
                      : `${item.price.toFixed(2)} ₼`}
                  </p>
                  <div className="mt-2">
                    {hasVariants ? (
                      <button
                        onClick={() => handleTapItem(item)}
                        className="w-full py-1.5 rounded-lg bg-amber-800 text-white text-xs font-semibold transition-colors hover:bg-amber-900 flex items-center justify-center gap-1"
                      >
                        {totalInCart > 0 && <span className="bg-white/25 px-1.5 rounded-md">{totalInCart}</span>}
                        Seç
                      </button>
                    ) : totalInCart > 0 ? (
                      <div className="flex items-center justify-between">
                        <button onClick={() => removeFromCart(item.id)} className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm font-semibold">{totalInCart}</span>
                        <button onClick={() => addToCart(item)} className="w-7 h-7 rounded-lg bg-amber-800 text-white flex items-center justify-center">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleTapItem(item)}
                        className="w-full py-1.5 rounded-lg bg-amber-800 text-white text-xs font-semibold transition-colors hover:bg-amber-900"
                      >
                        Əlavə et
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Bottom order bar */}
      {cartCount > 0 && !cartOpen && (
        <div className="sticky bottom-0 p-4 bg-white border-t border-gray-100">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full max-w-2xl mx-auto flex items-center justify-between bg-amber-800 hover:bg-amber-900 text-white px-5 py-3.5 rounded-xl font-semibold transition-colors"
          >
            <span className="bg-white/20 px-2 py-0.5 rounded-lg text-sm">{cartCount}</span>
            <span>Sifarişə bax</span>
            <span className="text-sm">{cartTotal.toFixed(2)} ₼</span>
          </button>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
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
                    <button onClick={() => addToCart(c.menuItem, c.variantName)} className="w-7 h-7 rounded-lg bg-amber-800 text-white flex items-center justify-center">
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
              <button
                onClick={placeOrder}
                disabled={submitting}
                className="w-full bg-amber-800 hover:bg-amber-900 disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors"
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
                      ? 'border-amber-800 bg-amber-50 text-amber-900'
                      : 'border-gray-200 text-gray-700'
                  }`}
                >
                  {v.name}
                  <span className="text-xs opacity-70">{v.price.toFixed(2)} ₼</span>
                </button>
              ))}
            </div>
            <button
              onClick={confirmVariant}
              className="w-full bg-amber-800 hover:bg-amber-900 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors"
            >
              Əlavə et · {selectedVariant?.price.toFixed(2)} ₼
            </button>
          </div>
        </>
      )}
    </div>
  );
}
