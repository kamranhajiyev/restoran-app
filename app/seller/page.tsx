'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  PanelLeftClose, PanelLeftOpen, LogOut, X,
  Receipt, Coffee, ShoppingBag, UtensilsCrossed,
  ShoppingCart, ChevronLeft, Minus, Plus,
} from 'lucide-react';
import { getSession, logout, validateSession } from '@/lib/auth';
import { fetchMenu, addOrder, fetchOrders, updateOrderStatus, fetchCategories, setCompanyContext, fetchTables } from '@/lib/store';
import { Category, MenuItem, Order, OrderItem, OrderStatus, RestaurantTable } from '@/types';

type View = 'orders' | 'new-order' | 'menu';
type PayMethod = 'nağd' | 'kart';
type OrderType = 'masa' | 'takeaway';

const MOD_GROUPS: Record<string, { label: string; options: string[] }[]> = {
  'Qəhvə': [
    { label: 'Ölçü', options: ['S', 'M', 'L'] },
    { label: 'Süd', options: ['Tam', 'Oat', 'Badam', 'Soya'] },
    { label: 'Temp', options: ['İsti', 'Buzlu'] },
  ],
  'Çay': [
    { label: 'Ölçü', options: ['Kiçik', 'Böyük'] },
    { label: 'Temp', options: ['İsti', 'Soyuq'] },
  ],
  'Soyuq içkilər': [
    { label: 'Ölçü', options: ['Kiçik', 'Böyük'] },
  ],
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  'gözləyir':  'bg-amber-100 text-amber-700',
  'hazırlanır':'bg-blue-100 text-blue-700',
  'hazırdır':  'bg-green-100 text-green-700',
  'ödənilib':  'bg-gray-100 text-gray-500',
};

function elapsed(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} dəq`;
  return `${Math.floor(mins / 60)} saat`;
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

export default function SellerPage() {
  const router = useRouter();
  const [view, setView]             = useState<View>('orders');
  const [menu, setMenu]             = useState<MenuItem[]>([]);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [orders, setOrders]         = useState<Order[]>([]);
  const [sellerName, setSellerName] = useState('Satıcı');
  const [online, setOnline]         = useState(true);
  const [collapsed, setCollapsed]   = useState(false);

  // new order
  const [tables, setTables]                 = useState<RestaurantTable[]>([]);
  const [orderType, setOrderType]           = useState<OrderType | null>(null);
  const [selectedTable, setSelectedTable]   = useState<number | null>(null);
  const [cart, setCart]                     = useState<OrderItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [note, setNote]                     = useState('');
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // payment modal
  const [payingOrder, setPayingOrder] = useState<Order | null>(null);
  const [cashInput, setCashInput]     = useState('');
  const [cardInput, setCardInput]     = useState('');
  const [isTip, setIsTip]             = useState(false);

  // modifier / variant modal
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [selectedMods, setSelectedMods] = useState<Record<string, string>>({});
  const [selectedVariant, setSelectedVariant] = useState<{ id: string; name: string; price: number } | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const refreshOrders = useCallback(async () => {
    setRefreshing(true);
    try { setOrders(await fetchOrders({ limit: 200 })); } finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'seller') { router.replace('/login'); return; }
    validateSession(session).then(valid => {
      if (!valid) { logout(); router.replace('/login'); }
    });
    setCompanyContext(session.companyId);
    setSellerName(session.name);
    Promise.all([fetchMenu(), fetchOrders({ limit: 200 }), fetchCategories(), fetchTables()]).then(([m, o, c, tb]) => {
      setOnline(true); setMenu(m); setOrders(o); setTables(tb);
      const available = c.filter(cat => cat.available);
      setAvailableCategories(available);
      const cats = [...new Set(m.map(i => i.category))].filter(cat => available.some(a => a.name === cat));
      if (cats.length > 0) setActiveCategory(cats[0]);
    }).catch(() => setOnline(false));
  }, [router]);

  useEffect(() => {
    async function sync() {
      const [m, o, c] = await Promise.all([fetchMenu(), fetchOrders({ limit: 200 }), fetchCategories()]);
      setMenu(m); setOrders(o);
      setAvailableCategories(c.filter(cat => cat.available));
    }
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  // ── cart helpers ──────────────────────────────────────────────────────────

  function addToCart(item: MenuItem, mods?: string) {
    setCart(prev => {
      const ex = prev.find(ci => ci.menuItem.id === item.id && (ci.modifiers ?? '') === (mods ?? ''));
      if (ex) return prev.map(ci =>
        ci.menuItem.id === item.id && (ci.modifiers ?? '') === (mods ?? '')
          ? { ...ci, quantity: ci.quantity + 1 } : ci
      );
      return [...prev, { menuItem: item, quantity: 1, modifiers: mods }];
    });
  }

  function removeFromCart(itemId: string, mods?: string) {
    setCart(prev => {
      const ex = prev.find(ci => ci.menuItem.id === itemId && (ci.modifiers ?? '') === (mods ?? ''));
      if (!ex) return prev;
      if (ex.quantity === 1) return prev.filter(ci => !(ci.menuItem.id === itemId && (ci.modifiers ?? '') === (mods ?? '')));
      return prev.map(ci =>
        ci.menuItem.id === itemId && (ci.modifiers ?? '') === (mods ?? '')
          ? { ...ci, quantity: ci.quantity - 1 } : ci
      );
    });
  }

  function handleMenuItemTap(item: MenuItem) {
    const groups = MOD_GROUPS[item.category] ?? [];
    const hasVariants = (item.variants?.length ?? 0) > 0;
    if (hasVariants || groups.length > 0) {
      const init: Record<string, string> = {};
      groups.forEach(g => { init[g.label] = g.options[0]; });
      setSelectedMods(init);
      setSelectedVariant(hasVariants ? { id: item.variants![0].id, name: item.variants![0].name, price: item.variants![0].price } : null);
      setModifierItem(item);
    } else {
      addToCart(item);
    }
  }

  function confirmModifiers() {
    if (!modifierItem) return;
    const groups = MOD_GROUPS[modifierItem.category] ?? [];
    const modsStr = groups.map(g => selectedMods[g.label]).filter(Boolean).join(' · ');
    const itemToAdd = selectedVariant ? { ...modifierItem, price: selectedVariant.price } : modifierItem;
    const label = [selectedVariant?.name, modsStr].filter(Boolean).join(' · ');
    addToCart(itemToAdd, label || undefined);
    setModifierItem(null);
    setSelectedVariant(null);
  }

  function tableName(id: number | null): string {
    if (!id) return 'Takeaway';
    return tables.find(t => t.id === id)?.name ?? `Masa ${id}`;
  }

  function startNewOrder(type: OrderType, tableNum?: number) {
    setOrderType(type);
    setSelectedTable(tableNum ?? null);
    setCart([]);
    setNote('');
    const cats = [...new Set(menu.map(i => i.category))].filter(cat => availableCategories.some(a => a.name === cat));
    if (cats.length > 0) setActiveCategory(cats[0]);
    setView('menu');
  }

  async function submitOrder() {
    if (cart.length === 0) return;
    if (orderType === 'masa' && !selectedTable) return;
    const order: Order = {
      id: Date.now().toString(),
      orderNumber: (orders[0]?.orderNumber ?? 0) + 1,
      tableNumber: orderType === 'takeaway' ? 0 : selectedTable!,
      items: cart,
      status: 'gözləyir',
      createdAt: new Date().toISOString(),
      sellerName,
      note: note.trim() || undefined,
    };
    setOrders(prev => [order, ...prev]);
    setCart([]); setNote(''); setSelectedTable(null); setOrderType(null);
    setMobileCartOpen(false);
    setView('orders');
    await addOrder(order);
    setPayingOrder(order);
    setCashInput('');
    setCardInput('');
    setIsTip(false);
  }

  async function confirmPayment() {
    if (!payingOrder) return;
    const cash = parseFloat(cashInput) || 0;
    const card = parseFloat(cardInput) || 0;
    const total = orderTotal(payingOrder);
    const tip = isTip ? Math.max(0, (cash + card) - total) : 0;
    setOrders(prev => prev.map(o => o.id === payingOrder.id ? { ...o, status: 'ödənilib', cashAmount: cash, cardAmount: card, tipAmount: tip } : o));
    setPayingOrder(null);
    setIsTip(false);
    await updateOrderStatus(payingOrder.id, 'ödənilib', cash, card, tip);
  }

  async function handleStatusChange(id: string, status: OrderStatus) {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
    await updateOrderStatus(id, status);
  }

  const cartTotal   = cart.reduce((s, ci) => s + ci.menuItem.price * ci.quantity, 0);
  const cartCount   = cart.reduce((s, ci) => s + ci.quantity, 0);
  const categories  = [...new Set(menu.map(i => i.category))].filter(cat => availableCategories.some(a => a.name === cat));
  const filtered    = menu.filter(m => m.category === activeCategory && m.available);
  const active      = orders.filter(o => o.status !== 'ödənilib');
  const todayOrders = active.filter(o => isToday(o.createdAt));
  const prevOrders  = active.filter(o => !isToday(o.createdAt));
  const myTodayTips = orders.filter(o => o.sellerName === sellerName && isToday(o.createdAt) && (o.tipAmount ?? 0) > 0).reduce((s, o) => s + (o.tipAmount ?? 0), 0);

  // ── sidebar (desktop only) ────────────────────────────────────────────────

  function SidebarContent() {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className={`flex items-center h-14 border-b border-gray-100/50 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-800 flex items-center justify-center">
                <Coffee className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-gray-800 text-sm">Satıcı Paneli</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="w-8 h-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors flex"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className={`flex flex-col gap-1 p-3 flex-1 ${collapsed ? 'items-center' : ''}`}>
          {[
            { id: 'orders' as View,    label: 'Sifarişlər',   icon: Receipt },
            { id: 'new-order' as View, label: 'Yeni sifariş', icon: ShoppingBag },
          ].map(n => {
            const Icon = n.icon;
            const isActive = view === n.id || (n.id === 'new-order' && view === 'menu');
            const badge = n.id === 'orders' && active.length > 0 ? active.length : null;

            if (collapsed) {
              return (
                <button
                  key={n.id}
                  title={n.label}
                  onClick={() => {
                    if (n.id === 'new-order') { setOrderType(null); setCart([]); }
                    setView(n.id);
                  }}
                  className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${isActive ? 'bg-amber-800/10 text-amber-800' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
                >
                  <Icon className="w-4 h-4" />
                  {badge && <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-800 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{badge}</span>}
                </button>
              );
            }

            return (
              <button
                key={n.id}
                onClick={() => {
                  if (n.id === 'new-order') { setOrderType(null); setCart([]); }
                  setView(n.id);
                }}
                className={`flex items-center gap-3 h-9 px-3 rounded-lg text-sm font-medium transition-colors w-full ${isActive ? 'bg-amber-800 text-white shadow-sm' : 'text-gray-500 hover:bg-amber-50 hover:text-amber-900'}`}
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

        {!collapsed ? (
          <div className="px-4 py-4 border-t border-gray-100/50">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 text-xs font-bold">
                {sellerName[0]?.toUpperCase()}
              </div>
              <span className="text-xs text-gray-500 truncate">{sellerName}</span>
              {!online && <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Oflayn</span>}
            </div>
            <button onClick={() => { logout(); router.push('/login'); }} className="flex items-center gap-2 text-xs text-gray-400 hover:text-red-500 transition-colors">
              <LogOut className="w-3.5 h-3.5" /> Çıxış
            </button>
          </div>
        ) : (
          <div className="py-4 flex flex-col items-center gap-2 border-t border-gray-100/50">
            <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 text-xs font-bold">
              {sellerName[0]?.toUpperCase()}
            </div>
            <button onClick={() => { logout(); router.push('/login'); }} title="Çıxış" className="text-gray-400 hover:text-red-500 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="sticky top-0 z-50 h-14 border-b border-gray-100/60 bg-white/90 backdrop-blur-sm flex items-center gap-3 px-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-800 flex items-center justify-center">
            <Coffee className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-gray-800 text-sm md:hidden">Restoran</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-xl">
          <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 text-xs font-bold">
            {sellerName[0]?.toUpperCase()}
          </div>
          <span className="text-sm font-medium text-gray-700 hidden sm:inline">{sellerName}</span>
        </div>
        <button
          onClick={() => { logout(); router.push('/login'); }}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Çıxış"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <div className="flex min-h-[calc(100vh-3.5rem)] bg-white">

        {/* Desktop sidebar */}
        <aside className={`hidden md:block flex-shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] transition-all duration-200 border-r border-gray-100/60 ${collapsed ? 'w-14' : 'w-56'}`}>
          <SidebarContent />
        </aside>

        {/* Main — pb-16 reserves space for mobile bottom nav */}
        <main className="flex-1 min-w-0 bg-gray-50 md:rounded-tl-2xl md:border-l md:border-t border-gray-100/60 overflow-hidden flex flex-col pb-16 md:pb-0">

          {/* ── ORDERS ── */}
          {view === 'orders' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 md:px-6 pt-5 pb-2">
                <h1 className="text-lg font-semibold text-gray-900">Sifarişlər</h1>
                <p className="text-sm text-gray-500 mt-0.5">Aktiv sifarişlər</p>
              </div>

              <div className="px-4 md:px-6 py-2 flex items-center gap-3 flex-wrap">
                <button
                  onClick={refreshOrders}
                  disabled={refreshing}
                  className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-white transition-colors bg-white disabled:opacity-60"
                >
                  {refreshing
                    ? <span className="w-3.5 h-3.5 border-2 border-gray-200 border-t-[#92400e] rounded-full animate-spin" />
                    : <span>↻</span>}
                  Yenilə
                </button>
                <div className="flex gap-3 text-sm flex-wrap">
                  <span className="text-gray-500">Cəmi <span className="font-semibold text-gray-800">{active.length}</span></span>
                  <span className="text-gray-500">Gözləyir <span className="font-semibold text-amber-700">{orders.filter(o => o.status === 'gözləyir').length}</span></span>
                  <span className="text-gray-500">Hazır <span className="font-semibold text-green-600">{orders.filter(o => o.status === 'hazırdır').length}</span></span>
                  {myTodayTips > 0 && (
                    <span className="flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-2 py-0.5 font-semibold">
                      ⭐ Bəxşiş: {myTodayTips.toFixed(2)} ₼
                    </span>
                  )}
                </div>
              </div>

              {/* Desktop table header */}
              <div className="hidden md:grid grid-cols-[120px_1fr_140px_200px_110px] gap-4 px-6 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-t bg-white">
                <span>Vaxt</span><span>Sifariş</span><span>Durum</span><span></span><span className="text-right">Ümumi</span>
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
                    <div className="px-4 md:px-6 py-2 bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">Əvvəlki günlər · {prevOrders.length}</div>
                    {prevOrders.map(o => <OrderRow key={o.id} order={o} tableLabel={tableName(o.tableNumber)} onPay={() => setPayingOrder(o)} onStatusChange={handleStatusChange} />)}
                  </div>
                )}
                {todayOrders.length > 0 && (
                  <div>
                    <div className="px-4 md:px-6 py-2 bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">Bu gün · {todayOrders.length}</div>
                    {todayOrders.map(o => <OrderRow key={o.id} order={o} tableLabel={tableName(o.tableNumber)} onPay={() => setPayingOrder(o)} onStatusChange={handleStatusChange} />)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── NEW ORDER ── */}
          {view === 'new-order' && (
            <div className="flex-1 p-5 md:p-8 overflow-y-auto">
              <h1 className="text-lg font-semibold text-gray-900 mb-1">Yeni sifariş</h1>
              <p className="text-sm text-gray-500 mb-6">Sifariş növünü seçin</p>

              <div className="grid grid-cols-2 gap-4 max-w-xs mb-8">
                <button
                  onClick={() => setOrderType('masa')}
                  className={`flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all active:scale-95 ${orderType === 'masa' ? 'border-amber-800 bg-amber-50' : 'border-gray-200 bg-white hover:border-amber-300'}`}
                >
                  <UtensilsCrossed className={`w-8 h-8 ${orderType === 'masa' ? 'text-amber-800' : 'text-gray-400'}`} />
                  <span className={`font-semibold text-sm ${orderType === 'masa' ? 'text-amber-800' : 'text-gray-600'}`}>Masa</span>
                </button>
                <button
                  onClick={() => startNewOrder('takeaway')}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-gray-200 bg-white hover:border-amber-300 transition-all active:scale-95"
                >
                  <ShoppingBag className="w-8 h-8 text-gray-400" />
                  <span className="font-semibold text-sm text-gray-600">Takeaway</span>
                </button>
              </div>

              {orderType === 'masa' && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-3">Masanı seçin</p>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-4">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block" /> Boş</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" /> Dolu</span>
                  </div>
                  <div
                    className="relative border border-gray-200 rounded-xl bg-white overflow-auto"
                    style={{
                      height: 440,
                      maxWidth: 700,
                      backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
                      backgroundSize: '24px 24px',
                    }}
                  >
                    {tables.map((t, i) => {
                      const busy = tableHasActive(t.id, orders);
                      const posX = t.x ?? (20 + (i % 5) * 130);
                      const posY = t.y ?? (20 + Math.floor(i / 5) * 110);
                      const w = t.w ?? 100;
                      const h = t.h ?? 70;
                      const isRound = t.shape === 'round';
                      const busyTotal = orders
                        .filter(o => o.tableNumber === t.id && o.status !== 'ödənilib')
                        .reduce((s, o) => s + orderTotal(o), 0);
                      return (
                        <button
                          key={t.id}
                          onClick={() => startNewOrder('masa', t.id)}
                          style={{
                            position: 'absolute',
                            left: posX,
                            top: posY,
                            width: w,
                            height: h,
                            borderRadius: isRound ? '50%' : 12,
                          }}
                          className={`flex flex-col items-center justify-center border-2 shadow-sm transition-all active:scale-95 hover:shadow-md hover:scale-105 ${
                            busy
                              ? 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100'
                              : 'bg-green-50 border-green-300 text-green-800 hover:bg-green-100'
                          }`}
                        >
                          <span className="font-bold text-sm leading-tight truncate px-1 max-w-full">{t.name}</span>
                          {busy && busyTotal > 0
                            ? <span className="text-[10px] opacity-80 font-semibold">{busyTotal.toFixed(0)} ₼</span>
                            : <span className="text-[10px] opacity-60">{t.capacity} nəfər</span>
                          }
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── MENU ── */}
          {view === 'menu' && (
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* Menu toolbar */}
                <div className="px-3 py-2.5 border-b bg-white flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { setView('new-order'); setOrderType('masa'); setCart([]); }}
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-amber-700 hover:bg-amber-50 active:scale-95 transition-all"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="font-semibold text-gray-800 text-sm flex-1">
                    {orderType === 'takeaway' ? '🛍 Takeaway' : tableName(selectedTable)}
                  </span>
                  {/* Cart icon — mobile only */}
                  <button
                    onClick={() => setMobileCartOpen(true)}
                    className="md:hidden relative w-9 h-9 flex items-center justify-center rounded-xl text-gray-600 hover:bg-gray-100 active:scale-95"
                  >
                    <ShoppingCart className="w-5 h-5" />
                    {cartCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-amber-800 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{cartCount}</span>
                    )}
                  </button>
                </div>

                {/* Category tabs */}
                <div className="bg-white border-b px-3 py-2 flex gap-2 overflow-x-auto shrink-0 scrollbar-none">
                  {categories.map(cat => {
                    const count = menu.filter(m => m.category === cat && m.available).length;
                    return (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`whitespace-nowrap text-sm px-3 py-1.5 rounded-full font-medium transition-colors shrink-0 flex items-center gap-1.5 ${activeCategory === cat ? 'bg-amber-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        {cat}
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${activeCategory === cat ? 'bg-amber-700 text-amber-100' : 'bg-gray-200 text-gray-500'}`}>{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Menu grid */}
                <div
                  className="flex-1 overflow-y-auto p-3 grid grid-cols-2 sm:grid-cols-3 gap-3 content-start bg-gray-50"
                  style={{ paddingBottom: cartCount > 0 ? '5.5rem' : '0.75rem' }}
                >
                  {filtered.map(item => {
                    const inCart = cart.filter(ci => ci.menuItem.id === item.id).reduce((s, ci) => s + ci.quantity, 0);
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleMenuItemTap(item)}
                        className="bg-white rounded-2xl shadow-sm text-left active:scale-95 border border-transparent hover:border-amber-200 transition-all relative overflow-hidden"
                      >
                        {inCart > 0 && (
                          <span className="absolute top-2 right-2 z-10 bg-amber-800 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">{inCart}</span>
                        )}
                        {item.image
                          ? <img src={item.image} alt={item.name} className="w-full h-24 object-cover" />
                          : <div className="w-full h-24 bg-amber-50 flex items-center justify-center text-3xl">☕</div>
                        }
                        <div className="p-2.5">
                          <p className="text-sm font-medium text-gray-800 leading-tight">{item.name}</p>
                          <p className="text-amber-700 font-bold text-sm mt-0.5">{item.price.toFixed(2)} ₼</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Desktop cart sidebar */}
              <div className="hidden md:flex w-72 bg-white border-l flex-col">
                <div className="px-4 py-3 border-b">
                  <h2 className="font-bold text-gray-800">Sifariş {cartCount > 0 && <span className="text-amber-700">({cartCount})</span>}</h2>
                  <p className="text-xs text-gray-400">{orderType === 'takeaway' ? 'Takeaway' : tableName(selectedTable)}</p>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  {cart.length === 0
                    ? <p className="text-center text-gray-400 text-sm py-8">Boşdur</p>
                    : <CartItems cart={cart} addToCart={addToCart} removeFromCart={removeFromCart} />
                  }
                </div>
                <div className="px-4 py-3 border-t space-y-3">
                  <textarea
                    placeholder="Qeyd..."
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Cəmi:</span>
                    <span className="font-bold text-lg text-amber-700">{cartTotal.toFixed(2)} ₼</span>
                  </div>
                  <button
                    onClick={submitOrder}
                    disabled={cart.length === 0}
                    className="w-full bg-amber-800 hover:bg-amber-900 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
                  >
                    Sifariş ver
                  </button>
                </div>
              </div>

              {/* Mobile floating cart bar */}
              {cartCount > 0 && (
                <div className="md:hidden fixed bottom-16 inset-x-0 z-30 px-4 pb-2 pointer-events-none">
                  <button
                    onClick={() => setMobileCartOpen(true)}
                    className="pointer-events-auto w-full bg-amber-800 text-white rounded-2xl py-3.5 flex items-center justify-between px-5 shadow-lg active:scale-95 transition-transform"
                  >
                    <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">{cartCount}</span>
                    <span className="font-semibold text-sm">Sifarişi gör</span>
                    <span className="font-bold">{cartTotal.toFixed(2)} ₼</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 flex safe-area-inset-bottom">
        {[
          { id: 'orders' as View,    label: 'Sifarişlər',   icon: Receipt },
          { id: 'new-order' as View, label: 'Yeni sifariş', icon: ShoppingBag },
        ].map(n => {
          const Icon = n.icon;
          const isActive = view === n.id || (n.id === 'new-order' && view === 'menu');
          const badge = n.id === 'orders' && active.length > 0 ? active.length : null;
          return (
            <button
              key={n.id}
              onClick={() => {
                if (n.id === 'new-order') { setOrderType(null); setCart([]); }
                setView(n.id);
              }}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 relative transition-colors active:opacity-70 ${isActive ? 'text-amber-800' : 'text-gray-400'}`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {badge && (
                  <span className="absolute -top-1.5 -right-2 w-4 h-4 bg-amber-800 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{badge}</span>
                )}
              </div>
              <span className="text-[10px] font-medium">{n.label}</span>
              {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-amber-800 rounded-full" />}
            </button>
          );
        })}
      </nav>

      {/* Mobile cart bottom sheet */}
      {mobileCartOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50 md:hidden" onClick={() => setMobileCartOpen(false)} />
          <div className="fixed bottom-0 inset-x-0 z-[60] bg-white rounded-t-2xl shadow-2xl md:hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b shrink-0">
              <div>
                <h2 className="font-bold text-gray-800">
                  Sifariş {cartCount > 0 && <span className="text-amber-700">({cartCount})</span>}
                </h2>
                <p className="text-xs text-gray-400">{orderType === 'takeaway' ? 'Takeaway' : tableName(selectedTable)}</p>
              </div>
              <button onClick={() => setMobileCartOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 text-gray-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {cart.length === 0
                ? <p className="text-center text-gray-400 text-sm py-8">Boşdur</p>
                : <CartItems cart={cart} addToCart={addToCart} removeFromCart={removeFromCart} />
              }
            </div>
            <div className="px-4 py-4 border-t space-y-3 bg-white shrink-0">
              <textarea
                placeholder="Qeyd..."
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Cəmi:</span>
                <span className="font-bold text-xl text-amber-700">{cartTotal.toFixed(2)} ₼</span>
              </div>
              <button
                onClick={submitOrder}
                disabled={cart.length === 0}
                className="w-full bg-amber-800 hover:bg-amber-900 disabled:bg-gray-300 text-white font-semibold py-4 rounded-2xl transition-colors text-base active:scale-95"
              >
                Sifariş ver
              </button>
            </div>
          </div>
        </>
      )}

      {/* Payment modal — bottom sheet on mobile */}
      {payingOrder && (() => {
        const total = orderTotal(payingOrder);
        const cash = parseFloat(cashInput) || 0;
        const card = parseFloat(cardInput) || 0;
        const paid = cash + card;
        const change = paid - total;
        const canPay = paid >= total;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 w-full sm:max-w-sm">
              <h3 className="font-bold text-lg text-gray-800 mb-1">Ödəniş</h3>
              <p className="text-sm text-gray-500 mb-4">
                №{payingOrder.orderNumber} · {tableName(payingOrder.tableNumber)}
              </p>
              <ul className="text-sm space-y-2 mb-4 border-t pt-3 max-h-40 overflow-y-auto">
                {payingOrder.items.map((oi, i) => (
                  <li key={i} className="flex justify-between text-gray-700">
                    <div>
                      <span>{oi.menuItem.name} × {oi.quantity}</span>
                      {oi.modifiers && <p className="text-xs text-amber-600">{oi.modifiers}</p>}
                    </div>
                    <span className="shrink-0 ml-2">{(oi.menuItem.price * oi.quantity).toFixed(2)} ₼</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between items-center font-bold text-xl border-t pt-3 mb-5">
                <span>Cəmi</span>
                <span className="text-amber-700">{total.toFixed(2)} ₼</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1 block">💵 Nağd (₼)</label>
                  <input
                    type="number" min="0" step="0.5" placeholder="0.00"
                    value={cashInput}
                    onChange={e => setCashInput(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-amber-700 text-center"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1 block">💳 Kart (₼)</label>
                  <input
                    type="number" min="0" step="0.5" placeholder="0.00"
                    value={cardInput}
                    onChange={e => setCardInput(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-amber-700 text-center"
                  />
                </div>
              </div>
                      {paid > 0 && change < 0 && (
                <div className="flex justify-between items-center px-4 py-3 rounded-xl font-semibold text-base mb-4 bg-red-50 text-red-600">
                  <span>Çatışmır</span>
                  <span>{Math.abs(change).toFixed(2)} ₼</span>
                </div>
              )}
              {paid > 0 && change > 0 && (
                <div className="mb-4 rounded-xl overflow-hidden border border-gray-200">
                  <div className="flex">
                    <button
                      onClick={() => setIsTip(false)}
                      className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${!isTip ? 'bg-green-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >
                      💸 Qaytarılacaq {change.toFixed(2)} ₼
                    </button>
                    <button
                      onClick={() => setIsTip(true)}
                      className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${isTip ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >
                      ⭐ Bəxşiş {change.toFixed(2)} ₼
                    </button>
                  </div>
                </div>
              )}
              {paid > 0 && change === 0 && (
                <div className="flex justify-between items-center px-4 py-3 rounded-xl font-semibold text-base mb-4 bg-green-50 text-green-700">
                  <span>Dəqiq ödəniş</span>
                  <span>✓</span>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setPayingOrder(null)} className="py-3 px-5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Ləğv et</button>
                <button
                  onClick={confirmPayment}
                  disabled={!canPay}
                  className="flex-1 py-3 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white font-semibold text-sm active:scale-95 transition-colors"
                >
                  Ödənildi ✓
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modifier modal — bottom sheet on mobile */}
      {modifierItem && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 w-full sm:max-w-sm">
            <h3 className="font-bold text-lg text-gray-800 mb-1">{modifierItem.name}</h3>
            <p className="text-sm text-gray-400 mb-4">Seçimləri edin</p>
            <div className="space-y-4">
              {(modifierItem.variants?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Variant</p>
                  <div className="flex flex-wrap gap-2">
                    {modifierItem.variants!.map(v => (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVariant({ id: v.id, name: v.name, price: v.price })}
                        className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-colors active:scale-95 ${selectedVariant?.id === v.id ? 'border-amber-800 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                      >
                        {v.name} — {v.price.toFixed(2)} ₼
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(MOD_GROUPS[modifierItem.category] ?? []).map(group => (
                <div key={group.label}>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{group.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.options.map(opt => (
                      <button
                        key={opt}
                        onClick={() => setSelectedMods(prev => ({ ...prev, [group.label]: opt }))}
                        className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-colors active:scale-95 ${selectedMods[group.label] === opt ? 'border-amber-800 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => setModifierItem(null)} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Ləğv et</button>
              <button onClick={confirmModifiers} className="flex-1 py-3 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-semibold text-sm active:scale-95">Əlavə et</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CartItems — shared between desktop sidebar and mobile sheet ───────────

function CartItems({ cart, addToCart, removeFromCart }: {
  cart: OrderItem[];
  addToCart: (item: MenuItem, mods?: string) => void;
  removeFromCart: (itemId: string, mods?: string) => void;
}) {
  return (
    <ul className="space-y-3">
      {cart.map(ci => (
        <li key={ci.menuItem.id + (ci.modifiers ?? '')} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{ci.menuItem.name}</p>
            {ci.modifiers && <p className="text-xs text-amber-600 truncate">{ci.modifiers}</p>}
            <p className="text-xs text-gray-400">{ci.menuItem.price.toFixed(2)} ₼</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => removeFromCart(ci.menuItem.id, ci.modifiers)}
              className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center active:scale-90"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="w-5 text-center text-sm font-semibold">{ci.quantity}</span>
            <button
              onClick={() => addToCart(ci.menuItem, ci.modifiers)}
              className="w-7 h-7 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-700 flex items-center justify-center active:scale-90"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── OrderRow — mobile card + desktop table row ────────────────────────────

function OrderRow({ order, tableLabel, onPay, onStatusChange }: {
  order: Order;
  tableLabel: string;
  onPay: () => void;
  onStatusChange: (id: string, s: OrderStatus) => void;
}) {
  const total = orderTotal(order);
  const itemsPreview = order.items.map(oi =>
    oi.modifiers ? `${oi.menuItem.name} (${oi.modifiers})` : oi.menuItem.name
  ).join(', ');

  return (
    <>
      {/* Mobile card */}
      <div className="md:hidden mx-3 my-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-amber-700 font-bold text-sm">№{order.orderNumber}</span>
              <span className="text-gray-800 font-semibold text-sm">{tableLabel}</span>
            </div>
            <p className="text-xs text-gray-400">
              {new Date(order.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })} · {elapsed(order.createdAt)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold text-gray-800">{total.toFixed(2)} ₼</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status]}`}>{order.status}</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 truncate mb-3">{itemsPreview}</p>
        {order.status !== 'ödənilib' && (
          <button
            onClick={onPay}
            className="w-full bg-amber-800 hover:bg-amber-900 active:scale-95 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
          >
            Ödəniş
          </button>
        )}
      </div>

      {/* Desktop table row */}
      <div className="hidden md:grid grid-cols-[120px_1fr_140px_200px_110px] gap-4 px-6 py-4 border-b bg-white hover:bg-gray-50 items-center">
        <div>
          <p className="font-semibold text-gray-800 text-sm">
            {new Date(order.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-xs text-gray-400">{elapsed(order.createdAt)}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-800">
            <span className="text-amber-700">№{order.orderNumber}</span>{' › '}<span>{tableLabel}</span>
          </p>
          <p className="text-xs text-gray-400 truncate max-w-xs">{itemsPreview}</p>
        </div>
        <div>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status]}`}>
            {order.status}
          </span>
        </div>
        <div>
          {order.status !== 'ödənilib' && (
            <button onClick={onPay} className="bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
              Ödəniş
            </button>
          )}
        </div>
        <div className="text-right">
          <span className="font-bold text-gray-800">{total.toFixed(2)} ₼</span>
        </div>
      </div>
    </>
  );
}
