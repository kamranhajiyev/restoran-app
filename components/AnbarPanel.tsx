'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Warehouse, Boxes, Truck, ShoppingCart, X, BookOpen, Eraser, ChevronDown, Wallet } from 'lucide-react';
import {
  fetchWarehouses, createWarehouse, updateWarehouse, deleteWarehouse,
  fetchSuppliers, createSupplier, updateSupplier, deleteSupplier, fetchSupplierLedger, addSupplierPayment,
  fetchStockItems, createStockItem, updateStockItem, deleteStockItem,
  fetchBalances, fetchReceipts, recordReceipt, updateReceipt, voidReceipt, recordWriteoff,
  fetchReceiptLines, fetchWriteoffs,
  fetchMenu, fetchRecipeLines, saveRecipe, fetchSalesWarehouse, setSalesWarehouse,
} from '@/lib/store';
import { Warehouse as Wh, Supplier, StockItem, StockBalance, StockReceipt, ReceiptLine, ReceiptLineDetail, WriteoffEntry, SupplierLedger, MenuItem, RecipeLineRow, RecipeIngredient } from '@/types';
import { DialogState } from '@/components/AppDialog';

type Sub = 'warehouses' | 'balances' | 'suppliers' | 'receipts' | 'writeoffs' | 'recipes';

const SUBS: { id: Sub; label: string; icon: React.ElementType }[] = [
  { id: 'warehouses', label: 'Anbarlar', icon: Warehouse },
  { id: 'balances', label: 'Qalıqlar', icon: Boxes },
  { id: 'suppliers', label: 'Tədarükçülər', icon: Truck },
  { id: 'receipts', label: 'Bazarlıqlar', icon: ShoppingCart },
  { id: 'writeoffs', label: 'Silinmələr', icon: Eraser },
  { id: 'recipes', label: 'Reseptlər', icon: BookOpen },
];

const UNITS = ['ədəd', 'kq', 'q', 'litr', 'ml', 'paket'];

const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-300';
const btnPrimary = 'inline-flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-lg bg-stone-800 hover:bg-stone-700 text-white font-medium transition-colors disabled:opacity-50';
const btnGhost = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors';

export default function AnbarPanel({ setDialog }: { setDialog: (d: DialogState | null) => void }) {
  const [sub, setSub] = useState<Sub>('warehouses');
  const [warehouses, setWarehouses] = useState<Wh[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<StockItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2200); }
  function fail(msg: string | null) { if (msg) setDialog({ title: 'Xəta', message: msg }); }

  async function reloadCatalog() {
    const [w, s, i] = await Promise.all([fetchWarehouses(), fetchSuppliers(), fetchStockItems()]);
    setWarehouses(w); setSuppliers(s); setItems(i); setLoaded(true);
  }
  useEffect(() => { reloadCatalog(); }, []);

  return (
    <div className="space-y-4">
      {/* sub-tabs */}
      <div className="flex flex-wrap gap-1.5">
        {SUBS.map(s => {
          const Icon = s.icon;
          const on = sub === s.id;
          return (
            <button key={s.id} onClick={() => setSub(s.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-lg font-medium transition-colors ${on ? 'bg-stone-800 text-white' : 'border border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
              <Icon className="w-4 h-4" /> {s.label}
            </button>
          );
        })}
      </div>

      {!loaded ? (
        <div className="text-sm text-stone-400 py-10 text-center">Yüklənir…</div>
      ) : (
        <>
          {sub === 'warehouses' && (
            <WarehousesTab warehouses={warehouses} reload={reloadCatalog} flash={flash} fail={fail} setDialog={setDialog} />
          )}
          {sub === 'suppliers' && (
            <SuppliersTab suppliers={suppliers} reload={reloadCatalog} flash={flash} fail={fail} setDialog={setDialog} />
          )}
          {sub === 'balances' && (
            <BalancesTab warehouses={warehouses} items={items} reloadItems={reloadCatalog} flash={flash} fail={fail} setDialog={setDialog} />
          )}
          {sub === 'receipts' && (
            <ReceiptsTab warehouses={warehouses} suppliers={suppliers} items={items} flash={flash} fail={fail} setDialog={setDialog} />
          )}
          {sub === 'writeoffs' && (
            <WriteoffsTab />
          )}
          {sub === 'recipes' && (
            <RecipesTab items={items} flash={flash} fail={fail} />
          )}
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] px-4 py-2 rounded-lg bg-stone-800 text-white text-sm shadow-lg">{toast}</div>
      )}
    </div>
  );
}

// ─── Anbarlar ──────────────────────────────────────────────────────────────────

function WarehousesTab({ warehouses, reload, flash, fail, setDialog }: {
  warehouses: Wh[]; reload: () => Promise<void>; flash: (m: string) => void; fail: (m: string | null) => void; setDialog: (d: DialogState | null) => void;
}) {
  const [editing, setEditing] = useState<Wh | 'new' | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [salesWh, setSalesWh] = useState<string>('');

  useEffect(() => { fetchSalesWarehouse().then(id => setSalesWh(id ?? '')); }, []);
  async function changeSalesWh(id: string) {
    setSalesWh(id);
    const err = await setSalesWarehouse(id || null);
    if (err) fail(err); else flash('Satış anbarı yadda saxlanıldı');
  }

  function open(w: Wh | 'new') {
    setEditing(w); setName(w === 'new' ? '' : w.name); setActive(w === 'new' ? true : w.active);
  }
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const err = editing === 'new' ? await createWarehouse(name.trim()) : await updateWarehouse((editing as Wh).id, name.trim(), active);
    setBusy(false);
    if (err) { fail(err); return; }
    setEditing(null); await reload(); flash('Yadda saxlanıldı');
  }
  function remove(w: Wh) {
    setDialog({
      title: 'Anbarı sil?', message: `«${w.name}» silinəcək.`, onConfirm: async () => {
        const err = await deleteWarehouse(w.id);
        if (err) fail(err.includes('foreign') || err.includes('violates') ? 'Bu anbarda hərəkət var — əvvəlcə qalıqları boşaldın.' : err);
        else { await reload(); flash('Silindi'); }
      },
    });
  }

  return (
    <div className="space-y-3">
      {/* sales warehouse: where sold ingredients are deducted from (Phase 2) */}
      <div className="bg-white rounded-2xl border border-stone-100 p-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-stone-800">Satış anbarı</div>
          <div className="text-xs text-stone-400">Satış zamanı resept məhsulları bu anbardan çıxılır</div>
        </div>
        <select className={`${inputCls} w-auto`} value={salesWh} onChange={e => changeSalesWh(e.target.value)}>
          <option value="">— seçilməyib —</option>
          {warehouses.filter(w => w.active).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      <div className="flex justify-end">
        <button className={btnPrimary} onClick={() => open('new')}><Plus className="w-4 h-4" /> Yeni anbar</button>
      </div>
      <div className="bg-white rounded-2xl border border-stone-100 divide-y divide-stone-100">
        {warehouses.length === 0 && <p className="text-sm text-stone-400 p-6 text-center">Anbar yoxdur</p>}
        {warehouses.map(w => (
          <div key={w.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-stone-400" />
              <span className="text-sm font-medium text-stone-800">{w.name}</span>
              {!w.active && <span className="text-xs text-stone-400">(deaktiv)</span>}
            </div>
            <div className="flex gap-1">
              <button className={btnGhost} onClick={() => open(w)}><Pencil className="w-3.5 h-3.5" /></button>
              <button className={btnGhost} onClick={() => remove(w)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title={editing === 'new' ? 'Yeni anbar' : 'Anbarı düzəlt'} onClose={() => setEditing(null)}>
          <label className="block text-xs text-stone-500 mb-1">Ad</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Mətbəx anbarı" autoFocus />
          {editing !== 'new' && (
            <label className="flex items-center gap-2 mt-3 text-sm text-stone-600">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Aktiv
            </label>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button className={btnGhost} onClick={() => setEditing(null)}>Ləğv et</button>
            <button className={btnPrimary} onClick={save} disabled={busy || !name.trim()}>Yadda saxla</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Tədarükçülər ───────────────────────────────────────────────────────────────

function SuppliersTab({ suppliers, reload, flash, fail, setDialog }: {
  suppliers: Supplier[]; reload: () => Promise<void>; flash: (m: string) => void; fail: (m: string | null) => void; setDialog: (d: DialogState | null) => void;
}) {
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [f, setF] = useState({ name: '', address: '', phone: '', note: '', active: true });
  const [busy, setBusy] = useState(false);
  const [ledger, setLedger] = useState<Record<string, SupplierLedger>>({});
  const [paying, setPaying] = useState<Supplier | null>(null);

  async function reloadLedger() { setLedger(await fetchSupplierLedger()); }
  useEffect(() => { reloadLedger(); }, []);

  function open(s: Supplier | 'new') {
    setEditing(s);
    setF(s === 'new' ? { name: '', address: '', phone: '', note: '', active: true }
      : { name: s.name, address: s.address ?? '', phone: s.phone ?? '', note: s.note ?? '', active: s.active });
  }
  async function save() {
    if (!f.name.trim()) return;
    setBusy(true);
    const err = editing === 'new'
      ? await createSupplier(f.name.trim(), f.address, f.phone, f.note)
      : await updateSupplier((editing as Supplier).id, f.name.trim(), f.address, f.phone, f.note, f.active);
    setBusy(false);
    if (err) { fail(err); return; }
    setEditing(null); await reload(); flash('Yadda saxlanıldı');
  }
  function remove(s: Supplier) {
    setDialog({
      title: 'Tədarükçünü sil?', message: `«${s.name}» silinəcək.`, onConfirm: async () => {
        const err = await deleteSupplier(s.id);
        if (err) fail(err.includes('foreign') || err.includes('violates') ? 'Bu tədarükçü ilə bazarlıq var — silinə bilməz.' : err);
        else { await reload(); flash('Silindi'); }
      },
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={btnPrimary} onClick={() => open('new')}><Plus className="w-4 h-4" /> Yeni tədarükçü</button>
      </div>
      <div className="bg-white rounded-2xl border border-stone-100 divide-y divide-stone-100">
        {suppliers.length === 0 && <p className="text-sm text-stone-400 p-6 text-center">Tədarükçü yoxdur</p>}
        {suppliers.map(s => {
          const l = ledger[s.id];
          const debt = l?.debt ?? 0;
          return (
          <div key={s.id} className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-stone-800">{s.name} {!s.active && <span className="text-xs text-stone-400">(deaktiv)</span>}</div>
              <div className="text-xs text-stone-400">{[s.phone, s.address].filter(Boolean).join(' · ')}</div>
              <div className="text-xs mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-stone-500">Cəmi alınıb: <b className="tabular-nums text-stone-700">{(l?.total ?? 0).toFixed(2)} ₼</b></span>
                {debt > 0.005
                  ? <span className="text-red-500">Borc: <b className="tabular-nums">{debt.toFixed(2)} ₼</b></span>
                  : <span className="text-emerald-600">Borc yoxdur</span>}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              {debt > 0.005 && <button className={btnGhost} onClick={() => setPaying(s)} title="Ödəniş et"><Wallet className="w-3.5 h-3.5 text-emerald-600" /></button>}
              <button className={btnGhost} onClick={() => open(s)}><Pencil className="w-3.5 h-3.5" /></button>
              <button className={btnGhost} onClick={() => remove(s)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
            </div>
          </div>
          );
        })}
      </div>

      {paying && (
        <PaySupplierModal supplier={paying} debt={ledger[paying.id]?.debt ?? 0} onClose={() => setPaying(null)}
          onDone={async () => { setPaying(null); await reloadLedger(); flash('Ödəniş qeydə alındı'); }} fail={fail} />
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'Yeni tədarükçü' : 'Tədarükçünü düzəlt'} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div><label className="block text-xs text-stone-500 mb-1">Ad</label><input className={inputCls} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></div>
            <div><label className="block text-xs text-stone-500 mb-1">Telefon</label><input className={inputCls} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
            <div><label className="block text-xs text-stone-500 mb-1">Ünvan</label><input className={inputCls} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></div>
            <div><label className="block text-xs text-stone-500 mb-1">Qeyd</label><input className={inputCls} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></div>
            {editing !== 'new' && (
              <label className="flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Aktiv</label>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className={btnGhost} onClick={() => setEditing(null)}>Ləğv et</button>
            <button className={btnPrimary} onClick={save} disabled={busy || !f.name.trim()}>Yadda saxla</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PaySupplierModal({ supplier, debt, onClose, onDone, fail }: {
  supplier: Supplier; debt: number; onClose: () => void; onDone: () => void; fail: (m: string | null) => void;
}) {
  const [amount, setAmount] = useState(debt > 0 ? debt.toFixed(2) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    setBusy(true);
    const err = await addSupplierPayment(supplier.id, n, note);
    setBusy(false);
    if (err) { fail(err); return; }
    onDone();
  }
  return (
    <Modal title={`Ödəniş — ${supplier.name}`} onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">Cari borc: <b className="tabular-nums">{debt.toFixed(2)} ₼</b></p>
      <div className="space-y-3">
        <div><label className="block text-xs text-stone-500 mb-1">Məbləğ (₼)</label><input className={inputCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
        <div><label className="block text-xs text-stone-500 mb-1">Qeyd</label><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="nağd ödəniş" /></div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className={btnGhost} onClick={onClose}>Ləğv et</button>
        <button className={btnPrimary} onClick={save} disabled={busy || !(parseFloat(amount) > 0)}>Təsdiqlə</button>
      </div>
    </Modal>
  );
}

// ─── Qalıqlar (+ stock item catalog & write-off) ───────────────────────────────

function BalancesTab({ warehouses, items, reloadItems, flash, fail, setDialog }: {
  warehouses: Wh[]; items: StockItem[]; reloadItems: () => Promise<void>; flash: (m: string) => void; fail: (m: string | null) => void; setDialog: (d: DialogState | null) => void;
}) {
  const activeWh = useMemo(() => warehouses.filter(w => w.active), [warehouses]);
  const [whId, setWhId] = useState<string>('');
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [loadingBal, setLoadingBal] = useState(false);
  const [itemModal, setItemModal] = useState<StockItem | 'new' | null>(null);
  const [woItem, setWoItem] = useState<StockBalance | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'product' | 'ingredient'>('all');

  const typeOf = useMemo(() => {
    const m = new Map(items.map(it => [it.id, it.type ?? 'ingredient']));
    return (id: string) => m.get(id) ?? 'ingredient';
  }, [items]);
  const shownBalances = typeFilter === 'all' ? balances : balances.filter(b => typeOf(b.stockItemId) === typeFilter);
  const shownItems = typeFilter === 'all' ? items : items.filter(it => (it.type ?? 'ingredient') === typeFilter);

  useEffect(() => { if (!whId && activeWh.length) setWhId(activeWh[0].id); }, [activeWh, whId]);
  async function reloadBalances(id = whId) {
    if (!id) { setBalances([]); return; }
    setLoadingBal(true); setBalances(await fetchBalances(id)); setLoadingBal(false);
  }
  useEffect(() => { reloadBalances(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [whId]);

  if (warehouses.length === 0) return <Empty msg="Əvvəlcə «Anbarlar» bölməsində bir anbar yaradın." />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select className={`${inputCls} w-auto`} value={whId} onChange={e => setWhId(e.target.value)}>
          {activeWh.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button className={btnGhost} onClick={() => setItemModal('new')}><Plus className="w-4 h-4" /> Yeni məhsul</button>
      </div>

      <div className="flex items-center gap-2">
        {([['all', 'Hamısı'], ['product', 'Məhsullar'], ['ingredient', 'İnqrediyentlər']] as const).map(([val, label]) => (
          <button key={val} onClick={() => setTypeFilter(val)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${typeFilter === val ? 'bg-amber-700 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 divide-y divide-stone-100">
        {loadingBal ? <p className="text-sm text-stone-400 p-6 text-center">Yüklənir…</p>
          : shownBalances.length === 0 ? <p className="text-sm text-stone-400 p-6 text-center">Bu anbarda qalıq yoxdur</p>
          : shownBalances.map(b => (
            <div key={b.stockItemId} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-stone-800">{b.name}</span>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold tabular-nums ${b.qty <= 0 ? 'text-red-500' : 'text-stone-800'}`}>{b.qty} {b.unit}</span>
                <button className={btnGhost} onClick={() => setWoItem(b)}>Silinmə</button>
              </div>
            </div>
          ))}
      </div>

      {/* full item catalog management */}
      <details className="bg-white rounded-2xl border border-stone-100 p-4">
        <summary className="text-sm font-medium text-stone-600 cursor-pointer">Bütün məhsullar ({shownItems.length})</summary>
        <div className="mt-3 divide-y divide-stone-100">
          {shownItems.map(it => (
            <div key={it.id} className="flex items-center justify-between py-2">
              <span className="text-sm text-stone-700">{it.name} <span className="text-xs text-stone-400">/ {it.unit} · {(it.type ?? 'ingredient') === 'product' ? 'Məhsul' : 'İnqrediyent'}</span></span>
              <div className="flex gap-1">
                <button className={btnGhost} onClick={() => setItemModal(it)}><Pencil className="w-3.5 h-3.5" /></button>
                <button className={btnGhost} onClick={() => setDialog({
                  title: 'Məhsulu sil?', message: `«${it.name}» silinəcək.`, onConfirm: async () => {
                    const err = await deleteStockItem(it.id);
                    if (err) fail(err.includes('foreign') || err.includes('violates') ? 'Bu məhsulun hərəkəti var — silinə bilməz.' : err);
                    else { await reloadItems(); await reloadBalances(); flash('Silindi'); }
                  },
                })}><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
              </div>
            </div>
          ))}
          {shownItems.length === 0 && <p className="text-sm text-stone-400 py-2">Məhsul yoxdur</p>}
        </div>
      </details>

      {itemModal && (
        <ItemModal item={itemModal} onClose={() => setItemModal(null)} onSaved={async () => { setItemModal(null); await reloadItems(); await reloadBalances(); flash('Yadda saxlanıldı'); }} fail={fail} />
      )}
      {woItem && (
        <WriteoffModal balance={woItem} warehouseId={whId} onClose={() => setWoItem(null)} onDone={async () => { setWoItem(null); await reloadBalances(); flash('Silinmə qeydə alındı'); }} fail={fail} />
      )}
    </div>
  );
}

function ItemModal({ item, onClose, onSaved, fail }: { item: StockItem | 'new'; onClose: () => void; onSaved: () => void; fail: (m: string | null) => void }) {
  const [name, setName] = useState(item === 'new' ? '' : item.name);
  const [unit, setUnit] = useState(item === 'new' ? 'ədəd' : item.unit);
  const [type, setType] = useState<'product' | 'ingredient'>(item === 'new' ? 'ingredient' : (item.type ?? 'ingredient'));
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const err = item === 'new' ? await createStockItem(name.trim(), unit, type) : await updateStockItem(item.id, name.trim(), unit, type);
    setBusy(false);
    if (err) { fail(err); return; }
    onSaved();
  }
  return (
    <Modal title={item === 'new' ? 'Yeni məhsul' : 'Məhsulu düzəlt'} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="block text-xs text-stone-500 mb-1">Ad</label><input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Kartof" autoFocus /></div>
        <div>
          <label className="block text-xs text-stone-500 mb-1">Növ</label>
          <div className="inline-flex rounded-lg border border-stone-200 overflow-hidden">
            {([['ingredient', 'İnqrediyent'], ['product', 'Məhsul']] as const).map(([val, label]) => (
              <button key={val} type="button" onClick={() => setType(val)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${type === val ? 'bg-amber-700 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-stone-500 mb-1">Ölçü vahidi</label>
          <select className={inputCls} value={unit} onChange={e => setUnit(e.target.value)}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className={btnGhost} onClick={onClose}>Ləğv et</button>
        <button className={btnPrimary} onClick={save} disabled={busy || !name.trim()}>Yadda saxla</button>
      </div>
    </Modal>
  );
}

function WriteoffModal({ balance, warehouseId, onClose, onDone, fail }: { balance: StockBalance; warehouseId: string; onClose: () => void; onDone: () => void; fail: (m: string | null) => void }) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const n = parseFloat(qty);
    if (!n || n <= 0) return;
    setBusy(true);
    const err = await recordWriteoff(warehouseId, balance.stockItemId, n, reason);
    setBusy(false);
    if (err) { fail(err); return; }
    onDone();
  }
  return (
    <Modal title={`Silinmə — ${balance.name}`} onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">Hazırkı qalıq: {balance.qty} {balance.unit}</p>
      <div className="space-y-3">
        <div><label className="block text-xs text-stone-500 mb-1">Miqdar ({balance.unit})</label><input className={inputCls} type="number" value={qty} onChange={e => setQty(e.target.value)} autoFocus /></div>
        <div><label className="block text-xs text-stone-500 mb-1">Səbəb</label><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="xarab oldu" /></div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className={btnGhost} onClick={onClose}>Ləğv et</button>
        <button className={btnPrimary} onClick={save} disabled={busy}>Təsdiqlə</button>
      </div>
    </Modal>
  );
}

// ─── Bazarlıqlar ────────────────────────────────────────────────────────────────

function ReceiptsTab({ warehouses, suppliers, items, flash, fail, setDialog }: {
  warehouses: Wh[]; suppliers: Supplier[]; items: StockItem[]; flash: (m: string) => void; fail: (m: string | null) => void; setDialog: (d: DialogState | null) => void;
}) {
  const activeWh = useMemo(() => warehouses.filter(w => w.active), [warehouses]);
  const [receipts, setReceipts] = useState<StockReceipt[]>([]);
  const [editingReceipt, setEditingReceipt] = useState<StockReceipt | 'new' | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lineCache, setLineCache] = useState<Record<string, ReceiptLineDetail[]>>({});

  async function reload() { setReceipts(await fetchReceipts()); }
  useEffect(() => { reload(); }, []);

  const whName = (id: string) => warehouses.find(w => w.id === id)?.name ?? '—';
  const supName = (id?: string) => suppliers.find(s => s.id === id)?.name ?? '—';

  async function toggle(r: StockReceipt) {
    if (expandedId === r.id) { setExpandedId(null); return; }
    setExpandedId(r.id);
    if (!lineCache[r.id]) setLineCache(prev => ({ ...prev, [r.id]: [] }));   // placeholder while loading
    const lines = await fetchReceiptLines(r.id);
    setLineCache(prev => ({ ...prev, [r.id]: lines }));
  }
  function askVoid(r: StockReceipt) {
    setDialog({
      title: 'Bazarlığı sil?',
      message: 'Bu bazarlığın məhsulları anbardan geri çıxılacaq. Qeyd siyahıda qırmızı ilə qalacaq.',
      onConfirm: async () => {
        const err = await voidReceipt(r.id);
        if (err) { fail(err); return; }
        await reload(); flash('Bazarlıq silindi');
      },
    });
  }

  if (warehouses.length === 0) return <Empty msg="Əvvəlcə «Anbarlar» bölməsində bir anbar yaradın." />;
  if (items.length === 0) return <Empty msg="Əvvəlcə «Qalıqlar» bölməsində məhsul yaradın." />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={btnPrimary} onClick={() => setEditingReceipt('new')}><Plus className="w-4 h-4" /> Yeni bazarlıq</button>
      </div>
      <div className="bg-white rounded-2xl border border-stone-100 divide-y divide-stone-100">
        {receipts.length === 0 && <p className="text-sm text-stone-400 p-6 text-center">Bazarlıq yoxdur</p>}
        {receipts.map(r => {
          const voided = !!r.voidedAt;
          const open = expandedId === r.id;
          const lines = lineCache[r.id];
          const debt = r.total - r.paidAmount;
          return (
            <div key={r.id}>
              <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-stone-50 transition-colors" onClick={() => toggle(r)}>
                <div className="min-w-0">
                  <div className={`text-sm font-medium flex items-center gap-2 ${voided ? 'text-red-500 line-through' : 'text-stone-800'}`}>
                    {supName(r.supplierId)} → {whName(r.warehouseId)}
                    {voided && <span className="text-[10px] font-semibold no-underline px-1.5 py-0.5 rounded bg-red-50 text-red-500">silinib</span>}
                  </div>
                  <div className="text-xs text-stone-400">{new Date(r.createdAt).toLocaleString('az-AZ')}{r.note ? ` · ${r.note}` : ''}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className={`text-sm font-semibold tabular-nums ${voided ? 'text-red-400' : 'text-stone-800'}`}>{r.total.toFixed(2)} ₼</div>
                    {!voided && (debt > 0.005
                      ? <div className="text-[11px] text-red-500 tabular-nums">borc {debt.toFixed(2)} ₼</div>
                      : <div className="text-[11px] text-emerald-600">ödənilib</div>)}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-stone-300 transition-transform ${open ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {open && (
                <div className="px-4 pb-3 bg-stone-50/60">
                  {lines === undefined ? null : lines.length === 0 ? (
                    <p className="text-xs text-stone-400 py-2">Yüklənir…</p>
                  ) : (
                    <div className="divide-y divide-stone-100">
                      {lines.map(l => (
                        <div key={l.stockItemId} className="flex items-center justify-between py-1.5 text-sm">
                          <span className="text-stone-700">{l.name}</span>
                          <span className="text-stone-500 tabular-nums">
                            {l.qty} {l.unit}{l.unitCost !== undefined ? ` × ${l.unitCost.toFixed(2)} ₼ = ${(l.qty * l.unitCost).toFixed(2)} ₼` : ''}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between py-1.5 text-sm font-medium">
                        <span className="text-stone-600">Cəmi</span>
                        <span className="text-stone-800 tabular-nums">{r.total.toFixed(2)} ₼</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 text-xs">
                        <span className="text-stone-500">Ödənilib</span>
                        <span className="tabular-nums text-stone-600">{r.paidAmount.toFixed(2)} ₼{debt > 0.005 ? ` · borc ${debt.toFixed(2)} ₼` : ''}</span>
                      </div>
                    </div>
                  )}
                  {!voided && (
                    <div className="flex justify-end gap-2 pt-2">
                      <button className={btnGhost} onClick={() => setEditingReceipt(r)}><Pencil className="w-3.5 h-3.5" /> Düzəliş</button>
                      <button className={btnGhost} onClick={() => askVoid(r)}><Trash2 className="w-3.5 h-3.5 text-red-500" /> Sil</button>
                    </div>
                  )}
                  {voided && <p className="text-xs text-red-400 pt-2">{r.voidedBy ? `${r.voidedBy} tərəfindən ` : ''}silinib{r.voidedAt ? ` · ${new Date(r.voidedAt).toLocaleString('az-AZ')}` : ''}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editingReceipt && (
        <NewReceipt activeWh={activeWh} suppliers={suppliers.filter(s => s.active)} items={items}
          initial={editingReceipt === 'new' ? null : editingReceipt}
          initialLines={editingReceipt === 'new' ? null : lineCache[editingReceipt.id]}
          onClose={() => setEditingReceipt(null)}
          onDone={async () => {
            const wasEdit = editingReceipt !== 'new';
            setEditingReceipt(null);
            if (wasEdit) { setLineCache({}); setExpandedId(null); }
            await reload();
            flash(wasEdit ? 'Bazarlıq yeniləndi' : 'Bazarlıq əlavə olundu');
          }} fail={fail} />
      )}
    </div>
  );
}

function NewReceipt({ activeWh, suppliers, items, initial, initialLines, onClose, onDone, fail }: {
  activeWh: Wh[]; suppliers: Supplier[]; items: StockItem[];
  initial?: StockReceipt | null; initialLines?: ReceiptLineDetail[] | null;
  onClose: () => void; onDone: () => void; fail: (m: string | null) => void;
}) {
  const editing = !!initial;
  const seedLines = (ls: ReceiptLineDetail[]) => ls.map(l => ({ stockItemId: l.stockItemId, qty: String(l.qty), unitCost: l.unitCost !== undefined ? String(l.unitCost) : '' }));
  const [whId, setWhId] = useState(initial?.warehouseId ?? activeWh[0]?.id ?? '');
  const [supId, setSupId] = useState(initial?.supplierId ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [paid, setPaid] = useState(initial ? String(initial.paidAmount) : '');
  const [lines, setLines] = useState<{ stockItemId: string; qty: string; unitCost: string }[]>(
    initialLines && initialLines.length ? seedLines(initialLines) : [{ stockItemId: items[0]?.id ?? '', qty: '', unitCost: '' }]
  );
  const [busy, setBusy] = useState(false);
  // When editing, the cache may still be loading (empty). Always refetch the
  // authoritative lines so a save can never wipe the purchase with a blank form.
  const [linesReady, setLinesReady] = useState(!editing || !!(initialLines && initialLines.length));
  useEffect(() => {
    if (!editing || !initial) return;
    let alive = true;
    fetchReceiptLines(initial.id).then(ls => {
      if (!alive) return;
      if (ls.length) setLines(seedLines(ls));
      setLinesReady(true);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unitCost) || 0), 0);
  const paidNum = parseFloat(paid) || 0;
  const debt = total - paidNum;
  function setLine(i: number, patch: Partial<{ stockItemId: string; qty: string; unitCost: string }>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  const unitOf = (id: string) => items.find(it => it.id === id)?.unit ?? '';

  async function save() {
    const valid: ReceiptLine[] = lines
      .filter(l => l.stockItemId && parseFloat(l.qty) > 0)
      .map(l => ({ stockItemId: l.stockItemId, qty: parseFloat(l.qty), unitCost: l.unitCost ? parseFloat(l.unitCost) : undefined }));
    if (!whId || valid.length === 0) { fail('Anbar və ən azı bir məhsul sətri lazımdır.'); return; }
    setBusy(true);
    const err = editing
      ? await updateReceipt(initial!.id, whId, supId || null, valid, note, paidNum)
      : await recordReceipt(whId, supId || null, valid, note, paidNum);
    setBusy(false);
    if (err) { fail(err); return; }
    onDone();
  }

  return (
    <Modal title={editing ? 'Bazarlığa düzəliş' : 'Yeni bazarlıq'} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-stone-500 mb-1">Anbar</label>
          <select className={inputCls} value={whId} onChange={e => setWhId(e.target.value)}>
            {activeWh.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-stone-500 mb-1">Tədarükçü</label>
          <select className={inputCls} value={supId} onChange={e => setSupId(e.target.value)}>
            <option value="">— seçilməyib —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-stone-500">Məhsullar</span>
          <button className={btnGhost} onClick={() => setLines([...lines, { stockItemId: items[0]?.id ?? '', qty: '', unitCost: '' }])}><Plus className="w-3.5 h-3.5" /> Sətir</button>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <select className={`${inputCls} flex-1`} value={l.stockItemId} onChange={e => setLine(i, { stockItemId: e.target.value })}>
              {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
            <input className={`${inputCls} w-20`} type="number" placeholder="say" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} />
            <span className="text-xs text-stone-400 w-8">{unitOf(l.stockItemId)}</span>
            <input className={`${inputCls} w-24`} type="number" placeholder="qiymət" value={l.unitCost} onChange={e => setLine(i, { unitCost: e.target.value })} />
            {lines.length > 1 && <button className="text-stone-400 hover:text-red-500" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}><X className="w-4 h-4" /></button>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div><label className="block text-xs text-stone-500 mb-1">Qeyd</label><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} /></div>
        <div>
          <label className="block text-xs text-stone-500 mb-1">Ödənilən məbləğ (₼)</label>
          <div className="flex items-center gap-2">
            <input className={inputCls} type="number" placeholder="0" value={paid} onChange={e => setPaid(e.target.value)} />
            <button type="button" className="text-xs text-stone-500 whitespace-nowrap hover:text-stone-800" onClick={() => setPaid(total.toFixed(2))}>tam</button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-stone-600">
          Cəmi: <b className="tabular-nums">{total.toFixed(2)} ₼</b>
          {debt > 0.005
            ? <span className="ml-2 text-red-500">borc {debt.toFixed(2)} ₼</span>
            : <span className="ml-2 text-emerald-600">ödənilib</span>}
        </div>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={onClose}>Ləğv et</button>
          <button className={btnPrimary} onClick={save} disabled={busy || !linesReady}>Yadda saxla</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Silinmələr ─────────────────────────────────────────────────────────────────

function WriteoffsTab() {
  const [rows, setRows] = useState<WriteoffEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { fetchWriteoffs().then(r => { setRows(r); setLoaded(true); }); }, []);

  if (!loaded) return <div className="text-sm text-stone-400 py-10 text-center">Yüklənir…</div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-400">Qalıqlar bölməsində edilən bütün silinmələr — tarix, miqdar və səbəb.</p>
      <div className="bg-white rounded-2xl border border-stone-100 divide-y divide-stone-100">
        {rows.length === 0 && <p className="text-sm text-stone-400 p-6 text-center">Silinmə yoxdur</p>}
        {rows.map(w => (
          <div key={w.id} className="flex items-start justify-between px-4 py-3 gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-stone-800">{w.name}</div>
              <div className="text-xs text-stone-400">
                {new Date(w.createdAt).toLocaleString('az-AZ')} · {w.warehouseName}
                {w.reason ? <> · <span className="text-stone-500">{w.reason}</span></> : ''}
                {w.createdBy ? ` · ${w.createdBy}` : ''}
              </div>
            </div>
            <span className="text-sm font-semibold tabular-nums text-red-500 shrink-0">−{w.qty} {w.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Reseptlər ──────────────────────────────────────────────────────────────────

function RecipesTab({ items, flash, fail }: {
  items: StockItem[]; flash: (m: string) => void; fail: (m: string | null) => void;
}) {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [lines, setLines] = useState<RecipeLineRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);

  async function reload() {
    const [m, l] = await Promise.all([fetchMenu(), fetchRecipeLines()]);
    setMenu(m.filter(mi => (mi.kind ?? 'product') === 'meal')); setLines(l); setLoaded(true);
  }
  useEffect(() => { reload(); }, []);

  const linesFor = (menuItemId: string) => lines.filter(l => l.menuItemId === menuItemId);
  const itemName = (id: string) => items.find(it => it.id === id)?.name ?? '—';
  const itemUnit = (id: string) => items.find(it => it.id === id)?.unit ?? '';

  if (items.length === 0) return <Empty msg="Əvvəlcə «Qalıqlar» bölməsində məhsul yaradın." />;
  if (!loaded) return <div className="text-sm text-stone-400 py-10 text-center">Yüklənir…</div>;
  if (menu.length === 0) return <Empty msg="Menyuda yemək yoxdur — əvvəlcə menyuya yemək əlavə edin." />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-400">Yalnız resepti olan menyu məhsulları satışda anbardan çıxılır.</p>
      <div className="bg-white rounded-2xl border border-stone-100 divide-y divide-stone-100">
        {menu.map(mi => {
          const ls = linesFor(mi.id);
          return (
            <div key={mi.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-stone-800 truncate">{mi.name}</div>
                <div className="text-xs text-stone-400 truncate">
                  {ls.length === 0 ? 'resept yoxdur' : ls.map(l => `${itemName(l.stockItemId)} ${l.qty}${itemUnit(l.stockItemId)}`).join(', ')}
                </div>
              </div>
              <button className={btnGhost} onClick={() => setEditing(mi)}>
                <Pencil className="w-3.5 h-3.5" /> Resept
              </button>
            </div>
          );
        })}
      </div>

      {editing && (
        <RecipeModal menuItem={editing} items={items} initial={linesFor(editing.id)}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); flash('Resept yadda saxlanıldı'); }} fail={fail} />
      )}
    </div>
  );
}

function RecipeModal({ menuItem, items, initial, onClose, onSaved, fail }: {
  menuItem: MenuItem; items: StockItem[]; initial: RecipeLineRow[]; onClose: () => void; onSaved: () => void; fail: (m: string | null) => void;
}) {
  const [rows, setRows] = useState<{ stockItemId: string; qty: string }[]>(
    initial.length ? initial.map(l => ({ stockItemId: l.stockItemId, qty: String(l.qty) })) : [{ stockItemId: items[0]?.id ?? '', qty: '' }]
  );
  const [busy, setBusy] = useState(false);
  const unitOf = (id: string) => items.find(it => it.id === id)?.unit ?? '';
  function setRow(i: number, patch: Partial<{ stockItemId: string; qty: string }>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  async function save() {
    const lines: RecipeIngredient[] = rows
      .filter(r => r.stockItemId && parseFloat(r.qty) > 0)
      .map(r => ({ stockItemId: r.stockItemId, qty: parseFloat(r.qty) }));
    setBusy(true);
    const err = await saveRecipe(menuItem.id, lines);
    setBusy(false);
    if (err) { fail(err); return; }
    onSaved();
  }
  return (
    <Modal title={`Resept — ${menuItem.name}`} onClose={onClose} wide>
      <p className="text-xs text-stone-500 mb-3">1 ədəd satılanda anbardan çıxılacaq məhsullar. Boş saxlasanız, bu məhsul anbara təsir etməyəcək.</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select className={`${inputCls} flex-1`} value={r.stockItemId} onChange={e => setRow(i, { stockItemId: e.target.value })}>
              {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
            <input className={`${inputCls} w-24`} type="number" placeholder="miqdar" value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} />
            <span className="text-xs text-stone-400 w-8">{unitOf(r.stockItemId)}</span>
            <button className="text-stone-400 hover:text-red-500" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}><X className="w-4 h-4" /></button>
          </div>
        ))}
        <button className={btnGhost} onClick={() => setRows([...rows, { stockItemId: items[0]?.id ?? '', qty: '' }])}><Plus className="w-3.5 h-3.5" /> Sətir</button>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className={btnGhost} onClick={onClose}>Ləğv et</button>
        <button className={btnPrimary} onClick={save} disabled={busy}>Yadda saxla</button>
      </div>
    </Modal>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────────────

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl p-6 w-full ${wide ? 'max-w-lg' : 'max-w-sm'}`} onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-stone-800 mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center text-sm text-stone-400">{msg}</div>;
}
