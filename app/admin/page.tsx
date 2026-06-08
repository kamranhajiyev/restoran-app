'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, ClipboardList, UtensilsCrossed, Tag,
  PanelLeftClose, PanelLeftOpen, LogOut, Menu, X,
  TrendingUp, ShoppingBag, Receipt, Star, ChevronDown, Percent,
} from 'lucide-react';
import { getSession, logout } from '@/lib/auth';
import {
  fetchMenu, saveMenu, fetchOrders, updateOrderStatus,
  fetchCategories, saveCategories,
} from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { MenuItem, MenuItemVariant, Order, OrderStatus } from '@/types';

const COOKING_STATIONS = ['Mətbəx', 'Bar', 'Soyuq mətbəx', 'Pizza', 'Mangal'];

const STATUS_COLORS: Record<OrderStatus, string> = {
  'gözləyir':  'bg-amber-100 text-amber-700',
  'hazırlanır':'bg-blue-100 text-blue-700',
  'hazırdır':  'bg-green-100 text-green-700',
  'ödənilib':  'bg-gray-100 text-gray-500',
};
const STATUS_OPTIONS: OrderStatus[] = ['gözləyir', 'hazırlanır', 'hazırdır', 'ödənilib'];

type Tab = 'stats' | 'orders' | 'menu' | 'categories';
type ChartView = 'gün' | 'həftə' | 'ay';
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

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'stats',      label: 'Statistika',    icon: LayoutDashboard },
  { id: 'orders',     label: 'Sifarişlər',    icon: ClipboardList },
  { id: 'menu',       label: 'Menyu',         icon: UtensilsCrossed },
  { id: 'categories', label: 'Kateqoriyalar', icon: Tag },
];

const PAGE_META: Record<Tab, { title: string; subtitle: string }> = {
  stats:      { title: 'Statistika & Hesabatlar', subtitle: 'Satış analitikası' },
  orders:     { title: 'Sifarişlər',              subtitle: 'Aktiv sifarişlər' },
  menu:       { title: 'Menyu İdarəsi',           subtitle: 'Məhsulları əlavə et, düzəlt, sil' },
  categories: { title: 'Kateqoriyalar',           subtitle: 'Menyu kateqoriyaları' },
};

function LineChartSvg({ data }: { data: { label: string; rev: number }[] }) {
  const W = 800, H = 160, PL = 44, PR = 12, PT = 14, PB = 26;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = data.length;
  const maxV = Math.max(...data.map(d => d.rev), 0.01);
  const px = (i: number) => PL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const py = (v: number) => PT + (1 - v / maxV) * plotH;
  const pts = data.map((d, i) => [px(i), py(d.rev)] as [number, number]);
  const lineStr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaStr = [`${pts[0][0].toFixed(1)},${(PT + plotH).toFixed(1)}`, ...pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`), `${pts[n - 1][0].toFixed(1)},${(PT + plotH).toFixed(1)}`].join(' ');
  const yTicks = [0, Math.round(maxV / 2), Math.round(maxV)];
  const step = Math.max(1, Math.floor(n / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="lc-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yTicks.map(t => (
        <g key={t}>
          <line x1={PL} y1={py(t)} x2={W - PR} y2={py(t)} stroke="#f3f4f6" strokeWidth="1" />
          <text x={PL - 5} y={py(t) + 4} textAnchor="end" fontSize="11" fill="#d1d5db">
            {t === 0 ? '0' : t >= 1000 ? `${(t / 1000).toFixed(1)}k` : t}
          </text>
        </g>
      ))}
      {n > 1 && <polygon points={areaStr} fill="url(#lc-g)" />}
      {n > 1 && <polyline points={lineStr} fill="none" stroke="#f97316" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map(([x, y], i) => data[i].rev > 0 && (
        <circle key={i} cx={x} cy={y} r="3" fill="#f97316" stroke="white" strokeWidth="1.5" />
      ))}
      {data.map((d, i) => (i % step === 0 || i === n - 1) && (
        <text key={i} x={px(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="10" fill="#9ca3af">{d.label}</text>
      ))}
    </svg>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('stats');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [adminName, setAdminName] = useState('Admin');
  const [online, setOnline] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // menu form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm(''));
  const imgRef = useRef<HTMLInputElement>(null);

  // categories form
  const [newCat, setNewCat] = useState('');

  // stats chart
  const [chartView, setChartView] = useState<ChartView>('gün');

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'admin') { router.replace('/login'); return; }
    setAdminName(session.name);
    Promise.all([fetchMenu(), fetchOrders(), fetchCategories()]).then(([m, o, c]) => {
      setMenu(m);
      setOrders(o);
      setCategories(c);
      setOnline(m.length > 0 || o.length > 0);
    });
  }, [router]);

  function refresh() { fetchOrders().then(setOrders); }

  // ── image ──────────────────────────────────────────────────────────────────
  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop();
    const path = `${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('menu-images').upload(path, file, { upsert: true });
    if (error) { alert('Şəkil yüklənmədi: ' + error.message); return; }
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
      variants: item.variants?.map(v => ({ id: v.id, name: v.name, price: String(v.price), costPrice: v.costPrice ? String(v.costPrice) : '' })) ?? [],
    });
    setShowForm(true);
  }

  function cancelForm() { setShowForm(false); setEditingId(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const variants: MenuItemVariant[] = form.hasVariants
      ? form.variants.map(v => ({ id: v.id || Date.now().toString(), name: v.name, price: parseFloat(v.price) || 0, costPrice: v.costPrice ? parseFloat(v.costPrice) : undefined }))
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
    setMenu(updated);
    cancelForm();
    saveMenu(updated);
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
    setMenu(updated);
    saveMenu(updated);
  }
  function deleteItem(id: string) {
    const updated = menu.filter(m => m.id !== id);
    setMenu(updated);
    saveMenu(updated);
  }
  function handleStatusChange(orderId: string, status: OrderStatus) {
    updateOrderStatus(orderId, status);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
  }

  // ── categories ─────────────────────────────────────────────────────────────
  function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newCat.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    const updated = [...categories, trimmed];
    setCategories(updated);
    setNewCat('');
    saveCategories(updated);
  }
  function deleteCategory(cat: string) {
    const updated = categories.filter(c => c !== cat);
    setCategories(updated);
    saveCategories(updated);
  }

  // ── stats computations ────────────────────────────────────────────────────
  const rNow = new Date();
  const rTodayStart = new Date(rNow.getFullYear(), rNow.getMonth(), rNow.getDate());
  const paidOrders = orders.filter(o => o.status === 'ödənilib');
  const activeOrders = orders.filter(o => o.status !== 'ödənilib');

  const menuCostMap: Record<string, number> = {};
  menu.forEach(m => {
    if (m.costPrice) menuCostMap[m.id] = m.costPrice;
    m.variants?.forEach(v => { if (v.costPrice) menuCostMap[v.id] = v.costPrice; });
  });

  const chartRangeStart: Date = (() => {
    const d = new Date(rTodayStart);
    if (chartView === 'gün') { d.setDate(d.getDate() - 29); return d; }
    if (chartView === 'həftə') { d.setDate(d.getDate() - 83); return d; }
    return new Date(rNow.getFullYear(), rNow.getMonth() - 11, 1);
  })();

  const chartData: { label: string; rev: number }[] = (() => {
    if (chartView === 'gün') {
      return Array.from({ length: 30 }, (_, i) => {
        const d = new Date(rTodayStart); d.setDate(d.getDate() - (29 - i));
        const ds = d.toDateString();
        return {
          label: i === 0 || d.getDate() === 1 ? `${d.getDate()} ${d.toLocaleDateString('az-AZ', { month: 'short' })}` : String(d.getDate()),
          rev: paidOrders.filter(o => new Date(o.createdAt).toDateString() === ds).reduce((s, o) => s + orderTotal(o), 0),
        };
      });
    }
    if (chartView === 'həftə') {
      return Array.from({ length: 12 }, (_, i) => {
        const wS = new Date(rTodayStart); wS.setDate(wS.getDate() - (11 - i) * 7);
        const wE = new Date(wS); wE.setDate(wE.getDate() + 7);
        return {
          label: `${wS.getDate()} ${wS.toLocaleDateString('az-AZ', { month: 'short' })}`,
          rev: paidOrders.filter(o => { const d = new Date(o.createdAt); return d >= wS && d < wE; }).reduce((s, o) => s + orderTotal(o), 0),
        };
      });
    }
    return Array.from({ length: 12 }, (_, i) => {
      const m = new Date(rNow.getFullYear(), rNow.getMonth() - (11 - i), 1);
      const mE = new Date(rNow.getFullYear(), rNow.getMonth() - (10 - i), 1);
      return {
        label: m.toLocaleDateString('az-AZ', { month: 'short' }),
        rev: paidOrders.filter(o => { const d = new Date(o.createdAt); return d >= m && d < mE; }).reduce((s, o) => s + orderTotal(o), 0),
      };
    });
  })();

  const chartPaid = paidOrders.filter(o => new Date(o.createdAt) >= chartRangeStart);
  const chartRevenue = chartPaid.reduce((s, o) => s + orderTotal(o), 0);
  const chartCost = chartPaid.reduce((s, o) => s + o.items.reduce((os, oi) => os + (menuCostMap[oi.menuItem.id] ?? 0) * oi.quantity, 0), 0);
  const chartProfit = chartRevenue - chartCost;
  const chartMarginPct = chartRevenue > 0 ? (chartProfit / chartRevenue) * 100 : 0;
  const chartAvg = chartPaid.length > 0 ? chartRevenue / chartPaid.length : 0;

  const cashRev = chartPaid.filter(o => o.paymentMethod === 'nağd').reduce((s, o) => s + orderTotal(o), 0);
  const cardRev = chartPaid.filter(o => o.paymentMethod === 'kart').reduce((s, o) => s + orderTotal(o), 0);
  const totalPayRev = cashRev + cardRev;

  const repCatMap: Record<string, { rev: number; cost: number }> = {};
  chartPaid.forEach(o => o.items.forEach(oi => {
    const menuItem = menu.find(m => m.id === oi.menuItem.id);
    const cat = menuItem?.category || oi.menuItem.category || 'Digər';
    if (!repCatMap[cat]) repCatMap[cat] = { rev: 0, cost: 0 };
    repCatMap[cat].rev += oi.menuItem.price * oi.quantity;
    repCatMap[cat].cost += (menuCostMap[oi.menuItem.id] ?? 0) * oi.quantity;
  }));
  const repCategories = Object.entries(repCatMap)
    .map(([cat, { rev, cost }]) => ({ cat, rev, cost, profit: rev - cost }))
    .sort((a, b) => b.profit - a.profit);
  const maxRepCatProfit = Math.max(...repCategories.map(c => Math.abs(c.profit)), 0.01);

  const itemMap: Record<string, { name: string; qty: number; rev: number; cost: number }> = {};
  chartPaid.forEach(o => o.items.forEach(oi => {
    const k = oi.menuItem.id;
    if (!itemMap[k]) itemMap[k] = { name: oi.menuItem.name, qty: 0, rev: 0, cost: 0 };
    itemMap[k].qty += oi.quantity;
    itemMap[k].rev += oi.menuItem.price * oi.quantity;
    itemMap[k].cost += (menuCostMap[oi.menuItem.id] ?? 0) * oi.quantity;
  }));
  const topItems = Object.values(itemMap).sort((a, b) => b.rev - a.rev).slice(0, 8);
  const maxItemRev = topItems[0]?.rev ?? 1;

  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    label: String(h),
    rev: paidOrders.filter(o => new Date(o.createdAt).getHours() === h).reduce((s, o) => s + orderTotal(o), 0),
  }));
  const maxHourly = Math.max(...hourlyData.map(h => h.rev), 0.01);

  const WEEKDAYS = ['Be', 'Ça', 'Çə', 'Ca', 'Cü', 'Şə', 'Ba'];
  const weeklyData = WEEKDAYS.map((label, i) => {
    const jsDay = i === 6 ? 0 : i + 1;
    return { label, rev: paidOrders.filter(o => new Date(o.createdAt).getDay() === jsDay).reduce((s, o) => s + orderTotal(o), 0) };
  });
  const maxWeekly = Math.max(...weeklyData.map(w => w.rev), 0.01);

  // ── sidebar ────────────────────────────────────────────────────────────────
  function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <div className="flex flex-col h-full bg-white">
        {/* Logo row */}
        <div className={`flex items-center h-16 border-b border-gray-100 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
                <UtensilsCrossed className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-gray-800 text-sm">Admin Paneli</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="hidden md:flex w-8 h-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Nav */}
        <nav className={`flex flex-col gap-1 p-3 flex-1 ${collapsed ? 'items-center' : ''}`}>
          {NAV_ITEMS.map(n => {
            const Icon = n.icon;
            const isActive = tab === n.id;
            const badge = n.id === 'orders' && activeOrders.length > 0 ? activeOrders.length : null;

            if (collapsed) {
              return (
                <button
                  key={n.id}
                  title={n.label}
                  onClick={() => { setTab(n.id); onNavigate?.(); if (n.id === 'orders') refresh(); }}
                  className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                    isActive ? 'bg-orange-50 text-orange-500 before:absolute before:left-[-9px] before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-r-full before:bg-orange-500' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {badge && <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{badge}</span>}
                </button>
              );
            }

            return (
              <button
                key={n.id}
                onClick={() => { setTab(n.id); onNavigate?.(); if (n.id === 'orders') refresh(); }}
                className={`flex items-center gap-3 h-9 px-3 rounded-lg text-sm font-medium transition-colors w-full ${
                  isActive ? 'bg-orange-500 text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left truncate">{n.label}</span>
                {badge && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${isActive ? 'bg-white/20 text-white' : 'bg-orange-500 text-white'}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User + logout */}
        {!collapsed && (
          <div className="px-4 py-4 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-xs font-bold">
                {adminName[0]?.toUpperCase()}
              </div>
              <span className="text-xs text-gray-600 truncate">{adminName}</span>
              {!online && <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Oflayn</span>}
            </div>
            <button
              onClick={() => { logout(); router.push('/login'); }}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Çıxış
            </button>
          </div>
        )}
        {collapsed && (
          <div className="py-4 flex flex-col items-center gap-2 border-t border-gray-100">
            <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-xs font-bold">
              {adminName[0]?.toUpperCase()}
            </div>
            <button onClick={() => { logout(); router.push('/login'); }} title="Çıxış" className="text-gray-400 hover:text-red-500 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  const meta = PAGE_META[tab];

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: 'var(--font-quicksand, Quicksand, sans-serif)' }}>

      {/* ── Top header ── */}
      <header className="sticky top-0 z-50 h-16 border-b border-gray-100 bg-white/90 backdrop-blur-sm flex items-center gap-3 px-4">
        {/* Mobile menu */}
        <button
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 md:hidden">
          <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
            <UtensilsCrossed className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-gray-800 text-sm">Restoran</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-xl">
          <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-xs font-bold">
            {adminName[0]?.toUpperCase()}
          </div>
          <span className="text-sm font-medium text-gray-700 hidden sm:inline">{adminName}</span>
        </div>

        <button
          onClick={() => { logout(); router.push('/login'); }}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Çıxış"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* ── Mobile sidebar overlay ── */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60] md:hidden" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-[70] w-64 md:hidden shadow-xl">
            <div className="absolute top-3 right-3 z-10">
              <button onClick={() => setMobileOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      <div className="flex min-h-[calc(100vh-4rem)]">

        {/* ── Desktop sidebar ── */}
        <aside className={`hidden md:block flex-shrink-0 sticky top-16 self-start h-[calc(100vh-4rem)] transition-all duration-200 border-r border-gray-100 ${collapsed ? 'w-14' : 'w-56'}`}>
          <SidebarContent />
        </aside>

        {/* ── Main ── */}
        <main className="flex-1 min-w-0 bg-gray-50 rounded-tl-2xl border-l border-t border-gray-100 p-6 md:p-8 overflow-y-auto">
          <div className="mb-6">
            <h1 className="text-lg font-semibold text-gray-900">{meta.title}</h1>
            <p className="text-sm text-gray-400 mt-0.5">{meta.subtitle}</p>
          </div>

          {/* ── STATS ─────────────────────────────────────────────────── */}
          {tab === 'stats' && (
            <div className="space-y-5 max-w-5xl">

              {/* Main chart card */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between px-6 pt-5 pb-3">
                  <h3 className="font-semibold text-gray-800">Gəlir</h3>
                  <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                    {([['gün', 'Gün'], ['həftə', 'Həftə'], ['ay', 'Ay']] as [ChartView, string][]).map(([v, l]) => (
                      <button key={v} onClick={() => setChartView(v)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${chartView === v ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="px-4 pb-2">
                  <LineChartSvg data={chartData} />
                </div>
                {/* KPI strip */}
                <div className="flex flex-wrap border-t border-gray-100">
                  {[
                    { label: 'Gəlir',       value: `${chartRevenue.toFixed(2)} ₼`,  icon: TrendingUp,  color: 'text-gray-800' },
                    { label: 'Maya dəyəri', value: `${chartCost.toFixed(2)} ₼`,     icon: ShoppingBag, color: 'text-gray-800' },
                    { label: 'Mənfəət',     value: `${chartProfit.toFixed(2)} ₼`,   icon: TrendingUp,  color: chartProfit >= 0 ? 'text-green-600' : 'text-red-500' },
                    { label: 'Mənfəət %',   value: `${chartMarginPct.toFixed(1)}%`, icon: Percent,     color: chartMarginPct >= 0 ? 'text-green-600' : 'text-red-500' },
                    { label: 'Orta çek',    value: `${chartAvg.toFixed(2)} ₼`,      icon: Receipt,     color: 'text-gray-800' },
                    { label: 'Sifarişlər',  value: String(chartPaid.length),         icon: ClipboardList, color: 'text-gray-800' },
                  ].map((kpi, i, arr) => {
                    const Icon = kpi.icon;
                    return (
                      <div key={kpi.label} className={`flex-1 min-w-[100px] px-4 py-3 ${i < arr.length - 1 ? 'border-r border-gray-100' : ''}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className="w-3 h-3 text-gray-300" />
                          <p className="text-xs text-gray-400 whitespace-nowrap">{kpi.label}</p>
                        </div>
                        <p className={`font-bold text-sm whitespace-nowrap ${kpi.color}`}>{kpi.value}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Payment + Category */}
              <div className="grid md:grid-cols-2 gap-5">
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-4">Ödəniş üsulları</h3>
                  {totalPayRev === 0 ? (
                    <p className="text-sm text-gray-300 text-center py-4">Məlumat yoxdur</p>
                  ) : (
                    <div className="space-y-3">
                      {[{ label: 'Nağd', rev: cashRev }, { label: 'Kart', rev: cardRev }].map(pm => {
                        const pct = totalPayRev > 0 ? (pm.rev / totalPayRev) * 100 : 0;
                        return (
                          <div key={pm.label}>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-sm text-gray-600">{pm.label}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400">{pct.toFixed(0)}%</span>
                                <span className="font-semibold text-gray-800 text-sm">{pm.rev.toFixed(2)} ₼</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-orange-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-4">Kateqoriya mənfəəti</h3>
                  {repCategories.length === 0 ? (
                    <p className="text-sm text-gray-300 text-center py-4">Məlumat yoxdur</p>
                  ) : (
                    <div className="space-y-3">
                      {repCategories.slice(0, 5).map(({ cat, rev, profit }) => {
                        const margin = rev > 0 ? Math.round((profit / rev) * 100) : 0;
                        return (
                          <div key={cat}>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-sm text-gray-600 truncate flex-1 mr-3">{cat}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-gray-400">{margin}%</span>
                                <span className={`font-semibold text-sm ${profit >= 0 ? 'text-gray-800' : 'text-red-500'}`}>{profit.toFixed(2)} ₼</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${profit >= 0 ? 'bg-green-400' : 'bg-red-400'}`}
                                style={{ width: `${(Math.abs(profit) / maxRepCatProfit) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Hourly + Weekly */}
              <div className="grid md:grid-cols-2 gap-5">
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-4">Gün saatlarına görə</h3>
                  <div className="flex items-end gap-0.5 h-36 pt-6">
                    {hourlyData.map((d, i) => {
                      const isPeak = d.rev > 0 && d.rev === maxHourly;
                      return (
                        <div key={i}
                          className={`relative flex-1 rounded-t-sm transition-colors cursor-default ${isPeak ? 'bg-orange-500' : 'bg-orange-300 hover:bg-orange-400'}`}
                          style={{ height: `${Math.max((d.rev / maxHourly) * 100, d.rev > 0 ? 3 : 0)}%`, opacity: d.rev > 0 ? 1 : 0.12 }}
                          title={`${i}:00 — ${d.rev.toFixed(2)} ₼`}
                        >
                          {isPeak && (
                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-orange-500 font-bold whitespace-nowrap">
                              {d.rev >= 1000 ? `${(d.rev / 1000).toFixed(1)}k` : `${d.rev.toFixed(0)}₼`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-0.5 mt-1.5">
                    {hourlyData.map((d, i) => (
                      <div key={i} className="flex-1 text-center">
                        {i % 2 === 0 && <span className="text-[9px] text-gray-300">{i}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-4">Həftənin günlərinə görə</h3>
                  <div className="flex items-end gap-2 h-36 pt-6">
                    {weeklyData.map(d => {
                      const isPeak = d.rev > 0 && d.rev === maxWeekly;
                      return (
                        <div key={d.label}
                          className={`relative flex-1 rounded-t-sm transition-colors cursor-default ${isPeak ? 'bg-orange-500' : 'bg-orange-300 hover:bg-orange-400'}`}
                          style={{ height: `${Math.max((d.rev / maxWeekly) * 100, d.rev > 0 ? 3 : 0)}%`, opacity: d.rev > 0 ? 1 : 0.12 }}
                          title={`${d.label} — ${d.rev.toFixed(2)} ₼`}
                        >
                          {d.rev > 0 && (
                            <span className={`absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold whitespace-nowrap ${isPeak ? 'text-orange-500' : 'text-gray-500'}`}>
                              {d.rev >= 1000 ? `${(d.rev / 1000).toFixed(1)}k` : `${d.rev.toFixed(0)}₼`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex mt-1.5">
                    {weeklyData.map(d => (
                      <span key={d.label} className="flex-1 text-center text-xs text-gray-400">{d.label}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Top items */}
              {topItems.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Star className="w-4 h-4 text-orange-400" />
                    <h3 className="font-semibold text-gray-800 text-sm">Top məhsullar</h3>
                  </div>
                  <div className="space-y-2.5">
                    {topItems.map((item, idx) => (
                      <div key={item.name}>
                        <div className="flex justify-between items-center mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-bold text-gray-200 w-4 shrink-0">#{idx + 1}</span>
                            <span className="text-sm text-gray-700 truncate">{item.name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            {item.cost > 0 && (
                              <span className="text-xs font-medium text-green-500">
                                {Math.round((1 - item.cost / item.rev) * 100)}%
                              </span>
                            )}
                            <span className="text-xs text-gray-400">{item.qty} ədəd</span>
                            <span className="font-semibold text-gray-800 text-sm">{item.rev.toFixed(2)} ₼</span>
                          </div>
                        </div>
                        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-orange-400 rounded-full" style={{ width: `${(item.rev / maxItemRev) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {paidOrders.length === 0 && (
                <div className="text-center py-16 text-gray-400">
                  <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Hələlik heç bir ödəniş yoxdur</p>
                </div>
              )}
            </div>
          )}

          {/* ── ORDERS ─────────────────────────────────────────────────── */}
          {tab === 'orders' && (
            <div className="space-y-4 max-w-3xl">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-400">{activeOrders.length} aktiv sifariş</p>
                <button onClick={refresh} className="text-xs font-medium text-orange-500 hover:text-orange-700 px-3 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">Yenilə</button>
              </div>

              {activeOrders.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-16 text-center">
                  <ClipboardList className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                  <p className="text-sm text-gray-400">Aktiv sifariş yoxdur</p>
                </div>
              )}

              {activeOrders.map(order => (
                <div key={order.id} className="bg-white rounded-xl border border-gray-100 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-orange-50 flex items-center justify-center">
                        <span className="text-sm font-bold text-orange-600">{order.tableNumber}</span>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 text-sm">Masa {order.tableNumber}</p>
                        <p className="text-xs text-gray-400">{order.sellerName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[order.status]}`}>{order.status}</span>
                      <select
                        value={order.status}
                        onChange={e => handleStatusChange(order.id, e.target.value as OrderStatus)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-1 mb-3">
                    {order.items.map((oi, i) => (
                      <div key={i} className="flex justify-between text-sm text-gray-700">
                        <span>{oi.menuItem.name} <span className="text-gray-400">× {oi.quantity}</span></span>
                        <span className="font-medium">{(oi.menuItem.price * oi.quantity).toFixed(2)} ₼</span>
                      </div>
                    ))}
                  </div>
                  {order.note && <p className="text-xs text-gray-400 italic mb-3">Qeyd: {order.note}</p>}
                  <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                    <span className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleTimeString('az-AZ')}</span>
                    <span className="font-bold text-orange-600">{orderTotal(order).toFixed(2)} ₼</span>
                  </div>
                </div>
              ))}

              {orders.filter(o => o.status === 'ödənilib').length > 0 && (
                <details className="mt-4 group">
                  <summary className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-gray-600 list-none">
                    <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                    Ödənilmiş sifarişlər ({orders.filter(o => o.status === 'ödənilib').length})
                  </summary>
                  <div className="mt-3 space-y-2">
                    {orders.filter(o => o.status === 'ödənilib').map(order => (
                      <div key={order.id} className="bg-white rounded-xl border border-gray-100 p-4 opacity-60">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-gray-700">Masa {order.tableNumber}</span>
                          <span className="font-bold text-sm text-gray-600">{orderTotal(order).toFixed(2)} ₼</span>
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
              <div className="flex items-center justify-between mb-5">
                <p className="text-sm text-gray-400">{menu.length} məhsul</p>
                <button onClick={openAdd} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm">
                  <span className="text-base leading-none">+</span>
                  Yemək əlavə et
                </button>
              </div>

              {showForm && (
                <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 mb-5 space-y-4">
                  <h3 className="font-semibold text-gray-800">{editingId ? 'Yeməyi düzəlt' : 'Yeni Yemək'}</h3>

                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Ad</label>
                    <input type="text" placeholder="Yeməyin adı" value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                      required />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1.5 block">Kateqoriya</label>
                      <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white">
                        {categories.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1.5 block">Bişirmə sexi</label>
                      <select value={form.cookingStation} onChange={e => setForm(f => ({ ...f, cookingStation: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white">
                        <option value="">— Seçin —</option>
                        {COOKING_STATIONS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Şəkil</label>
                    <div className="flex gap-3 items-start">
                      <div className="flex-1">
                        <input type="text" placeholder="Şəkil URL-i"
                          value={form.image.startsWith('data:') ? '' : form.image}
                          onChange={e => setForm(f => ({ ...f, image: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white" />
                        <button type="button" onClick={() => imgRef.current?.click()} className="mt-1.5 text-xs text-orange-500 hover:text-orange-700 font-medium">
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

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={form.hasVariants}
                      onChange={e => setForm(f => ({ ...f, hasVariants: e.target.checked, variants: e.target.checked && f.variants.length === 0 ? [{ id: Date.now().toString(), name: '', price: '', costPrice: '' }] : f.variants }))}
                      className="rounded accent-orange-500" />
                    <span className="text-sm text-gray-700">Variantlar var (ölçü, növ…)</span>
                  </label>

                  {!form.hasVariants ? (
                    <div className="grid grid-cols-3 gap-3 items-end">
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 block">Qiymət (₼)</label>
                        <input type="number" placeholder="0.00" step="0.5" min="0" value={form.price}
                          onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white" required />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 block">Maya dəyəri (₼)</label>
                        <input type="number" placeholder="0.00" step="0.01" min="0" value={form.costPrice}
                          onChange={e => setForm(f => ({ ...f, costPrice: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white" />
                      </div>
                      <div className="pb-2 text-sm font-semibold text-green-600">
                        {calcMargin(form.price, form.costPrice) && `Marja: ${calcMargin(form.price, form.costPrice)}`}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-9 gap-2 text-xs text-gray-400 px-1">
                        <span className="col-span-3">Variant adı</span>
                        <span className="col-span-2">Qiymət (₼)</span>
                        <span className="col-span-2">Maya (₼)</span>
                        <span className="col-span-2">Marja</span>
                      </div>
                      {form.variants.map((v, i) => (
                        <div key={v.id} className="grid grid-cols-9 gap-2 items-center">
                          <input className="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                            placeholder={`Variant ${i + 1}`} value={v.name} onChange={e => updateVariant(i, 'name', e.target.value)} required />
                          <input type="number" placeholder="0.00" step="0.5" min="0"
                            className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                            value={v.price} onChange={e => updateVariant(i, 'price', e.target.value)} required />
                          <input type="number" placeholder="0.00" step="0.01" min="0"
                            className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                            value={v.costPrice} onChange={e => updateVariant(i, 'costPrice', e.target.value)} />
                          <div className="col-span-2 flex items-center gap-1">
                            <span className="text-xs text-green-600 font-medium flex-1">{calcMargin(v.price, v.costPrice)}</span>
                            <button type="button" onClick={() => removeVariant(i)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                          </div>
                        </div>
                      ))}
                      <button type="button" onClick={addVariant} className="text-sm text-orange-500 hover:text-orange-700 font-medium">+ Variant əlavə et</button>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-5 py-2 rounded-lg shadow-sm transition-colors">
                      {editingId ? 'Yadda saxla' : 'Əlavə et'}
                    </button>
                    <button type="button" onClick={cancelForm} className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors">Ləğv et</button>
                  </div>
                </form>
              )}

              {categories.map(cat => {
                const items = menu.filter(m => m.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} className="mb-5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">{cat}</p>
                    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                      {items.map((item, i) => (
                        <div key={item.id} className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i < items.length - 1 ? 'border-b border-gray-50' : ''}`}>
                          {item.image
                            ? <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-gray-100" />
                            : <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0"><UtensilsCrossed className="w-4 h-4 text-gray-300" /></div>
                          }
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.available ? 'bg-green-400' : 'bg-gray-300'}`} />
                              <span className={`text-sm font-medium ${item.available ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{item.name}</span>
                              {item.cookingStation && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md">{item.cookingStation}</span>}
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
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => openEdit(item)} className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors font-medium">Düzəlt</button>
                            <button onClick={() => toggleAvailable(item.id)} className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${item.available ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                              {item.available ? 'Bağla' : 'Aç'}
                            </button>
                            <button onClick={() => deleteItem(item.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors font-medium">Sil</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {menu.length === 0 && !showForm && (
                <div className="bg-white rounded-xl border border-gray-100 p-16 text-center">
                  <UtensilsCrossed className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                  <p className="text-sm text-gray-400">Menyu boşdur</p>
                </div>
              )}
            </div>
          )}

          {/* ── CATEGORIES ─────────────────────────────────────────────── */}
          {tab === 'categories' && (
            <div className="max-w-lg space-y-4">
              <form onSubmit={addCategory} className="flex gap-2">
                <input type="text" placeholder="Yeni kateqoriya adı" value={newCat}
                  onChange={e => setNewCat(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white" />
                <button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors">Əlavə et</button>
              </form>

              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {categories.map((cat, i) => (
                  <div key={cat} className={`flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors ${i < categories.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 bg-orange-50 text-orange-500 rounded-lg flex items-center justify-center text-xs font-bold">{i + 1}</span>
                      <span className="text-sm text-gray-800 font-medium">{cat}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{menu.filter(m => m.category === cat).length} məhsul</span>
                      <button onClick={() => deleteCategory(cat)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors font-medium">Sil</button>
                    </div>
                  </div>
                ))}
                {categories.length === 0 && (
                  <div className="p-10 text-center">
                    <Tag className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                    <p className="text-sm text-gray-400">Kateqoriya yoxdur</p>
                  </div>
                )}
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
