'use client';

import { useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, X, Check, SlidersHorizontal, ImagePlus } from 'lucide-react';
import { saveModifierGroups } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { MenuItem, ModifierGroup, ModifierOption } from '@/types';
import { DialogState } from '@/components/AppDialog';

// One option row while it's being edited. Prices are kept as strings so a
// half-typed "1." doesn't collapse to 1 under the user's fingers.
interface FormOption {
  id: string;
  name: string;
  price: string;
  image: string;
}

function blankOption(): FormOption {
  return { id: crypto.randomUUID(), name: '', price: '', image: '' };
}

// The admin page owns `groups` — the product form needs the same list for its
// attach checkboxes — so this panel edits through the setter instead of a copy.
export default function ModifiersPanel({
  groups,
  setGroups,
  menu,
  setDialog,
}: {
  groups: ModifierGroup[];
  setGroups: (g: ModifierGroup[]) => void;
  menu: MenuItem[];
  setDialog: (d: DialogState | null) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ModifierGroup | null>(null);
  const [name, setName] = useState('');
  const [pickOne, setPickOne] = useState(true);
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<FormOption[]>([blankOption()]);
  const [saving, setSaving] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const imgTargetIdx = useRef<number>(0);

  // How many products each set is attached to — the whole point of a set is being
  // reused, and this is what tells the owner it actually is.
  const usageCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of menu) {
      for (const id of item.modifierGroupIds ?? []) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [menu]);

  function openNew() {
    setEditing(null);
    setName(''); setPickOne(true); setRequired(false);
    setOptions([blankOption()]);
    setFormOpen(true);
  }

  function openEdit(g: ModifierGroup) {
    setEditing(g);
    setName(g.name);
    setPickOne(g.maxSelect === 1);
    setRequired(g.minSelect > 0);
    setOptions(g.options.length > 0
      ? g.options.map(o => ({ id: o.id, name: o.name, price: o.price ? String(o.price) : '', image: o.image ?? '' }))
      : [blankOption()]);
    setFormOpen(true);
  }

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const idx = imgTargetIdx.current;
    setUploadingIdx(idx);
    try {
      const path = `modifiers/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '')}`;
      const { error } = await supabase.storage.from('menu-images').upload(path, file, { upsert: true });
      if (error) { setDialog({ title: 'Xəta', message: 'Şəkil yüklənmədi: ' + error.message }); return; }
      const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
      setOptions(prev => prev.map((o, i) => i === idx ? { ...o, image: data.publicUrl } : o));
    } finally {
      setUploadingIdx(null);
      if (imgRef.current) imgRef.current.value = '';
    }
  }

  async function persist(next: ModifierGroup[]): Promise<boolean> {
    setSaving(true);
    const err = await saveModifierGroups(next);
    setSaving(false);
    if (err) { setDialog({ title: 'Xəta', message: 'Modifikatorlar yadda saxlanmadı: ' + err }); return false; }
    setGroups(next);
    return true;
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) { setDialog({ title: 'Ad boşdur', message: 'Modifikator dəstinin adını yazın.' }); return; }

    const cleaned = options
      .filter(o => o.name.trim())
      .map((o, i) => ({
        id: o.id,
        name: o.name.trim(),
        // A blank price is a free choice, not a missing value.
        price: o.price ? Math.round(parseFloat(o.price) * 100) / 100 || 0 : 0,
        image: o.image || undefined,
        position: i,
      }) satisfies ModifierOption);

    if (cleaned.length === 0) {
      setDialog({ title: 'Seçim yoxdur', message: 'Ən azı bir seçim əlavə edin.' });
      return;
    }
    if (groups.some(g => g.id !== editing?.id && g.name.trim().toLocaleLowerCase('az') === trimmed.toLocaleLowerCase('az'))) {
      setDialog({ title: 'Təkrar ad', message: 'Bu adda dəst artıq var.' });
      return;
    }

    const g: ModifierGroup = {
      id: editing?.id ?? crypto.randomUUID(),
      name: trimmed,
      minSelect: required ? 1 : 0,
      maxSelect: pickOne ? 1 : null,
      position: editing?.position ?? groups.length,
      options: cleaned,
    };
    const next = editing ? groups.map(x => x.id === editing.id ? g : x) : [...groups, g];
    if (await persist(next)) setFormOpen(false);
  }

  function confirmDelete(g: ModifierGroup) {
    const used = usageCount.get(g.id) ?? 0;
    setDialog({
      title: 'Dəsti silmək?',
      message: used > 0
        ? `"${g.name}" ${used} məhsula bağlıdır. Silinsə, həmin məhsullarda bu seçimlər göstərilməyəcək. Köhnə sifarişlərə təsir etmir.`
        : `"${g.name}" silinsin?`,
      confirmLabel: 'Sil',
      onConfirm: async () => {
        setDialog(null);
        await persist(groups.filter(x => x.id !== g.id));
      },
    });
  }

  return (
    <div>
      <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />

      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-stone-600">{groups.length} dəst</p>
          <p className="text-xs text-stone-400 mt-0.5">
            Bir dəfə yaradın, istədiyiniz qədər məhsula bağlayın. Seçimin qiyməti məhsulun qiymətinin üstünə gəlir.
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 text-sm bg-primary-700 hover:bg-primary-800 text-white px-3 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Yeni dəst
        </button>
      </div>

      {groups.length === 0 && !formOpen && (
        <div className="text-center py-10 text-stone-400">
          <SlidersHorizontal className="w-10 h-10 mx-auto mb-3 text-stone-200" />
          <p className="text-sm">Hələ modifikator dəsti yoxdur</p>
        </div>
      )}

      <ul className="space-y-2">
        {groups.map(g => {
          const used = usageCount.get(g.id) ?? 0;
          return (
            <li key={g.id} className="bg-white border border-stone-200 rounded-xl px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-stone-800 text-sm">
                    {g.name}
                    {g.minSelect > 0 && <span className="text-red-500 ml-1" title="Mütləq seçilməlidir">*</span>}
                  </p>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {g.maxSelect === 1 ? 'Bir seçim' : 'Bir neçə seçim'} · {used} məhsulda
                  </p>
                  <p className="text-xs text-stone-500 mt-1 truncate">
                    {g.options.map(o => o.price > 0 ? `${o.name} +${o.price.toFixed(2)}₼` : o.name).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(g)} title="Düzəlt" className="text-blue-500 hover:text-blue-700 p-1.5 rounded-lg hover:bg-blue-50">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => confirmDelete(g)} title="Sil" className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {formOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
              <h3 className="font-bold text-stone-800">{editing ? 'Dəsti düzəlt' : 'Yeni dəst'}</h3>
              <button onClick={() => setFormOpen(false)} className="text-stone-400 hover:text-stone-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Ad</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Şuruplar"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-primary-600"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {([[true, 'Bir seçim'], [false, 'Bir neçə seçim']] as const).map(([val, label]) => (
                  <button
                    key={label}
                    onClick={() => setPickOne(val)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${pickOne === val ? 'bg-primary-700 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'}`}
                  >
                    {label}
                  </button>
                ))}
                <label className="flex items-center gap-2 text-sm text-stone-600 ml-1 px-2">
                  <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} className="w-4 h-4 accent-primary-700" />
                  Mütləq seçilsin
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">
                  Seçimlər <span className="font-normal normal-case text-stone-400">— qiymət boş və ya 0 olsa, qiymətə təsir etmir</span>
                </label>
                <ul className="space-y-2">
                  {options.map((o, i) => (
                    <li key={o.id} className="flex items-center gap-2">
                      <button
                        onClick={() => { imgTargetIdx.current = i; imgRef.current?.click(); }}
                        title="Şəkil"
                        className="shrink-0 w-10 h-10 rounded-lg border border-stone-200 flex items-center justify-center overflow-hidden hover:border-stone-300 text-stone-400"
                      >
                        {o.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={o.image} alt="" className="w-full h-full object-cover" />
                          : uploadingIdx === i ? <span className="text-[10px]">...</span> : <ImagePlus className="w-4 h-4" />}
                      </button>
                      <input
                        value={o.name}
                        onChange={e => setOptions(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                        placeholder="Reyhan"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-primary-600"
                      />
                      <div className="relative shrink-0 w-24">
                        <input
                          value={o.price}
                          onChange={e => setOptions(prev => prev.map((x, j) => j === i ? { ...x, price: e.target.value.replace(',', '.') } : x))}
                          inputMode="decimal"
                          placeholder="0"
                          className="w-full pl-5 pr-6 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-primary-600"
                        />
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 text-sm">+</span>
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 text-sm">₼</span>
                      </div>
                      <button
                        onClick={() => setOptions(prev => prev.length === 1 ? [blankOption()] : prev.filter((_, j) => j !== i))}
                        className="shrink-0 text-stone-300 hover:text-red-500 p-1"
                        title="Sil"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => setOptions(prev => [...prev, blankOption()])}
                  className="mt-2 flex items-center gap-1.5 text-sm text-primary-700 hover:text-primary-800 px-1 py-1"
                >
                  <Plus className="w-4 h-4" /> Seçim əlavə et
                </button>
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-stone-100">
              <button onClick={() => setFormOpen(false)} className="flex-1 py-2.5 rounded-lg border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">
                Ləğv et
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2.5 rounded-lg bg-primary-700 hover:bg-primary-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold text-sm flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" /> {saving ? 'Saxlanılır…' : 'Yadda saxla'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
