'use client';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard,
  PanelLeftClose, PanelLeftOpen, LogOut, Menu, X,
  TrendingUp, Receipt, Star, ChevronDown, Percent,
  Coffee, BarChart2, Package, Wallet, ImageIcon, Trash2, RotateCcw,
  Users, EyeOff, Eye, Plus, Pencil, QrCode, UserCircle, Lock, MapPin, Phone, User, Search, Download, Upload, Clock,
  GripVertical, Globe, KeyRound, Tablet, Copy, RefreshCw, Link, Printer, Check, ArrowUp, ArrowDown, ChefHat,
  Building2, AtSign,
} from 'lucide-react';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors,
  closestCenter, pointerWithin, useDroppable,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getSession, logout, validateSession, clearLocalSession, updateSession } from '@/lib/auth';
import {
  fetchMenu, saveMenu, fetchOrders, fetchOrdersCount, updateOrderStatus, cancelOrder, editOrderPayment, deleteOrder, restoreOrder,
  fetchShifts, fetchShiftSales, closeShift, fetchOpenShift,
  fetchCategories, saveCategories,
  fetchTrash, moveToTrash, restoreFromTrash, permanentlyDeleteFromTrash, emptyTrash,
  setCompanyContext, updateUser,
  fetchTables, createTable, updateTable, updateTableLayout, deleteTable, fetchCompanySlug,
  fetchTablesEnabled, setTablesEnabled,
  fetchQrEnabled, setQrEnabled, fetchMenuOnly, setMenuOnly,
  fetchKassaEnabled, setKassaEnabled,
  fetchCompanyProfile, updateMyCompanyProfile, fetchMyUsername, updateOwnerAccount, verifyPassword,
  fetchCompanySettings, updateCompanyHours,
  fetchLoginEvents, LoginEvent,
  fetchStaff, createStaff, updateStaff, setStaffPin, deleteStaff,
  fetchSellerToken, linkProductStock,
  fetchBranding, setLogoUrl as saveLogoUrl, setBrandColor as saveBrandColor,
  fetchStations,
  fetchAllUsers, createEmployee, updateEmployee, deleteUser, toggleUserActive,
} from '@/lib/store';
import { applyBrand, BRAND_PRESETS, DEFAULT_BRAND } from '@/lib/branding';
import { orderClosedAt } from '@/lib/order-items';
import {
  CompanySettings, DEFAULT_SETTINGS, businessDay, businessToday, businessDayStartUtc,
  addDays, dayDiff, dayOfWeek, dayToDate, tzHour, cutoffMinutes,
} from '@/lib/business-day';
import { supabase } from '@/lib/supabase';
import { CashShift, Category, MenuItem, MenuItemVariant, Order, OrderStatus, RestaurantTable, Staff, Station, TrashItem, isOrderOpen } from '@/types';
import AppDialog, { DialogState } from '@/components/AppDialog';
import AnbarPanel from '@/components/AnbarPanel';
import StationsPanel from '@/components/StationsPanel';
import OrderItemHistory from '@/components/OrderItemHistory';
import PasswordField from '@/components/PasswordField';
import { validatePassword } from '@/lib/password';
import { exportMenuExcel, exportOrdersExcel, exportAnalizExcel, parseMenuFile, ImportPreview, AnalizRow } from '@/lib/excel';
import QRCode from 'react-qr-code';
import InstallPWA from '@/components/InstallPWA';
import { connectPrinter, disconnectPrinter, selectPrinter, printReceipt, openCashDrawer } from '@/lib/printer';

// RPC raise messages are machine codes — translated here for display
const STAFF_ERRORS: Record<string, string> = {
  pin_taken: 'Bu PIN artıq başqa əməkdaşda istifadə olunur',
  bad_pin: 'PIN 4 rəqəmdən ibarət olmalıdır',
  bad_name: 'Ad boş ola bilməz',
  not_owner: 'Bu əməliyyat üçün icazəniz yoxdur',
};
function staffErrorText(err: string): string {
  const code = Object.keys(STAFF_ERRORS).find(c => err.includes(c));
  return code ? STAFF_ERRORS[code] : 'Xəta baş verdi, yenidən cəhd edin';
}
const WEAK_PINS = new Set([
  '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
  '0123','1234','2345','3456','4567','5678','6789','7890',
  '9876','8765','7654','6543','5432','4321','3210','0987',
  '1212','2121','1122','2211','0101','1010','1100','0011','1221','2112','0110','1001',
  '0852','1357','2580','1470','7410',
]);

const CANCEL_REASONS = ['Müştəri imtina etdi', 'Səhv sifariş', 'Məhsul yoxdur', 'Digər'];

const STATUS_COLORS: Record<OrderStatus, string> = {
  'gözləyir':  'bg-primary-100 text-primary-700',
  'hazırlanır':'bg-blue-100 text-blue-700',
  'hazırdır':  'bg-green-100 text-green-700',
  'ödənilib':  'bg-stone-100 text-stone-600',
  'ləğv edildi': 'bg-red-100 text-red-600',
  'silinib':   'bg-red-100 text-red-600',
};
const STATUS_LABELS: Record<OrderStatus, string> = {
  'gözləyir':   'gözləyir',
  'hazırlanır': 'hazırlanır',
  'hazırdır':   'hazırdır',
  'ödənilib':   'ödənilib',
  'ləğv edildi':'ödənişsiz bağlandı',
  'silinib':    'silinib',
};
const STATUS_OPTIONS: OrderStatus[] = ['gözləyir', 'hazırlanır', 'hazırdır', 'ödənilib'];

type Tab = 'stats' | 'orders' | 'kassa' | 'menu' | 'users' | 'tables' | 'anbar' | 'logins';

type ChartPreset = 'bugün' | '7g' | '30g' | 'ay' | '6ay' | '1il';
type FormVariant = { id: string; name: string; price: string; costPrice: string };

function emptyForm(cat: string) {
  return { name: '', price: '', costPrice: '', category: cat, image: '', stationId: '', kind: 'meal' as 'product' | 'meal', hasVariants: false, variants: [] as FormVariant[] };
}

const AZ_MON_SHORT = ['Yan','Fev','Mar','Apr','May','İyn','İyl','Avq','Sen','Okt','Noy','Dek'];
const AZ_MON_LONG  = ['Yanvar','Fevral','Mart','Aprel','May','İyun','İyul','Avqust','Sentyabr','Oktyabr','Noyabr','Dekabr'];

function orderTotal(order: Order) {
  const gross = order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
  return gross - (order.discountAmount ?? 0);
}

// Ranges are expressed in *business days* (company timezone + working-hours
// cutoff) — `today` is the company's current business day, not the device date.
function presetRange(p: ChartPreset, today: string): [string, string] {
  const toStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = dayToDate(today);
  if (p === '7g') from.setDate(from.getDate() - 6);
  else if (p === '30g') from.setDate(from.getDate() - 29);
  else if (p === 'ay') from.setDate(1);
  else if (p === '6ay') { from.setMonth(from.getMonth() - 6); from.setDate(from.getDate() + 1); }
  else if (p === '1il') { from.setFullYear(from.getFullYear() - 1); from.setDate(from.getDate() + 1); }
  return [toStr(from), today];
}

// Human-readable device summary; raw user agents are unreadable in a table.
function deviceLabel(ua: string | null): string {
  if (!ua) return '—';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Admin', seller: 'Satıcı', waiter: 'Ofisiant', superadmin: 'Superadmin',
};

function calcMargin(price: string, cost: string): string {
  const p = parseFloat(price), c = parseFloat(cost);
  if (!p || !c || c >= p) return '';
  return `${Math.round((1 - c / p) * 100)}%`;
}

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'stats',      label: 'Statistika',    icon: BarChart2 },
  { id: 'orders',     label: 'Sifarişlər',    icon: Receipt },
  { id: 'kassa',      label: 'Kassa',         icon: Wallet },
  { id: 'menu',       label: 'Menyu',         icon: Coffee },
  { id: 'users',      label: 'Əməkdaşlar', icon: Users },
  { id: 'tables',     label: 'Masalar',     icon: LayoutDashboard },
  { id: 'anbar',      label: 'Anbar',       icon: Package },
  { id: 'logins',     label: 'Girişlər',    icon: Globe },
];

const PAGE_META: Record<Tab, { title: string; subtitle: string }> = {
  stats:      { title: 'Statistika & Hesabatlar', subtitle: 'Satış analitikası' },
  orders:     { title: 'Sifarişlər',              subtitle: 'Aktiv sifarişlər' },
  kassa:      { title: 'Kassa',                   subtitle: 'Növbələr və nağd pul nəzarəti' },
  menu:       { title: 'Menyu',                    subtitle: 'Kateqoriyalar və məhsullar' },
  users:      { title: 'Əməkdaşlar',              subtitle: 'Satıcıları idarə et' },
  tables:     { title: 'Masalar',                 subtitle: 'Restoran masalarını idarə et' },
  anbar:      { title: 'Anbar',                   subtitle: 'Anbarlar, qalıqlar, tədarükçülər və bazarlıqlar' },
  logins:     { title: 'Girişlər',                subtitle: 'Sistemə kim, haradan daxil olub' },
};

function LineChartSvg({ data }: { data: { label: string; fullLabel: string; rev: number }[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
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

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bestDist = Infinity;
    pts.forEach(([x], i) => { const d = Math.abs(x - relX); if (d < bestDist) { bestDist = d; best = i; } });
    setHoveredIdx(best);
  }

  const hovered = hoveredIdx !== null ? data[hoveredIdx] : null;
  const hx = hoveredIdx !== null ? pts[hoveredIdx][0] : 0;
  const hy = hoveredIdx !== null ? pts[hoveredIdx][1] : 0;
  const tooltipW = 130, tooltipH = 36, tooltipPad = 6;
  const tooltipX = Math.min(Math.max(hx - tooltipW / 2, PL), W - PR - tooltipW);
  const tooltipY = Math.max(hy - tooltipH - tooltipPad, PT);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredIdx(null)}
    >
      <defs>
        <linearGradient id="lc-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#92400e" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#92400e" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PL} y1={py(t)} x2={W - PR} y2={py(t)} stroke="#f3f4f6" strokeWidth="1" />
          <text x={PL - 5} y={py(t) + 4} textAnchor="end" fontSize="11" fill="#a8a29e">
            {t === 0 ? '0' : t >= 1000 ? `${(t / 1000).toFixed(1)}k` : t}
          </text>
        </g>
      ))}
      {n > 1 && <polygon points={areaStr} fill="url(#lc-g)" />}
      {n > 1 && <polyline points={lineStr} fill="none" stroke="#92400e" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map(([x, y], i) => data[i].rev > 0 && (
        <circle key={i} cx={x} cy={y} r={hoveredIdx === i ? 5 : 3} fill="#92400e" stroke="white" strokeWidth="1.5" />
      ))}
      {data.map((d, i) => (i % step === 0 || i === n - 1) && (
        <text key={i} x={px(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="11" fill="#78716c">{d.label}</text>
      ))}
      {hovered && hoveredIdx !== null && (
        <g>
          <line x1={hx} y1={PT} x2={hx} y2={PT + plotH} stroke="#92400e" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
          <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH} rx="5" fill="white" stroke="#e5e7eb" strokeWidth="1" filter="drop-shadow(0 1px 4px rgba(0,0,0,0.10))" />
          <text x={tooltipX + tooltipW / 2} y={tooltipY + 13} textAnchor="middle" fontSize="10" fill="#6b7280">{hovered.fullLabel}</text>
          <text x={tooltipX + tooltipW / 2} y={tooltipY + 28} textAnchor="middle" fontSize="12" fontWeight="700" fill="#92400e">₼ {hovered.rev.toFixed(2)}</text>
        </g>
      )}
    </svg>
  );
}

// Diacritic-insensitive normalization so "cay" matches "Çay" and "e" matches "ə"
const AZ_CHARS: Record<string, string> = { 'ç': 'c', 'ə': 'e', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' };
function azNormalize(s: string): string {
  return s.toLocaleLowerCase('az').replace(/[çəğıöşü]/g, ch => AZ_CHARS[ch]);
}

// ── Statistika → Analiz ──────────────────────────────────────────────────────

const LOW_MARGIN = 0.20;

type AnalizChip = 'hamısı' | 'satılmayan' | 'aşağı marja' | 'mayasız';
type AnalizSortKey = 'name' | 'category' | 'qty' | 'rev' | 'share' | 'cost' | 'profit' | 'margin';

const isUnsold    = (r: AnalizRow) => r.qty === 0 && !r.hidden;
const isLowMargin = (r: AnalizRow) => r.qty > 0 && !r.noCost && r.margin !== null && r.margin < LOW_MARGIN;
const isNoCost    = (r: AnalizRow) => r.noCost && r.qty > 0;

const money = (n: number) => `${n.toFixed(2)} ₼`;

function AnalizTh({ k, label, right, sortKey, sortDir, onSort }: {
  k: AnalizSortKey; label: string; right?: boolean;
  sortKey: AnalizSortKey; sortDir: 'asc' | 'desc'; onSort: (k: AnalizSortKey) => void;
}) {
  const on = sortKey === k;
  return (
    <th className={`px-4 py-3 font-medium whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
      <button onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-stone-700 ${on ? 'text-stone-800 font-semibold' : ''}`}>
        {label}
        {on && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

// Kept a separate component on purpose: the search/sort state below changes on every
// keystroke, and the parent recomputes every chart aggregate over the full order set on
// each render (a "1 il" range is 10k+ orders). Holding this state here keeps that off the
// typing path — only this subtree, ~one row per product, re-renders.
function AnalizPanel({ rows, from, to }: { rows: AnalizRow[]; from: string; to: string }) {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [chip, setChip] = useState<AnalizChip>('hamısı');
  const [sortKey, setSortKey] = useState<AnalizSortKey>('rev');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const chips: [AnalizChip, string, number][] = [
    ['hamısı', 'Hamısı', rows.length],
    ['satılmayan', 'Satılmayan', rows.filter(isUnsold).length],
    ['aşağı marja', 'Aşağı marja', rows.filter(isLowMargin).length],
    ['mayasız', 'Mayasız', rows.filter(isNoCost).length],
  ];
  const catList = [...new Set(rows.map(r => r.category))].sort((a, b) => a.localeCompare(b, 'az'));

  const q = azNormalize(search.trim());
  const filtered = rows.filter(r => {
    if (q && !azNormalize(r.name).includes(q)) return false;
    if (cat && r.category !== cat) return false;
    if (chip === 'satılmayan') return isUnsold(r);
    if (chip === 'aşağı marja') return isLowMargin(r);
    if (chip === 'mayasız') return isNoCost(r);
    return true;
  });
  const visible = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'name') return a.name.localeCompare(b.name, 'az') * dir;
    if (sortKey === 'category') return a.category.localeCompare(b.category, 'az') * dir;
    // Unsold items have no margin — park them at the bottom rather than treating them as 0%.
    if (sortKey === 'margin') return ((a.margin ?? -Infinity) - (b.margin ?? -Infinity)) * dir;
    return (a[sortKey] - b[sortKey]) * dir;
  });

  const tQty    = visible.reduce((s, r) => s + r.qty, 0);
  const tRev    = visible.reduce((s, r) => s + r.rev, 0);
  const tCost   = visible.reduce((s, r) => s + r.cost, 0);
  const tProfit = tRev - tCost;
  const tMargin = tRev > 0 ? tProfit / tRev : null;

  function sortBy(k: AnalizSortKey) {
    if (k === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortKey(k);
    setSortDir(k === 'name' || k === 'category' ? 'asc' : 'desc');
  }

  const th = (k: AnalizSortKey, label: string, right?: boolean) => (
    <AnalizTh k={k} label={label} right={right} sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
  );

  return (
    <div className="space-y-3">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Məhsul axtar…"
            className="w-full bg-white border border-stone-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-stone-300"
          />
        </div>
        <select
          value={cat}
          onChange={e => setCat(e.target.value)}
          className="bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-700 outline-none focus:border-stone-300"
        >
          <option value="">Bütün kateqoriyalar</option>
          {catList.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          onClick={() => exportAnalizExcel(visible, from, to)}
          className="flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 px-3 py-2 rounded-lg hover:bg-stone-100 transition-colors whitespace-nowrap"
        >
          <Upload className="w-3.5 h-3.5" /> İxrac
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chips.map(([c, label, n]) => (
          <button key={c} onClick={() => setChip(c)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              chip === c ? 'bg-stone-800 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
            {label}
            <span className={chip === c ? 'text-white/60' : 'text-stone-400'}>{n}</span>
          </button>
        ))}
      </div>

      {chip === 'mayasız' && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Bu məhsulların maya dəyəri qeyd edilməyib — sistem onları 100% mənfəətli sayır, ona görə ümumi mənfəət rəqəmi olduğundan yüksək görünür.
        </p>
      )}

      <div className="bg-white rounded-xl border border-stone-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-500 border-b border-stone-100">
                {th('name', 'Məhsul')}
                {th('category', 'Kateqoriya')}
                {th('qty', 'Satış', true)}
                {th('rev', 'Gəlir', true)}
                {th('share', 'Pay', true)}
                {th('cost', 'Maya', true)}
                {th('profit', 'Mənfəət', true)}
                {th('margin', 'Marja', true)}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const dead = r.qty === 0;
                const low = isLowMargin(r);
                return (
                  <tr key={`${r.name}-${i}`} className={`border-b border-stone-50 last:border-0 ${dead ? 'text-stone-400' : 'text-stone-600'}`}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={dead ? '' : 'font-medium text-stone-800'}>{r.name}</span>
                      {r.hidden && <span className="ml-1.5 text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">Gizli</span>}
                      {r.orphan && <span className="ml-1.5 text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">Menyuda yoxdur</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.category}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{dead ? '—' : r.qty}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{dead ? '—' : money(r.rev)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {dead ? '—' : (
                        <span className="inline-flex items-center gap-1.5 justify-end">
                          <span className="w-10 h-1 bg-stone-100 rounded-full overflow-hidden">
                            <span className="block h-full bg-primary-800 rounded-full" style={{ width: `${Math.min(r.share * 100, 100)}%` }} />
                          </span>
                          <span className="tabular-nums w-9">{(r.share * 100).toFixed(1)}%</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {dead ? '—' : r.noCost
                        ? <span title="Maya dəyəri qeyd edilməyib" className="text-amber-600">⚠ —</span>
                        : money(r.cost)}
                    </td>
                    <td className={`px-4 py-3 text-right whitespace-nowrap ${dead || r.noCost ? '' : r.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {dead || r.noCost ? '—' : money(r.profit)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {dead || r.margin === null ? '—' : r.noCost
                        ? <span title="Maya dəyəri qeyd edilməyib" className="text-amber-600">⚠ 100%</span>
                        : <span className={low ? 'text-amber-600 font-medium' : ''}>
                            {low && '⚠ '}{(r.margin * 100).toFixed(0)}%
                          </span>}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-stone-400">Nəticə yoxdur</td></tr>
              )}
            </tbody>
            {visible.length > 0 && (
              <tfoot>
                <tr className="border-t border-stone-100 bg-stone-50/60 text-stone-800 font-semibold">
                  <td className="px-4 py-3 whitespace-nowrap">Cəmi</td>
                  <td className="px-4 py-3 whitespace-nowrap text-stone-500 font-normal">{visible.length} məhsul</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{tQty}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{money(tRev)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right whitespace-nowrap">{money(tCost)}</td>
                  <td className={`px-4 py-3 text-right whitespace-nowrap ${tProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{money(tProfit)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{tMargin === null ? '—' : `${(tMargin * 100).toFixed(0)}%`}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Menyu tab drag & drop wrappers ───────────────────────────────────────────

type DragHandle = {
  attributes: ReturnType<typeof useSortable>['attributes'];
  listeners: ReturnType<typeof useSortable>['listeners'];
};

function SortableRow({ id, className, children }: {
  id: string;
  className?: string;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${className ?? ''} ${isDragging ? 'opacity-50 relative z-10' : ''}`}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

// Category headers accept product drops — dropping a product here moves it
// into this category.
function CategoryDropTarget({ cat, children }: { cat: string; children: React.ReactNode }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `into:${cat}` });
  const itemOver = isOver && active != null && String(active.id).startsWith('item:');
  return (
    <div ref={setNodeRef} className={`rounded-lg transition-all ${itemOver ? 'ring-2 ring-primary-500 bg-primary-50' : ''}`}>
      {children}
    </div>
  );
}

function AdminPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  // 'categories' merged into 'menu' — keep old links working
  const tab = (rawTab === 'categories' ? 'menu' : rawTab as Tab | null) ?? 'stats';
  // Statistika sub-view. Absent ?sub= means Ümumi, so existing /admin?tab=stats links are unchanged.
  const statsSub: 'ümumi' | 'analiz' = searchParams.get('sub') === 'analiz' ? 'analiz' : 'ümumi';
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [menuView, setMenuView] = useState<'items' | 'stations'>('items');
  const [adminName, setAdminName] = useState('Admin');
  const [companyName, setCompanyName] = useState('');
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

  // cancel order modal
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [cancelOtherText, setCancelOtherText] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  // edit payment modal
  const [editingPaymentOrder, setEditingPaymentOrder] = useState<Order | null>(null);
  const [editPaymentCash, setEditPaymentCash] = useState('');
  const [editPaymentCard, setEditPaymentCard] = useState('');
  const [editPaymentBusy, setEditPaymentBusy] = useState(false);
  const [editPaymentError, setEditPaymentError] = useState('');

  // printer
  const [printerConnected, setPrinterConnected] = useState(false);
  const [printerError, setPrinterError] = useState<string | null>(null);

  // categories form
  const [newCat, setNewCat] = useState('');
  const [showCatDialog, setShowCatDialog] = useState(false);
  const [editCatTarget, setEditCatTarget] = useState<string | null>(null);
  const [editCatValue, setEditCatValue] = useState('');
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [emptyingTrash, setEmptyingTrash] = useState(false);

  // shared confirm/notice dialog
  const [dialog, setDialog] = useState<DialogState | null>(null);

  // Collapsed category sections — persisted so the layout survives reloads.
  // Stores the collapsed ones: new categories default to open.
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set<string>(JSON.parse(localStorage.getItem('admin_collapsed_categories') ?? '[]')); } catch { return new Set(); }
  });
  function toggleCatCollapsed(cat: string) {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      try { localStorage.setItem('admin_collapsed_categories', JSON.stringify([...next])); } catch {}
      return next;
    });
  }
  const [menuSearch, setMenuSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'product' | 'meal'>('all');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  // kassa tab
  const [shifts, setShifts] = useState<CashShift[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [openShiftSales, setOpenShiftSales] = useState({ cash: 0, card: 0 });
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [adminCountedInput, setAdminCountedInput] = useState('');
  const [adminTerminalInput, setAdminTerminalInput] = useState('');
  const [closingShift, setClosingShift] = useState(false);

  // orders tab
  const [totalOrders, setTotalOrders] = useState(0);
  const [orderSearch, setOrderSearch] = useState('');
  const [ordersPreset, setOrdersPreset] = useState<'all' | 'bugün' | 'bu həftə'>('all');
  // Date range for the orders tab. The presets above only filter the loaded page,
  // so a picked range is fetched from the server instead — that's the only way to
  // reach orders older than the last 200.
  const [ordersFrom, setOrdersFrom] = useState('');
  const [ordersTo, setOrdersTo] = useState('');
  // Tagged with the range it was fetched for, so a stale list is never shown
  // under a newly picked range while the new one is still loading.
  const [rangeResult, setRangeResult] = useState<{ key: string; data: Order[] } | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeRefreshKey, setRangeRefreshKey] = useState(0);
  // Empty while the range is incomplete or backwards — the presets stay in charge then.
  const ordersRangeKey = ordersFrom && ordersTo && ordersFrom <= ordersTo ? `${ordersFrom}|${ordersTo}` : '';
  const rangeOrders = ordersRangeKey && rangeResult?.key === ordersRangeKey ? rangeResult.data : null;
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const PULL_THRESHOLD = 72;

  // stats chart
  const [topSort, setTopSort] = useState<'rev' | 'profit' | 'qty' | 'margin'>('rev');
  const [bizSettings, setBizSettings] = useState<CompanySettings>(DEFAULT_SETTINGS);
  const [customFrom, setCustomFrom] = useState(() => businessToday(DEFAULT_SETTINGS));
  const [customTo, setCustomTo] = useState(() => businessToday(DEFAULT_SETTINGS));
  const [statsOrders, setStatsOrders] = useState<Order[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const statsCache = useRef<Map<string, { at: number; data: Order[] }>>(new Map());
  const refreshRef = useRef<() => void>(() => {});
  const refreshAllRef = useRef<() => void>(() => {});
  const [sessionReady, setSessionReady] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  // tables tab
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [showTableForm, setShowTableForm] = useState(false);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [tName, setTName] = useState('');
  const [tCapacity, setTCapacity] = useState('4');
  const [tSaving, setTSaving] = useState(false);
  const [qrTable, setQrTable] = useState<RestaurantTable | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const [tableView, setTableView] = useState<'list' | 'floor'>('floor');
  const [tShape, setTShape] = useState<'rect' | 'round' | 'rect-v'>('rect');
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{ id: number; ox: number; oy: number; mx: number; my: number } | null>(null);
  const [tableSavedToast, setTableSavedToast] = useState(false);
  const [tablesOn, setTablesOn] = useState(true);
  const [tablesToggleBusy, setTablesToggleBusy] = useState(false);
  const [qrOn, setQrOn] = useState(true);
  const [qrToggleBusy, setQrToggleBusy] = useState(false);
  const [menuOnly, setMenuOnlyState] = useState(false);
  const [menuOnlyBusy, setMenuOnlyBusy] = useState(false);
  const [kassaOn, setKassaOn] = useState(true);
  const [kassaToggleBusy, setKassaToggleBusy] = useState(false);
  const [kassaToggleError, setKassaToggleError] = useState<string | null>(null);
  // branding
  const [logoUrl, setLogoState] = useState<string | null>(null);
  const [brandColor, setBrandColorState] = useState<string>(DEFAULT_BRAND);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [alignGuides, setAlignGuides] = useState<{ type: 'h' | 'v'; pos: number }[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);

  // users tab
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companySlug, setCompanySlug] = useState<string | null>(null);
  const [sellerToken, setSellerToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [tokenRegenerating, setTokenRegenerating] = useState(false);

  // PIN staff (Poster-style sellers — identified by PIN on the terminal)
  const [pinStaff, setPinStaff] = useState<Staff[]>([]);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [sName, setSName] = useState('');
  const [sPin, setSPin] = useState('');
  const [sSaving, setSSaving] = useState(false);
  const [sError, setSError] = useState('');

  // Sex employees — full accounts, not PINs. A prep tablet is always on the same
  // wall, so the login is typed once at setup; PIN-switching would buy nothing and
  // every wrong PIN on a greasy screen would lock the till too (staff_pin_state is
  // keyed by company, not by device).
  const [employees, setEmployees] = useState<{ id: string; username: string; name: string; active: boolean; stationId: string | null }[]>([]);
  const [showEmpForm, setShowEmpForm] = useState(false);
  const [editingEmp, setEditingEmp] = useState<{ id: string; username: string; name: string; stationId: string | null } | null>(null);
  const [eName, setEName] = useState('');
  const [eUsername, setEUsername] = useState('');
  const [ePassword, setEPassword] = useState('');
  const [eStationId, setEStationId] = useState('');
  const [eSaving, setESaving] = useState(false);
  const [eError, setEError] = useState('');

  const reloadEmployees = useCallback(async () => {
    const users = await fetchAllUsers();
    setEmployees(users
      .filter(u => u.role === 'employee')
      .map(u => ({ id: u.id, username: u.username, name: u.name, active: u.active, stationId: u.stationId })));
  }, []);

  // logins tab
  const [loginEvents, setLoginEvents] = useState<LoginEvent[]>([]);
  const [loginsLoaded, setLoginsLoaded] = useState(false);

  // profile modal
  const [showProfile, setShowProfile] = useState(false);
  const [profName, setProfName] = useState('');
  const [profUsername, setProfUsername] = useState('');
  // What the login was when the modal opened, so an unchanged username doesn't
  // hit the users endpoint on every save.
  const [profUsernameSaved, setProfUsernameSaved] = useState('');
  const [profOwner, setProfOwner] = useState('');
  const [profAddress, setProfAddress] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profOpen, setProfOpen] = useState('00:00');
  const [profClose, setProfClose] = useState('00:00');
  const [profSaving, setProfSaving] = useState(false);
  const [profMsg, setProfMsg] = useState('');
  // A rejected username lands in the same slot as "Yadda saxlandı", so the
  // colour has to say which one it is.
  const [profMsgErr, setProfMsgErr] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwShowCurrent, setPwShowCurrent] = useState(false);
  const [userId, setUserId] = useState('');

  async function openProfile() {
    const session = getSession();
    if (!session?.companyId) return;
    const [profile, username] = await Promise.all([
      fetchCompanyProfile(session.companyId),
      fetchMyUsername(session.id),
    ]);
    setProfName(profile?.name ?? '');
    setProfUsername(username);
    setProfUsernameSaved(username);
    setProfOwner(profile?.ownerName ?? '');
    setProfAddress(profile?.address ?? '');
    setProfPhone(profile?.phone ?? '');
    setProfOpen(bizSettings.workOpen);
    setProfClose(bizSettings.workClose);
    setProfMsg(''); setProfMsgErr(false);
    setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwMsg('');
    setShowProfile(true);
  }

  async function handleSaveProfile() {
    const session = getSession();
    if (!session?.companyId) return;
    const name = profName.trim();
    if (!name) { setProfMsgErr(true); setProfMsg('Müəssisənin adı boş ola bilməz'); return; }
    setProfSaving(true);
    setProfMsgErr(false);

    // The username is the login, so a rejected one (taken, bad format) must not
    // be reported as saved — do it first and bail out before the rest.
    const username = profUsername.trim();
    if (username && username !== profUsernameSaved) {
      const err = await updateOwnerAccount(session.id, session.name, username);
      if (err) { setProfMsgErr(true); setProfMsg(err); setProfSaving(false); return; }
      setProfUsernameSaved(username);
    }

    const open = profOpen || '00:00', close = profClose || '00:00';
    await Promise.all([
      updateMyCompanyProfile(name, profOwner.trim(), profAddress.trim(), profPhone.trim()),
      updateCompanyHours(open, close),
    ]);
    updateSession({ companyName: name });
    setCompanyName(name);
    setBizSettings(prev => ({ ...prev, workOpen: open, workClose: close }));
    setProfMsg('Yadda saxlandı');
    setProfSaving(false);
    setTimeout(() => setProfMsg(''), 2000);
  }

  async function handleChangePassword() {
    if (!pwNew || pwNew !== pwConfirm) { setPwMsg('Yeni şifrələr uyğun deyil'); return; }
    const pwErr = validatePassword(pwNew);
    if (pwErr) { setPwMsg(pwErr); return; }
    const session = getSession();
    if (!session) return;
    setPwSaving(true);
    const ok = await verifyPassword(session.id, pwCurrent);
    if (!ok) { setPwMsg('Cari şifrə səhvdir'); setPwSaving(false); return; }
    await updateUser(session.id, session.name, pwNew);
    setPwMsg('Şifrə dəyişdirildi');
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    setPwSaving(false);
    setTimeout(() => setPwMsg(''), 2000);
  }

  useEffect(() => {
    if (window.innerWidth < 768) setTableView('list');
    setExpiresAt(getSession()?.expiresAt ?? null);
    connectPrinter().then(setPrinterConnected);
    return () => { disconnectPrinter(); };
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'owner') { router.replace('/login'); return; }
    validateSession(session).then(valid => {
      if (!valid) { logout(); router.replace('/login'); return; }
      const exp = getSession()?.expiresAt;
      if (exp) setExpiresAt(exp);
    });
    // If another tab logs into a different account, this tab's company context
    // no longer matches the shared auth token — force re-login instead of
    // firing doomed cross-company requests.
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s || s.user.id !== session.id) { clearLocalSession(); router.replace('/login'); }
    });
    setCompanyContext(session.companyId);
    setAdminName(session.name);
    setCompanyName(session.companyName ?? '');
    setCompanyId(session.companyId);
    setUserId(session.id);
    setSessionReady(true);
    fetchOrdersCount().then(setTotalOrders);
    fetchCompanySettings(session.companyId ?? '').then(s => {
      setBizSettings(s);
      // re-anchor the default "bugün" range to the company's business day
      const t = businessToday(s);
      setCustomFrom(t);
      setCustomTo(t);
    });
    fetchStaff().then(setPinStaff);
    fetchStations().then(setStations);
    reloadEmployees();
    fetchSellerToken(session.companyId ?? '').then(setSellerToken);
    fetchBranding().then(({ logoUrl: l, brandColor: b }) => { setLogoState(l); setBrandColorState(b ?? DEFAULT_BRAND); applyBrand(b); });
    Promise.all([fetchMenu(), fetchOrders({ limit: 200 }), fetchCategories(), fetchTrash(), fetchTables(), fetchCompanySlug(session.companyId ?? ''), fetchTablesEnabled(), fetchQrEnabled(), fetchKassaEnabled(), fetchMenuOnly()]).then(([m, o, c, t, tb, slug, te, qre, ke, mo]) => {
      setMenu(m);
      setOrders(o);
      setCategories(c);
      setTrash(t);
      setOnline(m.length > 0 || o.length > 0);
      setTables(tb);
      setCompanySlug(slug);
      setTablesOn(te);
      setQrOn(qre as boolean);
      setKassaOn(ke);
      setMenuOnlyState(mo as boolean);
    });
    return () => authSub.subscription.unsubscribe();
  }, [router]);

  // Login history is rarely opened — fetched once, on first visit to the tab.
  useEffect(() => {
    if (tab !== 'logins' || !sessionReady || loginsLoaded) return;
    fetchLoginEvents().then(ev => { setLoginEvents(ev); setLoginsLoaded(true); });
  }, [tab, sessionReady, loginsLoaded]);

  // Stats orders are fetched per selected range — only the period being viewed is downloaded.
  // Fetched ranges are cached in memory: fully-past ranges forever, ranges touching today for 60s.
  useEffect(() => {
    if (!sessionReady) return;
    const bizT = businessToday(bizSettings);
    const valid = !!(customFrom && customTo && customFrom <= customTo);
    const [f, t] = valid ? [customFrom, customTo] : presetRange('bugün', bizT);
    // a business day runs from cutoff to cutoff in the company timezone
    const from = businessDayStartUtc(f, bizSettings).toISOString();
    const to = new Date(businessDayStartUtc(addDays(t, 1), bizSettings).getTime() - 1).toISOString();
    const key = `${from}|${to}`;
    const ttl = t >= bizT ? 60000 : Infinity;
    const cached = statsCache.current.get(key);
    if (cached && Date.now() - cached.at < ttl) {
      setStatsOrders(cached.data);
      setDataLoading(false);
      setStatsLoaded(true);
      return;
    }
    setDataLoading(true);
    fetchOrders({ from, to }).then(o => {
      statsCache.current.set(key, { at: Date.now(), data: o });
      setStatsOrders(o);
    }).finally(() => { setDataLoading(false); setStatsLoaded(true); });
  }, [sessionReady, customFrom, customTo, bizSettings, statsRefreshKey]);

  // Orders tab date range — fetched from the server so it isn't limited to the
  // loaded page. A cleared or invalid range falls back to the preset filters.
  useEffect(() => {
    if (!sessionReady || !ordersRangeKey) return;
    const from = businessDayStartUtc(ordersFrom, bizSettings).toISOString();
    const to = new Date(businessDayStartUtc(addDays(ordersTo, 1), bizSettings).getTime() - 1).toISOString();
    let cancelled = false;
    const t = setTimeout(() => setRangeLoading(true), 0);
    fetchOrders({ from, to })
      .then(o => { if (!cancelled) setRangeResult({ key: ordersRangeKey, data: o }); })
      .finally(() => { if (!cancelled) setRangeLoading(false); });
    return () => { cancelled = true; clearTimeout(t); };
  }, [sessionReady, ordersRangeKey, ordersFrom, ordersTo, bizSettings, rangeRefreshKey]);

  useEffect(() => {
    if (!sessionReady || tab !== 'kassa') return;
    setShiftsLoading(true);
    fetchShifts().then(async s => {
      setShifts(s);
      const open = s.find(x => !x.closedAt);
      if (open) setOpenShiftSales(await fetchShiftSales(open.openedAt));
    }).finally(() => setShiftsLoading(false));
    const interval = setInterval(async () => {
      const open = await fetchOpenShift();
      if (open) setOpenShiftSales(await fetchShiftSales(open.openedAt));
    }, 30_000);
    return () => clearInterval(interval);
  }, [sessionReady, tab]);

  async function refreshKassa() {
    const s = await fetchShifts();
    setShifts(s);
    const open = s.find(x => !x.closedAt);
    if (open) setOpenShiftSales(await fetchShiftSales(open.openedAt));
  }

  async function handleAdminCloseShift(open: CashShift) {
    if (adminCountedInput === '') return;
    setClosingShift(true);
    try {
      const fresh = await fetchOpenShift();
      if (!fresh) {
        await refreshKassa();
        setClosingShift(false);
        return;
      }
      const sales = await fetchShiftSales(fresh.openedAt);
      const expected = fresh.openingCash + sales.cash + fresh.movements.reduce((t, m) => t + m.amount, 0);
      const countedCard = adminTerminalInput === '' ? undefined : parseFloat(adminTerminalInput) || 0;
      await closeShift(fresh.id, expected, parseFloat(adminCountedInput) || 0, adminName, sales.card, countedCard);
      setAdminCountedInput(''); setAdminTerminalInput('');
      setShifts(await fetchShifts());
    } finally { setClosingShift(false); }
  }

  function invalidateTodayStatsCache() {
    const bizT = businessToday(bizSettings);
    const [f, t] = presetRange('bugün', bizT);
    const from = businessDayStartUtc(f, bizSettings).toISOString();
    const to = new Date(businessDayStartUtc(addDays(t, 1), bizSettings).getTime() - 1).toISOString();
    statsCache.current.delete(`${from}|${to}`);
    setStatsRefreshKey(k => k + 1);
  }

  // Applies a local edit to both order lists, so a change made while a date range
  // is showing doesn't disappear when the range list is the one on screen.
  function patchOrder(id: string, patch: (o: Order) => Order) {
    setOrders(prev => prev.map(o => o.id === id ? patch(o) : o));
    setRangeResult(prev => prev ? { ...prev, data: prev.data.map(o => o.id === id ? patch(o) : o) } : prev);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const [o, total] = await Promise.all([fetchOrders({ limit: 200 }), fetchOrdersCount()]);
      setOrders(o);
      setTotalOrders(total);
      invalidateTodayStatsCache();
      // Past ranges never change on their own — only refetch one that reaches today.
      if (rangeOrders && ordersTo >= businessToday(bizSettings)) setRangeRefreshKey(k => k + 1);
    } finally { setRefreshing(false); }
  }

  async function refreshAll() {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    try {
      const [m, o, c, tb, total] = await Promise.all([
        fetchMenu(), fetchOrders({ limit: 200 }), fetchCategories(), fetchTables(), fetchOrdersCount(),
      ]);
      setMenu(m); setOrders(o); setCategories(c); setTables(tb); setTotalOrders(total);
      invalidateTodayStatsCache();
    } catch { /* ignore */ } finally { setPullRefreshing(false); }
  }

  refreshRef.current = refresh;
  refreshAllRef.current = refreshAll;

  useEffect(() => {
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        refreshRef.current();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') refreshAllRef.current();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('admin-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => refreshAllRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => refreshAllRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables' }, () => refreshAllRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_shifts' }, () => refreshKassa())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  function onTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (touchStartY.current === null) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 5) setPullDistance(Math.min(delta * 0.5, PULL_THRESHOLD));
    else setPullDistance(0);
  }
  function onTouchEnd() {
    if (pullDistance >= PULL_THRESHOLD && !pullRefreshing) refreshAll();
    setPullDistance(0);
    touchStartY.current = null;
  }

  async function loadMoreOrders() {
    setLoadingMore(true);
    try {
      const more = await fetchOrders({ limit: 200, offset: orders.length });
      setOrders(prev => [...prev, ...more.filter(m => !prev.some(p => p.id === m.id))]);
    } finally { setLoadingMore(false); }
  }
  function navigate(t: Tab) { router.replace(`/admin?tab=${t}`); }
  function setStatsSub(s: 'ümumi' | 'analiz') {
    router.replace(s === 'analiz' ? '/admin?tab=stats&sub=analiz' : '/admin?tab=stats');
  }

  // ── image ──────────────────────────────────────────────────────────────────
  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop();
    const path = `${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('menu-images').upload(path, file, { upsert: true });
    if (error) { setDialog({ title: 'Xəta', message: 'Şəkil yüklənmədi: ' + error.message }); return; }
    const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
    setForm(f => ({ ...f, image: data.publicUrl }));
  }

  // ── branding: logo + accent color ───────────────────────────────────────────
  async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoBusy(true);
    const ext = file.name.split('.').pop();
    const path = `logos/${companyId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('menu-images').upload(path, file, { upsert: true });
    if (error) { setLogoBusy(false); setDialog({ title: 'Xəta', message: 'Loqo yüklənmədi: ' + error.message }); return; }
    const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
    setLogoState(data.publicUrl);
    await saveLogoUrl(data.publicUrl);
    setLogoBusy(false);
    if (logoInputRef.current) logoInputRef.current.value = '';
  }

  async function removeLogo() {
    setLogoState(null);
    await saveLogoUrl(null);
  }

  async function pickBrandColor(color: string) {
    setBrandColorState(color);
    applyBrand(color);
    await saveBrandColor(color);
  }

  // ── menu form ──────────────────────────────────────────────────────────────
  function openEdit(item: MenuItem) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      price: item.variants?.length ? '' : String(item.price),
      costPrice: item.costPrice ? String(item.costPrice) : '',
      category: item.category,
      image: item.image ?? '',
      stationId: item.stationId ?? '',
      kind: item.kind ?? 'product',
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
      stationId: form.stationId || null,
      kind: form.kind,
    };
    const updated = editingId ? menu.map(m => m.id === editingId ? item : m) : [...menu, item];
    setMenu(updated);
    setSaving(true);
    await persistMenu(updated);
    // A product is stock-tracked: back it with its own stock item(s) + 0 balance so it
    // shows in Qalıqlar. Idempotent — already-linked products/variants are left untouched.
    // A product with variants links one stock item per variant.
    if (item.kind === 'product') {
      const err = await linkProductStock(item.id);
      if (err) setDialog({ title: 'Diqqət', message: 'Məhsul anbara əlavə olunmadı: ' + err });
    }
    setSaving(false);
    cancelForm();
  }

  // All menu/category saves go through these — a failed save (RLS, constraint,
  // network) must be shown, never swallowed: the delete+insert flow means a
  // silent failure looks like saved data but is actually a wipe.
  async function persistMenu(updated: MenuItem[]): Promise<void> {
    const err = await saveMenu(updated);
    if (err) setDialog({ title: 'Xəta', message: 'Menyu yadda saxlanmadı: ' + err });
  }
  async function persistCategories(updated: Category[]): Promise<void> {
    const err = await saveCategories(updated);
    if (err) setDialog({ title: 'Xəta', message: 'Kateqoriyalar yadda saxlanmadı: ' + err });
  }

  // Quick-add row at the bottom of each category: name + price + Enter.
  // One shared state — typing in a category's row claims it and empties the rest.
  const [quickAdd, setQuickAdd] = useState<{ cat: string; name: string; price: string }>({ cat: '', name: '', price: '' });

  function submitQuickAdd(cat: string) {
    if (quickAdd.cat !== cat) return;
    const name = quickAdd.name.trim();
    const price = parseFloat(quickAdd.price);
    if (!name || isNaN(price) || price < 0) return;
    // Follow the active filter tab: creating under "Məhsullar" makes a product, otherwise a meal.
    const item: MenuItem = { id: crypto.randomUUID(), name, price: Math.round(price * 100) / 100, category: cat, available: true, kind: kindFilter === 'product' ? 'product' : 'meal' };
    const updated = [...menu, item];
    setMenu(updated);
    setQuickAdd({ cat, name: '', price: '' });
    persistMenu(updated);
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
    persistMenu(updated);
  }

  // ── menu import / export ────────────────────────────────────────────────────
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setImportPreview(await parseMenuFile(file, menu, categories));
    } catch {
      setImportPreview({ newItems: [], updatedItems: [], newCategories: [], errors: ['Fayl oxuna bilmədi — .xlsx və ya .csv faylı seçin'], totalRows: 0 });
    }
  }

  async function applyImport() {
    if (!importPreview) return;
    setImporting(true);
    const updatedById = new Map(importPreview.updatedItems.map(u => [u.id, u]));
    const mergedMenu = [...menu.map(m => updatedById.get(m.id) ?? m), ...importPreview.newItems];
    const mergedCats = [...categories, ...importPreview.newCategories];
    setMenu(mergedMenu);
    setCategories(mergedCats);
    const catErr = await saveCategories(mergedCats);
    const menuErr = await saveMenu(mergedMenu);
    setImporting(false);
    setImportPreview(null);
    if (catErr || menuErr) {
      setDialog({ title: 'Xəta', message: 'İdxal yadda saxlanmadı: ' + (catErr ?? menuErr) });
    }
  }
  function duplicateItem(id: string) {
    const original = menu.find(m => m.id === id);
    if (!original) return;
    const copy = { ...original, id: crypto.randomUUID(), name: `${original.name} (kopya)` };
    const updated = [...menu, copy];
    setMenu(updated);
    persistMenu(updated);
  }
  function deleteItem(id: string) {
    const item = menu.find(m => m.id === id);
    if (!item) return;
    moveToTrash('menu', item as unknown as Record<string, unknown>).then(() =>
      fetchTrash().then(setTrash)
    );
    const updated = menu.filter(m => m.id !== id);
    setMenu(updated);
    persistMenu(updated);
  }
  async function handleEmptyTrash() {
    setEmptyingTrash(true);
    // Same cleanup the per-item "Sil" does: trashed product images leave storage too
    const marker = '/menu-images/';
    const paths = trash
      .map(t => (t.data as Record<string, unknown>).image as string | undefined)
      .filter((img): img is string => !!img && img.includes(marker))
      .map(img => img.slice(img.indexOf(marker) + marker.length));
    if (paths.length > 0) await supabase.storage.from('menu-images').remove(paths);
    const err = await emptyTrash();
    setEmptyingTrash(false);
    setConfirmEmptyTrash(false);
    if (err) { setDialog({ title: 'Xəta', message: 'Zibil qutusu boşaldılmadı: ' + err }); return; }
    setTrash([]);
  }

  async function handleStatusChange(orderId: string, status: OrderStatus) {
    const prevStatus = (rangeOrders ?? orders).find(o => o.id === orderId)?.status;
    patchOrder(orderId, o => ({ ...o, status }));
    const ok = await updateOrderStatus(orderId, status);
    if (!ok && prevStatus) {
      patchOrder(orderId, o => ({ ...o, status: prevStatus }));
    }
  }

  function handlePrintQr() {
    const svg = qrRef.current?.querySelector('svg')?.outerHTML;
    if (!svg || !qrTable) return;
    const style = document.createElement('style');
    style.id = '__qr-print-style';
    style.textContent = `@media print { body > * { display: none !important; } #__qr-print-area { display: flex !important; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif; } #__qr-print-area p { margin: 0 0 16px; font-size: 16px; font-weight: 600; } #__qr-print-area svg { width: 220px; height: 220px; } }`;
    document.head.appendChild(style);
    const area = document.createElement('div');
    area.id = '__qr-print-area';
    area.style.display = 'none';
    area.innerHTML = `<p>${qrTable.name}</p>${svg}`;
    document.body.appendChild(area);
    window.print();
    document.head.removeChild(style);
    document.body.removeChild(area);
  }

  async function confirmCancelOrder() {
    if (!cancellingOrder || !cancelReason || cancelBusy) return;
    const cancelling = cancellingOrder;
    const reason = cancelReason === 'Digər' ? cancelOtherText.trim() : cancelReason;
    if (!reason) return;
    setCancelBusy(true);
    // Conditional in the DB — a no-op if the order got paid in the meantime
    const ok = await cancelOrder(cancelling.id, reason, adminName);
    setCancelBusy(false);
    setCancellingOrder(null);
    if (ok) {
      patchOrder(cancelling.id, o => ({ ...o, status: 'ləğv edildi' as OrderStatus, cancelReason: reason, cancelledBy: adminName, cancelledAt: new Date().toISOString() }));
    } else {
      refresh();
    }
  }

  // ── categories ─────────────────────────────────────────────────────────────
  function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newCat.trim();
    if (!trimmed || categories.some(c => c.name === trimmed)) return;
    const updated = [...categories, { name: trimmed, available: true }];
    setCategories(updated);
    setNewCat('');
    setShowCatDialog(false);
    persistCategories(updated);
    // Drop the cursor straight into the new category's quick-add row, so
    // creating a section flows directly into typing its products
    setQuickAdd({ cat: trimmed, name: '', price: '' });
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-quickadd="${window.CSS.escape(trimmed)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
    });
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
    persistCategories(updatedCats);
    persistMenu(updatedMenu);
  }
  function renameCategory(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || categories.some(c => c.name === trimmed)) return;
    const updated = categories.map(c => c.name === oldName ? { ...c, name: trimmed } : c);
    setCategories(updated);
    persistCategories(updated);
    const updatedMenu = menu.map(m => m.category === oldName ? { ...m, category: trimmed } : m);
    setMenu(updatedMenu);
    persistMenu(updatedMenu);
    setEditCatTarget(null);
  }
  // ── menu drag & drop ────────────────────────────────────────────────────
  // 8px activation distance keeps plain clicks (edit, delete, …) working
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Category drags only sort against categories; item drags prefer a category
  // header under the pointer (move into it), otherwise sort against items.
  function menuCollision(args: Parameters<typeof closestCenter>[0]) {
    const activeId = String(args.active.id);
    if (activeId.startsWith('cat:')) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(c => String(c.id).startsWith('cat:')) });
    }
    const intoZones = args.droppableContainers.filter(c => String(c.id).startsWith('into:'));
    const hit = pointerWithin({ ...args, droppableContainers: intoZones });
    if (hit.length > 0) return hit;
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(c => String(c.id).startsWith('item:')) });
  }

  // Reorder one category's items while keeping every other item's slot in the
  // global menu array (array order = saved position).
  function applyItemOrder(cat: string, orderedIds: string[]) {
    const byId = new Map(menu.map(m => [m.id, m]));
    const queue = orderedIds.map(id => byId.get(id)).filter((m): m is MenuItem => !!m);
    let qi = 0;
    const updated = menu.map(m => m.category === cat ? queue[qi++] : m);
    setMenu(updated);
    persistMenu(updated);
  }

  function moveItemToCategory(itemId: string, cat: string) {
    const item = menu.find(m => m.id === itemId);
    if (!item || item.category === cat || !categories.some(c => c.name === cat)) return;
    const updated = [...menu.filter(m => m.id !== itemId), { ...item, category: cat }];
    setMenu(updated);
    persistMenu(updated);
  }

  function handleMenuDragEnd(e: DragEndEvent) {
    const a = String(e.active.id);
    const o = e.over ? String(e.over.id) : null;
    if (!o || a === o) return;
    if (a.startsWith('cat:') && o.startsWith('cat:')) {
      const from = categories.findIndex(c => c.name === a.slice(4));
      const to = categories.findIndex(c => c.name === o.slice(4));
      if (from < 0 || to < 0 || from === to) return;
      const reordered = arrayMove(categories, from, to);
      setCategories(reordered);
      persistCategories(reordered);
    } else if (a.startsWith('item:')) {
      const itemId = a.slice(5);
      const item = menu.find(m => m.id === itemId);
      if (!item) return;
      if (o.startsWith('into:')) {
        moveItemToCategory(itemId, o.slice(5));
      } else if (o.startsWith('item:')) {
        const overItem = menu.find(m => m.id === o.slice(5));
        if (!overItem) return;
        if (overItem.category === item.category) {
          const ids = menu.filter(m => m.category === item.category).map(m => m.id);
          applyItemOrder(item.category, arrayMove(ids, ids.indexOf(itemId), ids.indexOf(overItem.id)));
        } else {
          moveItemToCategory(itemId, overItem.category);
        }
      }
    }
  }
  function toggleCategoryAvailable(name: string) {
    const updated = categories.map(c => c.name === name ? { ...c, available: !c.available } : c);
    setCategories(updated);
    persistCategories(updated);
  }

  // ── table canvas drag ─────────────────────────────────────────────────────
  function autoPos(id: number, existing: typeof tables): { x: number; y: number } {
    const col = existing.length % 5;
    const row = Math.floor(existing.length / 5);
    return { x: 20 + col * 130, y: 20 + row * 110 };
  }
  function handleTableDragStart(e: React.MouseEvent, t: typeof tables[0]) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedTableId(t.id);
    const dragState = { id: t.id, ox: t.x ?? 20, oy: t.y ?? 20, mx: e.clientX, my: e.clientY };
    setDragging(dragState);

    // Snapshot other tables once at drag start — they don't move during the drag.
    const otherTables = tables.filter(x => x.id !== t.id);
    let rafId: number | null = null;

    function onMove(ev: MouseEvent) {
      if (!canvasRef.current) return;
      // Throttle to one update per animation frame — mousemove fires at 60+ Hz
      // and two setState calls per event (tables + alignGuides) caused the admin
      // page to re-render 120+ times/second, freezing the browser.
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const w = t.w ?? 100; const h = t.h ?? 70;
        let newX = Math.max(0, Math.min(rect.width - w, dragState.ox + ev.clientX - dragState.mx));
        let newY = Math.max(0, Math.min(rect.height - h, dragState.oy + ev.clientY - dragState.my));

        const SNAP = 8;
        const guides: { type: 'h' | 'v'; pos: number }[] = [];
        const dxPoints = [newX, newX + w / 2, newX + w];
        const dyPoints = [newY, newY + h / 2, newY + h];
        const dxOffsets = [0, w / 2, w];
        const dyOffsets = [0, h / 2, h];

        otherTables.forEach(other => {
          const ow = other.w ?? 100; const oh = other.h ?? 70;
          const ox2 = other.x ?? 20; const oy2 = other.y ?? 20;
          const oxPoints = [ox2, ox2 + ow / 2, ox2 + ow];
          const oyPoints = [oy2, oy2 + oh / 2, oy2 + oh];

          oxPoints.forEach(op => {
            dxPoints.forEach((dp, di) => {
              if (Math.abs(dp - op) < SNAP) { guides.push({ type: 'v', pos: op }); newX = op - dxOffsets[di]; }
            });
          });
          oyPoints.forEach(op => {
            dyPoints.forEach((dp, di) => {
              if (Math.abs(dp - op) < SNAP) { guides.push({ type: 'h', pos: op }); newY = op - dyOffsets[di]; }
            });
          });
        });

        // Separate state updates — never call setState inside another setState updater
        setAlignGuides(guides);
        setTables(prev => prev.map(x => x.id === dragState.id ? { ...x, x: newX, y: newY } : x));
      });
    }
    function onUp() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setAlignGuides([]);
      setDragging(null);
      setTables(prev => {
        const updated = prev.find(x => x.id === dragState.id);
        if (updated) updateTableLayout(updated.id, updated.x ?? 20, updated.y ?? 20, updated.w ?? 100, updated.h ?? 70, updated.shape ?? 'rect');
        return prev;
      });
      setTableSavedToast(true);
      setTimeout(() => setTableSavedToast(false), 2000);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function handleCanvasMouseMove() {}
  function handleCanvasMouseUp() {}

  // ── item form renderer ────────────────────────────────────────────────────
  function renderItemForm(className: string) {
    return (
      <form ref={formRef} onSubmit={handleSubmit} className={className}>
        <h3 className="font-semibold text-stone-800">{editingId ? 'Məhsulu düzəlt' : 'Yeni Məhsul'}</h3>

        <div>
          <label className="text-xs font-medium text-stone-600 mb-1.5 block">Ad</label>
          <input type="text" placeholder="Məhsulun adı" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white"
            required />
        </div>

        <div>
          <label className="text-xs font-medium text-stone-600 mb-1.5 block">Kateqoriya</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white">
            {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        {stations.length > 0 && (
          <div>
            <label className="text-xs font-medium text-stone-600 mb-1.5 block">Sex</label>
            <select value={form.stationId} onChange={e => setForm(f => ({ ...f, stationId: e.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white">
              <option value="">Sex yoxdur</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-stone-600 mb-1.5 block">Növ</label>
          <div className="inline-flex rounded-lg border border-stone-200 overflow-hidden">
            {([['product', 'Məhsul'], ['meal', 'Yemək']] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setForm(f => ({ ...f, kind: val }))}
                className={`px-4 py-2 text-sm font-medium transition-colors ${form.kind === val ? 'bg-primary-700 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-stone-600 mb-1.5 block">Şəkil</label>
          <div className="flex gap-3 items-center">
            <button type="button" onClick={() => imgRef.current?.click()}
              className="w-16 h-16 rounded-lg border-2 border-dashed border-stone-200 hover:border-primary-400 flex items-center justify-center text-stone-400 hover:text-primary-500 transition-colors shrink-0">
              <ImageIcon className="w-6 h-6" />
            </button>
            <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
            {form.image && (
              <div className="relative">
                <img src={form.image} alt="" className="w-16 h-16 rounded-lg object-cover border border-stone-200" />
                <button type="button" onClick={() => setForm(f => ({ ...f, image: '' }))} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center">×</button>
              </div>
            )}
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={form.hasVariants}
            onChange={e => setForm(f => ({ ...f, hasVariants: e.target.checked, variants: e.target.checked && f.variants.length === 0 ? [{ id: Date.now().toString(), name: '', price: '', costPrice: '' }] : f.variants }))}
            className="rounded accent-primary-800" />
          <span className="text-sm text-stone-700">Variantlar var (ölçü, növ…)</span>
        </label>

        {!form.hasVariants ? (
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-stone-600 mb-1.5 block">Qiymət (₼)</label>
              <input type="number" placeholder="0.00" step="0.01" min="0" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white" required />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-600 mb-1.5 block">Maya dəyəri (₼)</label>
              <input type="number" placeholder="0.00" step="0.01" min="0" value={form.costPrice}
                onChange={e => setForm(f => ({ ...f, costPrice: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white" />
            </div>
            <div className="pb-2 text-sm font-semibold text-green-600">
              {calcMargin(form.price, form.costPrice) && `Marja: ${calcMargin(form.price, form.costPrice)}`}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-9 gap-2 text-xs text-stone-500 px-1">
              <span className="col-span-3">Variant adı</span>
              <span className="col-span-2">Qiymət (₼)</span>
              <span className="col-span-2">Maya (₼)</span>
              <span className="col-span-2">Marja</span>
            </div>
            {form.variants.map((v, i) => (
              <div key={v.id} className="grid grid-cols-9 gap-2 items-center">
                <input className="col-span-3 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white"
                  placeholder={`Variant ${i + 1}`} value={v.name} onChange={e => updateVariant(i, 'name', e.target.value)} required />
                <input type="number" placeholder="0.00" step="0.01" min="0"
                  className="col-span-2 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white"
                  value={v.price} onChange={e => updateVariant(i, 'price', e.target.value)} required />
                <input type="number" placeholder="0.00" step="0.01" min="0"
                  className="col-span-2 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white"
                  value={v.costPrice} onChange={e => updateVariant(i, 'costPrice', e.target.value)} />
                <div className="col-span-2 flex items-center gap-1">
                  <span className="text-xs text-green-600 font-medium flex-1">{calcMargin(v.price, v.costPrice)}</span>
                  <button type="button" onClick={() => removeVariant(i)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addVariant} className="text-sm text-primary-800 hover:text-primary-950 font-medium">+ Variant əlavə et</button>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className="flex items-center gap-2 bg-primary-800 hover:bg-primary-900 disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg shadow-sm transition-colors">
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? 'Saxlanır…' : editingId ? 'Yadda saxla' : 'Əlavə et'}
          </button>
          <button type="button" onClick={cancelForm} disabled={saving} className="text-sm text-stone-500 hover:text-stone-600 px-4 py-2 rounded-lg hover:bg-stone-100 transition-colors disabled:opacity-40">Ləğv et</button>
        </div>
      </form>
    );
  }

  // ── stats computations ────────────────────────────────────────────────────
  // While a new range is loading, show empty charts — old orders plotted on the new axis would be misleading
  const paidOrders = (dataLoading ? [] : statsOrders).filter(o => o.status === 'ödənilib');
  const activeOrders = orders.filter(isOrderOpen);
  const orderQuery = orderSearch.trim().toLowerCase();
  const menuQuery = azNormalize(menuSearch.trim());
  const menuMatchCount = menuQuery
    ? menu.filter(m => categories.some(c => c.name === m.category) && azNormalize(m.name).includes(menuQuery)).length
    : 0;
  const todayStr = businessToday(bizSettings);
  const weekStart = addDays(todayStr, -((dayOfWeek(todayStr) + 6) % 7));
  // A picked date range replaces the loaded page entirely — it was fetched for
  // exactly those days, so the presets don't apply on top of it.
  const ordersDateFiltered = rangeOrders
    ? rangeOrders
    : ordersPreset === 'bugün'
    ? orders.filter(o => businessDay(o.createdAt, bizSettings) === todayStr)
    : ordersPreset === 'bu həftə'
    ? orders.filter(o => businessDay(o.createdAt, bizSettings) >= weekStart)
    : orders;
  const visibleOrders = orderQuery
    ? ordersDateFiltered.filter(o => String(o.orderNumber).includes(orderQuery) || (o.sellerName ?? '').toLowerCase().includes(orderQuery))
    : ordersDateFiltered;

  const menuCostMap: Record<string, number> = {};
  menu.forEach(m => {
    if (m.costPrice) {
      menuCostMap[m.id] = m.costPrice;
    } else if (m.variants?.length) {
      const varCosts = m.variants.filter(v => v.costPrice).map(v => v.costPrice!);
      if (varCosts.length > 0) menuCostMap[m.id] = varCosts.reduce((s, c) => s + c, 0) / varCosts.length;
    }
    m.variants?.forEach(v => { if (v.costPrice) menuCostMap[v.id] = v.costPrice; });
  });

  const isValidRange = !!(customFrom && customTo && customFrom <= customTo);
  const [rangeFrom, rangeTo] = isValidRange ? [customFrom, customTo] : presetRange('bugün', businessToday(bizSettings));

  // Orders are grouped by the company's business day ('YYYY-MM-DD'), not the
  // device's calendar day — night-shift sales stay on the day the shift started
  const orderBizDay = (o: Order) => businessDay(o.createdAt, bizSettings);

  const chartData: { label: string; fullLabel: string; rev: number }[] = (() => {
    const dayFull = (d: Date) => `${d.getDate()} ${AZ_MON_LONG[d.getMonth()]} ${d.getFullYear()}`;
    const weekFull = (wS: Date, wE: Date) => {
      const eDay = new Date(wE); eDay.setDate(eDay.getDate() - 1);
      return `${wS.getDate()} ${AZ_MON_SHORT[wS.getMonth()]} – ${eDay.getDate()} ${AZ_MON_SHORT[eDay.getMonth()]}`;
    };
    const monthFull = (m: Date) => `${AZ_MON_LONG[m.getMonth()]} ${m.getFullYear()}`;

    const dayCount = dayDiff(rangeTo, rangeFrom) + 1;
    if (dayCount === 1) {
      const dayOrders = paidOrders.filter(o => orderBizDay(o) === rangeFrom);
      return Array.from({ length: 24 }, (_, h) => ({
        label: `${String(h).padStart(2, '0')}:00`,
        fullLabel: `${dayFull(dayToDate(rangeFrom))}, ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00`,
        rev: dayOrders.filter(o => tzHour(o.createdAt, bizSettings.timezone) === h).reduce((s, o) => s + orderTotal(o), 0),
      }));
    }
    if (dayCount <= 60) {
      return Array.from({ length: dayCount }, (_, i) => {
        const ds = addDays(rangeFrom, i);
        const d = dayToDate(ds);
        return {
          label: i === 0 || d.getDate() === 1 ? `${d.getDate()} ${AZ_MON_SHORT[d.getMonth()]}` : String(d.getDate()),
          fullLabel: dayFull(d),
          rev: paidOrders.filter(o => orderBizDay(o) === ds).reduce((s, o) => s + orderTotal(o), 0),
        };
      });
    }
    if (dayCount <= 200) {
      const weekCount = Math.ceil(dayCount / 7);
      return Array.from({ length: weekCount }, (_, i) => {
        const wS = addDays(rangeFrom, i * 7);
        const wE = addDays(rangeFrom, i * 7 + 7);
        return {
          label: `${dayToDate(wS).getDate()} ${AZ_MON_SHORT[dayToDate(wS).getMonth()]}`,
          fullLabel: weekFull(dayToDate(wS), dayToDate(wE)),
          rev: paidOrders.filter(o => { const d = orderBizDay(o); return d >= wS && d < wE; }).reduce((s, o) => s + orderTotal(o), 0),
        };
      });
    }
    const monthSet: { year: number; month: number }[] = [];
    const fromD = dayToDate(rangeFrom), toD = dayToDate(rangeTo);
    for (let d = new Date(fromD.getFullYear(), fromD.getMonth(), 1); d <= toD; d.setMonth(d.getMonth() + 1)) {
      monthSet.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return monthSet.map(({ year, month }) => {
      const mS = `${year}-${pad2(month + 1)}-01`;
      const mE = month === 11 ? `${year + 1}-01-01` : `${year}-${pad2(month + 2)}-01`;
      return {
        label: new Date(year, month, 1).toLocaleDateString('az-AZ', { month: 'short' }),
        fullLabel: monthFull(new Date(year, month, 1)),
        rev: paidOrders.filter(o => { const d = orderBizDay(o); return d >= mS && d < mE; }).reduce((s, o) => s + orderTotal(o), 0),
      };
    });
  })();

  const chartPaid = paidOrders.filter(o => {
    const d = orderBizDay(o);
    return d >= rangeFrom && d <= rangeTo;
  });
  const allClosedOrders = (dataLoading ? [] : statsOrders).filter(o => o.status === 'ödənilib' || o.status === 'ləğv edildi');
  const chartAllOrders = allClosedOrders.filter(o => {
    const d = orderBizDay(o);
    return d >= rangeFrom && d <= rangeTo;
  });
  const chartRevenue = chartPaid.reduce((s, o) => s + orderTotal(o), 0);
  const chartCost = chartPaid.reduce((s, o) => s + o.items.reduce((os, oi) => os + (menuCostMap[oi.menuItem.id] ?? 0) * oi.quantity, 0), 0);
  const chartProfit = chartRevenue - chartCost;
  const chartMarginPct = chartRevenue > 0 ? (chartProfit / chartRevenue) * 100 : 0;
  const chartAvg = chartPaid.length > 0 ? chartRevenue / chartPaid.length : 0;

  // Per-method revenue: excess beyond the order total is attributed card-first.
  // Orders saved before payment tracking (no amounts) contribute nothing.
  const methodRev = chartPaid.reduce((acc, o) => {
    const t = orderTotal(o);
    const cashPaid = o.cashAmount ?? 0;
    const cardPaid = o.cardAmount ?? 0;
    if (cashPaid + cardPaid === 0) return acc;
    const cardPart = Math.min(cardPaid, t);
    acc.card += cardPart;
    acc.cash += Math.min(cashPaid, t - cardPart);
    return acc;
  }, { cash: 0, card: 0 });
  const cashRev = methodRev.cash;
  const cardRev = methodRev.card;
  const totalPayRev = cashRev + cardRev;
  const sellerRevMap: Record<string, { orders: number; rev: number }> = {};
  chartPaid.forEach(o => {
    const name = o.sellerName || 'Naməlum';
    if (!sellerRevMap[name]) sellerRevMap[name] = { orders: 0, rev: 0 };
    sellerRevMap[name].orders += 1;
    sellerRevMap[name].rev += orderTotal(o);
  });
  const sellerStats = Object.entries(sellerRevMap)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.rev - a.rev);

  const repCatMap: Record<string, { rev: number; cost: number }> = {};
  chartPaid.forEach(o => {
    const gross = o.items.reduce((s, i) => s + i.menuItem.price * i.quantity, 0);
    const ratio = gross > 0 ? orderTotal(o) / gross : 1;
    o.items.forEach(oi => {
      const menuItem = menu.find(m => m.id === oi.menuItem.id);
      const cat = menuItem?.category || oi.menuItem.category || 'Digər';
      if (!repCatMap[cat]) repCatMap[cat] = { rev: 0, cost: 0 };
      repCatMap[cat].rev += oi.menuItem.price * oi.quantity * ratio;
      repCatMap[cat].cost += (menuCostMap[oi.menuItem.id] ?? 0) * oi.quantity;
    });
  });
  const repCategories = Object.entries(repCatMap)
    .map(([cat, { rev, cost }]) => ({ cat, rev, cost, profit: rev - cost }))
    .sort((a, b) => b.profit - a.profit);
  const maxRepCatProfit = Math.max(...repCategories.map(c => Math.abs(c.profit)), 0.01);

  const itemMap: Record<string, { name: string; cat: string; qty: number; rev: number; cost: number }> = {};
  chartPaid.forEach(o => {
    const gross = o.items.reduce((s, i) => s + i.menuItem.price * i.quantity, 0);
    const ratio = gross > 0 ? orderTotal(o) / gross : 1;
    o.items.forEach(oi => {
      const k = oi.menuItem.id;
      if (!itemMap[k]) itemMap[k] = { name: oi.menuItem.name, cat: oi.menuItem.category || 'Digər', qty: 0, rev: 0, cost: 0 };
      itemMap[k].qty += oi.quantity;
      itemMap[k].rev += oi.menuItem.price * oi.quantity * ratio;
      itemMap[k].cost += (menuCostMap[oi.menuItem.id] ?? 0) * oi.quantity;
    });
  });
  const topItemsSorted = Object.values(itemMap).sort((a, b) => {
    if (topSort === 'profit') return (b.rev - b.cost) - (a.rev - a.cost);
    if (topSort === 'qty') return b.qty - a.qty;
    if (topSort === 'margin') return (b.cost > 0 ? (b.rev - b.cost) / b.rev : -1) - (a.cost > 0 ? (a.rev - a.cost) / a.rev : -1);
    return b.rev - a.rev;
  }).slice(0, 8);
  const topItems = topItemsSorted;
  const topMetricVal = (item: typeof topItems[0]) => {
    if (topSort === 'profit') return item.rev - item.cost;
    if (topSort === 'qty') return item.qty;
    if (topSort === 'margin') return item.cost > 0 ? (item.rev - item.cost) / item.rev : 0;
    return item.rev;
  };
  const maxItemMetric = Math.max(...topItems.map(topMetricVal), 0.01);

  // Analiz: one row per product, unlike topItems this keeps the whole menu — including
  // items that sold nothing, which never appear in itemMap (it's built from order snapshots)
  // and are therefore invisible everywhere else in the app.
  const analizRows: AnalizRow[] = [];
  menu.forEach(m => {
    const s = itemMap[m.id];
    const rev = s?.rev ?? 0;
    const cost = s?.cost ?? 0;
    analizRows.push({
      name: m.name,
      category: m.category || 'Digər',
      qty: s?.qty ?? 0,
      rev, cost,
      profit: rev - cost,
      margin: rev > 0 ? (rev - cost) / rev : null,
      share: chartRevenue > 0 ? rev / chartRevenue : 0,
      hidden: !m.available,
      // No costPrice on the item (nor on any variant) → menuCostMap has no key for it and
      // every stats consumer falls back to `?? 0`, so it silently reports 100% margin.
      noCost: menuCostMap[m.id] === undefined,
      orphan: false,
    });
  });
  // Sold in this range but no longer on the menu — still real revenue, so don't drop it.
  Object.entries(itemMap).forEach(([id, s]) => {
    if (menu.some(m => m.id === id)) return;
    analizRows.push({
      name: s.name,
      category: s.cat,
      qty: s.qty, rev: s.rev, cost: s.cost,
      profit: s.rev - s.cost,
      margin: s.rev > 0 ? (s.rev - s.cost) / s.rev : null,
      share: chartRevenue > 0 ? s.rev / chartRevenue : 0,
      hidden: false,
      noCost: menuCostMap[id] === undefined,
      orphan: true,
    });
  });

  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    label: String(h),
    rev: chartPaid.filter(o => tzHour(o.createdAt, bizSettings.timezone) === h).reduce((s, o) => s + orderTotal(o), 0),
  }));
  const maxHourly = Math.max(...hourlyData.map(h => h.rev), 0.01);

  const WEEKDAYS = ['Be', 'Ça', 'Çə', 'Ca', 'Cü', 'Şə', 'Ba'];
  const weeklyData = WEEKDAYS.map((label, i) => {
    const jsDay = i === 6 ? 0 : i + 1;
    return { label, rev: chartPaid.filter(o => dayOfWeek(orderBizDay(o)) === jsDay).reduce((s, o) => s + orderTotal(o), 0) };
  });
  const maxWeekly = Math.max(...weeklyData.map(w => w.rev), 0.01);

  // ── sidebar ────────────────────────────────────────────────────────────────
  function SidebarContent({ onNavigate, forceExpanded }: { onNavigate?: () => void; forceExpanded?: boolean }) {
    const isCollapsed = forceExpanded ? false : collapsed;
    return (
      <div className="flex flex-col h-full bg-white min-h-[calc(100vh-4rem)]">
        {/* Logo row */}
        <div className={`flex items-center h-16 border-b border-stone-100/50 ${isCollapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="w-7 h-7 rounded-lg object-cover border border-stone-100" />
              ) : (
                <div className="w-7 h-7 rounded-lg bg-primary-800 flex items-center justify-center">
                  <Coffee className="w-4 h-4 text-white" />
                </div>
              )}
              <span className="font-semibold text-stone-800 text-sm truncate max-w-[140px]">{companyName || 'Admin Paneli'}</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="hidden md:flex w-8 h-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors"
          >
            {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Nav */}
        <nav className={`flex flex-col gap-1 p-3 flex-1 ${isCollapsed ? 'items-center' : ''}`}>
          {NAV_ITEMS.map(n => {
            const Icon = n.icon;
            const isActive = tab === n.id;
            const badge = n.id === 'orders' && activeOrders.length > 0 ? activeOrders.length : null;

            if (isCollapsed) {
              return (
                <button
                  key={n.id}
                  title={n.label}
                  onClick={() => { navigate(n.id); onNavigate?.(); if (n.id === 'orders') refresh(); }}
                  className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary-100 text-primary-800 before:absolute before:left-[-9px] before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-r-full before:bg-primary-800'
                      : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {badge && <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary-800 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{badge}</span>}
                </button>
              );
            }

            return (
              <button
                key={n.id}
                onClick={() => { navigate(n.id); onNavigate?.(); if (n.id === 'orders') refresh(); }}
                className={`flex items-center gap-3 h-10 px-3 rounded-lg text-[15px] font-semibold transition-colors w-full ${
                  isActive
                    ? 'bg-primary-800 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-primary-50 hover:text-primary-900'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left truncate">{n.label}</span>
                {badge && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${isActive ? 'bg-white/20 text-white' : 'bg-primary-800 text-white'}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User + logout */}
        {!isCollapsed && (
          <div className="px-4 py-4 border-t border-stone-100/50">
            <button
              onClick={openProfile}
              className="flex items-center gap-2 mb-3 w-full hover:opacity-80 transition-opacity text-left"
            >
              <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-900 text-xs font-bold shrink-0">
                {adminName[0]?.toUpperCase()}
              </div>
              <span className="text-sm font-medium text-stone-700 truncate">{adminName}</span>
              {!online && <span className="ml-auto text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full">Oflayn</span>}
            </button>
            <button
              onClick={() => { logout(); router.push('/login'); }}
              className="flex items-center gap-2 text-sm text-stone-600 hover:text-red-500 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Çıxış
            </button>
          </div>
        )}
        {isCollapsed && (
          <div className="py-4 flex flex-col items-center gap-2 border-t border-stone-100/50">
            <button
              onClick={openProfile}
              title="Profil"
              className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-900 text-xs font-bold hover:opacity-80 transition-opacity"
            >
              {adminName[0]?.toUpperCase()}
            </button>
            <button onClick={() => { logout(); router.push('/login'); }} title="Çıxış" className="text-stone-500 hover:text-red-500 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  const meta = PAGE_META[tab];

  return (
    <div
      className="min-h-screen bg-[#f7f3ed]"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >

      {/* ── Top header ── */}
      <header className="sticky top-0 z-50 h-16 border-b border-stone-100/60 bg-white/80 backdrop-blur-sm flex items-center gap-3 px-4">
        {/* Mobile menu */}
        <button
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 md:hidden">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="w-7 h-7 rounded-lg object-cover border border-stone-100" />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-primary-800 flex items-center justify-center">
              <Coffee className="w-4 h-4 text-white" />
            </div>
          )}
          <span className="font-semibold text-stone-800 text-sm truncate max-w-[160px]">{companyName || 'Kafe'}</span>
        </div>

        <div className="flex-1" />

        {companySlug && sellerToken && (
          <a
            href={`/s/${companySlug}/${sellerToken}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Satıcı terminalını aç"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-50 border border-stone-100 rounded-xl hover:border-primary-300 hover:bg-primary-50 transition-colors mr-2"
          >
            <Tablet className="w-4 h-4 text-primary-700" />
            <span className="hidden sm:inline text-xs font-semibold text-primary-800">Satıcı terminalı</span>
          </a>
        )}

        <InstallPWA />

        {printerConnected && (
          <button
            onClick={openCashDrawer}
            title="Pul çəkməcəsini aç"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-50 border border-stone-100 rounded-xl hover:border-emerald-300 hover:bg-emerald-50 transition-colors mr-2"
          >
            <Printer className="w-4 h-4 text-emerald-600" />
            <span className="hidden sm:inline text-xs font-semibold text-emerald-700">Pul çəkməcəsi</span>
          </button>
        )}

        <button
          onClick={openProfile}
          className="flex items-center gap-2 px-3 py-1.5 bg-stone-50 border border-stone-100 rounded-xl hover:border-primary-300 hover:bg-primary-50 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-900 text-xs font-bold">
            {adminName[0]?.toUpperCase()}
          </div>
          <div className="hidden sm:flex flex-col leading-tight">
            <span className="text-sm font-semibold text-stone-800">{adminName}</span>
            {companyName && (
              <span className="text-xs font-medium text-stone-600">{companyName}</span>
            )}
          </div>
        </button>

        <button
          onClick={() => { logout(); router.push('/login'); }}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-stone-500 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Çıxış"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {(pullDistance > 0 || pullRefreshing) && (
        <div
          className="flex items-center justify-center gap-2 text-sm text-stone-500 overflow-hidden"
          style={{ height: pullRefreshing ? 44 : Math.round(pullDistance * (44 / PULL_THRESHOLD)) }}
        >
          {pullRefreshing ? (
            <><span className="w-4 h-4 border-2 border-stone-300 border-t-primary-800 rounded-full animate-spin" /><span>Yenilənir...</span></>
          ) : (
            <>
              <span style={{ display: 'inline-block', transform: `rotate(${pullDistance >= PULL_THRESHOLD ? 180 : 0}deg)`, transition: 'transform 0.2s' }}>↓</span>
              <span>{pullDistance >= PULL_THRESHOLD ? 'Buraxın' : 'Yeniləmək üçün çəkin'}</span>
            </>
          )}
        </div>
      )}

      {/* ── Subscription warning banner ── */}
      {(() => {
        const exp = expiresAt;
        if (!exp) return null;
        const days = Math.ceil((new Date(exp).getTime() - Date.now()) / 86400000);
        if (days > 10) return null;
        const expired = days < 0;
        return (
          <div className={`relative flex items-center justify-between gap-4 px-5 py-3 ${expired ? 'bg-red-600' : 'bg-primary-500'}`}>
            <div className="flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${expired ? 'bg-red-200' : 'bg-primary-200'}`} />
              <p className="text-white text-sm font-medium">
                {expired
                  ? 'Abunəliyinizin müddəti bitib. Sistemə giriş məhdudlaşdırıla bilər.'
                  : `Abunəliyinizin müddəti ${days} gün sonra bitir. Xidmətin fasiləsiz davam etməsi üçün ödənişi tamamlayın.`}
              </p>
            </div>
            <a
              href="https://wa.me/994998989876"
              target="_blank"
              rel="noopener noreferrer"
              className={`shrink-0 text-xs font-bold px-4 py-1.5 rounded-lg transition-colors ${expired ? 'bg-white text-red-600 hover:bg-red-50' : 'bg-white text-primary-600 hover:bg-primary-50'}`}
            >
              Ödəniş et
            </a>
          </div>
        );
      })()}

      {/* ── Mobile sidebar overlay ── */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60] md:hidden" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-[70] w-64 md:hidden shadow-xl">
            <div className="absolute top-3 right-3 z-10">
              <button onClick={() => setMobileOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100 text-stone-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setMobileOpen(false)} forceExpanded />
          </div>
        </>
      )}

      <div className="flex min-h-[calc(100vh-4rem)] bg-white">

        {/* ── Desktop sidebar ── */}
        <aside className={`hidden md:block flex-shrink-0 sticky top-16 self-start h-[calc(100vh-4rem)] transition-all duration-200 border-r border-stone-100/60 ${collapsed ? 'w-14' : 'w-56'}`}>
          <SidebarContent />
        </aside>

        {/* ── Main ── */}
        <main className="flex-1 min-w-0 bg-[#f7f3ed] rounded-tl-2xl border-l border-t border-stone-100/60 p-4 md:p-6 lg:p-8 overflow-y-auto">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-stone-900">{meta.title}</h1>
            <p className="text-sm font-medium text-stone-600 mt-0.5">{meta.subtitle}</p>
          </div>

          {/* ── STATS ─────────────────────────────────────────────────── */}
          {tab === 'stats' && !statsLoaded && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 max-w-5xl">
              <span className="w-8 h-8 border-2 border-stone-200 border-t-[#92400e] rounded-full animate-spin" />
              <p className="text-sm text-stone-500">Yüklənir...</p>
            </div>
          )}
          {tab === 'stats' && statsLoaded && (
            <div className={`relative space-y-5 max-w-5xl transition-opacity duration-300 ${dataLoading ? 'opacity-60' : ''}`}>
              {dataLoading && (
                <div className="absolute inset-x-0 top-32 z-10 flex justify-center pointer-events-none">
                  <div className="flex flex-col items-center gap-2 bg-white/95 rounded-xl px-8 py-5 shadow-lg border border-stone-100">
                    <span className="w-7 h-7 border-2 border-stone-200 border-t-[#92400e] rounded-full animate-spin" />
                    <p className="text-sm text-stone-600">Yüklənir...</p>
                  </div>
                </div>
              )}

              {/* Sub-view switch + the date range, which drives both Ümumi and Analiz */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-0.5 bg-stone-100 rounded-lg p-0.5">
                  {(['ümumi', 'analiz'] as const).map(s => (
                    <button key={s} onClick={() => setStatsSub(s)}
                      className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${statsSub === s ? 'bg-white shadow-sm text-stone-800' : 'text-stone-600 hover:text-stone-800'}`}>
                      {s === 'ümumi' ? 'Ümumi' : 'Analiz'}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-0.5 bg-stone-100 rounded-lg p-0.5 overflow-x-auto max-w-full">
                    {([['bugün', 'Bu gün'], ['7g', '7 gün'], ['30g', '30 gün'], ['ay', 'Bu ay'], ['6ay', '6 ay'], ['1il', '1 il']] as [ChartPreset, string][]).map(([p, l]) => {
                      const [f, t] = presetRange(p, businessToday(bizSettings));
                      const active = customFrom === f && customTo === t;
                      return (
                        <button key={p} onClick={() => { setCustomFrom(f); setCustomTo(t); }}
                          className={`px-3 py-1 rounded-md text-sm font-semibold transition-colors ${active ? 'bg-white shadow-sm text-stone-800' : 'text-stone-600 hover:text-stone-800'}`}>
                          {l}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={e => setCustomFrom(e.target.value)}
                      className="text-sm font-medium text-stone-700 bg-transparent border-none outline-none w-[124px]"
                    />
                    <span className="text-stone-500 text-xs">—</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={e => setCustomTo(e.target.value)}
                      className="text-sm font-medium text-stone-700 bg-transparent border-none outline-none w-[124px]"
                    />
                  </div>
                </div>
              </div>

              {statsSub === 'analiz' && (
                <AnalizPanel rows={analizRows} from={rangeFrom} to={rangeTo} />
              )}

              {statsSub === 'ümumi' && (<>
              {/* Main chart card */}
              <div className="bg-white rounded-xl border border-stone-100 card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
                  <h3 className="font-semibold text-stone-800 flex items-center gap-2">
                    Gəlir
                    {dataLoading && <span className="w-3.5 h-3.5 border-2 border-stone-200 border-t-[#92400e] rounded-full animate-spin" />}
                  </h3>
                </div>
                <div className="px-4 pb-2">
                  <LineChartSvg data={chartData} />
                </div>
                {/* KPI strip */}
                <div className="flex flex-wrap border-t border-stone-100">
                  {[
                    { label: 'Gəlir',       value: `${chartRevenue.toFixed(2)} ₼`,  icon: Wallet,    color: 'text-stone-800' },
                    { label: 'Maya dəyəri', value: `${chartCost.toFixed(2)} ₼`,     icon: Package,   color: 'text-stone-800' },
                    { label: 'Mənfəət',     value: `${chartProfit.toFixed(2)} ₼`,   icon: TrendingUp,color: chartProfit >= 0 ? 'text-green-600' : 'text-red-500' },
                    { label: 'Mənfəət %',   value: `${chartMarginPct.toFixed(1)}%`, icon: Percent,   color: chartMarginPct >= 0 ? 'text-green-600' : 'text-red-500' },
                    { label: 'Orta çek',    value: `${chartAvg.toFixed(2)} ₼`,      icon: Receipt,   color: 'text-stone-800' },
                    { label: 'Sifarişlər',  value: String(chartPaid.length),         icon: Coffee,    color: 'text-stone-800' },
                  ].map((kpi, i, arr) => {
                    const Icon = kpi.icon;
                    return (
                      <div key={kpi.label} className={`flex-1 min-w-[100px] px-4 py-3 ${i < arr.length - 1 ? 'border-r border-stone-100' : ''}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className="w-3.5 h-3.5 text-stone-500" />
                          <p className="text-xs font-semibold text-stone-600 whitespace-nowrap">{kpi.label}</p>
                        </div>
                        <p className={`font-bold text-base whitespace-nowrap ${kpi.color}`}>{kpi.value}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Payment + Category */}
              <div className="grid md:grid-cols-2 gap-5">
                <div className="bg-white rounded-xl border border-stone-100 card p-5">
                  <h3 className="font-semibold text-stone-800 text-sm mb-4">Ödəniş üsulları</h3>
                  {totalPayRev === 0 ? (
                    <p className="text-sm text-stone-400 text-center py-4">Məlumat yoxdur</p>
                  ) : (
                    <div className="space-y-3">
                      {[{ label: 'Nağd', rev: cashRev }, { label: 'Kart', rev: cardRev }].map(pm => {
                        const pct = totalPayRev > 0 ? (pm.rev / totalPayRev) * 100 : 0;
                        return (
                          <div key={pm.label}>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-sm text-stone-600">{pm.label}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-stone-500">{pct.toFixed(0)}%</span>
                                <span className="font-semibold text-stone-800 text-sm">{pm.rev.toFixed(2)} ₼</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                              <div className="h-full bg-primary-700 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-stone-100 card p-5">
                  <h3 className="font-semibold text-stone-800 text-sm mb-4">Kateqoriya mənfəəti</h3>
                  {repCategories.length === 0 ? (
                    <p className="text-sm text-stone-400 text-center py-4">Məlumat yoxdur</p>
                  ) : (
                    <div className="space-y-3">
                      {repCategories.slice(0, 5).map(({ cat, rev, profit }) => {
                        const margin = rev > 0 ? Math.round((profit / rev) * 100) : 0;
                        return (
                          <div key={cat}>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-sm text-stone-600 truncate flex-1 mr-3">{cat}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-stone-500">{margin}%</span>
                                <span className={`font-semibold text-sm ${profit >= 0 ? 'text-stone-800' : 'text-red-500'}`}>{profit.toFixed(2)} ₼</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
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
                <div className="bg-white rounded-xl border border-stone-100 card p-5">
                  <h3 className="font-semibold text-stone-800 text-sm mb-4">Gün saatlarına görə</h3>
                  <div className="flex items-end gap-0.5 h-36 pt-6">
                    {hourlyData.map((d, i) => {
                      const isPeak = d.rev > 0 && d.rev === maxHourly;
                      return (
                        <div key={i}
                          className={`relative flex-1 rounded-t-sm transition-colors cursor-default ${isPeak ? 'bg-primary-800' : 'bg-primary-600 hover:bg-primary-700'}`}
                          style={{ height: `${Math.max((d.rev / maxHourly) * 100, d.rev > 0 ? 3 : 0)}%`, opacity: d.rev > 0 ? 1 : 0.12 }}
                          title={`${i}:00 — ${d.rev.toFixed(2)} ₼`}
                        >
                          {isPeak && (
                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-primary-800 font-bold whitespace-nowrap">
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
                        {i % 2 === 0 && <span className="text-[9px] text-stone-400">{i}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-stone-100 card p-5">
                  <h3 className="font-semibold text-stone-800 text-sm mb-4">Həftənin günlərinə görə</h3>
                  <div className="flex items-end gap-2 h-36 pt-6">
                    {weeklyData.map(d => {
                      const isPeak = d.rev > 0 && d.rev === maxWeekly;
                      return (
                        <div key={d.label}
                          className={`relative flex-1 rounded-t-sm transition-colors cursor-default ${isPeak ? 'bg-primary-800' : 'bg-primary-600 hover:bg-primary-700'}`}
                          style={{ height: `${Math.max((d.rev / maxWeekly) * 100, d.rev > 0 ? 3 : 0)}%`, opacity: d.rev > 0 ? 1 : 0.12 }}
                          title={`${d.label} — ${d.rev.toFixed(2)} ₼`}
                        >
                          {d.rev > 0 && (
                            <span className={`absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold whitespace-nowrap ${isPeak ? 'text-primary-800' : 'text-stone-600'}`}>
                              {d.rev >= 1000 ? `${(d.rev / 1000).toFixed(1)}k` : `${d.rev.toFixed(0)}₼`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex mt-1.5">
                    {weeklyData.map(d => (
                      <span key={d.label} className="flex-1 text-center text-xs text-stone-500">{d.label}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Top items */}
              {topItems.length > 0 && (
                <div className="bg-white rounded-xl border border-stone-100 card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Star className="w-4 h-4 text-primary-700" />
                      <h3 className="font-semibold text-stone-800 text-sm">Top məhsullar</h3>
                    </div>
                    <div className="flex gap-0.5 bg-stone-100 rounded-lg p-0.5">
                      {([['rev','Gəlir'],['profit','Mənfəət'],['qty','Ədəd'],['margin','Marja']] as const).map(([v, l]) => (
                        <button key={v} onClick={() => setTopSort(v)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${topSort === v ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500 hover:text-stone-600'}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    {topItems.map((item, idx) => {
                      const margin = item.cost > 0 ? Math.round((1 - item.cost / item.rev) * 100) : null;
                      const profit = item.rev - item.cost;
                      const metricVal = topMetricVal(item);
                      return (
                        <div key={`${item.name}-${idx}`}>
                          <div className="flex justify-between items-center mb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] font-bold text-stone-200 w-4 shrink-0">#{idx + 1}</span>
                              <span className="text-sm text-stone-700 truncate">{item.name}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3">
                              {topSort === 'margin' && margin !== null && (
                                <span className="text-sm font-bold text-green-500">{margin}%</span>
                              )}
                              {topSort === 'profit' && (
                                <span className="text-sm font-bold text-green-600">{profit.toFixed(2)} ₼</span>
                              )}
                              {topSort === 'qty' && (
                                <span className="text-sm font-bold text-primary-700">{item.qty} ədəd</span>
                              )}
                              {topSort === 'rev' && (
                                <span className="font-semibold text-stone-800 text-sm">{item.rev.toFixed(2)} ₼</span>
                              )}
                              <span className="text-xs text-stone-400">
                                {topSort !== 'qty' && `${item.qty} ədəd`}
                                {topSort !== 'rev' && topSort !== 'qty' && ` · ${item.rev.toFixed(2)} ₼`}
                              </span>
                            </div>
                          </div>
                          <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary-700 rounded-full transition-all" style={{ width: `${(metricVal / maxItemMetric) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Seller stats */}
              <div className="grid md:grid-cols-2 gap-5">
                <div className="bg-white rounded-xl border border-stone-100 card p-5">
                  <h3 className="font-semibold text-stone-800 text-sm mb-4">Satıcı statistikası</h3>
                  {sellerStats.length === 0 ? (
                    <p className="text-sm text-stone-400 text-center py-4">Məlumat yoxdur</p>
                  ) : (
                    <div className="space-y-3">
                      {sellerStats.map((s, i) => (
                        <div key={`${s.name}-${i}`} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-primary-900 text-xs font-bold shrink-0">
                              {s.name[0]?.toUpperCase()}
                            </div>
                            <span className="text-sm text-stone-700 truncate">{s.name}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-sm">
                            <span className="text-stone-500">{s.orders} sif.</span>
                            <span className="font-semibold text-stone-800">{s.rev.toFixed(2)} ₼</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {paidOrders.length === 0 && (
                <div className="text-center py-16 text-stone-500">
                  <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Hələlik heç bir ödəniş yoxdur</p>
                </div>
              )}
              </>)}
            </div>
          )}

          {/* ── ORDERS ─────────────────────────────────────────────────── */}
          {tab === 'orders' && (
            <div className="max-w-3xl space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-stone-500">
                  {rangeOrders
                    ? `${rangeOrders.length} sifariş · seçilmiş tarix`
                    : totalOrders > orders.length ? `${totalOrders} sifariş · son ${orders.length}` : `${orders.length} sifariş`} · {activeOrders.length} aktiv
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => exportOrdersExcel(visibleOrders, bizSettings.timezone)}
                    title="Excel-ə ixrac et"
                    className="flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 px-3 py-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    İxrac
                  </button>
                  <button
                    onClick={refresh}
                    disabled={refreshing}
                    className="flex items-center gap-1.5 text-xs font-medium text-primary-800 hover:text-primary-950 px-3 py-1.5 rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-60"
                  >
                    {refreshing && <span className="w-3 h-3 border-2 border-primary-200 border-t-primary-800 rounded-full animate-spin" />}
                    Yenilə
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(['all', 'bugün', 'bu həftə'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => { setOrdersPreset(p); setOrdersFrom(''); setOrdersTo(''); }}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${!rangeOrders && ordersPreset === p ? 'bg-primary-800 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'}`}
                  >
                    {p === 'all' ? 'Hamısı' : p === 'bugün' ? 'Bugün' : 'Bu həftə'}
                  </button>
                ))}

                <div className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 ${rangeOrders ? 'bg-primary-50 border-primary-300' : 'bg-white border-stone-200'}`}>
                  <input
                    type="date"
                    value={ordersFrom}
                    max={ordersTo || undefined}
                    onChange={e => setOrdersFrom(e.target.value)}
                    className="text-xs font-medium text-stone-700 bg-transparent border-none outline-none w-[118px]"
                  />
                  <span className="text-stone-400 text-xs">—</span>
                  <input
                    type="date"
                    value={ordersTo}
                    min={ordersFrom || undefined}
                    onChange={e => setOrdersTo(e.target.value)}
                    className="text-xs font-medium text-stone-700 bg-transparent border-none outline-none w-[118px]"
                  />
                </div>

                {(ordersFrom || ordersTo) && (
                  <button
                    onClick={() => { setOrdersFrom(''); setOrdersTo(''); }}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
                  >
                    Tarixi sıfırla
                  </button>
                )}

                {rangeLoading && <span className="w-3.5 h-3.5 border-2 border-primary-200 border-t-primary-800 rounded-full animate-spin" />}
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={orderSearch}
                  onChange={e => setOrderSearch(e.target.value)}
                  placeholder="Sifariş № və ya satıcı adı ilə axtar"
                  className="w-full bg-white border border-stone-200 rounded-xl pl-9 pr-3 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-primary-300"
                />
              </div>

              {ordersDateFiltered.length === 0 && (
                <div className="bg-white rounded-xl border border-stone-100 card p-16 text-center">
                  <Coffee className="w-10 h-10 mx-auto mb-3 text-stone-200" />
                  <p className="text-sm text-stone-500">{rangeOrders ? 'Seçilmiş tarixdə sifariş yoxdur' : 'Sifariş yoxdur'}</p>
                </div>
              )}

              {ordersDateFiltered.length > 0 && visibleOrders.length === 0 && (
                <div className="bg-white rounded-xl border border-stone-100 card p-10 text-center">
                  <p className="text-sm text-stone-500">Axtarışa uyğun sifariş tapılmadı ({ordersDateFiltered.length} sifariş arasında)</p>
                </div>
              )}

              <div className="bg-white rounded-xl border border-stone-100 card overflow-hidden">
                {visibleOrders.map((order, i) => {
                  const isExpanded = expandedOrderId === order.id;
                  const closedAt = orderClosedAt(order);
                  return (
                    <div key={order.id} className={i < visibleOrders.length - 1 ? 'border-b border-stone-50' : ''}>
                      {/* Row */}
                      <button
                        onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                      >
                        <ChevronDown className={`w-4 h-4 text-stone-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        <span className="w-14 text-xs font-bold text-primary-900 flex-shrink-0">#{order.orderNumber}</span>
                        <span className="flex-1 text-sm text-stone-700 truncate">{order.sellerName}</span>
                        <span className="text-xs text-stone-500 flex-shrink-0 hidden sm:block">
                          {new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: bizSettings.timezone })},{' '}
                          {new Date(order.createdAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })}
                          {' → '}
                          {closedAt
                            ? new Date(closedAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })
                            : '—'}
                        </span>
                        <span className="text-sm font-semibold text-stone-800 flex-shrink-0 text-right">
                          {(order.discountAmount ?? 0) > 0
                            ? <><span className="text-xs text-stone-400 line-through mr-1">{(orderTotal(order) + order.discountAmount!).toFixed(2)}</span>{orderTotal(order).toFixed(2)}</>
                            : orderTotal(order).toFixed(2)
                          } ₼
                        </span>
                        {(order.discountAmount ?? 0) > 0 && (
                          <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-1.5 py-0.5 flex-shrink-0 hidden sm:inline">
                            🏷️ -{order.discountAmount!.toFixed(2)} ₼
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 text-center ${STATUS_COLORS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
                      </button>

                      {/* Expanded items */}
                      {isExpanded && (
                        <div className="px-4 pb-4 bg-stone-50 border-t border-stone-100">
                          <div className="pt-3 mb-3">
                            <div className="hidden sm:grid grid-cols-[1fr_80px_80px] gap-2 text-xs font-medium text-stone-500 uppercase tracking-wide pb-1 border-b border-stone-200 mb-2">
                              <span>Məhsul</span><span className="text-right">Say</span><span className="text-right">Cəmi</span>
                            </div>
                            <OrderItemHistory order={order} tz={bizSettings.timezone} />
                          </div>
                          {order.note && <p className="text-xs text-stone-500 italic mb-3">Qeyd: {order.note}</p>}
                          {order.status === 'ləğv edildi' && (
                            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
                              Ödənişsiz bağlandı{order.cancelledBy ? ` — ${order.cancelledBy}` : ''}
                              {order.cancelledAt ? `, ${new Date(order.cancelledAt).toLocaleString('az-AZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })}` : ''}
                              {order.cancelReason ? ` · Səbəb: ${order.cancelReason}` : ''}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-200">
                            <div className="flex items-center gap-2">
                              {isOrderOpen(order) && (
                                <select
                                  value={order.status}
                                  onChange={e => handleStatusChange(order.id, e.target.value as OrderStatus)}
                                  className="text-xs border border-stone-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white"
                                >
                                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              )}
                              {isOrderOpen(order) && (
                                <button
                                  onClick={() => { setCancellingOrder(order); setCancelReason(null); setCancelOtherText(''); }}
                                  className="text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-2.5 py-1 transition-colors"
                                >
                                  Ödənişsiz bağla
                                </button>
                              )}
                              {order.status === 'ödənilib' && (
                                <button
                                  onClick={() => {
                                    setEditingPaymentOrder(order);
                                    setEditPaymentCash((order.cashAmount ?? 0).toFixed(2));
                                    setEditPaymentCard((order.cardAmount ?? 0).toFixed(2));
                                  }}
                                  className="text-xs font-semibold text-blue-500 border border-blue-200 hover:bg-blue-50 rounded-lg px-2.5 py-1 transition-colors"
                                >
                                  Düzəlt
                                </button>
                              )}
                              {order.status === 'ödənilib' && printerConnected && (
                                <button
                                  onClick={async () => {
                                    const ok = await printReceipt(order, companyName);
                                    if (!ok) setPrinterError('Çap alınmadı — yazıcı bağlantısını yoxlayın');
                                  }}
                                  className="text-xs font-semibold text-emerald-600 border border-emerald-200 hover:bg-emerald-50 rounded-lg px-2.5 py-1 transition-colors flex items-center gap-1"
                                >
                                  <Printer className="w-3 h-3" />Çap et
                                </button>
                              )}
                              {order.status !== 'silinib' && (
                                <button
                                  onClick={() => setDialog({ title: 'Sifarişi sil?', message: <>№{order.orderNumber} silinib statusuna keçəcək. Bərpa edə bilərsiniz.</>, onConfirm: async () => {
                                    const ok = await deleteOrder(order.id);
                                    if (ok) patchOrder(order.id, o => ({ ...o, status: 'silinib' as OrderStatus }));
                                  }})}
                                  className="text-xs font-semibold text-red-400 border border-red-200 hover:bg-red-50 rounded-lg px-2.5 py-1 transition-colors"
                                >
                                  Sil
                                </button>
                              )}
                              {order.status === 'silinib' && (
                                <button
                                  onClick={async () => {
                                    const prev = (order.cashAmount || order.cardAmount) ? 'ödənilib' : 'ləğv edildi';
                                    const ok = await restoreOrder(order.id, prev);
                                    if (ok) patchOrder(order.id, o => ({ ...o, status: prev as OrderStatus }));
                                  }}
                                  className="text-xs font-semibold text-green-600 border border-green-200 hover:bg-green-50 rounded-lg px-2.5 py-1 transition-colors"
                                >
                                  Bərpa et
                                </button>
                              )}
                              {(order.cashAmount || order.cardAmount) && (
                                <span className="text-xs text-stone-500">
                                  {[order.cashAmount ? `💵 ${order.cashAmount.toFixed(2)}` : '', order.cardAmount ? `💳 ${order.cardAmount.toFixed(2)}` : ''].filter(Boolean).join(' · ')}
                                </span>
                              )}
                              {(order.changeAmount ?? 0) > 0 && (
                                <span className="text-xs text-stone-500">
                                  💸 {((order.cashAmount ?? 0) + order.changeAmount!).toFixed(2)} alındı · {order.changeAmount!.toFixed(2)} qaytarıldı
                                </span>
                              )}
                            </div>
                            <span className="font-bold text-primary-900">{orderTotal(order).toFixed(2)} ₼</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {!orderQuery && !rangeOrders && orders.length < totalOrders && (
                <button
                  onClick={loadMoreOrders}
                  disabled={loadingMore}
                  className="w-full flex items-center justify-center gap-2 bg-white border border-stone-200 rounded-xl py-2.5 text-sm font-medium text-primary-800 hover:bg-primary-50 transition-colors disabled:opacity-60"
                >
                  {loadingMore && <span className="w-3.5 h-3.5 border-2 border-primary-200 border-t-primary-800 rounded-full animate-spin" />}
                  Daha çox göstər ({totalOrders - orders.length} qalıb)
                </button>
              )}
            </div>
          )}

          {/* ── KASSA ──────────────────────────────────────────────────── */}
          {tab === 'kassa' && (
            <div className="max-w-3xl space-y-4">
              {/* Kassa enable/disable toggle */}
              <div className="bg-white rounded-xl border border-stone-100 card p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-stone-800">Kassa</p>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {kassaOn ? 'Satıcılar növbə aça və bağlaya bilər' : 'Deaktivdir — satıcılar kassa tabını görə bilməz'}
                  </p>
                  {kassaToggleError && <p className="text-xs text-red-500 mt-1 font-semibold">{kassaToggleError}</p>}
                </div>
                <button
                  onClick={async () => {
                    const next = !kassaOn;
                    setKassaToggleBusy(true);
                    setKassaToggleError(null);
                    const result = await setKassaEnabled(next);
                    if (result.error) {
                      setKassaToggleError(result.error);
                    } else {
                      setKassaOn(next);
                    }
                    setKassaToggleBusy(false);
                  }}
                  disabled={kassaToggleBusy}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${kassaOn ? 'bg-primary-800' : 'bg-stone-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${kassaOn ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {shiftsLoading ? (
                <div className="flex justify-center py-16">
                  <span className="w-7 h-7 border-2 border-stone-200 border-t-[#92400e] rounded-full animate-spin" />
                </div>
              ) : (() => {
                const open = shifts.find(s => !s.closedAt);
                const movTotal = (s: CashShift) => s.movements.reduce((t, m) => t + m.amount, 0);
                const expected = open ? open.openingCash + openShiftSales.cash + movTotal(open) : 0;
                const closed = shifts.filter(s => s.closedAt);
                return (
                  <>
                    {/* Current shift */}
                    {open ? (
                      <div className="bg-white rounded-xl border border-green-200 card p-5 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-stone-800 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Açıq növbə
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-stone-500">
                              {new Date(open.openedAt).toLocaleString('az-AZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })} · {open.openedBy}
                            </span>
                            <button
                              onClick={refreshKassa}
                              className="text-xs font-semibold text-stone-600 hover:text-stone-700 border border-stone-200 rounded-lg px-2 py-1 flex items-center gap-1 transition-colors"
                            >
                              <RotateCcw className="w-3 h-3" /> Yenilə
                            </button>
                          </div>
                        </div>
                        <div className="flex justify-between text-sm text-stone-600">
                          <span>Başlanğıc məbləğ</span><span className="font-semibold">{open.openingCash.toFixed(2)} ₼</span>
                        </div>
                        <div className="flex justify-between text-sm text-stone-600">
                          <span>Nağd satış</span><span className="font-semibold">{openShiftSales.cash.toFixed(2)} ₼</span>
                        </div>
                        {movTotal(open) !== 0 && (
                          <div className="flex justify-between text-sm text-stone-600">
                            <span>Mədaxil / məxaric</span>
                            <span className={`font-semibold ${movTotal(open) < 0 ? 'text-red-500' : 'text-green-600'}`}>
                              {movTotal(open) > 0 ? '+' : ''}{movTotal(open).toFixed(2)} ₼
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center border-t pt-2.5 font-bold">
                          <span>Kassada olmalıdır</span><span className="text-primary-800 text-lg">{expected.toFixed(2)} ₼</span>
                        </div>
                        <div className="flex justify-between items-center border-t pt-2.5 font-bold">
                          <span>💳 Terminal (kart satışı)</span><span className="text-primary-800">{openShiftSales.card.toFixed(2)} ₼</span>
                        </div>
                        <p className="text-xs text-stone-500 -mt-1.5">Kassaya daxil deyil — bank terminalından keçir</p>
                        {open.movements.length > 0 && (
                          <ul className="border-t pt-2.5 space-y-1">
                            {open.movements.map((m, i) => (
                              <li key={i} className="flex justify-between text-xs text-stone-600">
                                <span className="truncate mr-3">{m.reason} · {m.by}</span>
                                <span className={`font-semibold shrink-0 ${m.amount < 0 ? 'text-red-500' : 'text-green-600'}`}>
                                  {m.amount > 0 ? '+' : ''}{m.amount.toFixed(2)} ₼
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {activeOrders.length > 0 && (
                          <p className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                            {activeOrders.length} açıq sifariş var — növbəni bağlamaq üçün əvvəlcə sifarişləri tamamlayın.
                          </p>
                        )}
                        <div className="border-t pt-3 flex gap-2">
                          <input
                            type="number" min="0" step="0.01" placeholder="Sayılan nağd (₼)"
                            value={adminCountedInput}
                            onChange={e => setAdminCountedInput(e.target.value)}
                            className="flex-1 min-w-0 border border-stone-200 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-700"
                          />
                          <input
                            type="number" min="0" step="0.01" placeholder="Terminal (₼)"
                            value={adminTerminalInput}
                            onChange={e => setAdminTerminalInput(e.target.value)}
                            className="flex-1 min-w-0 border border-stone-200 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-700"
                          />
                          <button
                            onClick={() => handleAdminCloseShift(open)}
                            disabled={closingShift || adminCountedInput === '' || activeOrders.length > 0}
                            className="bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors flex items-center gap-2"
                          >
                            {closingShift && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                            Bağla
                          </button>
                        </div>
                        {adminCountedInput !== '' && (
                          <p className={`text-xs font-semibold text-right ${
                            Math.abs((parseFloat(adminCountedInput) || 0) - expected) < 0.005 ? 'text-green-600'
                            : (parseFloat(adminCountedInput) || 0) < expected ? 'text-red-500' : 'text-primary-600'
                          }`}>
                            Nağd fərq: {((parseFloat(adminCountedInput) || 0) - expected).toFixed(2)} ₼
                          </p>
                        )}
                        {adminTerminalInput !== '' && (
                          <p className={`text-xs font-semibold text-right ${
                            Math.abs((parseFloat(adminTerminalInput) || 0) - openShiftSales.card) < 0.005 ? 'text-green-600'
                            : (parseFloat(adminTerminalInput) || 0) < openShiftSales.card ? 'text-red-500' : 'text-primary-600'
                          }`}>
                            Terminal fərq: {((parseFloat(adminTerminalInput) || 0) - openShiftSales.card).toFixed(2)} ₼
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="bg-white rounded-xl border border-stone-100 card p-8 text-center">
                        <Wallet className="w-8 h-8 mx-auto mb-2 text-stone-200" />
                        <p className="text-sm text-stone-500">Hazırda açıq növbə yoxdur — satıcı işə başlayanda açır</p>
                      </div>
                    )}

                    {/* History */}
                    {closed.length > 0 && (
                      <div className="bg-white rounded-xl border border-stone-100 card overflow-hidden">
                        <div className="px-4 py-3 border-b border-stone-50 text-xs font-semibold text-stone-500 uppercase tracking-wide">Bağlanmış növbələr</div>
                        {closed.map((s, i) => {
                          const diff = (s.countedCash ?? 0) - (s.expectedCash ?? 0);
                          const isExp = expandedShiftId === s.id;
                          return (
                            <div key={s.id} className={i < closed.length - 1 ? 'border-b border-stone-50' : ''}>
                              <button
                                onClick={() => setExpandedShiftId(isExp ? null : s.id)}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                              >
                                <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                                <span className="text-sm text-stone-700 flex-1 truncate">
                                  {new Date(s.openedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: bizSettings.timezone })}
                                  <span className="text-xs text-stone-500 ml-2">
                                    {new Date(s.openedAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone })}
                                    –{s.closedAt ? new Date(s.closedAt).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', timeZone: bizSettings.timezone }) : ''}
                                  </span>
                                </span>
                                <span className="text-sm font-semibold text-stone-700 shrink-0">{(s.countedCash ?? 0).toFixed(2)} ₼</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 w-20 text-center ${
                                  Math.abs(diff) < 0.005 ? 'bg-green-50 text-green-600'
                                  : diff < 0 ? 'bg-red-50 text-red-600' : 'bg-primary-50 text-primary-700'
                                }`}>
                                  {Math.abs(diff) < 0.005 ? 'Dəqiq ✓' : `${diff > 0 ? '+' : ''}${diff.toFixed(2)} ₼`}
                                </span>
                              </button>
                              {isExp && (
                                <div className="px-11 pb-4 text-sm text-stone-600 space-y-1.5 bg-stone-50 pt-3 border-t border-stone-100">
                                  <div className="flex justify-between"><span>Açdı / bağladı</span><span>{s.openedBy} / {s.closedBy}</span></div>
                                  <div className="flex justify-between"><span>Başlanğıc</span><span>{s.openingCash.toFixed(2)} ₼</span></div>
                                  <div className="flex justify-between"><span>Olmalı idi</span><span>{(s.expectedCash ?? 0).toFixed(2)} ₼</span></div>
                                  <div className="flex justify-between"><span>Sayıldı</span><span>{(s.countedCash ?? 0).toFixed(2)} ₼</span></div>
                                  {s.cardSales !== undefined && (
                                    <div className="flex justify-between"><span>💳 Kart satışı</span><span>{s.cardSales.toFixed(2)} ₼</span></div>
                                  )}
                                  {s.countedCard !== undefined && (
                                    <div className="flex justify-between">
                                      <span>💳 Terminal (Z-hesabat)</span>
                                      <span className={
                                        Math.abs(s.countedCard - (s.cardSales ?? 0)) < 0.005 ? 'text-green-600'
                                        : s.countedCard < (s.cardSales ?? 0) ? 'text-red-500' : 'text-primary-600'
                                      }>{s.countedCard.toFixed(2)} ₼</span>
                                    </div>
                                  )}
                                  {s.movements.length > 0 && (
                                    <ul className="pt-1.5 border-t border-stone-200 space-y-1">
                                      {s.movements.map((m, j) => (
                                        <li key={j} className="flex justify-between text-xs text-stone-600">
                                          <span className="truncate mr-3">{m.reason} · {m.by}</span>
                                          <span className={m.amount < 0 ? 'text-red-500' : 'text-green-600'}>
                                            {m.amount > 0 ? '+' : ''}{m.amount.toFixed(2)} ₼
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* ── MENU ───────────────────────────────────────────────────── */}
          {tab === 'menu' && (
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 mb-5">
                {([['items', 'Məhsullar'], ['stations', 'Sexlər']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setMenuView(val)}
                    className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${menuView === val ? 'bg-primary-700 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {menuView === 'stations' && (
                <StationsPanel
                  stations={stations}
                  setStations={setStations}
                  menu={menu}
                  reloadMenu={async () => setMenu(await fetchMenu())}
                  setDialog={setDialog}
                />
              )}

              {menuView === 'items' && (<>
              <div className="flex items-center justify-between mb-5">
                <p className="text-sm font-semibold text-stone-600">{menu.filter(m => categories.some(c => c.name === m.category)).length} məhsul</p>
                <div className="flex items-center gap-2">
                  <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
                  <button onClick={() => importFileRef.current?.click()} title="Excel-dən idxal et" className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-600 px-3 py-2 rounded-lg hover:bg-stone-100 transition-colors">
                    <Download className="w-4 h-4" /> <span className="hidden sm:inline">İdxal</span>
                  </button>
                  <button onClick={() => exportMenuExcel(menu, categories)} title="Excel-ə ixrac et" className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-600 px-3 py-2 rounded-lg hover:bg-stone-100 transition-colors">
                    <Upload className="w-4 h-4" /> <span className="hidden sm:inline">İxrac</span>
                  </button>
                  <button onClick={() => setShowTrash(true)} className="relative flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-600 px-3 py-2 rounded-lg hover:bg-stone-100 transition-colors">
                    <Trash2 className="w-4 h-4" />
                    {trash.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{trash.length}</span>}
                  </button>
                  <button onClick={() => { setNewCat(''); setShowCatDialog(true); }} className="flex items-center gap-2 bg-primary-800 hover:bg-primary-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm">
                    <Plus className="w-4 h-4" /> Kateqoriya əlavə et
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                {([['all', 'Hamısı'], ['meal', 'Yeməklər'], ['product', 'Məhsullar']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setKindFilter(val)}
                    className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${kindFilter === val ? 'bg-primary-700 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative mb-5">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={menuSearch}
                  onChange={e => setMenuSearch(e.target.value)}
                  placeholder="Məhsul adı ilə axtar"
                  className="w-full bg-white border border-stone-200 rounded-xl pl-9 pr-9 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-primary-300"
                />
                {menuSearch && (
                  <button onClick={() => setMenuSearch('')} title="Axtarışı təmizlə" className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <DndContext sensors={dndSensors} collisionDetection={menuCollision} onDragEnd={handleMenuDragEnd}>
              <SortableContext items={categories.map(c => `cat:${c.name}`)} strategy={verticalListSortingStrategy}>
              {categories.map(({ name: cat, available: catAvailable }) => {
                const allItems = menu.filter(m => m.category === cat);
                const items = allItems.filter(m =>
                  (kindFilter === 'all' || (m.kind ?? 'product') === kindFilter) &&
                  (!menuQuery || azNormalize(m.name).includes(menuQuery)));
                if ((menuQuery || kindFilter !== 'all') && items.length === 0) return null;
                const isCollapsed = !menuQuery && kindFilter === 'all' && collapsedCats.has(cat);
                return (
                  <SortableRow key={cat} id={`cat:${cat}`} className="mb-5">
                  {catHandle => (<>
                    <CategoryDropTarget cat={cat}>
                    <div className="flex items-center gap-2 mb-2 px-1 group">
                      <button
                        title="Sürüklə"
                        className="cursor-grab active:cursor-grabbing touch-none text-stone-400 hover:text-stone-600 p-0.5 shrink-0"
                        {...catHandle.attributes} {...catHandle.listeners}
                      >
                        <GripVertical className="w-4 h-4" />
                      </button>
                      <button onClick={() => toggleCatCollapsed(cat)} className="flex items-center gap-2 min-w-0 group/toggle py-1">
                        <ChevronDown className={`w-4 h-4 text-stone-500 group-hover/toggle:text-stone-600 transition-transform shrink-0 ${isCollapsed ? '-rotate-90' : ''}`} />
                        <p className="text-sm font-bold text-stone-700 group-hover/toggle:text-stone-900 uppercase tracking-wide truncate transition-colors">{cat}</p>
                        <span className="text-xs font-semibold text-stone-500 bg-stone-100 rounded-full px-1.5 py-0.5">{items.length}</span>
                      </button>
                      {!catAvailable && <span className="text-xs bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded font-medium">Gizli</span>}
                      <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => toggleCategoryAvailable(cat)} title={catAvailable ? 'Kateqoriyanı satışda gizlət — satıcı və QR menyuda görünməyəcək' : 'Kateqoriyanı yenidən satışa aç'} className={`text-xs px-2 py-0.5 rounded-lg font-medium transition-colors ${catAvailable ? 'text-stone-500 hover:bg-stone-100' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                          {catAvailable ? 'Gizlət' : 'Aç'}
                        </button>
                        <button onClick={() => { setEditCatTarget(cat); setEditCatValue(cat); }} title="Kateqoriyanın adını dəyiş" className="text-xs text-primary-600 hover:text-primary-800 px-2 py-0.5 rounded-lg hover:bg-primary-50 transition-colors font-medium">Adını dəyiş</button>
                        <button onClick={() => setDialog({ title: 'Kateqoriyanı sil?', message: <><span className="font-medium text-stone-700">&ldquo;{cat}&rdquo;</span> silinəcək. Bu əməliyyat geri qaytarıla bilməz.</>, onConfirm: () => deleteCategory(cat) })} title="Kateqoriyanı və içindəki məhsulları sil (zibil qutusuna gedir)" className="text-xs text-red-400 hover:text-red-600 px-2 py-0.5 rounded-lg hover:bg-red-50 transition-colors font-medium">Sil</button>
                      </div>
                    </div>
                    </CategoryDropTarget>
                    {!isCollapsed && (
                    <div className="bg-white rounded-xl border border-stone-100 card overflow-hidden">
                      {items.length === 0 && (
                        <p className="px-4 py-3 text-xs text-stone-400">Bu kateqoriyada məhsul yoxdur</p>
                      )}
                      <SortableContext items={items.map(m => `item:${m.id}`)} strategy={verticalListSortingStrategy}>
                      {items.map((item, i) => (
                        <React.Fragment key={item.id}>
                        <SortableRow id={`item:${item.id}`}>
                        {handle => (
                        <div className={`flex items-center gap-3 px-4 py-3 hover:bg-stone-50 transition-colors bg-white ${(i < items.length - 1 && editingId !== item.id) ? 'border-b border-stone-50' : ''}`}>
                          <button
                            title="Sürüklə"
                            className="cursor-grab active:cursor-grabbing touch-none text-stone-400 hover:text-stone-600 shrink-0 p-0.5"
                            {...handle.attributes} {...handle.listeners}
                          >
                            <GripVertical className="w-4 h-4" />
                          </button>
                          {item.image
                            ? <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-stone-100" />
                            : <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center flex-shrink-0"><Coffee className="w-4 h-4 text-stone-400" /></div>
                          }
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.available ? 'bg-green-400' : 'bg-stone-300'}`} />
                              <span className={`text-sm font-medium ${item.available ? 'text-stone-800' : 'text-stone-500 line-through'}`}>{item.name}</span>
                            </div>
                            {item.variants?.length ? (
                              <p className="text-xs text-stone-500 mt-0.5">{item.variants.map(v => `${v.name}: ${v.price.toFixed(2)}₼`).join(' · ')}</p>
                            ) : (
                              <p className="text-xs text-stone-500 mt-0.5">
                                {item.price.toFixed(2)} ₼
                                {item.costPrice ? ` · Maya: ${item.costPrice.toFixed(2)}₼ · Marja: ${Math.round((1 - item.costPrice / item.price) * 100)}%` : ''}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => openEdit(item)} title="Məhsulu düzəlt — qiymət, şəkil, variantlar, maya dəyəri" className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors font-medium">Düzəlt</button>
                            <button onClick={() => duplicateItem(item.id)} title="Məhsulun kopyasını yarat" className="text-xs text-purple-500 hover:text-purple-700 px-2 py-1 rounded-lg hover:bg-purple-50 transition-colors font-medium">Kopyala</button>
                            <button onClick={() => toggleAvailable(item.id)} title={item.available ? 'Satışdan götür — satıcı və QR menyuda görünməyəcək' : 'Yenidən satışa qaytar'} className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${item.available ? 'bg-stone-100 text-stone-600 hover:bg-stone-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                              {item.available ? 'Gizlət' : 'Aç'}
                            </button>
                            <button onClick={() => setDialog({ title: 'Məhsulu sil?', message: <><span className="font-medium text-stone-700">&ldquo;{item.name}&rdquo;</span> silinəcək. Bu əməliyyat geri qaytarıla bilməz.</>, onConfirm: () => deleteItem(item.id) })} title="Məhsulu sil (zibil qutusuna gedir)" className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors font-medium">Sil</button>
                          </div>
                        </div>
                        )}
                        </SortableRow>
                        {editingId === item.id && renderItemForm(`border-t border-primary-100 bg-primary-50 px-5 py-4 space-y-4${i < items.length - 1 ? ' border-b border-stone-50' : ''}`)}
                        </React.Fragment>
                      ))}
                      </SortableContext>
                      {/* Quick add: type name + price, Enter — details via Düzəlt later */}
                      {!menuQuery && (
                      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-stone-100 bg-stone-50/60">
                        <input
                          type="text" placeholder={kindFilter === 'product' ? 'Yeni məhsul adı…' : 'Yeni yemək adı…'}
                          data-quickadd={cat}
                          value={quickAdd.cat === cat ? quickAdd.name : ''}
                          onChange={e => setQuickAdd({ cat, name: e.target.value, price: quickAdd.cat === cat ? quickAdd.price : '' })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLInputElement)?.focus(); }
                          }}
                          className="flex-1 min-w-0 bg-white border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
                        />
                        <input
                          type="number" placeholder="₼" step="0.01" min="0"
                          value={quickAdd.cat === cat ? quickAdd.price : ''}
                          onChange={e => setQuickAdd({ cat, name: quickAdd.cat === cat ? quickAdd.name : '', price: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const nameEl = e.currentTarget.previousElementSibling as HTMLInputElement;
                              submitQuickAdd(cat);
                              nameEl?.focus();
                            }
                          }}
                          className="w-24 bg-white border border-stone-200 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-700"
                        />
                        <button
                          onClick={() => submitQuickAdd(cat)}
                          disabled={!(quickAdd.cat === cat && quickAdd.name.trim() !== '' && quickAdd.price !== '' && parseFloat(quickAdd.price) >= 0)}
                          title="Əlavə et"
                          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-primary-800 hover:bg-primary-900 disabled:opacity-30 text-white transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                      )}
                    </div>
                    )}
                  </>)}
                  </SortableRow>
                );
              })}
              </SortableContext>
              </DndContext>

              {menuQuery !== '' && menuMatchCount === 0 && (
                <div className="bg-white rounded-xl border border-stone-100 card p-16 text-center">
                  <Search className="w-10 h-10 mx-auto mb-3 text-stone-200" />
                  <p className="text-sm text-stone-500">&ldquo;{menuSearch.trim()}&rdquo; üzrə məhsul tapılmadı</p>
                </div>
              )}

              {menu.length === 0 && categories.length === 0 && !showForm && (
                <div className="bg-white rounded-xl border border-stone-100 card p-16 text-center">
                  <Coffee className="w-10 h-10 mx-auto mb-3 text-stone-200" />
                  <p className="text-sm text-stone-500">Məhsul yoxdur</p>
                </div>
              )}
              </>)}

            </div>
          )}

          {/* ── USERS ──────────────────────────────────────────────────── */}
          {tab === 'users' && (
            <div className="max-w-lg space-y-4">

              {/* Seller terminal URL */}
              {companySlug && sellerToken && (() => {
                const terminalUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/s/${companySlug}/${sellerToken}`;
                return (
                  <div className="bg-white rounded-xl border border-stone-100 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Link className="w-4 h-4 text-primary-700" />
                      <p className="text-sm font-semibold text-stone-700">Satıcı terminal linki</p>
                    </div>
                    <p className="text-xs text-stone-500">Bu linki satıcılara verin. Açdıqda yalnız PIN daxil edirlər — başqa şey lazım deyil.</p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={terminalUrl}
                        className="flex-1 text-xs bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-stone-700 font-mono truncate focus:outline-none"
                      />
                      <button
                        onClick={() => { navigator.clipboard.writeText(terminalUrl); setTokenCopied(true); setTimeout(() => setTokenCopied(false), 2000); }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-xs text-stone-600 hover:bg-stone-50 transition-colors shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {tokenCopied ? 'Kopyalandı!' : 'Kopyala'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-xs text-stone-400">Linki dəyişdirmək köhnə linki işdən çıxarır</p>
                      <button
                        disabled={tokenRegenerating}
                        onClick={() => setDialog({
                          title: 'Linki yenilə?',
                          message: 'Köhnə link dərhal işdən çıxacaq. Satıcılar yeni link olmadan daxil ola bilməyəcək.',
                          confirmLabel: 'Yenilə',
                          onConfirm: async () => {
                            setTokenRegenerating(true);
                            try {
                              const { data: { session } } = await supabase.auth.getSession();
                              const r = await fetch('/api/seller-token', {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${session?.access_token}` },
                              });
                              const d = await r.json();
                              if (d.token) setSellerToken(d.token);
                            } finally { setTokenRegenerating(false); }
                          },
                        })}
                        className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${tokenRegenerating ? 'animate-spin' : ''}`} />
                        Linki yenilə
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-600">PIN ilə satıcılar · {pinStaff.length}</p>
                    <p className="text-xs text-stone-400 mt-0.5">Satıcılar yuxarıdakı linkdən daxil olur, özlərini 4 rəqəmli PIN ilə tanıdır</p>
                  </div>
                  <button
                    onClick={() => { setEditingStaff(null); setSName(''); setSPin(''); setSError(''); setShowStaffForm(true); }}
                    className="flex items-center gap-2 bg-primary-800 hover:bg-primary-900 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors shrink-0"
                  >
                    <Plus className="w-4 h-4" /> PIN əməkdaşı
                  </button>
                </div>

                {pinStaff.length === 0 && (
                  <div className="bg-white rounded-xl border border-stone-100 p-10 text-center">
                    <KeyRound className="w-8 h-8 mx-auto mb-3 text-stone-200" />
                    <p className="text-sm text-stone-500">PIN əməkdaşı yoxdur</p>
                    <p className="text-xs text-stone-400 mt-1">Əlavə etdikdən sonra satıcı səhifəsi PIN ekranı ilə açılacaq</p>
                  </div>
                )}

                {pinStaff.map(s => (
                  <div key={s.id} className="bg-white rounded-xl border border-stone-100 px-4 py-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 shrink-0">
                      <KeyRound className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-stone-800">{s.name}</p>
                      <p className="text-xs text-stone-500">PIN: ••••</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.active ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-600'}`}>
                      {s.active ? 'Aktiv' : 'Deaktiv'}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => { setEditingStaff(s); setSName(s.name); setSPin(''); setSError(''); setShowStaffForm(true); }}
                        title="Düzəlt"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-primary-700 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => updateStaff(s.id, s.name, !s.active).then(err => {
                          if (err) setDialog({ title: 'Alınmadı', message: staffErrorText(err) });
                          else setPinStaff(prev => prev.map(x => x.id === s.id ? { ...x, active: !x.active } : x));
                        })}
                        title={s.active ? 'Deaktiv et' : 'Aktiv et'}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
                      >
                        {s.active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => setDialog({
                          title: 'Əməkdaşı sil?',
                          message: <><span className="font-medium text-stone-700">&ldquo;{s.name}&rdquo;</span> silinəcək. Köhnə sifarişlərdə adı qalacaq.</>,
                          onConfirm: () => deleteStaff(s.id).then(err => {
                            if (err) setDialog({ title: 'Silinmədi', message: staffErrorText(err) });
                            else setPinStaff(prev => prev.filter(x => x.id !== s.id));
                          }),
                        })}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {/* ── Sex employees ──────────────────────────────────────────
                    People, so they live here beside the PIN sellers rather than in
                    Sexlər — that tab is about the sex itself: its name, its printer,
                    what it makes. */}
                <div className="flex items-center justify-between gap-3 pt-6 mt-2 border-t border-stone-200">
                  <div>
                    <p className="text-sm font-semibold text-stone-600">Sex əməkdaşları · {employees.length}</p>
                    <p className="text-xs text-stone-400 mt-0.5">Öz hesabı ilə daxil olur, yalnız öz sexinin hazırlayacağı yeməkləri görür</p>
                  </div>
                  <button
                    onClick={() => {
                      setEditingEmp(null);
                      setEName(''); setEUsername(''); setEPassword('');
                      setEStationId(stations[0]?.id ?? '');
                      setEError(''); setShowEmpForm(true);
                    }}
                    disabled={stations.length === 0}
                    title={stations.length === 0 ? 'Əvvəlcə sex əlavə edin' : undefined}
                    className="flex items-center gap-2 bg-primary-800 hover:bg-primary-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors shrink-0"
                  >
                    <Plus className="w-4 h-4" /> Sex əməkdaşı
                  </button>
                </div>

                {stations.length === 0 ? (
                  // Nothing to attach an employee to. Say so rather than offering a
                  // form whose only dropdown would be empty.
                  <div className="bg-white rounded-xl border border-stone-100 p-10 text-center">
                    <ChefHat className="w-8 h-8 mx-auto mb-3 text-stone-200" />
                    <p className="text-sm text-stone-500">Əvvəlcə sex yaradın</p>
                    <p className="text-xs text-stone-400 mt-1">Menyu → Sexlər bölməsindən Mətbəx, Bar və s. əlavə edin</p>
                  </div>
                ) : employees.length === 0 ? (
                  <div className="bg-white rounded-xl border border-stone-100 p-10 text-center">
                    <ChefHat className="w-8 h-8 mx-auto mb-3 text-stone-200" />
                    <p className="text-sm text-stone-500">Sex əməkdaşı yoxdur</p>
                    <p className="text-xs text-stone-400 mt-1">Əlavə etdikdən sonra öz hesabı ilə daxil olub hazırlanacaqları görəcək</p>
                  </div>
                ) : employees.map(e => {
                  const st = stations.find(s => s.id === e.stationId);
                  return (
                    <div key={e.id} className="bg-white rounded-xl border border-stone-100 px-4 py-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 shrink-0">
                        <ChefHat className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-stone-800 truncate">{e.name}</p>
                        <p className="text-xs text-stone-500 truncate">@{e.username}</p>
                      </div>
                      {/* The sex was deleted under them — they can log in but have
                          nothing to prepare, so it can't be left looking normal. */}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st ? 'bg-primary-50 text-primary-800' : 'bg-red-50 text-red-600'}`}>
                        {st?.name ?? 'Sex silinib'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${e.active ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-600'}`}>
                        {e.active ? 'Aktiv' : 'Deaktiv'}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setEditingEmp(e);
                            setEName(e.name); setEUsername(e.username); setEPassword('');
                            setEStationId(e.stationId ?? stations[0]?.id ?? '');
                            setEError(''); setShowEmpForm(true);
                          }}
                          title="Düzəlt"
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-primary-700 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={async () => { await toggleUserActive(e.id, !e.active); reloadEmployees(); }}
                          title={e.active ? 'Deaktiv et' : 'Aktiv et'}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
                        >
                          {e.active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => setDialog({
                            title: 'Əməkdaşı sil?',
                            message: <><span className="font-medium text-stone-700">&ldquo;{e.name}&rdquo;</span> və hesabı silinəcək. Bir daha daxil ola bilməyəcək.</>,
                            onConfirm: async () => {
                              const err = await deleteUser(e.id);
                              if (err) setDialog({ title: 'Silinmədi', message: err });
                              else reloadEmployees();
                            },
                          })}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* ── ANBAR ──────────────────────────────────────────────────── */}
          {tab === 'anbar' && (
            <div className="max-w-3xl">
              <AnbarPanel setDialog={setDialog} />
            </div>
          )}

          {/* ── LOGINS ─────────────────────────────────────────────────── */}
          {tab === 'logins' && (
            <div className="max-w-3xl space-y-4">
              {!loginsLoaded && (
                <div className="bg-white rounded-xl border border-stone-100 p-16 text-center">
                  <p className="text-sm text-stone-500">Yüklənir…</p>
                </div>
              )}

              {loginsLoaded && loginEvents.length === 0 && (
                <div className="bg-white rounded-xl border border-stone-100 p-16 text-center">
                  <Globe className="w-10 h-10 mx-auto mb-3 text-stone-200" />
                  <p className="text-sm text-stone-500">Hələ giriş qeydi yoxdur</p>
                  <p className="text-xs text-stone-400 mt-1">Növbəti girişlərdən etibarən burada görünəcək</p>
                </div>
              )}

              {loginsLoaded && loginEvents.length > 0 && (
                <div className="bg-white rounded-xl border border-stone-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-stone-500 border-b border-stone-100">
                          <th className="px-4 py-3 font-medium">İstifadəçi</th>
                          <th className="px-4 py-3 font-medium">Vaxt</th>
                          <th className="px-4 py-3 font-medium">IP ünvanı</th>
                          <th className="px-4 py-3 font-medium">Cihaz</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loginEvents.map(e => {
                          const d = new Date(e.createdAt);
                          return (
                            <tr key={e.id} className="border-b border-stone-50 last:border-0">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-900 text-xs font-bold shrink-0">
                                    {e.name[0]?.toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-semibold text-stone-800 truncate">{e.name}</p>
                                    <p className="text-xs text-stone-500">{ROLE_LABELS[e.role] ?? e.role}{e.username ? ` · @${e.username}` : ''}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-stone-600 whitespace-nowrap">
                                {d.getDate()} {AZ_MON_SHORT[d.getMonth()]} {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-stone-600 whitespace-nowrap">{e.ip ?? '—'}</td>
                              <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{deviceLabel(e.userAgent)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {loginsLoaded && loginEvents.length > 0 && (
                <p className="text-xs text-stone-400">Eyni Wi-Fi şəbəkəsindəki bütün cihazlar eyni IP ilə görünür. Son 200 giriş göstərilir.</p>
              )}
            </div>
          )}

          {/* ── TABLES ─────────────────────────────────────────────────── */}
          {tab === 'tables' && (
            <div className="max-w-3xl space-y-4">
              {/* ── Brendinq ── */}
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider px-1">Brendinq</p>

              <div className="bg-white rounded-xl border border-stone-100 p-4 space-y-4">
                {/* Logo */}
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl border border-stone-200 bg-stone-50 flex items-center justify-center overflow-hidden shrink-0">
                    {logoUrl
                      ? <img src={logoUrl} alt="" className="w-full h-full object-cover" />
                      : <ImageIcon className="w-6 h-6 text-stone-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-stone-800">Loqo</p>
                    <p className="text-xs text-stone-500">Satıcı, QR menyu və admin panelində görünür</p>
                  </div>
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoBusy}
                      className="px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-semibold text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-60"
                    >
                      {logoBusy ? 'Yüklənir…' : logoUrl ? 'Dəyiş' : 'Yüklə'}
                    </button>
                    {logoUrl && (
                      <button
                        onClick={removeLogo}
                        disabled={logoBusy}
                        className="px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors disabled:opacity-60"
                      >
                        Sil
                      </button>
                    )}
                  </div>
                </div>

                {/* Accent color */}
                <div className="border-t border-stone-100 pt-4">
                  <p className="text-sm font-semibold text-stone-800">Rəng</p>
                  <p className="text-xs text-stone-500 mb-3">Tətbiqin əsas rəngi</p>
                  <div className="flex flex-wrap gap-2.5">
                    {BRAND_PRESETS.map(p => (
                      <button
                        key={p.key}
                        onClick={() => pickBrandColor(p.key)}
                        title={p.label}
                        className={`w-9 h-9 rounded-full transition-transform hover:scale-105 ring-offset-2 ${brandColor === p.key ? 'ring-2 ring-stone-400' : 'ring-1 ring-stone-200'}`}
                        style={{ backgroundColor: p.swatch }}
                      >
                        {brandColor === p.key && <Check className="w-4 h-4 text-white mx-auto" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── QR & Onlayn ── */}
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider px-1 mt-2">QR &amp; Onlayn</p>

              {companySlug && (
                <div className="bg-primary-50 border border-primary-100 rounded-xl px-4 py-3 flex items-center gap-3">
                  <Globe className="w-4 h-4 text-primary-700 shrink-0" />
                  <p className="text-xs text-primary-800 font-medium truncate flex-1">{typeof window !== 'undefined' ? window.location.origin : ''}/{companySlug}/menu</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/${companySlug}/menu`)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-primary-200 text-primary-700 transition-colors shrink-0"
                    title="Kopyala"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={`/${companySlug}/menu`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-primary-200 text-primary-700 transition-colors shrink-0"
                    title="Aç"
                  >
                    <Link className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {tablesOn && (
                <div className="bg-white rounded-xl border border-stone-100 p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-800">QR sifariş</p>
                    <p className="text-xs text-stone-500">
                      {qrOn
                        ? 'Müştərilər QR kod ilə sifariş verə bilir'
                        : 'Deaktivdir — QR kodlar işləmir'}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      const next = !qrOn;
                      setQrToggleBusy(true);
                      setQrOn(next);
                      await setQrEnabled(next);
                      if (next && menuOnly) {
                        setMenuOnlyState(false);
                        await setMenuOnly(false);
                      }
                      setQrToggleBusy(false);
                    }}
                    disabled={qrToggleBusy}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${qrOn ? 'bg-primary-800' : 'bg-stone-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${qrOn ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
              )}

              {tablesOn && (
                <div className="bg-white rounded-xl border border-stone-100 p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-800">Yalnız menyu baxışı</p>
                    <p className="text-xs text-stone-500">
                      {menuOnly
                        ? 'Müştərilər menyuya baxa bilir, sifariş verə bilmir'
                        : 'Deaktivdir — müştərilər sifariş verə bilir'}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      const next = !menuOnly;
                      setMenuOnlyBusy(true);
                      setMenuOnlyState(next);
                      await setMenuOnly(next);
                      if (next && qrOn) {
                        setQrOn(false);
                        await setQrEnabled(false);
                      }
                      setMenuOnlyBusy(false);
                    }}
                    disabled={menuOnlyBusy}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${menuOnly ? 'bg-primary-800' : 'bg-stone-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${menuOnly ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
              )}

              {/* ── Masalar ── */}
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider px-1 mt-2">Masalar</p>

              <div className="bg-white rounded-xl border border-stone-100 px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-800">Masa rejimi</p>
                  <p className="text-xs text-stone-500">
                    {tablesOn
                      ? 'Satıcılar sifariş üçün masa seçir'
                      : 'Deaktivdir — satıcılar masa seçmədən birbaşa məhsul seçir'}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const next = !tablesOn;
                    setTablesToggleBusy(true);
                    setTablesOn(next);
                    await setTablesEnabled(next);
                    setTablesToggleBusy(false);
                  }}
                  disabled={tablesToggleBusy}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${tablesOn ? 'bg-primary-800' : 'bg-stone-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${tablesOn ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {!tablesOn && (
                <div className="bg-white rounded-xl border border-stone-100 p-12 text-center">
                  <LayoutDashboard className="w-10 h-10 mx-auto mb-3 text-stone-200" />
                  <p className="text-sm text-stone-500">Masalar deaktivdir. Satıcı panelində sifarişlər masa seçilmədən yaradılır.</p>
                </div>
              )}

              {tablesOn && (<>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-stone-600">{tables.length} masa</p>
                  <div className="flex bg-stone-100 rounded-lg p-0.5 gap-0.5">
                    <button onClick={() => setTableView('floor')} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tableView === 'floor' ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500 hover:text-stone-600'}`}>Plan</button>
                    <button onClick={() => setTableView('list')} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tableView === 'list' ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500 hover:text-stone-600'}`}>Siyahı</button>
                  </div>
                </div>
                <button
                  onClick={() => { setEditingTable(null); setTName(''); setTCapacity('4'); setTShape('rect'); setShowTableForm(true); }}
                  className="flex items-center gap-2 bg-primary-800 hover:bg-primary-900 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" /> Masa əlavə et
                </button>
              </div>

              {tables.length === 0 && (
                <div className="bg-white rounded-xl border border-stone-100 p-16 text-center">
                  <LayoutDashboard className="w-10 h-10 mx-auto mb-3 text-stone-200" />
                  <p className="text-sm text-stone-500">Masa yoxdur</p>
                </div>
              )}

              {/* Floor plan / canvas view */}
              {tableView === 'floor' && tables.length > 0 && (
                <div className="bg-white rounded-xl border border-stone-100 overflow-hidden">
                  <div className="flex items-center gap-4 px-4 py-3 border-b border-stone-50 text-xs text-stone-500">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-400 inline-block" />Boş</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />Dolu</span>
                    <span className="ml-auto text-stone-400">Masaları sürükləyərək yerini dəyiş</span>
                    {tableSavedToast && (
                      <span className="ml-2 text-xs text-green-600 font-medium transition-opacity">✓ Saxlanıldı</span>
                    )}
                  </div>
                  <div className="overflow-auto">
                  <div
                    ref={canvasRef}
                    className="relative bg-[#f9f9f7] select-none"
                    style={{ height: 480, minWidth: 640, backgroundImage: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)', backgroundSize: '24px 24px' }}
                    onClick={() => setSelectedTableId(null)}
                  >
                    {alignGuides.map((g, i) => (
                      <div key={i} className="absolute pointer-events-none z-10"
                        style={g.type === 'h'
                          ? { left: 0, right: 0, top: g.pos, height: 1, background: '#6366f1', opacity: 0.7 }
                          : { top: 0, bottom: 0, left: g.pos, width: 1, background: '#6366f1', opacity: 0.7 }
                        }
                      />
                    ))}
                    {tables.map((t, idx) => {
                      const busy = orders.some(o => o.tableNumber === t.id && isOrderOpen(o));
                      const activeOrder = orders.find(o => o.tableNumber === t.id && isOrderOpen(o));
                      const isSelected = selectedTableId === t.id;
                      const isRound = t.shape === 'round';
                      const pos = autoPos(idx, tables);
                      const x = t.x ?? pos.x;
                      const y = t.y ?? pos.y;
                      const w = t.w ?? 100;
                      const h = isRound ? w : (t.h ?? 70);
                      const activeStatus = activeOrder?.status;
                      const statusColor = activeStatus === 'gözləyir' ? 'bg-primary-400' : activeStatus === 'hazırlanır' ? 'bg-blue-400' : activeStatus === 'hazırdır' ? 'bg-green-500' : '';
                      return (
                        <div
                          key={t.id}
                          style={{
                            left: x, top: y, width: w, height: h,
                            borderRadius: isRound ? '50%' : 10,
                            cursor: dragging?.id === t.id ? 'grabbing' : 'grab',
                          }}
                          className={`absolute flex flex-col items-center justify-center border-2 transition-shadow ${
                            isSelected ? 'shadow-xl' : 'shadow-sm hover:shadow-md'
                          } ${busy ? 'bg-red-50 border-red-300' : 'bg-white border-stone-200'}`}
                          onMouseDown={e => handleTableDragStart(e, { ...t, x, y, w, h })}
                          onClick={e => { e.stopPropagation(); setSelectedTableId(t.id); }}
                        >
                          {isSelected && (
                            <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex gap-1 bg-white rounded-lg shadow border border-stone-100 px-1.5 py-1">
                              <button onClick={e => { e.stopPropagation(); setQrTable(t); }} className="w-5 h-5 flex items-center justify-center text-stone-500 hover:text-primary-700"><QrCode className="w-3 h-3" /></button>
                              <button onClick={e => { e.stopPropagation(); setEditingTable(t); setTName(t.name); setTCapacity(String(t.capacity)); setTShape(t.shape ?? 'rect'); setShowTableForm(true); }} className="w-5 h-5 flex items-center justify-center text-stone-500 hover:text-primary-700"><Pencil className="w-3 h-3" /></button>
                              <button onClick={e => { e.stopPropagation(); if (busy) { setDialog({ title: 'Silinmədi', message: 'Aktiv sifarişi olan masanı silmək olmaz.' }); return; } setDialog({ title: 'Masanı sil?', message: <><span className="font-medium text-stone-700">&ldquo;{t.name}&rdquo;</span> silinəcək.</>, onConfirm: () => deleteTable(t.id).then(err => { if (err) setDialog({ title: 'Silinmədi', message: err }); else setTables(prev => prev.filter(x => x.id !== t.id)); }) }); }} className="w-5 h-5 flex items-center justify-center text-stone-500 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          )}
                          <span className={`text-xs font-bold ${busy ? 'text-red-600' : 'text-stone-600'}`}>{t.name}</span>
                          {busy && activeOrder && (
                            <>
                              <span className={`text-[9px] font-semibold text-white px-1.5 py-0.5 rounded-full mt-0.5 ${statusColor}`}>{activeOrder.status}</span>
                              <span className="text-[10px] font-bold text-red-500 mt-0.5">{orderTotal(activeOrder).toFixed(2)} ₼</span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  </div>
                </div>
              )}

              {/* List view */}
              {tableView === 'list' && tables.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tables.map(t => {
                    const busy = orders.some(o => o.tableNumber === t.id && isOrderOpen(o));
                    return (
                      <div key={t.id} className="bg-white rounded-xl border border-stone-100 px-4 py-3 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-primary-800 font-bold text-sm shrink-0">
                          {t.id}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-stone-800 truncate">{t.name}</p>
                          <p className="text-xs text-stone-500">{t.capacity} nəfər</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${busy ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                          {busy ? 'Dolu' : 'Boş'}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => setQrTable(t)} title="QR kod" className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-primary-700 transition-colors">
                            <QrCode className="w-4 h-4" />
                          </button>
                          <button onClick={() => { setEditingTable(t); setTName(t.name); setTCapacity(String(t.capacity)); setTShape(t.shape ?? 'rect'); setShowTableForm(true); }} title="Düzəlt" className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-primary-700 transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (busy) { setDialog({ title: 'Silinmədi', message: 'Aktiv sifarişi olan masanı silmək olmaz.' }); return; }
                              setDialog({
                                title: 'Masanı sil?',
                                message: <><span className="font-medium text-stone-700">&ldquo;{t.name}&rdquo;</span> silinəcək.</>,
                                onConfirm: () => deleteTable(t.id).then(err => {
                                  if (err) setDialog({ title: 'Silinmədi', message: err });
                                  else setTables(prev => prev.filter(x => x.id !== t.id));
                                }),
                              });
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              </>)}
            </div>
          )}

        </main>
      </div>

      {/* ── Edit payment modal ──────────────────────────────────────────── */}
      {editingPaymentOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 w-full sm:max-w-sm">
            <h3 className="font-bold text-lg text-stone-800 mb-1">Ödənişi düzəlt</h3>
            <p className="text-sm text-stone-600 mb-4">
              №{editingPaymentOrder.orderNumber} · {editingPaymentOrder.sellerName} · {orderTotal(editingPaymentOrder).toFixed(2)} ₼
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs font-semibold text-stone-600 uppercase tracking-wide block mb-1">Nağd ödəniş</label>
                <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary-300">
                  <input
                    type="number" min="0" step="0.01"
                    value={editPaymentCash}
                    onChange={e => {
                      const val = e.target.value;
                      setEditPaymentCash(val);
                      setEditPaymentError('');
                      const cash = parseFloat(val) || 0;
                      const total = orderTotal(editingPaymentOrder);
                      const remaining = Math.max(0, total - cash);
                      setEditPaymentCard(remaining % 1 === 0 ? String(remaining) : remaining.toFixed(2));
                    }}
                    className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
                    autoFocus
                  />
                  <span className="px-3 text-stone-400 text-sm">₼</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-stone-600 uppercase tracking-wide block mb-1">Kartla ödəniş</label>
                <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary-300">
                  <input
                    type="number" min="0" step="0.01"
                    value={editPaymentCard}
                    onChange={e => {
                      const val = e.target.value;
                      setEditPaymentCard(val);
                      setEditPaymentError('');
                      const card = parseFloat(val) || 0;
                      const total = orderTotal(editingPaymentOrder);
                      const remaining = Math.max(0, total - card);
                      setEditPaymentCash(remaining % 1 === 0 ? String(remaining) : remaining.toFixed(2));
                    }}
                    className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
                  />
                  <span className="px-3 text-stone-400 text-sm">₼</span>
                </div>
              </div>
            </div>
            {editPaymentError && (
              <p className="text-red-500 text-sm mb-4">{editPaymentError}</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setEditingPaymentOrder(null); setEditPaymentError(''); }} className="flex-1 py-3 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">Ləğv et</button>
              <button
                disabled={editPaymentBusy}
                onClick={async () => {
                  if (!editingPaymentOrder || editPaymentBusy) return;
                  const cash = parseFloat(editPaymentCash) || 0;
                  const card = parseFloat(editPaymentCard) || 0;
                  const total = orderTotal(editingPaymentOrder);
                  if (cash + card > total) {
                    setEditPaymentError(`Nəğd + kart (${(cash + card).toFixed(2)} ₼) sifarişin məbləğindən (${total.toFixed(2)} ₼) çox ola bilməz.`);
                    return;
                  }
                  setEditPaymentError('');
                  setEditPaymentBusy(true);
                  const ok = await editOrderPayment(editingPaymentOrder.id, cash, card);
                  if (ok) {
                    patchOrder(editingPaymentOrder.id, o => ({ ...o, cashAmount: cash, cardAmount: card, changeAmount: 0 }));
                    setEditingPaymentOrder(null);
                    setEditPaymentError('');
                  }
                  setEditPaymentBusy(false);
                }}
                className="flex-1 py-3 rounded-xl bg-primary-800 hover:bg-primary-900 disabled:opacity-40 text-white font-semibold text-sm active:scale-95 transition-colors flex items-center justify-center gap-2"
              >
                {editPaymentBusy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                Tətbiq et
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel order modal ──────────────────────────────────────────── */}
      {cancellingOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 w-full sm:max-w-sm">
            <h3 className="font-bold text-lg text-stone-800 mb-1">Sifarişi ödənişsiz bağla</h3>
            <p className="text-sm text-stone-600 mb-4">
              №{cancellingOrder.orderNumber} · {cancellingOrder.sellerName} · {orderTotal(cancellingOrder).toFixed(2)} ₼
            </p>
            <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-2">Səbəb</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {CANCEL_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setCancelReason(r)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-colors active:scale-95 ${cancelReason === r ? 'border-red-400 bg-red-50 text-red-600' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            {cancelReason === 'Digər' && (
              <input
                type="text" placeholder="Səbəbi yazın..."
                value={cancelOtherText}
                onChange={e => setCancelOtherText(e.target.value)}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
                autoFocus
              />
            )}
            <div className="flex gap-2">
              <button onClick={() => setCancellingOrder(null)} className="flex-1 py-3 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">İmtina</button>
              <button
                onClick={confirmCancelOrder}
                disabled={cancelBusy || !cancelReason || (cancelReason === 'Digər' && !cancelOtherText.trim())}
                className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white font-semibold text-sm active:scale-95 transition-colors flex items-center justify-center gap-2"
              >
                {cancelBusy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                Ödənişsiz bağla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create / Edit table modal ───────────────────────────────────── */}
      {showTableForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-stone-800">{editingTable ? 'Masanı düzəlt' : 'Yeni masa'}</h3>
              <button onClick={() => setShowTableForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async e => {
                e.preventDefault();
                setTSaving(true);
                const cap = Math.max(1, parseInt(tCapacity) || 4);
                const sw = tShape === 'round' ? 90 : tShape === 'rect-v' ? 70 : 100;
                const sh = tShape === 'round' ? 90 : tShape === 'rect-v' ? 100 : 70;
                if (editingTable) {
                  await updateTable(editingTable.id, tName.trim(), cap);
                  await updateTableLayout(editingTable.id, editingTable.x ?? 20, editingTable.y ?? 20, sw, sh, tShape);
                  setTables(prev => prev.map(x => x.id === editingTable.id ? { ...x, name: tName.trim(), capacity: cap, shape: tShape, w: sw, h: sh } : x));
                } else {
                  const err = await createTable(tName.trim(), cap, tShape, sw, sh);
                  if (err) { setDialog({ title: 'Xəta', message: err }); setTSaving(false); return; }
                  const fresh = await fetchTables();
                  setTables(fresh);
                }
                setTSaving(false);
                setShowTableForm(false);
              }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs font-medium text-stone-600 block mb-1">Ad</label>
                <input
                  value={tName}
                  onChange={e => setTName(e.target.value)}
                  className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Masa 1"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-600 block mb-1">Tutum (nəfər)</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={tCapacity}
                  onChange={e => setTCapacity(e.target.value)}
                  className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-600 block mb-2">Forma</label>
                <div className="flex gap-2">
                  {([
                    { value: 'rect' as const,   label: 'Üfüqi',   w: 'w-6', h: 'h-4', round: false },
                    { value: 'rect-v' as const, label: 'Şaquli',  w: 'w-4', h: 'h-6', round: false },
                    { value: 'round' as const,  label: 'Dairəvi', w: 'w-5', h: 'h-5', round: true },
                  ]).map(s => (
                    <button key={s.value} type="button" onClick={() => setTShape(s.value)}
                      className={`flex-1 py-2 rounded-xl border-2 text-xs font-medium transition-colors flex flex-col items-center justify-center gap-1.5 ${tShape === s.value ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-stone-200 text-stone-500 hover:border-stone-300'}`}>
                      <span className={`inline-block border-2 ${s.w} ${s.h} ${s.round ? 'rounded-full' : 'rounded-sm'} ${tShape === s.value ? 'border-primary-600' : 'border-stone-300'}`} />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={tSaving}
                className="w-full bg-primary-800 hover:bg-primary-900 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors mt-2"
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
              <h3 className="font-bold text-stone-800">{qrTable.name} — QR Kod</h3>
              <div className="flex items-center gap-2">
                <button onClick={handlePrintQr} title="Çap et" className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100 hover:bg-primary-100 hover:text-primary-800 transition-colors">
                  <Printer className="w-4 h-4" />
                </button>
                <button onClick={() => setQrTable(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div ref={qrRef} className="flex justify-center p-4 bg-white rounded-xl border border-stone-100">
              <QRCode value={`${typeof window !== 'undefined' ? window.location.origin : ''}/${companySlug}/menu?table=${qrTable.id}`} size={180} />
            </div>
            <p className="text-xs text-stone-500 mt-3">/{companySlug}/menu?table={qrTable.id}</p>
          </div>
        </div>
      )}

      {/* ── Create / Edit user modal ────────────────────────────────────── */}
      {showEmpForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-stone-800">{editingEmp ? 'Sex əməkdaşını düzəlt' : 'Yeni sex əməkdaşı'}</h3>
              <button onClick={() => setShowEmpForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async e => {
                e.preventDefault();
                if (eSaving) return;
                const name = eName.trim();
                const username = eUsername.trim();
                if (!name) { setEError('Ad boş ola bilməz'); return; }
                if (!/^[a-z0-9_.-]{2,30}$/i.test(username)) { setEError('İstifadəçi adı 2-30 simvol: hərf, rəqəm, . _ -'); return; }
                if (!editingEmp && ePassword.length < 6) { setEError('Şifrə ən azı 6 simvol olmalıdır'); return; }
                if (ePassword && ePassword.length < 6) { setEError('Şifrə ən azı 6 simvol olmalıdır'); return; }
                if (!eStationId) { setEError('Sex seçin'); return; }
                setESaving(true);
                const err = editingEmp
                  ? await updateEmployee(editingEmp.id, {
                      name, username, stationId: eStationId,
                      ...(ePassword ? { password: ePassword } : {}),   // blank = leave the password alone
                    })
                  : await createEmployee(username, ePassword, name, eStationId);
                setESaving(false);
                if (err) { setEError(err); return; }
                setShowEmpForm(false);
                reloadEmployees();
              }}
              className="space-y-3"
            >
              <input
                value={eName}
                onChange={e => { setEName(e.target.value); setEError(''); }}
                placeholder="Ad, məsələn Rəşad"
                autoFocus
                className="w-full px-4 py-2.5 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-700/20 focus:border-primary-700"
              />
              <input
                value={eUsername}
                onChange={e => { setEUsername(e.target.value); setEError(''); }}
                placeholder="İstifadəçi adı, məsələn resad"
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full px-4 py-2.5 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-700/20 focus:border-primary-700"
              />
              <input
                value={ePassword}
                onChange={e => { setEPassword(e.target.value); setEError(''); }}
                type="password"
                placeholder={editingEmp ? 'Yeni şifrə (boş = dəyişmir)' : 'Şifrə'}
                autoComplete="new-password"
                className="w-full px-4 py-2.5 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-700/20 focus:border-primary-700"
              />
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Sex</label>
                <select
                  value={eStationId}
                  onChange={e => { setEStationId(e.target.value); setEError(''); }}
                  className="w-full px-4 py-2.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-700/20 focus:border-primary-700"
                >
                  {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <p className="text-xs text-stone-400 mt-1">Yalnız bu sexin hazırlayacağı yeməkləri görəcək</p>
              </div>
              {eError && <p className="text-xs text-red-600">{eError}</p>}
              <button
                type="submit"
                disabled={eSaving}
                className="w-full bg-primary-800 hover:bg-primary-900 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {eSaving ? 'Gözləyin…' : editingEmp ? 'Yadda saxla' : 'Əlavə et'}
              </button>
            </form>
          </div>
        </div>
      )}

      {showStaffForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-stone-800">{editingStaff ? 'PIN əməkdaşını düzəlt' : 'Yeni PIN əməkdaşı'}</h3>
              <button onClick={() => setShowStaffForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async e => {
                e.preventDefault();
                setSError('');
                const name = sName.trim();
                // edit with empty PIN = keep the old one
                if ((sPin || !editingStaff) && !/^\d{4}$/.test(sPin)) { setSError(STAFF_ERRORS.bad_pin); return; }
                if (sPin && WEAK_PINS.has(sPin)) { setSError('Bu PIN çox sadədir, başqa PIN seçin'); return; }
                setSSaving(true);
                let err: string | null;
                if (editingStaff) {
                  err = await updateStaff(editingStaff.id, name, editingStaff.active);
                  if (!err && sPin) err = await setStaffPin(editingStaff.id, sPin);
                } else {
                  err = await createStaff(name, sPin);
                }
                setSSaving(false);
                if (err) { setSError(staffErrorText(err)); return; }
                setPinStaff(await fetchStaff());
                setShowStaffForm(false);
              }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs font-medium text-stone-600 block mb-1">Ad</label>
                <input
                  value={sName}
                  onChange={e => setSName(e.target.value)}
                  className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Tam ad"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-600 block mb-1">
                  {editingStaff ? 'Yeni PIN' : 'PIN'}
                </label>
                <input
                  value={sPin}
                  onChange={e => setSPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  inputMode="numeric"
                  className={`w-full border rounded-xl px-3 py-2.5 text-sm tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 ${sPin.length === 4 && WEAK_PINS.has(sPin) ? 'border-red-400 bg-red-50' : 'border-stone-200'}`}
                  placeholder={editingStaff ? 'Dəyişmək üçün daxil edin' : '4 rəqəm'}
                  required={!editingStaff}
                />
                {sPin.length === 4 && WEAK_PINS.has(sPin) && (
                  <p className="text-xs text-red-500 mt-1">Bu PIN çox sadədir — 1111, 1234 kimi ardıcıl PINlər qəbul edilmir</p>
                )}
              </div>
              {sError && <p className="text-red-500 text-sm">{sError}</p>}
              <button
                type="submit"
                disabled={sSaving}
                className="w-full bg-primary-800 hover:bg-primary-900 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {sSaving && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {editingStaff ? 'Yadda saxla' : 'Əlavə et'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── New category dialog ─────────────────────────────────────────── */}
      {showCatDialog && (() => {
        const dup = categories.some(c => c.name === newCat.trim());
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <form onSubmit={addCategory} className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
              <h3 className="text-base font-semibold text-stone-800">Yeni kateqoriya</h3>
              <input
                autoFocus
                type="text"
                placeholder="Kateqoriya adı"
                value={newCat}
                onChange={e => setNewCat(e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white"
              />
              {dup && newCat.trim() !== '' && <p className="text-xs text-red-500">Bu adda kateqoriya artıq var</p>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowCatDialog(false)} className="px-4 py-2 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">Ləğv et</button>
                <button type="submit" disabled={!newCat.trim() || dup} className="px-4 py-2 text-sm rounded-lg bg-primary-800 hover:bg-primary-900 disabled:opacity-40 text-white font-medium transition-colors">Əlavə et</button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* ── Import preview modal ────────────────────────────────────────── */}
      {importPreview && (() => {
        const { newItems, updatedItems, newCategories, errors, totalRows } = importPreview;
        const validCount = newItems.length + updatedItems.length;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[85vh]">
              <div className="p-6 pb-4">
                <h3 className="text-base font-semibold text-stone-800">Menyu idxalı</h3>
                <p className="text-sm text-stone-600 mt-1">{totalRows} sətir oxundu</p>
              </div>
              <div className="px-6 space-y-2 overflow-y-auto flex-1">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-green-50 rounded-xl py-3">
                    <p className="text-xl font-bold text-green-700">{newItems.length}</p>
                    <p className="text-xs text-green-600">yeni məhsul</p>
                  </div>
                  <div className="bg-primary-50 rounded-xl py-3">
                    <p className="text-xl font-bold text-primary-700">{updatedItems.length}</p>
                    <p className="text-xs text-primary-600">yenilənəcək</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl py-3">
                    <p className="text-xl font-bold text-blue-700">{newCategories.length}</p>
                    <p className="text-xs text-blue-600">yeni kateqoriya</p>
                  </div>
                </div>
                {newCategories.length > 0 && (
                  <p className="text-xs text-stone-600">Yeni kateqoriyalar: {newCategories.map(c => c.name).join(', ')}</p>
                )}
                {errors.length > 0 && (
                  <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-1">
                    <p className="text-xs font-semibold text-red-600">{errors.length} xəta — bu sətirlər ötürüləcək:</p>
                    {errors.map((e, i) => <p key={i} className="text-xs text-red-500">{e}</p>)}
                  </div>
                )}
                <p className="text-xs text-stone-500">
                  Mövcud məhsullar ad üzrə tapılıb yenilənir (şəkilləri qalır). Faylda olmayan məhsullara toxunulmur — heç nə silinmir.
                </p>
              </div>
              <div className="flex gap-2 justify-end p-6 pt-4">
                <button onClick={() => setImportPreview(null)} className="px-4 py-2 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">Ləğv et</button>
                <button
                  onClick={applyImport}
                  disabled={importing || validCount === 0}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary-800 hover:bg-primary-900 disabled:opacity-40 text-white font-medium transition-colors"
                >
                  {importing && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  Tətbiq et ({validCount})
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Trash modal ─────────────────────────────────────────────────── */}
      {showTrash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-stone-500" />
                <h3 className="text-base font-semibold text-stone-800">Zibil qutusu</h3>
                <span className="text-xs text-stone-500">(30 gün saxlanılır)</span>
              </div>
              <div className="flex items-center gap-3">
                {trash.length > 0 && (
                  <button
                    onClick={() => setConfirmEmptyTrash(true)}
                    className="text-xs font-medium text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Hamısını sil
                  </button>
                )}
                <button onClick={() => setShowTrash(false)} className="text-stone-500 hover:text-stone-600"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {trash.length === 0 && (
                <p className="text-sm text-stone-500 text-center py-8">Zibil qutusu boşdur</p>
              )}
              {trash.map(item => {
                const d = item.data as Record<string, unknown>;
                const label = item.type === 'menu' ? String(d.name ?? '') : String(d.name ?? '');
                const sub = item.type === 'menu' ? String(d.category ?? '') : 'Kateqoriya';
                const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(item.deletedAt).getTime()) / 86400000));
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-stone-100 hover:bg-stone-50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{label}</p>
                      <p className="text-xs text-stone-500">{sub} · {daysLeft} gün qalıb</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={async () => {
                          await restoreFromTrash(item.id);
                          // Skip if already in the menu (double click / re-restore) —
                          // a duplicate would poison every following save
                          if (item.type === 'menu') {
                            const restored = item.data as unknown as MenuItem;
                            if (!menu.some(m => m.id === restored.id)) {
                              const updatedMenu = [...menu, restored];
                              setMenu(updatedMenu);
                              await persistMenu(updatedMenu);
                            }
                          } else if (item.type === 'category') {
                            const restored = item.data as unknown as Category;
                            if (!categories.some(c => c.name === restored.name)) {
                              const updatedCats = [...categories, restored];
                              setCategories(updatedCats);
                              await persistCategories(updatedCats);
                            }
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
            <h3 className="text-base font-semibold text-stone-800">Kateqoriyanı dəyiş</h3>
            <input
              autoFocus
              type="text"
              value={editCatValue}
              onChange={e => setEditCatValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') renameCategory(editCatTarget, editCatValue); }}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 bg-white"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditCatTarget(null)} className="px-4 py-2 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">Ləğv et</button>
              <button onClick={() => renameCategory(editCatTarget, editCatValue)} className="px-4 py-2 text-sm rounded-lg bg-primary-800 hover:bg-primary-900 text-white font-medium transition-colors">Yadda saxla</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty trash confirmation dialog ─────────────────────────────── */}
      {confirmEmptyTrash && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
            <h3 className="text-base font-semibold text-stone-800">Zibil qutusunu boşalt?</h3>
            <p className="text-sm text-stone-600">
              <span className="font-medium text-stone-700">{trash.length} element</span> həmişəlik silinəcək. Bu əməliyyat geri qaytarıla bilməz.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmEmptyTrash(false)} className="px-4 py-2 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">Ləğv et</button>
              <button
                onClick={handleEmptyTrash}
                disabled={emptyingTrash}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white font-medium transition-colors"
              >
                {emptyingTrash && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                Hamısını sil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Profile Modal ── */}
      {showProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <UserCircle className="w-5 h-5 text-primary-800" />
                <h3 className="font-bold text-stone-800">Profil</h3>
              </div>
              <button onClick={() => setShowProfile(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100 hover:bg-stone-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* ── Business Info ── */}
              <div>
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Müəssisə məlumatları</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-stone-600 flex items-center gap-1 mb-1"><Building2 className="w-3.5 h-3.5" />Müəssisənin adı</label>
                    <input
                      value={profName}
                      onChange={e => setProfName(e.target.value)}
                      className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                      placeholder="Məkanın adı"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-stone-600 flex items-center gap-1 mb-1"><AtSign className="w-3.5 h-3.5" />İstifadəçi adı</label>
                    <input
                      value={profUsername}
                      onChange={e => setProfUsername(e.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-400"
                      placeholder="istifadeci"
                    />
                    <p className="text-xs text-stone-500 mt-1">Girişdə bu ad istifadə olunur — dəyişsəniz, növbəti dəfə yeni adla daxil olun</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-stone-600 flex items-center gap-1 mb-1"><User className="w-3.5 h-3.5" />Sahibin adı</label>
                    <input
                      value={profOwner}
                      onChange={e => setProfOwner(e.target.value)}
                      className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                      placeholder="Ad Soyad"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-stone-600 flex items-center gap-1 mb-1"><MapPin className="w-3.5 h-3.5" />Ünvan</label>
                    <input
                      value={profAddress}
                      onChange={e => setProfAddress(e.target.value)}
                      className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                      placeholder="Şəhər, küçə, ev"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-stone-600 flex items-center gap-1 mb-1"><Phone className="w-3.5 h-3.5" />Mobil nömrə</label>
                    <input
                      value={profPhone}
                      onChange={e => setProfPhone(e.target.value)}
                      className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                      placeholder="+994 50 000 00 00"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-stone-600 flex items-center gap-1 mb-1"><Clock className="w-3.5 h-3.5" />İş saatları</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={profOpen}
                        onChange={e => setProfOpen(e.target.value)}
                        className="flex-1 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                      <span className="text-stone-400 text-sm">—</span>
                      <input
                        type="time"
                        value={profClose}
                        onChange={e => setProfClose(e.target.value)}
                        className="flex-1 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    </div>
                    <p className="text-xs text-stone-500 mt-1">
                      {cutoffMinutes({ ...bizSettings, workOpen: profOpen || '00:00', workClose: profClose || '00:00' }) > 0
                        ? `Gecə yarısından sonrakı satışlar (saat ${profClose}-a qədər) əvvəlki günün statistikasına yazılır`
                        : 'Statistika günü gecə yarısında dəyişir'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleSaveProfile}
                      disabled={profSaving}
                      className="flex-1 bg-primary-800 hover:bg-primary-900 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                    >
                      {profSaving ? 'Saxlanır...' : 'Yadda saxla'}
                    </button>
                    {profMsg && <span className={`text-xs font-medium ${profMsgErr ? 'text-red-600' : 'text-green-600'}`}>{profMsg}</span>}
                  </div>
                </div>
              </div>

              <div className="border-t border-stone-100" />

              {/* ── Password Change ── */}
              <div>
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3 flex items-center gap-1"><Lock className="w-3.5 h-3.5" />Şifrəni dəyiş</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-stone-600 block mb-1">Cari şifrə</label>
                    <div className="relative">
                      <input
                        type={pwShowCurrent ? 'text' : 'password'}
                        value={pwCurrent}
                        onChange={e => setPwCurrent(e.target.value)}
                        className="w-full border border-stone-200 rounded-xl px-3 py-2.5 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                        placeholder="••••••••"
                      />
                      <button type="button" onClick={() => setPwShowCurrent(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500">
                        {pwShowCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-stone-600 block mb-1">Yeni şifrə</label>
                    <PasswordField value={pwNew} onChange={setPwNew} focusClass="focus:ring-primary-400" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-stone-600 block mb-1">Yeni şifrəni təsdiqlə</label>
                    <input
                      type="password"
                      value={pwConfirm}
                      onChange={e => setPwConfirm(e.target.value)}
                      className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleChangePassword}
                      disabled={pwSaving}
                      className="flex-1 bg-stone-800 hover:bg-stone-900 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                    >
                      {pwSaving ? 'Dəyişdirilir...' : 'Şifrəni dəyiş'}
                    </button>
                    {pwMsg && <span className={`text-xs font-medium ${pwMsg.includes('dəyişdirildi') ? 'text-green-600' : 'text-red-500'}`}>{pwMsg}</span>}
                  </div>
                </div>
              </div>

              <div className="border-t border-stone-100" />

              {/* ── Printer Settings ── */}
              <div>
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3 flex items-center gap-1"><Printer className="w-3.5 h-3.5" />Printer</p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${printerConnected ? 'bg-green-500' : 'bg-stone-300'}`} />
                    <span className="text-xs text-stone-600">{printerConnected ? 'Yazıcı bağlı' : 'Yazıcı tapılmadı'}</span>
                  </div>
                  <button
                    onClick={async () => {
                      setPrinterError(null);
                      const ok = await selectPrinter();
                      setPrinterConnected(ok);
                      if (!ok) setPrinterError('Yazıcı seçilmədi və ya bağlantı alınmadı');
                    }}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                  >
                    Yazıcı seç
                  </button>
                  {printerError && <p className="text-xs text-red-500">{printerError}</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageContent />
    </Suspense>
  );
}
