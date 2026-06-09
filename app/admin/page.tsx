'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard, Tag,
  PanelLeftClose, PanelLeftOpen, LogOut, Menu, X,
  TrendingUp, Receipt, Star, ChevronDown, Percent,
  Coffee, BarChart2, Package, Wallet, ChevronUp, ImageIcon, Trash2, RotateCcw,
  Users, EyeOff, Eye, Plus, Pencil,
} from 'lucide-react';
import { getSession, logout } from '@/lib/auth';
import {
  fetchMenu, saveMenu, fetchOrders, updateOrderStatus,
  fetchCategories, saveCategories,
  fetchTrash, moveToTrash, restoreFromTrash, permanentlyDeleteFromTrash,
  setCompanyContext, fetchAllUsers, createUser, deleteUser, toggleUserActive, updateUser,
  fetchTables, createTable, updateTable, deleteTable,
} from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { Category, MenuItem, MenuItemVariant, Order, OrderStatus, RestaurantTable, TrashItem } from '@/types';
import QRCode from 'react-qr-code';

const COOKING_STATIONS = ['Mətbəx', 'Bar', 'Soyuq mətbəx', 'Pizza', 'Mangal'];

const STATUS_COLORS: Record<OrderStatus, string> = {
  'gözləyir':  'bg-amber-100 text-amber-700',
  'hazırlanır':'bg-blue-100 text-blue-700',
  'hazırdır':  'bg-green-100 text-green-700',
  'ödənilib':  'bg-gray-100 text-gray-500',
};
const STATUS_OPTIONS: OrderStatus[] = ['gözləyir', 'hazırlanır', 'hazırdır', 'ödənilib'];

type Tab = 'stats' | 'orders' | 'menu' | 'categories' | 'users' | 'tables';

interface StaffUser {
  id: string;
  username: string;
  name: string;
  active: boolean;
}
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
  { id: 'stats',      label: 'Statistika',    icon: BarChart2 },
  { id: 'orders',     label: 'Sifarişlər',    icon: Receipt },
  { id: 'menu',       label: 'Menyu',         icon: Coffee },
  { id: 'categories', label: 'Kateqoriyalar', icon: Tag },
  { id: 'users',      label: 'Əməkdaşlar', icon: Users },
  { id: 'tables',     label: 'Masalar',     icon: LayoutDashboard },
];

const PAGE_META: Record<Tab, { title: string; subtitle: string }> = {
  stats:      { title: 'Statistika & Hesabatlar', subtitle: 'Satış analitikası' },
  orders:     { title: 'Sifarişlər',              subtitle: 'Aktiv sifarişlər' },
  menu:       { title: 'Menyu',                    subtitle: 'Məhsulları əlavə et, düzəlt, sil' },
  categories: { title: 'Kateqoriyalar',           subtitle: 'Menyu kateqoriyaları' },
  users:      { title: 'Əməkdaşlar',              subtitle: 'Satıcıları idarə et' },
  tables:     { title: 'Masalar',                 subtitle: 'Restoran masalarını idarə et' },
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
          <stop offset="0%" stopColor="#92400e" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#92400e" stopOpacity="0.02" />
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
      {n > 1 && <polyline points={lineStr} fill="none" stroke="#92400e" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map(([x, y], i) => data[i].rev > 0 && (
        <circle key={i} cx={x} cy={y} r="3" fill="#92400e" stroke="white" strokeWidth="1.5" />
      ))}
      {data.map((d, i) => (i % step === 0 || i === n - 1) && (
        <text key={i} x={px(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="10" fill="#9ca3af">{d.label}</text>
      ))}
    </svg>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = (searchParams.get('tab') as Tab | null) ?? 'stats';
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [adminName, setAdminName] = useState('Admin');
  const [online, setOnline] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // menu form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm(''));
  const imgRef = useRef<HTMLInputElement>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  // categories form
  const [newCat, setNewCat] = useState('');
  const [deleteCatTarget, setDeleteCatTarget] = useState<string | null>(null);
  const [editCatTarget, setEditCatTarget] = useState<string | null>(null);
  const [editCatValue, setEditCatValue] = useState('');
  const [deleteItemTarget, setDeleteItemTarget] = useState<string | null>(null);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [showTrash, setShowTrash] = useState(false);

  // stats chart
  const [chartView, setChartView] = useState<ChartView>('gün');

  // tables tab
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [showTableForm, setShowTableForm] = useState(false);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [tName, setTName] = useState('');
  const [tCapacity, setTCapacity] = useState('4');
  const [tSaving, setTSaving] = useState(false);
  const [qrTable, setQrTable] = useState<RestaurantTable | null>(null);

  // users tab
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<StaffUser | null>(null);
  const [uName, setUName] = useState('');
  const [uUsername, setUUsername] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uSaving, setUSaving] = useState(false);
  const [uError, setUError] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'owner') { router.replace('/login'); return; }
    setCompanyContext(session.companyId);
    setAdminName(session.name);
    setCompanyId(session.companyId);
    Promise.all([fetchMenu(), fetchOrders(), fetchCategories(), fetchTrash(), fetchAllUsers(), fetchTables()]).then(([m, o, c, t, u, tb]) => {
      setMenu(m);
      setOrders(o);
      setCategories(c);
      setTrash(t);
      setOnline(m.length > 0 || o.length > 0);
      setStaffUsers(u.filter(x => x.companyId === session.companyId && x.role === 'seller').map(x => ({ id: x.id, username: x.username, name: x.name, active: x.active })));
      setTables(tb);
    });
  }, [router]);

  function refresh() { fetchOrders().then(setOrders); }
  function navigate(t: Tab) { router.replace(`/admin?tab=${t}`); }

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
    setForm(emptyForm(categories[0]?.name ?? ''));
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
    setShowForm(false);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  function cancelForm() { setShowForm(false); setEditingId(null); }

  async function handleSubmit(e: React.FormEvent) {
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
    setSaving(true);
    await saveMenu(updated);
    setSaving(false);
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
    setMenu(updated);
    saveMenu(updated);
  }
  function duplicateItem(id: string) {
    const original = menu.find(m => m.id === id);
    if (!original) return;
    const copy = { ...original, id: crypto.randomUUID(), name: `${original.name} (kopya)` };
    const updated = [...menu, copy];
    setMenu(updated);
    saveMenu(updated);
  }
  function deleteItem(id: string) {
    const item = menu.find(m => m.id === id);
    if (!item) return;
    moveToTrash('menu', item as unknown as Record<string, unknown>).then(() =>
      fetchTrash().then(setTrash)
    );
    const updated = menu.filter(m => m.id !== id);
    setMenu(updated);
    saveMenu(updated);
    setDeleteItemTarget(null);
  }
  function handleStatusChange(orderId: string, status: OrderStatus) {
    updateOrderStatus(orderId, status);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
  }

  // ── categories ─────────────────────────────────────────────────────────────
  function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newCat.trim();
    if (!trimmed || categories.some(c => c.name === trimmed)) return;
    const updated = [...categories, { name: trimmed, available: true }];
    setCategories(updated);
    setNewCat('');
    saveCategories(updated);
  }
  function deleteCategory(cat: string) {
    const catObj = categories.find(c => c.name === cat);
    const itemsInCat = menu.filter(m => m.category === cat);
    const trashMoves = [
      ...(catObj ? [moveToTrash('category', catObj as unknown as Record<string, unknown>)] : []),
      ...itemsInCat.map(m => moveToTrash('menu', m as unknown as Record<string, unknown>)),
    ];
    Promise.all(trashMoves).then(() => fetchTrash().then(setTrash));
    const updatedCats = categories.filter(c => c.name !== cat);
    const updatedMenu = menu.filter(m => m.category !== cat);
    setCategories(updatedCats);
    setMenu(updatedMenu);
    saveCategories(updatedCats);
    saveMenu(updatedMenu);
    setDeleteCatTarget(null);
  }
  function renameCategory(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || categories.some(c => c.name === trimmed)) return;
    const updated = categories.map(c => c.name === oldName ? { ...c, name: trimmed } : c);
    setCategories(updated);
    saveCategories(updated);
    setMenu(prev => prev.map(m => m.category === oldName ? { ...m, category: trimmed } : m));
    setEditCatTarget(null);
  }
  function moveCategoryOrder(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setCategories(reordered);
    saveCategories(reordered);
  }
  function moveItemOrder(cat: string, indexInCat: number, dir: -1 | 1) {
    const catItems = menu.filter(m => m.category === cat);
    const targetInCat = indexInCat + dir;
    if (targetInCat < 0 || targetInCat >= catItems.length) return;
    const aId = catItems[indexInCat].id;
    const bId = catItems[targetInCat].id;
    const reordered = [...menu];
    const aIdx = reordered.findIndex(m => m.id === aId);
    const bIdx = reordered.findIndex(m => m.id === bId);
    [reordered[aIdx], reordered[bIdx]] = [reordered[bIdx], reordered[aIdx]];
    setMenu(reordered);
    saveMenu(reordered);
  }
  function toggleCategoryAvailable(name: string) {
    const updated = categories.map(c => c.name === name ? { ...c, available: !c.available } : c);
    setCategories(updated);
    saveCategories(updated);
  }

  // ── item form renderer ────────────────────────────────────────────────────
  function renderItemForm(className: string) {
    return (
      <form ref={formRef} onSubmit={handleSubmit} className={className}>
        <h3 className="font-semibold text-gray-800">{editingId ? 'Məhsulu düzəlt' : 'Yeni Məhsul'}</h3>

        <div>
          <label className="text-xs font-medium text-gray-500 mb-1.5 block">Ad</label>
          <input type="text" placeholder="Məhsulun adı" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white"
            required />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500 mb-1.5 block">Kateqoriya</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white">
            {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500 mb-1.5 block">Şəkil</label>
          <div className="flex gap-3 items-center">
            <button type="button" onClick={() => imgRef.current?.click()}
              className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-200 hover:border-amber-400 flex items-center justify-center text-gray-300 hover:text-amber-500 transition-colors shrink-0">
              <ImageIcon className="w-6 h-6" />
            </button>
            <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
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
            className="rounded accent-amber-800" />
          <span className="text-sm text-gray-700">Variantlar var (ölçü, növ…)</span>
        </label>

        {!form.hasVariants ? (
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Qiymət (₼)</label>
              <input type="number" placeholder="0.00" step="0.5" min="0" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white" required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Maya dəyəri (₼)</label>
              <input type="number" placeholder="0.00" step="0.01" min="0" value={form.costPrice}
                onChange={e => setForm(f => ({ ...f, costPrice: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white" />
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
                <input className="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white"
                  placeholder={`Variant ${i + 1}`} value={v.name} onChange={e => updateVariant(i, 'name', e.target.value)} required />
                <input type="number" placeholder="0.00" step="0.5" min="0"
                  className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white"
                  value={v.price} onChange={e => updateVariant(i, 'price', e.target.value)} required />
                <input type="number" placeholder="0.00" step="0.01" min="0"
                  className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white"
                  value={v.costPrice} onChange={e => updateVariant(i, 'costPrice', e.target.value)} />
                <div className="col-span-2 flex items-center gap-1">
                  <span className="text-xs text-green-600 font-medium flex-1">{calcMargin(v.price, v.costPrice)}</span>
                  <button type="button" onClick={() => removeVariant(i)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addVariant} className="text-sm text-amber-800 hover:text-amber-950 font-medium">+ Variant əlavə et</button>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className="flex items-center gap-2 bg-amber-800 hover:bg-amber-900 disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg shadow-sm transition-colors">
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? 'Saxlanır…' : editingId ? 'Yadda saxla' : 'Əlavə et'}
          </button>
          <button type="button" onClick={cancelForm} disabled={saving} className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40">Ləğv et</button>
        </div>
      </form>
    );
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

  const cashRev = chartPaid.reduce((s, o) => s + Math.max(0, (o.cashAmount ?? 0) - (o.tipAmount ?? 0)), 0);
  const cardRev = chartPaid.reduce((s, o) => s + (o.cardAmount ?? 0), 0);
  const totalPayRev = cashRev + cardRev;
  const totalTips = chartPaid.reduce((s, o) => s + (o.tipAmount ?? 0), 0);

  const sellerTipMap: Record<string, { tips: number; orders: number; rev: number }> = {};
  chartPaid.forEach(o => {
    const name = o.sellerName || 'Naməlum';
    if (!sellerTipMap[name]) sellerTipMap[name] = { tips: 0, orders: 0, rev: 0 };
    sellerTipMap[name].tips += o.tipAmount ?? 0;
    sellerTipMap[name].orders += 1;
    sellerTipMap[name].rev += orderTotal(o);
  });
  const sellerStats = Object.entries(sellerTipMap)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.rev - a.rev);

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
      <div className="flex flex-col h-full bg-white min-h-[calc(100vh-4rem)]">
        {/* Logo row */}
        <div className={`flex items-center h-16 border-b border-gray-100/50 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-800 flex items-center justify-center">
                <Coffee className="w-4 h-4 text-white" />
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
                  onClick={() => { navigate(n.id); onNavigate?.(); if (n.id === 'orders') refresh(); }}
                  className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-amber-800/10 text-amber-800 before:absolute before:left-[-9px] before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-r-full before:bg-amber-800'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {badge && <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-800 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{badge}</span>}
                </button>
              );
            }

            return (
              <button
                key={n.id}
                onClick={() => { navigate(n.id); onNavigate?.(); if (n.id === 'orders') refresh(); }}
                className={`flex items-center gap-3 h-9 px-3 rounded-lg text-sm font-medium transition-colors w-full ${
                  isActive
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-amber-50 hover:text-amber-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left truncate">{n.label}</span>
                {badge && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${isActive ? 'bg-white/20 text-white' : 'bg-amber-800 text-white'}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User + logout */}
        {!collapsed && (
          <div className="px-4 py-4 border-t border-gray-100/50">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 text-xs font-bold">
                {adminName[0]?.toUpperCase()}
              </div>
              <span className="text-xs text-gray-500 truncate">{adminName}</span>
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
          <div className="py-4 flex flex-col items-center gap-2 border-t border-gray-100/50">
            <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 text-xs font-bold">
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
    <div className="min-h-screen bg-gray-50">

      {/* ── Top header ── */}
      <header className="sticky top-0 z-50 h-16 border-b border-gray-100/60 bg-white/80 backdrop-blur-sm flex items-center gap-3 px-4">
        {/* Mobile menu */}
        <button
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 md:hidden">
          <div className="w-7 h-7 rounded-lg bg-amber-800 flex items-center justify-center">
            <Coffee className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-gray-800 text-sm">Restoran</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-xl">
          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 text-xs font-bold">
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

      <div className="flex min-h-[calc(100vh-4rem)] bg-white">

        {/* ── Desktop sidebar ── */}
        <aside className={`hidden md:block flex-shrink-0 sticky top-16 self-start h-[calc(100vh-4rem)] transition-all duration-200 border-r border-gray-100/60 ${collapsed ? 'w-14' : 'w-56'}`}>
          <SidebarContent />
        </aside>

        {/* ── Main ── */}
        <main className="flex-1 min-w-0 bg-gray-50 rounded-tl-2xl border-l border-t border-gray-100/60 p-6 md:p-8 overflow-y-auto">
          <div className="mb-6">
            <h1 className="text-lg font-semibold text-gray-900">{meta.title}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{meta.subtitle}</p>
          </div>

          {/* ── STATS ─────────────────────────────────────────────────── */}
          {tab === 'stats' && (
            <div className="space-y-5 max-w-5xl">

              {/* Main chart card */}
              <div className="bg-white rounded-xl border border-gray-100 card overflow-hidden">
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
                    { label: 'Gəlir',       value: `${chartRevenue.toFixed(2)} ₼`,  icon: Wallet,    color: 'text-gray-800' },
                    { label: 'Maya dəyəri', value: `${chartCost.toFixed(2)} ₼`,     icon: Package,   color: 'text-gray-800' },
                    { label: 'Mənfəət',     value: `${chartProfit.toFixed(2)} ₼`,   icon: TrendingUp,color: chartProfit >= 0 ? 'text-green-600' : 'text-red-500' },
                    { label: 'Mənfəət %',   value: `${chartMarginPct.toFixed(1)}%`, icon: Percent,   color: chartMarginPct >= 0 ? 'text-green-600' : 'text-red-500' },
                    { label: 'Orta çek',    value: `${chartAvg.toFixed(2)} ₼`,      icon: Receipt,   color: 'text-gray-800' },
                    { label: 'Sifarişlər',  value: String(chartPaid.length),         icon: Coffee,    color: 'text-gray-800' },
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
                <div className="bg-white rounded-xl border border-gray-100 card p-5">
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
                              <div className="h-full bg-amber-700 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-gray-100 card p-5">
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

              {/* Seller stats + Tips */}
              <div className="grid md:grid-cols-2 gap-5">
                <div className="bg-white rounded-xl border border-gray-100 card p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-4">Satıcı statistikası</h3>
                  {sellerStats.length === 0 ? (
                    <p className="text-sm text-gray-300 text-center py-4">Məlumat yoxdur</p>
                  ) : (
                    <div className="space-y-3">
                      {sellerStats.map(s => (
                        <div key={s.name} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 text-xs font-bold shrink-0">
                              {s.name[0]?.toUpperCase()}
                            </div>
                            <span className="text-sm text-gray-700 truncate">{s.name}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-sm">
                            <span className="text-gray-400">{s.orders} sif.</span>
                            <span className="font-semibold text-gray-800">{s.rev.toFixed(2)} ₼</span>
                            {s.tips > 0 && (
                              <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-2 py-0.5 text-xs font-semibold">
                                ⭐ bəxşiş {s.tips.toFixed(2)} ₼
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-gray-100 card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-800 text-sm">Bəxşiş gəliri</h3>
                    {totalTips > 0 && <span className="text-lg font-bold text-amber-600">⭐ {totalTips.toFixed(2)} ₼</span>}
                  </div>
                  {totalTips === 0 ? (
                    <p className="text-sm text-gray-300 text-center py-4">Bəxşiş yoxdur</p>
                  ) : (
                    <div className="space-y-3">
                      {sellerStats.filter(s => s.tips > 0).map(s => {
                        const pct = totalTips > 0 ? (s.tips / totalTips) * 100 : 0;
                        return (
                          <div key={s.name}>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-sm text-gray-600">{s.name}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400">{pct.toFixed(0)}%</span>
                                <span className="font-semibold text-amber-700 text-sm">{s.tips.toFixed(2)} ₼</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
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
                <div className="bg-white rounded-xl border border-gray-100 card p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-4">Gün saatlarına görə</h3>
                  <div className="flex items-end gap-0.5 h-36 pt-6">
                    {hourlyData.map((d, i) => {
                      const isPeak = d.rev > 0 && d.rev === maxHourly;
                      return (
                        <div key={i}
                          className={`relative flex-1 rounded-t-sm transition-colors cursor-default ${isPeak ? 'bg-amber-800' : 'bg-amber-600 hover:bg-amber-700'}`}
                          style={{ height: `${Math.max((d.rev / maxHourly) * 100, d.rev > 0 ? 3 : 0)}%`, opacity: d.rev > 0 ? 1 : 0.12 }}
                          title={`${i}:00 — ${d.rev.toFixed(2)} ₼`}
                        >
                          {isPeak && (
                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-amber-800 font-bold whitespace-nowrap">
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

                <div className="bg-white rounded-xl border border-gray-100 card p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-4">Həftənin günlərinə görə</h3>
                  <div className="flex items-end gap-2 h-36 pt-6">
                    {weeklyData.map(d => {
                      const isPeak = d.rev > 0 && d.rev === maxWeekly;
                      return (
                        <div key={d.label}
                          className={`relative flex-1 rounded-t-sm transition-colors cursor-default ${isPeak ? 'bg-amber-800' : 'bg-amber-600 hover:bg-amber-700'}`}
                          style={{ height: `${Math.max((d.rev / maxWeekly) * 100, d.rev > 0 ? 3 : 0)}%`, opacity: d.rev > 0 ? 1 : 0.12 }}
                          title={`${d.label} — ${d.rev.toFixed(2)} ₼`}
                        >
                          {d.rev > 0 && (
                            <span className={`absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold whitespace-nowrap ${isPeak ? 'text-amber-800' : 'text-gray-500'}`}>
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
                <div className="bg-white rounded-xl border border-gray-100 card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Star className="w-4 h-4 text-amber-700" />
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
                          <div className="h-full bg-amber-700 rounded-full" style={{ width: `${(item.rev / maxItemRev) * 100}%` }} />
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
            <div className="max-w-3xl space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-400">{orders.length} sifariş · {activeOrders.length} aktiv</p>
                <button onClick={refresh} className="text-xs font-medium text-amber-800 hover:text-amber-950 px-3 py-1.5 rounded-lg hover:bg-amber-50 transition-colors">Yenilə</button>
              </div>

              {orders.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-100 card p-16 text-center">
                  <Coffee className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                  <p className="text-sm text-gray-400">Sifariş yoxdur</p>
                </div>
              )}

              <div className="bg-white rounded-xl border border-gray-100 card overflow-hidden">
                {orders.map((order, i) => {
                  const isPaid = order.status === 'ödənilib';
                  const isExpanded = expandedOrderId === order.id;
                  return (
                    <div key={order.id} className={i < orders.length - 1 ? 'border-b border-gray-50' : ''}>
                      {/* Row */}
                      <button
                        onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                      >
                        <ChevronDown className={`w-4 h-4 text-gray-300 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        <span className="w-14 text-xs font-bold text-amber-900 flex-shrink-0">#{order.orderNumber}</span>
                        <span className="flex-1 text-sm text-gray-700 truncate">{order.sellerName}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:block">
                          {new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })},{' '}
                          {new Date(order.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-sm font-semibold text-gray-800 flex-shrink-0 w-20 text-right">{orderTotal(order).toFixed(2)} ₼</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 w-24 text-center ${STATUS_COLORS[order.status]}`}>{order.status}</span>
                      </button>

                      {/* Expanded items */}
                      {isExpanded && (
                        <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100">
                          <div className="pt-3 space-y-1 mb-3">
                            <div className="hidden sm:grid grid-cols-[1fr_80px_80px] gap-2 text-xs font-medium text-gray-400 uppercase tracking-wide pb-1 border-b border-gray-200 mb-2">
                              <span>Məhsul</span><span className="text-right">Say</span><span className="text-right">Cəmi</span>
                            </div>
                            {order.items.map((oi, j) => (
                              <div key={j} className="flex justify-between text-sm text-gray-700 py-0.5">
                                <span className="flex-1">
                                  {oi.menuItem.name}
                                  {oi.modifiers && <span className="text-xs text-amber-600 ml-1">({oi.modifiers})</span>}
                                </span>
                                <span className="text-gray-400 mx-4">{oi.quantity} əd</span>
                                <span className="font-medium">{(oi.menuItem.price * oi.quantity).toFixed(2)} ₼</span>
                              </div>
                            ))}
                          </div>
                          {order.note && <p className="text-xs text-gray-400 italic mb-3">Qeyd: {order.note}</p>}
                          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                            <div className="flex items-center gap-2">
                              {!isPaid && (
                                <select
                                  value={order.status}
                                  onChange={e => handleStatusChange(order.id, e.target.value as OrderStatus)}
                                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white"
                                >
                                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              )}
                              {(order.cashAmount || order.cardAmount) && (
                                <span className="text-xs text-gray-400">
                                  {[order.cashAmount ? `💵 ${order.cashAmount.toFixed(2)}` : '', order.cardAmount ? `💳 ${order.cardAmount.toFixed(2)}` : ''].filter(Boolean).join(' · ')}
                                </span>
                              )}
                              {(order.tipAmount ?? 0) > 0 && (
                                <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                  ⭐ bəxşiş {order.tipAmount!.toFixed(2)} ₼
                                </span>
                              )}
                            </div>
                            <span className="font-bold text-amber-900">{orderTotal(order).toFixed(2)} ₼</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── MENU ───────────────────────────────────────────────────── */}
          {tab === 'menu' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-5">
                <p className="text-sm text-gray-400">{menu.filter(m => categories.some(c => c.name === m.category)).length} məhsul</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowTrash(true)} className="relative flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                    <Trash2 className="w-4 h-4" />
                    {trash.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{trash.length}</span>}
                  </button>
                  <button onClick={openAdd} className="flex items-center gap-2 bg-amber-800 hover:bg-amber-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm">
                    <span className="text-base leading-none">+</span>
                    Məhsul əlavə et
                  </button>
                </div>
              </div>

              {showForm && !editingId && renderItemForm('bg-white rounded-xl border border-gray-100 card p-6 mb-5 space-y-4')}

              {categories.map(({ name: cat, available: catAvailable }) => {
                const items = menu.filter(m => m.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} className="mb-5">
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{cat}</p>
                      {!catAvailable && <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-medium">Gizli</span>}
                    </div>
                    <div className="bg-white rounded-xl border border-gray-100 card overflow-hidden">
                      {items.map((item, i) => (
                        <React.Fragment key={item.id}>
                        <div className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${(i < items.length - 1 && editingId !== item.id) ? 'border-b border-gray-50' : ''}`}>
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button onClick={() => moveItemOrder(cat, i, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => moveItemOrder(cat, i, 1)} disabled={i === items.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {item.image
                            ? <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-gray-100" />
                            : <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0"><Coffee className="w-4 h-4 text-gray-300" /></div>
                          }
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.available ? 'bg-green-400' : 'bg-gray-300'}`} />
                              <span className={`text-sm font-medium ${item.available ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{item.name}</span>
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
                            <button onClick={() => duplicateItem(item.id)} className="text-xs text-purple-500 hover:text-purple-700 px-2 py-1 rounded-lg hover:bg-purple-50 transition-colors font-medium">Kopyala</button>
                            <button onClick={() => toggleAvailable(item.id)} className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${item.available ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                              {item.available ? 'Bağla' : 'Aç'}
                            </button>
                            <button onClick={() => setDeleteItemTarget(item.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors font-medium">Sil</button>
                          </div>
                        </div>
                        {editingId === item.id && renderItemForm(`border-t border-amber-100 bg-amber-50/20 px-5 py-4 space-y-4${i < items.length - 1 ? ' border-b border-gray-50' : ''}`)}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                );
              })}

              {menu.length === 0 && !showForm && (
                <div className="bg-white rounded-xl border border-gray-100 card p-16 text-center">
                  <Coffee className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                  <p className="text-sm text-gray-400">Məhsul yoxdur</p>
                </div>
              )}
            </div>
          )}

          {/* ── USERS ──────────────────────────────────────────────────── */}
          {tab === 'users' && (
            <div className="max-w-lg space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-400">{staffUsers.length} əməkdaş</p>
                <button
                  onClick={() => { setEditingUser(null); setUName(''); setUUsername(''); setUPassword(''); setUError(''); setShowUserForm(true); }}
                  className="flex items-center gap-2 bg-amber-800 hover:bg-amber-900 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" /> Əməkdaş əlavə et
                </button>
              </div>

              {staffUsers.length === 0 && !showUserForm && (
                <div className="bg-white rounded-xl border border-gray-100 p-16 text-center">
                  <Users className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                  <p className="text-sm text-gray-400">Əməkdaş yoxdur</p>
                </div>
              )}

              {staffUsers.map(u => (
                <div key={u.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 text-sm font-bold shrink-0">
                    {u.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{u.name}</p>
                    <p className="text-xs text-gray-400">@{u.username}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.active ? 'Aktiv' : 'Deaktiv'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditingUser(u); setUName(u.name); setUUsername(u.username); setUPassword(''); setUError(''); setShowUserForm(true); }}
                      title="Düzəlt"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-amber-700 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => toggleUserActive(u.id, !u.active).then(() => setStaffUsers(prev => prev.map(x => x.id === u.id ? { ...x, active: !x.active } : x)))}
                      title={u.active ? 'Deaktiv et' : 'Aktiv et'}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
                    >
                      {u.active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => { if (confirm(`"${u.name}" silinsin?`)) deleteUser(u.id).then(err => { if (err) alert('Silinmədi: ' + err); else setStaffUsers(prev => prev.filter(x => x.id !== u.id)); }); }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── CATEGORIES ─────────────────────────────────────────────── */}
          {tab === 'categories' && (
            <div className="max-w-lg space-y-4">
              <form onSubmit={addCategory} className="flex gap-2">
                <input type="text" placeholder="Yeni kateqoriya adı" value={newCat}
                  onChange={e => setNewCat(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white" />
                <button type="submit" className="bg-amber-800 hover:bg-amber-900 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors">Əlavə et</button>
                <button type="button" onClick={() => setShowTrash(true)} className="relative flex items-center justify-center text-gray-400 hover:text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200">
                  <Trash2 className="w-4 h-4" />
                  {trash.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{trash.length}</span>}
                </button>
              </form>

              <div className="bg-white rounded-xl border border-gray-100 card overflow-hidden">
                {categories.map(({ name: cat, available: catAvailable }, i) => (
                  <div key={cat} className={`flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors ${i < categories.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => moveCategoryOrder(i, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => moveCategoryOrder(i, 1)} disabled={i === categories.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="w-6 h-6 bg-amber-50 text-amber-800 rounded-lg flex items-center justify-center text-xs font-bold">{i + 1}</span>
                      <span className={`text-sm font-medium ${catAvailable ? 'text-gray-800' : 'text-gray-400'}`}>{cat}</span>
                      {!catAvailable && <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-medium">Gizli</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{menu.filter(m => m.category === cat).length} məhsul</span>
                      <button onClick={() => toggleCategoryAvailable(cat)} className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${catAvailable ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                        {catAvailable ? 'Bağla' : 'Aç'}
                      </button>
                      <button onClick={() => { setEditCatTarget(cat); setEditCatValue(cat); }} className="text-xs text-amber-600 hover:text-amber-800 px-2 py-1 rounded-lg hover:bg-amber-50 transition-colors font-medium">Dəyiş</button>
                      <button onClick={() => setDeleteCatTarget(cat)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors font-medium">Sil</button>
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

          {/* ── TABLES ─────────────────────────────────────────────────── */}
          {tab === 'tables' && (
            <div className="max-w-2xl space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-400">{tables.length} masa</p>
                <button
                  onClick={() => { setEditingTable(null); setTName(''); setTCapacity('4'); setShowTableForm(true); }}
                  className="flex items-center gap-2 bg-amber-800 hover:bg-amber-900 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" /> Masa əlavə et
                </button>
              </div>

              {tables.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-16 text-center">
                  <LayoutDashboard className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                  <p className="text-sm text-gray-400">Masa yoxdur</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {tables.map(t => {
                  const busy = orders.some(o => o.tableNumber === t.id && o.status !== 'ödənilib');
                  return (
                    <div key={t.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-800 font-bold text-sm shrink-0">
                        {t.id}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{t.name}</p>
                        <p className="text-xs text-gray-400">{t.capacity} nəfər</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${busy ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                        {busy ? 'Dolu' : 'Boş'}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setQrTable(t)}
                          title="QR kod"
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-amber-700 transition-colors"
                        >
                          <Star className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setEditingTable(t); setTName(t.name); setTCapacity(String(t.capacity)); setShowTableForm(true); }}
                          title="Düzəlt"
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-amber-700 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (busy) { alert('Aktiv sifarişi olan masanı silmək olmaz.'); return; }
                            if (confirm(`"${t.name}" silinsin?`)) {
                              deleteTable(t.id).then(err => {
                                if (err) alert('Silinmədi: ' + err);
                                else setTables(prev => prev.filter(x => x.id !== t.id));
                              });
                            }
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ── Create / Edit table modal ───────────────────────────────────── */}
      {showTableForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800">{editingTable ? 'Masanı düzəlt' : 'Yeni masa'}</h3>
              <button onClick={() => setShowTableForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async e => {
                e.preventDefault();
                setTSaving(true);
                const cap = Math.max(1, parseInt(tCapacity) || 4);
                if (editingTable) {
                  await updateTable(editingTable.id, tName.trim(), cap);
                  setTables(prev => prev.map(x => x.id === editingTable.id ? { ...x, name: tName.trim(), capacity: cap } : x));
                } else {
                  const err = await createTable(tName.trim(), cap);
                  if (err) { alert('Xəta: ' + err); setTSaving(false); return; }
                  const fresh = await fetchTables();
                  setTables(fresh);
                }
                setTSaving(false);
                setShowTableForm(false);
              }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Ad</label>
                <input
                  value={tName}
                  onChange={e => setTName(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Masa 1"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Tutum (nəfər)</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={tCapacity}
                  onChange={e => setTCapacity(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={tSaving}
                className="w-full bg-amber-800 hover:bg-amber-900 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors mt-2"
              >
                {tSaving ? 'Saxlanır...' : editingTable ? 'Yadda saxla' : 'Yarat'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── QR code modal ──────────────────────────────────────────────── */}
      {qrTable && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs shadow-xl text-center">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800">{qrTable.name} — QR Kod</h3>
              <button onClick={() => setQrTable(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-center p-4 bg-white rounded-xl border border-gray-100">
              <QRCode value={`${typeof window !== 'undefined' ? window.location.origin : ''}/menu?table=${qrTable.id}`} size={180} />
            </div>
            <p className="text-xs text-gray-400 mt-3">/menu?table={qrTable.id}</p>
          </div>
        </div>
      )}

      {/* ── Create / Edit user modal ────────────────────────────────────── */}
      {showUserForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800">{editingUser ? 'Əməkdaşı düzəlt' : 'Yeni əməkdaş'}</h3>
              <button onClick={() => setShowUserForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async e => {
                e.preventDefault();
                setUError('');
                setUSaving(true);
                if (editingUser) {
                  await updateUser(editingUser.id, uName.trim(), uPassword);
                  setStaffUsers(prev => prev.map(x => x.id === editingUser.id ? { ...x, name: uName.trim() } : x));
                  setUSaving(false);
                  setShowUserForm(false);
                } else {
                  const err = await createUser(uUsername.trim(), uPassword, uName.trim(), 'seller', companyId);
                  setUSaving(false);
                  if (err) {
                    setUError('Bu istifadəçi adı artıq mövcuddur');
                    return;
                  }
                  const all = await fetchAllUsers();
                  setStaffUsers(all.filter(x => x.companyId === companyId && x.role === 'seller').map(x => ({ id: x.id, username: x.username, name: x.name, active: x.active })));
                  setShowUserForm(false);
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Ad</label>
                <input
                  value={uName}
                  onChange={e => setUName(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Tam ad"
                  required
                />
              </div>
              {!editingUser && (
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">İstifadəçi adı</label>
                  <input
                    value={uUsername}
                    onChange={e => setUUsername(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="login"
                    required
                  />
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">
                  {editingUser ? 'Yeni şifrə' : 'Şifrə'}
                </label>
                <input
                  type="password"
                  value={uPassword}
                  onChange={e => setUPassword(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder={editingUser ? 'Dəyişmək üçün daxil edin' : ''}
                  required={!editingUser}
                />
              </div>
              {uError && <p className="text-red-500 text-sm">{uError}</p>}
              <button
                type="submit"
                disabled={uSaving}
                className="w-full bg-amber-800 hover:bg-amber-900 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors mt-2"
              >
                {uSaving ? 'Saxlanır...' : editingUser ? 'Yadda saxla' : 'Yarat'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete category confirmation dialog ─────────────────────────── */}
      {deleteCatTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
            <h3 className="text-base font-semibold text-gray-800">Kateqoriyanı sil?</h3>
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-700">&ldquo;{deleteCatTarget}&rdquo;</span> silinəcək. Bu əməliyyat geri qaytarıla bilməz.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteCatTarget(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">Ləğv et</button>
              <button onClick={() => deleteCategory(deleteCatTarget)} className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors">Sil</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete product confirmation dialog ──────────────────────────── */}
      {deleteItemTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
            <h3 className="text-base font-semibold text-gray-800">Məhsulu sil?</h3>
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-700">&ldquo;{menu.find(m => m.id === deleteItemTarget)?.name}&rdquo;</span> silinəcək. Bu əməliyyat geri qaytarıla bilməz.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteItemTarget(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">Ləğv et</button>
              <button onClick={() => deleteItem(deleteItemTarget)} className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors">Sil</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Trash modal ─────────────────────────────────────────────────── */}
      {showTrash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-gray-400" />
                <h3 className="text-base font-semibold text-gray-800">Zibil qutusu</h3>
                <span className="text-xs text-gray-400">(30 gün saxlanılır)</span>
              </div>
              <button onClick={() => setShowTrash(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {trash.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">Zibil qutusu boşdur</p>
              )}
              {trash.map(item => {
                const d = item.data as Record<string, unknown>;
                const label = item.type === 'menu' ? String(d.name ?? '') : String(d.name ?? '');
                const sub = item.type === 'menu' ? String(d.category ?? '') : 'Kateqoriya';
                const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(item.deletedAt).getTime()) / 86400000));
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-gray-100 hover:bg-gray-50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{label}</p>
                      <p className="text-xs text-gray-400">{sub} · {daysLeft} gün qalıb</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={async () => {
                          await restoreFromTrash(item.id);
                          if (item.type === 'menu') {
                            const restored = item.data as unknown as MenuItem;
                            const updatedMenu = [...menu, restored];
                            setMenu(updatedMenu);
                            await saveMenu(updatedMenu);
                          } else if (item.type === 'category') {
                            const restored = item.data as unknown as Category;
                            const updatedCats = [...categories, restored];
                            setCategories(updatedCats);
                            await saveCategories(updatedCats);
                          }
                          setTrash(t => t.filter(x => x.id !== item.id));
                        }}
                        className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 px-2 py-1 rounded-lg hover:bg-green-50 transition-colors font-medium"
                      >
                        <RotateCcw className="w-3 h-3" /> Bərpa et
                      </button>
                      <button
                        onClick={async () => {
                          const d2 = item.data as Record<string, unknown>;
                          const img = d2.image as string | undefined;
                          if (img) {
                            const marker = '/menu-images/';
                            const idx = img.indexOf(marker);
                            if (idx !== -1) supabase.storage.from('menu-images').remove([img.slice(idx + marker.length)]);
                          }
                          await permanentlyDeleteFromTrash(item.id);
                          setTrash(t => t.filter(x => x.id !== item.id));
                        }}
                        className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors font-medium"
                      >
                        Sil
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Rename category dialog ───────────────────────────────────────── */}
      {editCatTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
            <h3 className="text-base font-semibold text-gray-800">Kateqoriyanı dəyiş</h3>
            <input
              autoFocus
              type="text"
              value={editCatValue}
              onChange={e => setEditCatValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') renameCategory(editCatTarget, editCatValue); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-700 bg-white"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditCatTarget(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">Ləğv et</button>
              <button onClick={() => renameCategory(editCatTarget, editCatValue)} className="px-4 py-2 text-sm rounded-lg bg-amber-800 hover:bg-amber-900 text-white font-medium transition-colors">Yadda saxla</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
