'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, X, Check, ChefHat, Printer, Bell } from 'lucide-react';
import { saveStations, assignItemsToStation, fetchSoundEnabled, setSoundEnabled } from '@/lib/store';
import { MenuItem, Station } from '@/types';
import { DialogState } from '@/components/AppDialog';

// A blank IP means "no printer yet" — the station still routes tickets, they
// just wait in the queue. Only a malformed IP is worth rejecting.
function isValidIp(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

// The admin page owns `stations` (its item form needs the same list for its
// dropdown), so this panel edits through the setter instead of holding a copy.
export default function StationsPanel({
  stations,
  setStations,
  menu,
  reloadMenu,
  setDialog,
}: {
  stations: Station[];
  setStations: (s: Station[]) => void;
  menu: MenuItem[];
  reloadMenu: () => Promise<void>;
  setDialog: (d: DialogState | null) => void;
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editIp, setEditIp] = useState('');
  const [assignFor, setAssignFor] = useState<Station | null>(null);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => { fetchSoundEnabled().then(setSoundOn); }, []);

  async function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    await setSoundEnabled(next);
  }

  const countByStation = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of menu) if (item.stationId) m.set(item.stationId, (m.get(item.stationId) ?? 0) + 1);
    return m;
  }, [menu]);

  const unassigned = useMemo(() => menu.filter(i => !i.stationId), [menu]);

  async function persist(next: Station[]): Promise<boolean> {
    const err = await saveStations(next);
    if (err) { setDialog({ title: 'Xəta', message: 'Sexlər yadda saxlanmadı: ' + err }); return false; }
    return true;
  }

  async function addStation() {
    const name = newName.trim();
    if (!name) return;
    if (stations.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      setDialog({ title: 'Diqqət', message: 'Bu adda sex artıq var.' });
      return;
    }
    const next = [...stations, { id: crypto.randomUUID(), name, printerIp: null, printerPort: 9100 }];
    setStations(next);
    setNewName('');
    if (!await persist(next)) setStations(stations);
  }

  function startEdit(s: Station) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditIp(s.printerIp ?? '');
  }

  async function saveEdit() {
    const name = editName.trim();
    const ip = editIp.trim();
    if (!name) return;
    if (ip && !isValidIp(ip)) {
      setDialog({ title: 'Diqqət', message: 'IP ünvanı düzgün deyil. Nümunə: 192.168.1.50' });
      return;
    }
    const prev = stations;
    const next = stations.map(s => s.id === editingId ? { ...s, name, printerIp: ip || null } : s);
    setStations(next);
    setEditingId(null);
    if (!await persist(next)) setStations(prev);
  }

  async function removeStation(s: Station) {
    const count = countByStation.get(s.id) ?? 0;
    setDialog({
      title: 'Sexi sil',
      message: count > 0
        ? `"${s.name}" silinsin? ${count} məhsul sexsiz qalacaq — məhsullar silinmir.`
        : `"${s.name}" silinsin?`,
      confirmLabel: 'Sil',
      onConfirm: async () => {
        const prev = stations;
        const next = stations.filter(x => x.id !== s.id);
        setStations(next);
        if (await persist(next)) await reloadMenu();   // items' station_id was nulled by the FK
        else setStations(prev);
      },
    });
  }

  async function toggleAssign(item: MenuItem, station: Station) {
    const nextId = item.stationId === station.id ? null : station.id;
    const err = await assignItemsToStation([item.id], nextId);
    if (err) { setDialog({ title: 'Xəta', message: 'Təyin edilmədi: ' + err }); return; }
    await reloadMenu();
  }

  return (
    <div>
      <p className="text-sm text-stone-500 mb-5">
        Sex — yeməyin hazırlandığı yer. Hər məhsulu öz sexinə təyin edin: sifariş veriləndə
        qəbz yalnız həmin sexin printerindən çıxacaq.
      </p>

      <div className="bg-white rounded-xl border border-stone-100 card p-4 mb-5 flex items-center gap-3">
        <Bell className="w-4 h-4 text-stone-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-700">Səs bildirişləri</p>
          <p className="text-xs text-stone-500 mt-0.5">
            {soundOn
              ? 'Yeni sifariş veriləndə satış ekranları səs verir; yemək silinəndə fərqli səs'
              : 'Deaktivdir — satış ekranları səs vermir'}
          </p>
        </div>
        <button
          onClick={toggleSound}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${soundOn ? 'bg-primary-800' : 'bg-stone-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${soundOn ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      <div className="space-y-2 mb-5">
        {stations.map(s => {
          const count = countByStation.get(s.id) ?? 0;
          const isEditing = editingId === s.id;
          return (
            <div key={s.id} className="bg-white rounded-xl border border-stone-100 card p-4">
              {isEditing ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveEdit()}
                    placeholder="Sexin adı"
                    autoFocus
                    className="flex-1 bg-white border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
                  />
                  <input
                    value={editIp}
                    onChange={e => setEditIp(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveEdit()}
                    placeholder="Printer IP (məs: 192.168.1.50)"
                    className="flex-1 bg-white border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={saveEdit} title="Yadda saxla" className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary-800 hover:bg-primary-900 text-white transition-colors">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingId(null)} title="Ləğv et" className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <ChefHat className="w-4 h-4 text-stone-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-stone-700 truncate">{s.name}</p>
                    <p className="text-xs text-stone-400 flex items-center gap-1.5 mt-0.5">
                      <span>{count} məhsul</span>
                      <span>·</span>
                      {s.printerIp
                        ? <span className="flex items-center gap-1"><Printer className="w-3 h-3" /> {s.printerIp}</span>
                        : <span className="text-amber-600">printer təyin edilməyib</span>}
                    </p>
                  </div>
                  <button onClick={() => setAssignFor(s)} className="text-sm text-primary-800 hover:text-primary-900 font-medium px-3 py-1.5 rounded-lg hover:bg-stone-50 transition-colors shrink-0">
                    Məhsullar
                  </button>
                  <button onClick={() => startEdit(s)} title="Redaktə et" className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors shrink-0">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => removeStation(s)} title="Sil" className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {stations.length === 0 && (
          <div className="bg-white rounded-xl border border-stone-100 card p-16 text-center">
            <ChefHat className="w-10 h-10 mx-auto mb-3 text-stone-200" />
            <p className="text-sm text-stone-500">Sex yoxdur</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addStation()}
          placeholder="Yeni sexin adı — məs: Mətbəx, Bar, Kabab"
          className="flex-1 bg-white border border-stone-200 rounded-xl px-3.5 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-primary-300"
        />
        <button
          onClick={addStation}
          disabled={!newName.trim()}
          className="flex items-center gap-2 bg-primary-800 hover:bg-primary-900 disabled:opacity-30 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" /> Sex əlavə et
        </button>
      </div>

      {unassigned.length > 0 && stations.length > 0 && (
        <p className="text-xs text-amber-600 mt-4">
          {unassigned.length} məhsul heç bir sexə təyin edilməyib.
        </p>
      )}

      {assignFor && (
        <AssignDialog
          station={assignFor}
          menu={menu}
          onToggle={item => toggleAssign(item, assignFor)}
          onClose={() => setAssignFor(null)}
        />
      )}
    </div>
  );
}

// Assigning from the station's side, not the item's: picking 12 dishes for
// "Mətbəx" in one pass beats opening 12 item forms.
function AssignDialog({
  station,
  menu,
  onToggle,
  onClose,
}: {
  station: Station;
  menu: MenuItem[];
  onToggle: (item: MenuItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const items = q ? menu.filter(i => i.name.toLowerCase().includes(q)) : menu;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 pb-3 shrink-0">
          <div>
            <h3 className="font-semibold text-stone-800">{station.name}</h3>
            <p className="text-xs text-stone-400 mt-0.5">Bu sexdə hazırlanan məhsulları seçin</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-3 shrink-0">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Məhsul adı ilə axtar"
            className="w-full bg-white border border-stone-200 rounded-xl px-3.5 py-2 text-sm placeholder:text-stone-400 focus:outline-none focus:border-primary-300"
          />
        </div>

        <div className="overflow-y-auto px-5 pb-5 space-y-1">
          {items.map(item => {
            const mine = item.stationId === station.id;
            const elsewhere = !!item.stationId && !mine;
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${mine ? 'bg-primary-50' : 'hover:bg-stone-50'}`}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${mine ? 'bg-primary-800 border-primary-800' : 'border-stone-300'}`}>
                  {mine && <Check className="w-3 h-3 text-white" />}
                </span>
                <span className="flex-1 text-sm text-stone-700 truncate">{item.name}</span>
                {/* An item lives in exactly one sex — say so, rather than silently stealing it */}
                {elsewhere && <span className="text-[11px] text-stone-400 shrink-0">başqa sexdə</span>}
              </button>
            );
          })}
          {items.length === 0 && <p className="text-sm text-stone-400 text-center py-8">Məhsul tapılmadı</p>}
        </div>
      </div>
    </div>
  );
}
