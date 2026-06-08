'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, logout } from '@/lib/auth';
import { getMenu, addOrder, getOrders, pullMenuFromSupabase, pullOrdersFromSupabase } from '@/lib/store';
import { MenuItem, Order, OrderItem } from '@/types';

type View = 'tables' | 'order';

const TOTAL_TABLES = 20;

function getTableStatus(tableNum: number, orders: Order[]): 'boş' | 'dolu' | 'hesab' {
  const active = orders.filter(
    o => o.tableNumber === tableNum && o.status !== 'ödənilib'
  );
  if (active.length === 0) return 'boş';
  if (active.some(o => o.status === 'hazırdır')) return 'hesab';
  return 'dolu';
}

export default function WaiterPage() {
  const router = useRouter();
  const [view, setView] = useState<View>('tables');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<number>(1);
  const [note, setNote] = useState('');
  const [waiterName, setWaiterName] = useState('Ofisiant');
  const [success, setSuccess] = useState(false);
  const [activeCategory, setActiveCategory] = useState('');
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'waiter') {
      router.replace('/login');
      return;
    }
    setWaiterName(session.name);

    const m = getMenu();
    setMenu(m);
    setOrders(getOrders());
    const cats = [...new Set(m.map(i => i.category))];
    if (cats.length > 0) setActiveCategory(cats[0]);

    // pull from Supabase in background
    Promise.all([pullMenuFromSupabase(), pullOrdersFromSupabase()]).then(([menuOk]) => {
      setOnline(menuOk);
      const fresh = getMenu();
      setMenu(fresh);
      setOrders(getOrders());
      const freshCats = [...new Set(fresh.map(i => i.category))];
      if (freshCats.length > 0) setActiveCategory(freshCats[0]);
    });
  }, [router]);

  const categories = [...new Set(menu.map(i => i.category))];
  const filtered = menu.filter(m => m.category === activeCategory && m.available);
  const total = cart.reduce((s, ci) => s + ci.menuItem.price * ci.quantity, 0);
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);

  function openTable(n: number) {
    setSelectedTable(n);
    setCart([]);
    setNote('');
    setView('order');
  }

  function addToCart(item: MenuItem) {
    setCart(prev => {
      const ex = prev.find(ci => ci.menuItem.id === item.id);
      if (ex) return prev.map(ci => ci.menuItem.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci);
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  }

  function removeFromCart(itemId: string) {
    setCart(prev => {
      const ex = prev.find(ci => ci.menuItem.id === itemId);
      if (!ex) return prev;
      if (ex.quantity === 1) return prev.filter(ci => ci.menuItem.id !== itemId);
      return prev.map(ci => ci.menuItem.id === itemId ? { ...ci, quantity: ci.quantity - 1 } : ci);
    });
  }

  function handleOrder() {
    if (cart.length === 0) return;
    const order: Order = {
      id: Date.now().toString(),
      tableNumber: selectedTable,
      items: cart,
      status: 'gözləyir',
      createdAt: new Date().toISOString(),
      waiterName,
      note: note.trim() || undefined,
    };
    addOrder(order);
    setOrders(getOrders());
    setCart([]);
    setNote('');
    setSuccess(true);
    setTimeout(() => { setSuccess(false); setView('tables'); }, 2000);
  }

  // ── TABLES VIEW ──────────────────────────────────────────────────────────
  if (view === 'tables') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white shadow-sm px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🍽️</span>
            <span className="font-bold text-gray-800">Restoran</span>
            {!online && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Oflayn</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{waiterName}</span>
            <button onClick={() => { logout(); router.push('/login'); }} className="text-sm text-red-500 hover:text-red-700">Çıxış</button>
          </div>
        </header>

        <main className="flex-1 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Masalar</h2>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block" /> Boş</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" /> Dolu</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300 inline-block" /> Hesab</span>
            </div>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
            {Array.from({ length: TOTAL_TABLES }, (_, i) => i + 1).map(n => {
              const status = getTableStatus(n, orders);
              const styles: Record<typeof status, string> = {
                boş: 'bg-green-50 border-green-200 hover:border-green-400 text-green-800',
                dolu: 'bg-red-50 border-red-200 hover:border-red-400 text-red-800',
                hesab: 'bg-orange-50 border-orange-300 hover:border-orange-500 text-orange-800',
              };
              return (
                <button
                  key={n}
                  onClick={() => openTable(n)}
                  className={`border-2 rounded-xl py-4 text-center font-bold transition-all ${styles[status]}`}
                >
                  <div className="text-lg">{n}</div>
                  <div className="text-xs font-normal capitalize mt-0.5">{status}</div>
                </button>
              );
            })}
          </div>
        </main>
      </div>
    );
  }

  // ── ORDER VIEW ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setView('tables')} className="text-orange-500 hover:text-orange-700 font-medium text-sm">
            ← Masalar
          </button>
          <span className="text-gray-300">|</span>
          <span className="font-bold text-gray-800">Masa {selectedTable}</span>
          {!online && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Oflayn</span>
          )}
        </div>
        <span className="text-sm text-gray-600">{waiterName}</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Menu */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="bg-white border-b px-4 py-2 flex gap-2 overflow-x-auto">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap text-sm px-3 py-1.5 rounded-full font-medium transition-colors ${activeCategory === cat ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
            {filtered.map(item => {
              const inCart = cart.find(ci => ci.menuItem.id === item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  className="bg-white rounded-xl shadow-sm p-4 text-left hover:shadow-md hover:border-orange-200 border border-transparent transition-all relative"
                >
                  {inCart && (
                    <span className="absolute top-2 right-2 bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                      {inCart.quantity}
                    </span>
                  )}
                  <p className="text-sm font-medium text-gray-800 leading-tight">{item.name}</p>
                  <p className="text-orange-600 font-bold text-sm mt-1">{item.price.toFixed(2)} ₼</p>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="col-span-3 text-center text-gray-400 py-8">Bu kateqoriyada mövcud yemək yoxdur</p>
            )}
          </div>
        </div>

        {/* Cart */}
        <div className="w-72 bg-white border-l flex flex-col shadow-lg">
          <div className="px-4 py-3 border-b">
            <h2 className="font-bold text-gray-800">
              Sifariş {cartCount > 0 && <span className="text-orange-500">({cartCount})</span>}
            </h2>
            <p className="text-xs text-gray-500">Masa {selectedTable}</p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-2">
            {cart.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">Sifariş boşdur</p>
            ) : (
              <ul className="space-y-2">
                {cart.map(ci => (
                  <li key={ci.menuItem.id} className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{ci.menuItem.name}</p>
                      <p className="text-xs text-gray-500">{ci.menuItem.price.toFixed(2)} ₼</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => removeFromCart(ci.menuItem.id)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center text-sm font-bold">−</button>
                      <span className="w-5 text-center text-sm font-medium">{ci.quantity}</span>
                      <button onClick={() => addToCart(ci.menuItem)} className="w-6 h-6 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-600 flex items-center justify-center text-sm font-bold">+</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-4 py-3 border-t space-y-3">
            <textarea
              placeholder="Qeyd (istəyə bağlı)..."
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Cəmi:</span>
              <span className="font-bold text-lg text-orange-600">{total.toFixed(2)} ₼</span>
            </div>
            {success && (
              <div className="bg-green-50 text-green-700 text-sm text-center py-2 rounded-lg font-medium">
                Sifariş göndərildi!
              </div>
            )}
            <button
              onClick={handleOrder}
              disabled={cart.length === 0}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Sifariş ver
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
