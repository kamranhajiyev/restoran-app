'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, logout } from '@/lib/auth';
import {
  getMenu, saveMenu, getOrders, updateOrderStatus,
  pullMenuFromSupabase, pullOrdersFromSupabase,
  getCategories, saveCategories, pullCategoriesFromSupabase,
  syncMenuToSupabase,
} from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { MenuItem, MenuItemVariant, Order, OrderStatus } from '@/types';

const COOKING_STATIONS = ['Mətbəx', 'Bar', 'Soyuq mətbəx', 'Pizza', 'Mangal'];

const STATUS_COLORS: Record<OrderStatus, string> = {
  'gözləyir': 'bg-yellow-100 text-yellow-800',
  'hazırlanır': 'bg-blue-100 text-blue-800',
  'hazırdır': 'bg-green-100 text-green-800',
  'ödənilib': 'bg-gray-100 text-gray-500',
};
const STATUS_OPTIONS: OrderStatus[] = ['gözləyir', 'hazırlanır', 'hazırdır', 'ödənilib'];

type Tab = 'dashboard' | 'orders' | 'menu' | 'categories' | 'reports';
type ReportPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'lastmonth' | 'all';

type FormVariant = { id: string; name: string; price: string; costPrice: string };

function emptyForm(cat: string) {
  return { name: '', price: '', costPrice: '', category: cat, image: '', cookingStation: '', hasVariants: false, variants: [] as FormVariant[] };
}

function orderTotal(order: Order) {
  return order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
}

function calcMargin(price: string, cost: string): string {
  const p = parseFloat(price), c = parseFloat(cost);
  if (!p || !c || c >= p) return '';
  return `${Math.round((1 - c / p) * 100)}%`;
}

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [adminName, setAdminName] = useState('Admin');
  const [online, setOnline] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('today');

  // menu form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm(''));
  const imgRef = useRef<HTMLInputElement>(null);

  // categories form
  const [newCat, setNewCat] = useState('');

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'admin') { router.replace('/login'); return; }
    setAdminName(session.name);
    const cats = getCategories();
    setCategories(cats);
    setMenu(getMenu());
    setOrders(getOrders());

    // push local menu to Supabase first, then pull to get UUID-stable ids back
    syncMenuToSupabase().then(() =>
      Promise.all([pullMenuFromSupabase(), pullOrdersFromSupabase(), pullCategoriesFromSupabase()])
    ).then(([ok]) => {
      setOnline(ok);
      setMenu(getMenu());
      setOrders(getOrders());
      setCategories(getCategories());
    });
  }, [router]);

  function refresh() { setOrders(getOrders()); }

  // ── image ──────────────────────────────────────────────────────────────────
  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop();
    const path = `${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('menu-images').upload(path, file, { upsert: true });
    if (error) {
      alert('Şəkil yüklənmədi: ' + error.message);
      return;
    }
    const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
    setForm(f => ({ ...f, image: data.publicUrl }));
  }

  // ── menu form ──────────────────────────────────────────────────────────────
  function openAdd() {
    setEditingId(null);
    setForm(emptyForm(categories[0] ?? ''));
    setShowForm(true);
  }

  function openEdit(item: MenuItem) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      price: item.variants?.length ? '' : String(item.price),
      costPrice: item.costPrice ? String(item.costPrice) : '',
      category: item.category,
      image: item.image ?? '',
      cookingStation: item.cookingStation ?? '',
      hasVariants: !!item.variants?.length,
      variants: item.variants?.map(v => ({
        id: v.id,
        name: v.name,
        price: String(v.price),
        costPrice: v.costPrice ? String(v.costPrice) : '',
      })) ?? [],
    });
    setShowForm(true);
  }

  function cancelForm() { setShowForm(false); setEditingId(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const variants: MenuItemVariant[] = form.hasVariants
      ? form.variants.map(v => ({
          id: v.id || Date.now().toString(),
          name: v.name,
          price: parseFloat(v.price) || 0,
          costPrice: v.costPrice ? parseFloat(v.costPrice) : undefined,
        }))
      : [];

    const basePrice = form.hasVariants ? (variants[0]?.price ?? 0) : (parseFloat(form.price) || 0);

    const item: MenuItem = {
      id: editingId ?? crypto.randomUUID(),
      name: form.name,
      price: basePrice,
      category: form.category,
      available: editingId ? (menu.find(m => m.id === editingId)?.available ?? true) : true,
      variants: form.hasVariants ? variants : undefined,
      costPrice: form.costPrice ? parseFloat(form.costPrice) : undefined,
      image: form.image || undefined,
      cookingStation: form.cookingStation || undefined,
    };

    const updated = editingId ? menu.map(m => m.id === editingId ? item : m) : [...menu, item];
    saveMenu(updated);
    setMenu(updated);
    cancelForm();
  }

  function addVariant() {
    setForm(f => ({ ...f, variants: [...f.variants, { id: Date.now().toString(), name: '', price: '', costPrice: '' }] }));
  }

  function updateVariant(idx: number, field: keyof FormVariant, value: string) {
    setForm(f => ({ ...f, variants: f.variants.map((v, i) => i === idx ? { ...v, [field]: value } : v) }));
  }

  function removeVariant(idx: number) {
    setForm(f => ({ ...f, variants: f.variants.filter((_, i) => i !== idx) }));
  }

  function toggleAvailable(id: string) {
    const updated = menu.map(m => m.id === id ? { ...m, available: !m.available } : m);
    saveMenu(updated); setMenu(updated);
  }

  function deleteItem(id: string) {
    const updated = menu.filter(m => m.id !== id);
    saveMenu(updated); setMenu(updated);
  }

  function handleStatusChange(orderId: string, status: OrderStatus) {
    updateOrderStatus(orderId, status); refresh();
  }

  // ── categories ─────────────────────────────────────────────────────────────
  function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newCat.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    const updated = [...categories, trimmed];
    saveCategories(updated); setCategories(updated); setNewCat('');
  }

  function deleteCategory(cat: string) {
    const updated = categories.filter(c => c !== cat);
    saveCategories(updated); setCategories(updated);
  }

  // ── stats ──────────────────────────────────────────────────────────────────
  const activeOrders = orders.filter(o => o.status !== 'ödənilib');
  const paidOrders = orders.filter(o => o.status === 'ödənilib');
  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today);
  const todayPaid = todayOrders.filter(o => o.status === 'ödənilib');
  const todayRevenue = todayPaid.reduce((s, o) => s + orderTotal(o), 0);
  const avgCheck = todayPaid.length > 0 ? todayRevenue / todayPaid.length : 0;
  const totalRevenue = paidOrders.reduce((s, o) => s + orderTotal(o), 0);

  const categoryMap: Record<string, number> = {};
  todayPaid.forEach(o => o.items.forEach(oi => {
    categoryMap[oi.menuItem.category] = (categoryMap[oi.menuItem.category] ?? 0) + oi.menuItem.price * oi.quantity;
  }));
  const topCategories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
  const maxCatRevenue = topCategories[0]?.[1] ?? 1;

  // ── report computations ──────────────────────────────────────────────────────
  const rNow = new Date();
  const rTodayStart = new Date(rNow.getFullYear(), rNow.getMonth(), rNow.getDate());
  function getReportRange(p: ReportPeriod): [Date, Date] {
    switch (p) {
      case 'today': return [rTodayStart, rNow];
      case 'yesterday': { const y = new Date(rTodayStart); y.setDate(y.getDate() - 1); return [y, rTodayStart]; }
      case 'week': { const w = new Date(rTodayStart); w.setDate(w.getDate() - 6); return [w, rNow]; }
      case 'month': return [new Date(rNow.getFullYear(), rNow.getMonth(), 1), rNow];
      case 'lastmonth': return [new Date(rNow.getFullYear(), rNow.getMonth() - 1, 1), new Date(rNow.getFullYear(), rNow.getMonth(), 1)];
      case 'all': return [new Date(0), rNow];
    }
  }
  const [rStart, rEnd] = getReportRange(reportPeriod);
  const reportOrders = orders.filter(o => { const d = new Date(o.createdAt); return o.status === 'ödənilib' && d >= rStart && d < rEnd; });
  const reportRevenue = reportOrders.reduce((s, o) => s + orderTotal(o), 0);
  const reportAvg = reportOrders.length > 0 ? reportRevenue / reportOrders.length : 0;

  const itemMap: Record<string, { name: string; qty: number; rev: number }> = {};
  reportOrders.forEach(o => o.items.forEach(oi => {
    const k = oi.menuItem.name;
    if (!itemMap[k]) itemMap[k] = { name: k, qty: 0, rev: 0 };
    itemMap[k].qty += oi.quantity;
    itemMap[k].rev += oi.menuItem.price * oi.quantity;
  }));
  const topItems = Object.values(itemMap).sort((a, b) => b.rev - a.rev).slice(0, 10);
  const maxItemRev = topItems[0]?.rev ?? 1;

  const repCatMap: Record<string, number> = {};
  reportOrders.forEach(o => o.items.forEach(oi => {
    repCatMap[oi.menuItem.category] = (repCatMap[oi.menuItem.category] ?? 0) + oi.menuItem.price * oi.quantity;
  }));
  const repCategories = Object.entries(repCatMap).sort((a, b) => b[1] - a[1]);
  const maxRepCat = repCategories[0]?.[1] ?? 1;

  const cashRev = reportOrders.filter(o => o.paymentMethod === 'nağd').reduce((s, o) => s + orderTotal(o), 0);
  const cardRev = reportOrders.filter(o => o.paymentMethod === 'kart').reduce((s, o) => s + orderTotal(o), 0);

  const timeSlots: { label: string; rev: number }[] = (() => {
    if (reportPeriod === 'today' || reportPeriod === 'yesterday') {
      const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${h}:00`, rev: 0 }));
      reportOrders.forEach(o => { hours[new Date(o.createdAt).getHours()].rev += orderTotal(o); });
      return hours.filter(h => h.rev > 0);
    }
    if (reportPeriod === 'week') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(rTodayStart); d.setDate(d.getDate() - (6 - i));
        return {
          label: d.toLocaleDateString('az-AZ', { weekday: 'short', day: 'numeric' }),
          rev: reportOrders.filter(o => new Date(o.createdAt).toDateString() === d.toDateString()).reduce((s, o) => s + orderTotal(o), 0),
        };
      });
    }
    if (reportPeriod === 'month' || reportPeriod === 'lastmonth') {
      const slots: { label: string; rev: number }[] = [];
      const d = new Date(rStart);
      while (d < rEnd) {
        const ds = d.toDateString();
        slots.push({ label: String(d.getDate()), rev: reportOrders.filter(o => new Date(o.createdAt).toDateString() === ds).reduce((s, o) => s + orderTotal(o), 0) });
        d.setDate(d.getDate() + 1);
      }
      return slots;
    }
    const monthMap: Record<string, number> = {};
    reportOrders.forEach(o => { const d = new Date(o.createdAt); const k = `${d.getFullYear()}/${d.getMonth() + 1}`; monthMap[k] = (monthMap[k] ?? 0) + orderTotal(o); });
    return Object.entries(monthMap).sort().map(([k, rev]) => ({ label: k, rev }));
  })();
  const maxTimeRev = Math.max(...timeSlots.map(t => t.rev), 1);

  const NAV: { id: Tab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Statistika', icon: '📊' },
    { id: 'orders', label: 'Sifarişlər', icon: '📋' },
    { id: 'menu', label: 'Menyu', icon: '🍽️' },
    { id: 'categories', label: 'Kateqoriyalar', icon: '🗂️' },
    { id: 'reports', label: 'Hesabatlar', icon: '📈' },
  ];

  function navClick(t: Tab) {
    setTab(t);
    setSidebarOpen(false);
    if (t === 'orders') refresh();
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── Sidebar overlay (mobile) ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={`fixed md:static inset-y-0 left-0 z-30 w-60 bg-white border-r border-gray-100 flex flex-col transform transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍽️</span>
            <div>
              <p className="font-bold text-gray-800 text-sm">Restoran</p>
              <p className="text-xs text-gray-400">Admin Paneli</p>
            </div>
          </div>
          {!online && <span className="mt-2 inline-block text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Oflayn</span>}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => navClick(n.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === n.id ? 'bg-orange-50 text-orange-600' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <span>{n.icon}</span>
              <span>{n.label}</span>
              {n.id === 'orders' && activeOrders.length > 0 && (
                <span className="ml-auto bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5">{activeOrders.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">Salam, {adminName}</p>
          <button
            onClick={() => { logout(); router.push('/login'); }}
            className="w-full text-sm text-red-500 hover:text-red-700 font-medium text-left"
          >
            Çıxış
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-500 text-xl">☰</button>
          <span className="font-semibold text-gray-800 text-sm">{NAV.find(n => n.id === tab)?.label}</span>
        </header>

        <main className="flex-1 overflow-y-auto p-6">

          {/* ── DASHBOARD ──────────────────────────────────────────────── */}
          {tab === 'dashboard' && (
            <div className="space-y-6 max-w-3xl">
              <h2 className="text-lg font-semibold text-gray-800">Statistika</h2>
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
                          <div className="h-full bg-orange-400 rounded-full" style={{ width: `${(rev / maxCatRevenue) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

          {/* ── ORDERS ─────────────────────────────────────────────────── */}
          {tab === 'orders' && (
            <div className="space-y-4 max-w-3xl">
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
                  <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">Ödənilmiş sifarişlər ({paidOrders.length})</summary>
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

          {/* ── MENU ───────────────────────────────────────────────────── */}
          {tab === 'menu' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-800">Menyu İdarəsi</h2>
                <button onClick={openAdd} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  + Yemək əlavə et
                </button>
              </div>

              {/* Add / Edit form */}
              {showForm && (
                <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 mb-5 space-y-4">
                  <h3 className="font-semibold text-gray-800">{editingId ? 'Yeməyi düzəlt' : 'Yeni Yemək'}</h3>

                  {/* Name */}
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Ad</label>
                    <input
                      type="text"
                      placeholder="Yeməyin adı"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      required
                    />
                  </div>

                  {/* Category + Station */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Kateqoriya</label>
                      <select
                        value={form.category}
                        onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      >
                        {categories.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Bişirmə sexi</label>
                      <select
                        value={form.cookingStation}
                        onChange={e => setForm(f => ({ ...f, cookingStation: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      >
                        <option value="">— Seçin —</option>
                        {COOKING_STATIONS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Image */}
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Şəkil</label>
                    <div className="flex gap-3 items-start">
                      <div className="flex-1">
                        <input
                          type="text"
                          placeholder="Şəkil URL-i"
                          value={form.image.startsWith('data:') ? '' : form.image}
                          onChange={e => setForm(f => ({ ...f, image: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                        <button type="button" onClick={() => imgRef.current?.click()} className="mt-1.5 text-xs text-orange-500 hover:text-orange-700">
                          Fayldan yüklə
                        </button>
                        <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
                      </div>
                      {form.image && (
                        <div className="relative">
                          <img src={form.image} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                          <button type="button" onClick={() => setForm(f => ({ ...f, image: '' }))} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center">×</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Variants toggle */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.hasVariants}
                      onChange={e => setForm(f => ({
                        ...f,
                        hasVariants: e.target.checked,
                        variants: e.target.checked && f.variants.length === 0
                          ? [{ id: Date.now().toString(), name: '', price: '', costPrice: '' }]
                          : f.variants,
                      }))}
                      className="rounded accent-orange-500"
                    />
                    <span className="text-sm text-gray-700">Variantlar var (ölçü, növ…)</span>
                  </label>

                  {/* Price row OR variants */}
                  {!form.hasVariants ? (
                    <div className="grid grid-cols-3 gap-3 items-end">
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Qiymət (₼)</label>
                        <input
                          type="number" placeholder="0.00" step="0.5" min="0"
                          value={form.price}
                          onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Maya dəyəri (₼)</label>
                        <input
                          type="number" placeholder="0.00" step="0.01" min="0"
                          value={form.costPrice}
                          onChange={e => setForm(f => ({ ...f, costPrice: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                      </div>
                      <div className="pb-2 text-sm font-semibold text-green-600">
                        {calcMargin(form.price, form.costPrice) && `Marja: ${calcMargin(form.price, form.costPrice)}`}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-9 gap-2 text-xs text-gray-500 px-1">
                        <span className="col-span-3">Variant adı</span>
                        <span className="col-span-2">Qiymət (₼)</span>
                        <span className="col-span-2">Maya (₼)</span>
                        <span className="col-span-2">Marja</span>
                      </div>
                      {form.variants.map((v, i) => (
                        <div key={v.id} className="grid grid-cols-9 gap-2 items-center">
                          <input
                            className="col-span-3 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                            placeholder={`Variant ${i + 1}`}
                            value={v.name}
                            onChange={e => updateVariant(i, 'name', e.target.value)}
                            required
                          />
                          <input
                            type="number" placeholder="0.00" step="0.5" min="0"
                            className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                            value={v.price}
                            onChange={e => updateVariant(i, 'price', e.target.value)}
                            required
                          />
                          <input
                            type="number" placeholder="0.00" step="0.01" min="0"
                            className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                            value={v.costPrice}
                            onChange={e => updateVariant(i, 'costPrice', e.target.value)}
                          />
                          <div className="col-span-2 flex items-center gap-1">
                            <span className="text-xs text-green-600 font-medium flex-1">{calcMargin(v.price, v.costPrice)}</span>
                            <button type="button" onClick={() => removeVariant(i)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                          </div>
                        </div>
                      ))}
                      <button type="button" onClick={addVariant} className="text-sm text-orange-500 hover:text-orange-700">
                        + Variant əlavə et
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-5 py-2 rounded-lg">
                      {editingId ? 'Yadda saxla' : 'Əlavə et'}
                    </button>
                    <button type="button" onClick={cancelForm} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Ləğv et</button>
                  </div>
                </form>
              )}

              {/* Menu list */}
              {categories.map(cat => {
                const items = menu.filter(m => m.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} className="mb-5">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{cat}</h3>
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                      {items.map((item, i) => (
                        <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${i < items.length - 1 ? 'border-b border-gray-50' : ''}`}>
                          {item.image
                            ? <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                            : <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg flex-shrink-0">🍴</div>
                          }
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.available ? 'bg-green-400' : 'bg-gray-300'}`} />
                              <span className={`text-sm font-medium ${item.available ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{item.name}</span>
                              {item.cookingStation && (
                                <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{item.cookingStation}</span>
                              )}
                            </div>
                            {item.variants?.length ? (
                              <p className="text-xs text-gray-400 mt-0.5">{item.variants.map(v => `${v.name}: ${v.price.toFixed(2)}₼`).join(' · ')}</p>
                            ) : (
                              <p className="text-xs text-gray-400 mt-0.5">
                                {item.price.toFixed(2)} ₼
                                {item.costPrice ? ` · Maya: ${item.costPrice.toFixed(2)}₼ · Marja: ${Math.round((1 - item.costPrice / item.price) * 100)}%` : ''}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => openEdit(item)} className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50">Düzəlt</button>
                            <button onClick={() => toggleAvailable(item.id)} className={`text-xs px-2 py-1 rounded-lg ${item.available ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                              {item.available ? 'Bağla' : 'Aç'}
                            </button>
                            <button onClick={() => deleteItem(item.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">Sil</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {menu.length === 0 && !showForm && (
                <div className="text-center py-16 text-gray-400">
                  <div className="text-5xl mb-3">🍽️</div>
                  <p>Menyu boşdur</p>
                </div>
              )}
            </div>
          )}

          {/* ── CATEGORIES ─────────────────────────────────────────────── */}
          {tab === 'categories' && (
            <div className="max-w-lg space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Kateqoriyalar</h2>

              <form onSubmit={addCategory} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Yeni kateqoriya adı"
                  value={newCat}
                  onChange={e => setNewCat(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
                <button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-lg">Əlavə et</button>
              </form>

              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                {categories.map((cat, i) => (
                  <div key={cat} className={`flex items-center justify-between px-5 py-3 ${i < categories.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 bg-orange-50 text-orange-500 rounded-md flex items-center justify-center text-xs font-bold">{i + 1}</span>
                      <span className="text-sm text-gray-800">{cat}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{menu.filter(m => m.category === cat).length} məhsul</span>
                      <button onClick={() => deleteCategory(cat)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">Sil</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── REPORTS ────────────────────────────────────────────────── */}
          {tab === 'reports' && (
            <div className="space-y-6 max-w-4xl">
              <h2 className="text-lg font-semibold text-gray-800">Hesabatlar</h2>

              {/* Period selector */}
              <div className="flex gap-2 flex-wrap">
                {([
                  ['today', 'Bugün'], ['yesterday', 'Dünən'], ['week', 'Bu həftə'],
                  ['month', 'Bu ay'], ['lastmonth', 'Keçən ay'], ['all', 'Hamısı'],
                ] as [ReportPeriod, string][]).map(([p, label]) => (
                  <button
                    key={p}
                    onClick={() => setReportPeriod(p)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${reportPeriod === p ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* KPI cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Gəlir', value: `${reportRevenue.toFixed(2)} ₼` },
                  { label: 'Sifarişlər', value: String(reportOrders.length) },
                  { label: 'Orta qəbz', value: `${reportAvg.toFixed(2)} ₼` },
                  { label: 'Ən çox satan', value: topItems[0]?.name ?? '—' },
                ].map(kpi => (
                  <div key={kpi.label} className="bg-white rounded-xl shadow-sm p-5">
                    <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
                    <p className="text-xl font-bold text-gray-800 truncate">{kpi.value}</p>
                  </div>
                ))}
              </div>

              {reportOrders.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <div className="text-5xl mb-3">📈</div>
                  <p>Bu dövr üçün məlumat yoxdur</p>
                </div>
              ) : (
                <>
                  {/* Time breakdown chart */}
                  {timeSlots.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm p-5">
                      <h3 className="font-semibold text-gray-800 mb-4">Gəlir dinamikası</h3>
                      <div className="overflow-x-auto">
                        <div
                          className="flex items-end gap-1 h-36"
                          style={{ minWidth: `${Math.max(timeSlots.length * 32, 300)}px` }}
                        >
                          {timeSlots.map((slot, i) => (
                            <div key={i} className="flex flex-col items-center flex-1 group">
                              <div
                                className="w-full bg-orange-400 hover:bg-orange-500 rounded-t transition-colors relative"
                                style={{ height: `${Math.max((slot.rev / maxTimeRev) * 100, slot.rev > 0 ? 3 : 0)}%` }}
                              >
                                {slot.rev > 0 && (
                                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 pointer-events-none">
                                    {slot.rev.toFixed(2)} ₼
                                  </div>
                                )}
                              </div>
                              <span className="text-xs text-gray-400 mt-1 truncate max-w-full text-center">{slot.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Top items */}
                    {topItems.length > 0 && (
                      <div className="bg-white rounded-xl shadow-sm p-5">
                        <h3 className="font-semibold text-gray-800 mb-4">Top məhsullar</h3>
                        <div className="space-y-2.5">
                          {topItems.map(item => (
                            <div key={item.name}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-700 truncate flex-1 mr-2">{item.name}</span>
                                <span className="text-gray-400 text-xs mr-2 flex-shrink-0">{item.qty} ədəd</span>
                                <span className="font-medium text-gray-800 flex-shrink-0">{item.rev.toFixed(2)} ₼</span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-orange-400 rounded-full" style={{ width: `${(item.rev / maxItemRev) * 100}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Category breakdown */}
                    {repCategories.length > 0 && (
                      <div className="bg-white rounded-xl shadow-sm p-5">
                        <h3 className="font-semibold text-gray-800 mb-4">Kateqoriyaya görə</h3>
                        <div className="space-y-2.5">
                          {repCategories.map(([cat, rev]) => (
                            <div key={cat}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-700">{cat}</span>
                                <span className="font-medium text-gray-800">{rev.toFixed(2)} ₼</span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(rev / maxRepCat) * 100}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Payment methods */}
                  {(cashRev > 0 || cardRev > 0) && (
                    <div className="bg-white rounded-xl shadow-sm p-5">
                      <h3 className="font-semibold text-gray-800 mb-4">Ödəniş üsulu</h3>
                      <div className="grid grid-cols-2 gap-6">
                        {[
                          { label: 'Nağd', rev: cashRev, color: 'bg-green-400' },
                          { label: 'Kart', rev: cardRev, color: 'bg-blue-400' },
                        ].map(pm => {
                          const pct = (cashRev + cardRev) > 0 ? Math.round((pm.rev / (cashRev + cardRev)) * 100) : 0;
                          return (
                            <div key={pm.label}>
                              <p className="text-2xl font-bold text-gray-800">{pm.rev.toFixed(2)} ₼</p>
                              <p className="text-sm text-gray-500 mt-0.5">{pm.label} · {pct}%</p>
                              <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full ${pm.color} rounded-full`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
