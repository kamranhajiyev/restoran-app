'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, logout } from '@/lib/auth';
import { getMenu, saveMenu, getOrders, updateOrderStatus, pullMenuFromSupabase, pullOrdersFromSupabase } from '@/lib/store';
import { MenuItem, Order, OrderStatus } from '@/types';

const CATEGORIES = ['Salatlar', 'Şorbalar', 'Əsas Yeməklər', 'Qəlyanaltı', 'İçkilər', 'Desertlər'];

const STATUS_COLORS: Record<OrderStatus, string> = {
  'gözləyir': 'bg-yellow-100 text-yellow-800',
  'hazırlanır': 'bg-blue-100 text-blue-800',
  'hazırdır': 'bg-green-100 text-green-800',
  'ödənilib': 'bg-gray-100 text-gray-500',
};

const STATUS_OPTIONS: OrderStatus[] = ['gözləyir', 'hazırlanır', 'hazırdır', 'ödənilib'];

type Tab = 'dashboard' | 'orders' | 'menu';

function orderTotal(order: Order) {
  return order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
}

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', price: '', category: CATEGORIES[0] });
  const [adminName, setAdminName] = useState('Admin');
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'admin') { router.replace('/login'); return; }
    setAdminName(session.name);
    setMenu(getMenu());
    setOrders(getOrders());

    Promise.all([pullMenuFromSupabase(), pullOrdersFromSupabase()]).then(([ok]) => {
      setOnline(ok);
      setMenu(getMenu());
      setOrders(getOrders());
    });
  }, [router]);

  function refresh() {
    setOrders(getOrders());
  }

  function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    const item: MenuItem = {
      id: Date.now().toString(),
      name: newItem.name,
      price: parseFloat(newItem.price),
      category: newItem.category,
      available: true,
    };
    const updated = [...menu, item];
    saveMenu(updated);
    setMenu(updated);
    setNewItem({ name: '', price: '', category: CATEGORIES[0] });
    setShowAddForm(false);
  }

  function toggleAvailable(id: string) {
    const updated = menu.map(m => m.id === id ? { ...m, available: !m.available } : m);
    saveMenu(updated);
    setMenu(updated);
  }

  function deleteItem(id: string) {
    const updated = menu.filter(m => m.id !== id);
    saveMenu(updated);
    setMenu(updated);
  }

  function handleStatusChange(orderId: string, status: OrderStatus) {
    updateOrderStatus(orderId, status);
    refresh();
  }

  const activeOrders = orders.filter(o => o.status !== 'ödənilib');
  const paidOrders = orders.filter(o => o.status === 'ödənilib');

  // ── dashboard stats ──────────────────────────────────────────────────────
  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today);
  const todayPaid = todayOrders.filter(o => o.status === 'ödənilib');
  const todayRevenue = todayPaid.reduce((s, o) => s + orderTotal(o), 0);
  const avgCheck = todayPaid.length > 0 ? todayRevenue / todayPaid.length : 0;
  const totalRevenue = paidOrders.reduce((s, o) => s + orderTotal(o), 0);

  // category breakdown for today
  const categoryMap: Record<string, number> = {};
  todayPaid.forEach(o => {
    o.items.forEach(oi => {
      categoryMap[oi.menuItem.category] = (categoryMap[oi.menuItem.category] ?? 0) + oi.menuItem.price * oi.quantity;
    });
  });
  const topCategories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
  const maxCatRevenue = topCategories[0]?.[1] ?? 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🍽️</span>
          <div>
            <h1 className="font-bold text-gray-800">Restoran</h1>
            <p className="text-xs text-gray-500">Admin Paneli</p>
          </div>
          {!online && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Oflayn</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">Salam, {adminName}</span>
          <button onClick={() => { logout(); router.push('/login'); }} className="text-sm text-red-500 hover:text-red-700 font-medium">Çıxış</button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b bg-white px-6">
        {(['dashboard', 'orders', 'menu'] as Tab[]).map(t => {
          const labels: Record<Tab, string> = { dashboard: 'Statistika', orders: 'Sifarişlər', menu: 'Menyu' };
          return (
            <button
              key={t}
              onClick={() => { setTab(t); if (t === 'orders') refresh(); }}
              className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {labels[t]}
              {t === 'orders' && activeOrders.length > 0 && (
                <span className="ml-2 bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5">{activeOrders.length}</span>
              )}
            </button>
          );
        })}
      </div>

      <main className="max-w-4xl mx-auto p-6">

        {/* ── DASHBOARD ──────────────────────────────────────────────────── */}
        {tab === 'dashboard' && (
          <div className="space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Bu gün gəlir', value: `${todayRevenue.toFixed(2)} ₼`, sub: `${todayPaid.length} qəbz` },
                { label: 'Orta qəbz', value: `${avgCheck.toFixed(2)} ₼`, sub: 'bu gün' },
                { label: 'Aktiv sifarişlər', value: String(activeOrders.length), sub: 'hal-hazırda' },
                { label: 'Ümumi gəlir', value: `${totalRevenue.toFixed(2)} ₼`, sub: `${paidOrders.length} qəbz` },
              ].map(kpi => (
                <div key={kpi.label} className="bg-white rounded-xl shadow-sm p-5">
                  <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
                  <p className="text-2xl font-bold text-gray-800">{kpi.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{kpi.sub}</p>
                </div>
              ))}
            </div>

            {/* Category breakdown */}
            {topCategories.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Bu gün kateqoriyaya görə gəlir</h3>
                <div className="space-y-3">
                  {topCategories.map(([cat, rev]) => (
                    <div key={cat}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700">{cat}</span>
                        <span className="font-medium text-gray-800">{rev.toFixed(2)} ₼</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-400 rounded-full"
                          style={{ width: `${(rev / maxCatRevenue) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent paid orders */}
            {todayPaid.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Bu günün ödənilmiş sifarişləri</h3>
                <div className="space-y-2">
                  {todayPaid.map(o => (
                    <div key={o.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <span className="font-medium text-sm text-gray-800">Masa {o.tableNumber}</span>
                        <span className="ml-2 text-xs text-gray-400">{o.sellerName}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-sm text-gray-800">{orderTotal(o).toFixed(2)} ₼</span>
                        <p className="text-xs text-gray-400">{new Date(o.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {todayOrders.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <div className="text-5xl mb-3">📊</div>
                <p>Bu gün üçün məlumat yoxdur</p>
              </div>
            )}
          </div>
        )}

        {/* ── ORDERS ─────────────────────────────────────────────────────── */}
        {tab === 'orders' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">Aktiv Sifarişlər</h2>
              <button onClick={refresh} className="text-sm text-orange-500 hover:text-orange-700">Yenilə</button>
            </div>

            {activeOrders.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">📋</div>
                <p>Aktiv sifariş yoxdur</p>
              </div>
            )}

            {activeOrders.map(order => (
              <div key={order.id} className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="font-bold text-lg">Masa {order.tableNumber}</span>
                    <span className="ml-3 text-sm text-gray-500">{order.sellerName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[order.status]}`}>{order.status}</span>
                    <select
                      value={order.status}
                      onChange={e => handleStatusChange(order.id, e.target.value as OrderStatus)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none"
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <ul className="text-sm space-y-1 mb-3">
                  {order.items.map((oi, i) => (
                    <li key={i} className="flex justify-between text-gray-700">
                      <span>{oi.menuItem.name} × {oi.quantity}</span>
                      <span>{(oi.menuItem.price * oi.quantity).toFixed(2)} ₼</span>
                    </li>
                  ))}
                </ul>

                {order.note && <p className="text-xs text-gray-500 italic mb-2">Qeyd: {order.note}</p>}

                <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleTimeString('az-AZ')}</span>
                  <span className="font-bold text-orange-600">{orderTotal(order).toFixed(2)} ₼</span>
                </div>
              </div>
            ))}

            {paidOrders.length > 0 && (
              <details className="mt-6">
                <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                  Ödənilmiş sifarişlər ({paidOrders.length})
                </summary>
                <div className="mt-3 space-y-3">
                  {paidOrders.map(order => (
                    <div key={order.id} className="bg-white rounded-xl shadow-sm p-4 opacity-60">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">Masa {order.tableNumber}</span>
                        <span className="font-bold text-gray-600">{orderTotal(order).toFixed(2)} ₼</span>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* ── MENU ───────────────────────────────────────────────────────── */}
        {tab === 'menu' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Menyu İdarəsi</h2>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                + Yemək əlavə et
              </button>
            </div>

            {showAddForm && (
              <form onSubmit={handleAddItem} className="bg-white rounded-xl shadow-sm p-5 mb-4">
                <h3 className="font-medium text-gray-800 mb-3">Yeni Yemək</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <input
                      type="text"
                      placeholder="Yeməyin adı"
                      value={newItem.name}
                      onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      required
                    />
                  </div>
                  <input
                    type="number"
                    placeholder="Qiymət (₼)"
                    step="0.5"
                    min="0"
                    value={newItem.price}
                    onChange={e => setNewItem({ ...newItem, price: e.target.value })}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    required
                  />
                  <select
                    value={newItem.category}
                    onChange={e => setNewItem({ ...newItem, category: e.target.value })}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  >
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 mt-3">
                  <button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-lg">Əlavə et</button>
                  <button type="button" onClick={() => setShowAddForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Ləğv et</button>
                </div>
              </form>
            )}

            {CATEGORIES.map(cat => {
              const items = menu.filter(m => m.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat} className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{cat}</h3>
                  <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                    {items.map((item, i) => (
                      <div key={item.id} className={`flex items-center justify-between px-5 py-3 ${i < items.length - 1 ? 'border-b border-gray-50' : ''}`}>
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${item.available ? 'bg-green-400' : 'bg-gray-300'}`} />
                          <span className={`text-sm ${item.available ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{item.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-gray-700">{item.price.toFixed(2)} ₼</span>
                          <button onClick={() => toggleAvailable(item.id)} className={`text-xs px-2 py-1 rounded-lg transition-colors ${item.available ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                            {item.available ? 'Bağla' : 'Aç'}
                          </button>
                          <button onClick={() => deleteItem(item.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">Sil</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
