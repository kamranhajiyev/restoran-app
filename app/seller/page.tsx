'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, logout } from '@/lib/auth';
import { getMenu, addOrder, getOrders, updateOrderStatus, nextOrderNumber, pullMenuFromSupabase, pullOrdersFromSupabase } from '@/lib/store';
import { MenuItem, Order, OrderItem, OrderStatus } from '@/types';

type View = 'orders' | 'tables' | 'menu';
type PayMethod = 'nağd' | 'kart';

const TOTAL_TABLES = 20;

function elapsed(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} dəq`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} saat`;
}

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

function orderTotal(order: Order): number {
  return order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
}

function tableHasActive(n: number, orders: Order[]): boolean {
  return orders.some(o => o.tableNumber === n && o.status !== 'ödənilib');
}

const STATUS_STYLES: Record<OrderStatus, string> = {
  'gözləyir': 'text-amber-600 border-amber-400',
  'hazırlanır': 'text-blue-600 border-blue-400',
  'hazırdır': 'text-green-600 border-green-500',
  'ödənilib': 'text-gray-400 border-gray-300',
};

export default function SellerPage() {
  const router = useRouter();
  const [view, setView] = useState<View>('orders');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sellerName, setSellerName] = useState('Satıcı');
  const [online, setOnline] = useState(true);

  // new order state
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [note, setNote] = useState('');

  // payment modal
  const [payingOrder, setPayingOrder] = useState<Order | null>(null);
  const [payMethod, setPayMethod] = useState<PayMethod>('nağd');

  const refreshOrders = useCallback(() => setOrders(getOrders()), []);

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'seller') { router.replace('/login'); return; }
    setSellerName(session.name);
    setOrders(getOrders());
    const m = getMenu();
    setMenu(m);
    const cats = [...new Set(m.map(i => i.category))];
    if (cats.length > 0) setActiveCategory(cats[0]);

    Promise.all([pullMenuFromSupabase(), pullOrdersFromSupabase()]).then(([ok]) => {
      setOnline(ok);
      const fresh = getMenu();
      setMenu(fresh);
      setOrders(getOrders());
      const cats2 = [...new Set(fresh.map(i => i.category))];
      if (cats2.length > 0) setActiveCategory(cats2[0]);
    });
  }, [router]);

  // ── cart helpers ──────────────────────────────────────────────────────────

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

  const cartTotal = cart.reduce((s, ci) => s + ci.menuItem.price * ci.quantity, 0);
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);
  const categories = [...new Set(menu.map(i => i.category))];
  const filtered = menu.filter(m => m.category === activeCategory && m.available);

  function selectTable(n: number) {
    setSelectedTable(n);
    setCart([]);
    setNote('');
    setView('menu');
  }

  function submitOrder() {
    if (!selectedTable || cart.length === 0) return;
    const order: Order = {
      id: Date.now().toString(),
      orderNumber: nextOrderNumber(),
      tableNumber: selectedTable,
      items: cart,
      status: 'gözləyir',
      createdAt: new Date().toISOString(),
      sellerName,
      note: note.trim() || undefined,
    };
    addOrder(order);
    refreshOrders();
    setCart([]);
    setNote('');
    setSelectedTable(null);
    setView('orders');
  }

  function confirmPayment() {
    if (!payingOrder) return;
    updateOrderStatus(payingOrder.id, 'ödənilib', payMethod);
    refreshOrders();
    setPayingOrder(null);
  }

  // ── grouped orders ────────────────────────────────────────────────────────
  const active = orders.filter(o => o.status !== 'ödənilib');
  const todayOrders = active.filter(o => isToday(o.createdAt));
  const prevOrders = active.filter(o => !isToday(o.createdAt));

  // ── HEADER ─────────────────────────────────────────────────────────────────
  const header = (
    <header className="bg-gray-900 text-white px-5 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-6">
        <span className="font-bold text-lg">🍽️ Restoran</span>
        <nav className="flex gap-1">
          {(['orders', 'tables'] as View[]).map(v => {
            const labels: Record<string, string> = { orders: 'Sifarişlər', tables: 'Zal xəritəsi' };
            return (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${view === v || (v === 'tables' && view === 'menu') ? 'bg-white/20' : 'hover:bg-white/10'}`}
              >
                {labels[v]}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {!online && <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full">Oflayn</span>}
        <span className="text-sm text-gray-300">{sellerName}</span>
        <button onClick={() => { logout(); router.push('/login'); }} className="text-sm text-gray-400 hover:text-white">Çıxış</button>
      </div>
    </header>
  );

  // ── ORDERS VIEW ────────────────────────────────────────────────────────────
  if (view === 'orders') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}

        {/* filter bar */}
        <div className="bg-white border-b px-5 py-2.5 flex items-center gap-3">
          <button
            onClick={() => { setSelectedTable(null); setCart([]); setView('tables'); }}
            className="bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            + Yeni sifariş
          </button>
          <div className="flex gap-4 text-sm ml-2">
            <span className="font-medium text-gray-800">Bütün sifarişlər <span className="text-gray-400">{active.length}</span></span>
            <span className="text-gray-500">Yeni <span className="font-medium text-gray-800">{orders.filter(o => o.status === 'gözləyir').length}</span></span>
            <span className="text-gray-500">Hazırlanır <span className="font-medium text-gray-800">{orders.filter(o => o.status === 'hazırlanır').length}</span></span>
            <span className="text-gray-500">Hazır <span className="font-medium text-gray-800">{orders.filter(o => o.status === 'hazırdır').length}</span></span>
          </div>
          <button onClick={refreshOrders} className="ml-auto text-sm text-gray-400 hover:text-gray-600">↻ Yenilə</button>
        </div>

        {/* table header */}
        <div className="grid grid-cols-[120px_1fr_160px_180px_120px] gap-4 px-5 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide border-b bg-white">
          <span>Vaxt</span>
          <span>Sifariş</span>
          <span>Durum</span>
          <span></span>
          <span className="text-right">Ümumi</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {active.length === 0 && (
            <div className="text-center py-20 text-gray-400">
              <div className="text-5xl mb-3">📋</div>
              <p>Aktiv sifariş yoxdur</p>
            </div>
          )}

          {prevOrders.length > 0 && (
            <div>
              <div className="px-5 py-2 bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                ▸ Əvvəlki günlər &nbsp;{prevOrders.length}
              </div>
              {prevOrders.map(o => <OrderRow key={o.id} order={o} onPay={() => setPayingOrder(o)} onStatusChange={(id, s) => { updateOrderStatus(id, s); refreshOrders(); }} />)}
            </div>
          )}

          {todayOrders.length > 0 && (
            <div>
              <div className="px-5 py-2 bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                ▸ Bu gün &nbsp;{todayOrders.length}
              </div>
              {todayOrders.map(o => <OrderRow key={o.id} order={o} onPay={() => setPayingOrder(o)} onStatusChange={(id, s) => { updateOrderStatus(id, s); refreshOrders(); }} />)}
            </div>
          )}
        </div>

        {/* payment modal */}
        {payingOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
              <h3 className="font-bold text-lg text-gray-800 mb-1">Ödəniş</h3>
              <p className="text-sm text-gray-500 mb-4">№{payingOrder.orderNumber} · Masa {payingOrder.tableNumber}</p>

              <ul className="text-sm space-y-1 mb-4 border-t pt-3">
                {payingOrder.items.map((oi, i) => (
                  <li key={i} className="flex justify-between text-gray-700">
                    <span>{oi.menuItem.name} × {oi.quantity}</span>
                    <span>{(oi.menuItem.price * oi.quantity).toFixed(2)} ₼</span>
                  </li>
                ))}
              </ul>

              <div className="flex justify-between items-center font-bold text-lg border-t pt-3 mb-4">
                <span>Cəmi</span>
                <span className="text-orange-600">{orderTotal(payingOrder).toFixed(2)} ₼</span>
              </div>

              <div className="flex gap-2 mb-4">
                {(['nağd', 'kart'] as PayMethod[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setPayMethod(m)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${payMethod === m ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    {m === 'nağd' ? '💵 Nağd' : '💳 Kart'}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <button onClick={() => setPayingOrder(null)} className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Ləğv et</button>
                <button onClick={confirmPayment} className="flex-1 py-2.5 rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold text-sm">Ödənildi ✓</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── TABLE MAP VIEW ─────────────────────────────────────────────────────────
  if (view === 'tables') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <main className="flex-1 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Masa seçin</h2>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block" /> Boş</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" /> Dolu</span>
            </div>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 max-w-xl">
            {Array.from({ length: TOTAL_TABLES }, (_, i) => i + 1).map(n => {
              const busy = tableHasActive(n, orders);
              return (
                <button
                  key={n}
                  onClick={() => selectTable(n)}
                  className={`border-2 rounded-xl py-5 text-center font-bold transition-all ${busy ? 'bg-red-50 border-red-200 hover:border-red-400 text-red-800' : 'bg-green-50 border-green-200 hover:border-green-400 text-green-800'}`}
                >
                  <div className="text-xl">{n}</div>
                  <div className="text-xs font-normal mt-0.5">{busy ? 'Dolu' : 'Boş'}</div>
                </button>
              );
            })}
          </div>
        </main>
      </div>
    );
  }

  // ── MENU / ORDER CREATION VIEW ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {header}
      <div className="bg-white border-b px-5 py-2 flex items-center gap-3">
        <button onClick={() => setView('tables')} className="text-sm text-orange-500 hover:text-orange-700 font-medium">← Masalar</button>
        <span className="text-gray-300">|</span>
        <span className="font-semibold text-gray-800">Masa {selectedTable} — Yeni sifariş</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* menu */}
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
                  className="bg-white rounded-xl shadow-sm text-left hover:shadow-md border border-transparent hover:border-orange-200 transition-all relative overflow-hidden"
                >
                  {inCart && (
                    <span className="absolute top-2 right-2 z-10 bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">{inCart.quantity}</span>
                  )}
                  {item.image
                    ? <img src={item.image} alt={item.name} className="w-full h-28 object-cover" />
                    : <div className="w-full h-28 bg-gray-100 flex items-center justify-center text-3xl">🍴</div>
                  }
                  <div className="p-3">
                    <p className="text-sm font-medium text-gray-800 leading-tight">{item.name}</p>
                    <p className="text-orange-600 font-bold text-sm mt-0.5">{item.price.toFixed(2)} ₼</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* cart */}
        <div className="w-72 bg-white border-l flex flex-col">
          <div className="px-4 py-3 border-b">
            <h2 className="font-bold text-gray-800">Sifariş {cartCount > 0 && <span className="text-orange-500">({cartCount})</span>}</h2>
            <p className="text-xs text-gray-400">Masa {selectedTable}</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {cart.length === 0
              ? <p className="text-center text-gray-400 text-sm py-8">Boşdur</p>
              : <ul className="space-y-2">
                  {cart.map(ci => (
                    <li key={ci.menuItem.id} className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{ci.menuItem.name}</p>
                        <p className="text-xs text-gray-400">{ci.menuItem.price.toFixed(2)} ₼</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => removeFromCart(ci.menuItem.id)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center text-sm font-bold">−</button>
                        <span className="w-5 text-center text-sm">{ci.quantity}</span>
                        <button onClick={() => addToCart(ci.menuItem)} className="w-6 h-6 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-600 flex items-center justify-center text-sm font-bold">+</button>
                      </div>
                    </li>
                  ))}
                </ul>
            }
          </div>
          <div className="px-4 py-3 border-t space-y-3">
            <textarea
              placeholder="Qeyd..."
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Cəmi:</span>
              <span className="font-bold text-lg text-orange-600">{cartTotal.toFixed(2)} ₼</span>
            </div>
            <button
              onClick={submitOrder}
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

// ── order row component ───────────────────────────────────────────────────────

function OrderRow({ order, onPay, onStatusChange }: {
  order: Order;
  onPay: () => void;
  onStatusChange: (id: string, s: OrderStatus) => void;
}) {
  const total = orderTotal(order);
  const itemsPreview = order.items.map(oi => oi.menuItem.name).join(', ');

  return (
    <div className="grid grid-cols-[120px_1fr_160px_180px_120px] gap-4 px-5 py-4 border-b bg-white hover:bg-gray-50 items-center">
      {/* time */}
      <div>
        <p className="font-semibold text-gray-800 text-sm">
          {new Date(order.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="text-xs text-gray-400">{elapsed(order.createdAt)}</p>
      </div>

      {/* order info */}
      <div>
        <p className="text-sm font-medium text-gray-800">
          <span className="text-blue-600">№{order.orderNumber}</span>
          {' › '}
          <span>Masa {order.tableNumber}</span>
        </p>
        <p className="text-xs text-gray-400 truncate max-w-xs">{itemsPreview}</p>
      </div>

      {/* status */}
      <div>
        <span className={`text-xs font-bold uppercase border-b-2 pb-0.5 ${STATUS_STYLES[order.status]}`}>
          {order.status}
        </span>
        <p className="text-xs text-gray-400 mt-0.5">{elapsed(order.createdAt)}</p>
      </div>

      {/* action */}
      <div>
        {order.status !== 'ödənilib' && (
          <div className="flex gap-2">
            {order.status !== 'hazırdır' && (
              <select
                value={order.status}
                onChange={e => onStatusChange(order.id, e.target.value as OrderStatus)}
                className="text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none text-gray-600"
              >
                <option value="gözləyir">Gözləyir</option>
                <option value="hazırlanır">Hazırlanır</option>
                <option value="hazırdır">Hazırdır</option>
              </select>
            )}
            {(order.status === 'hazırdır' || order.status === 'gözləyir' || order.status === 'hazırlanır') && (
              <button
                onClick={onPay}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap"
              >
                Ödənişə keç
              </button>
            )}
          </div>
        )}
      </div>

      {/* total */}
      <div className="text-right">
        <span className="font-bold text-gray-800">{total.toFixed(2)} ₼</span>
      </div>
    </div>
  );
}
