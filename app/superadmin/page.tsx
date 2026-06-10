'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LogOut, Plus, Building2, Trash2, EyeOff, Eye, X, ShieldCheck, UserCircle, MapPin, Phone, User, KeyRound, RotateCcw, PanelLeftClose, PanelLeftOpen, Menu, Calendar,
} from 'lucide-react';
import { getSession, logout } from '@/lib/auth';
import {
  fetchCompanies, createCompany, trashCompany, toggleCompanyActive, updateCompanyName, updateCompanyExpiry,
  fetchAllUsers, createUser, deleteUser, toggleUserActive, updateCompanyProfile, updateOwnerAccount,
  fetchCompanyTrash, restoreCompany, permanentlyDeleteCompany, verifyPassword, updateUser,
} from '@/lib/store';
import { TrashItem } from '@/types';

interface SAUser {
  id: string;
  username: string;
  name: string;
  role: string;
  companyId: string | null;
  active: boolean;
  createdAt: string;
}

interface Company {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
  ownerName: string | null;
  address: string | null;
  phone: string | null;
  ownerUser?: SAUser;
}

export default function SuperadminPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // inline name edit
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState('');

  // profile modal — company info section
  const [profileCompany, setProfileCompany] = useState<Company | null>(null);
  const [profOwner, setProfOwner] = useState('');
  const [profAddress, setProfAddress] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profExpiry, setProfExpiry] = useState<string | null>(null);
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [profSaving, setProfSaving] = useState(false);
  const [profMsg, setProfMsg] = useState('');

  // profile modal — admin account section
  const [modalOwnerUser, setModalOwnerUser] = useState<SAUser | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [ownerMsg, setOwnerMsg] = useState('');

  // create company form
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companySlug, setCompanySlug] = useState('');
  const [saving, setSaving] = useState(false);

  // trash
  const [companyTrash, setCompanyTrash] = useState<TrashItem[]>([]);
  const [showTrash, setShowTrash] = useState(false);

  // account / password modal
  const [showAccount, setShowAccount] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwShowCurrent, setPwShowCurrent] = useState(false);
  const [pwShowNew, setPwShowNew] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'superadmin') { router.replace('/login'); return; }
    loadData();
    fetchCompanyTrash().then(setCompanyTrash);
  }, [router]);

  async function loadData(): Promise<Company[]> {
    setLoading(true);
    const [comps, usrs] = await Promise.all([fetchCompanies(), fetchAllUsers()]);
    const owners = usrs.filter(u => u.role === 'owner');
    const withOwners: Company[] = comps.map(c => ({
      ...c,
      ownerUser: owners.find(u => u.companyId === c.id),
    }));
    setCompanies(withOwners);
    setLoading(false);
    return withOwners;
  }

  function openProfileModal(c: Company) {
    setProfileCompany(c);
    setProfOwner(c.ownerName ?? '');
    setProfAddress(c.address ?? '');
    setProfPhone(c.phone ?? '');
    setProfExpiry(c.expiresAt ?? null);
    setShowCustomDate(false);
    setProfMsg('');
    setModalOwnerUser(c.ownerUser ?? null);
    setOwnerName(c.ownerUser?.name ?? '');
    setOwnerUsername(c.ownerUser?.username ?? '');
    setOwnerPassword('');
    setOwnerMsg('');
  }

  async function handleSaveProfile() {
    if (!profileCompany) return;
    setProfSaving(true);
    await Promise.all([
      updateCompanyProfile(profileCompany.id, profOwner.trim(), profAddress.trim(), profPhone.trim()),
      updateCompanyExpiry(profileCompany.id, profExpiry),
    ]);
    setProfMsg('Yadda saxlandı');
    setProfSaving(false);
    loadData();
    setTimeout(() => setProfMsg(''), 2000);
  }

  function addMonthsToExpiry(months: number) {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    let base: Date;
    const savedExpiry = profileCompany?.expiresAt;
    if (savedExpiry) {
      const localNoon = new Date(savedExpiry.slice(0, 10) + 'T12:00:00');
      base = localNoon > now ? new Date(localNoon) : new Date(now);
    } else {
      base = new Date(now);
    }
    base.setMonth(base.getMonth() + months);
    setProfExpiry(base.toISOString());
  }

  async function handleSaveOwner() {
    if (!profileCompany || !modalOwnerUser) return;
    setOwnerSaving(true);
    const err = await updateOwnerAccount(modalOwnerUser.id, ownerName.trim(), ownerUsername.trim(), ownerPassword || undefined);
    if (err) {
      setOwnerMsg('Xəta: ' + err);
    } else {
      setModalOwnerUser(prev => prev ? { ...prev, name: ownerName.trim(), username: ownerUsername.trim() } : null);
      setOwnerPassword('');
      setOwnerMsg('Yadda saxlandı');
      loadData();
      setTimeout(() => setOwnerMsg(''), 2000);
    }
    setOwnerSaving(false);
  }

  async function handleCreateOwner() {
    if (!profileCompany) return;
    if (!ownerName.trim() || !ownerUsername.trim() || !ownerPassword) {
      setOwnerMsg('Bütün sahələri doldurun');
      return;
    }
    setOwnerSaving(true);
    const err = await createUser(ownerUsername.trim(), ownerPassword, ownerName.trim(), 'owner', profileCompany.id);
    if (err) {
      setOwnerMsg('Xəta: ' + err);
    } else {
      setOwnerMsg('Hesab yaradıldı');
      setOwnerPassword('');
      const updated = await loadData();
      const updatedComp = updated.find(c => c.id === profileCompany.id);
      if (updatedComp?.ownerUser) setModalOwnerUser(updatedComp.ownerUser);
      setTimeout(() => setOwnerMsg(''), 2000);
    }
    setOwnerSaving(false);
  }

  async function handleToggleOwnerActive() {
    if (!modalOwnerUser) return;
    await toggleUserActive(modalOwnerUser.id, !modalOwnerUser.active);
    setModalOwnerUser(prev => prev ? { ...prev, active: !prev.active } : null);
    loadData();
  }

  async function handleDeleteOwner() {
    if (!modalOwnerUser) return;
    if (!confirm(`"${modalOwnerUser.name}" admin hesabı silinsin?`)) return;
    await deleteUser(modalOwnerUser.id);
    setModalOwnerUser(null);
    setOwnerName('');
    setOwnerUsername('');
    setOwnerPassword('');
    loadData();
  }

  async function handleChangePassword() {
    if (!pwNew || pwNew !== pwConfirm) { setPwMsg('Yeni şifrələr uyğun deyil'); return; }
    if (pwNew.length < 4) { setPwMsg('Şifrə ən az 4 simvol olmalıdır'); return; }
    const session = getSession();
    if (!session) return;
    setPwSaving(true);
    const ok = await verifyPassword(session.id, pwCurrent);
    if (!ok) { setPwMsg('Cari şifrə səhvdir'); setPwSaving(false); return; }
    await updateUser(session.id, session.name, pwNew);
    setPwMsg('Şifrə dəyişdirildi');
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    setPwSaving(false);
    setTimeout(() => { setPwMsg(''); setShowAccount(false); }, 1500);
  }

  async function handleCreateCompany(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await createCompany(companyName.trim(), companySlug.trim().toLowerCase());
    setCompanyName(''); setCompanySlug('');
    setShowCompanyForm(false);
    setSaving(false);
    loadData();
  }

  function expiryBadge(expiresAt: string | null) {
    if (!expiresAt) return null;
    const expiry = new Date(expiresAt.slice(0, 10) + 'T12:00:00');
    const days = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
    if (days < 0)  return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600 shrink-0">Müddəti bitib</span>;
    if (days <= 10) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700 shrink-0">{days} gün qaldı</span>;
    return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 shrink-0">{days} gün</span>;
  }

  function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <div className="flex flex-col h-full bg-white min-h-[calc(100vh-4rem)]">
        <div className={`flex items-center h-16 border-b border-gray-100/50 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#2779a7] flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-gray-800 text-sm">Superadmin</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="hidden md:flex w-8 h-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className={`flex flex-col gap-1 p-3 flex-1 ${collapsed ? 'items-center' : ''}`}>
          {collapsed ? (
            <button
              title="Şirkətlər"
              onClick={() => onNavigate?.()}
              className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-[#2779a7]/10 text-[#2779a7] before:absolute before:left-[-9px] before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-r-full before:bg-[#2779a7]"
            >
              <Building2 className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => onNavigate?.()}
              className="flex items-center gap-3 h-9 px-3 rounded-lg text-sm font-medium transition-colors w-full bg-[#2779a7] text-white shadow-sm"
            >
              <Building2 className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-left">Şirkətlər</span>
            </button>
          )}
        </nav>

        {!collapsed ? (
          <div className="px-4 py-4 border-t border-gray-100/50">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-[#49c5b6]/25 flex items-center justify-center text-[#2779a7] text-xs font-bold shrink-0">
                S
              </div>
              <span className="text-xs text-gray-500 truncate">Superadmin</span>
            </div>
            <button
              onClick={() => { logout(); router.push('/login'); }}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> Çıxış
            </button>
          </div>
        ) : (
          <div className="py-4 flex flex-col items-center gap-2 border-t border-gray-100/50">
            <div className="w-7 h-7 rounded-full bg-[#49c5b6]/25 flex items-center justify-center text-[#2779a7] text-xs font-bold">S</div>
            <button onClick={() => { logout(); router.push('/login'); }} title="Çıxış" className="text-gray-400 hover:text-red-500 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Top header */}
      <header className="sticky top-0 z-50 h-16 border-b border-gray-100/60 bg-white/80 backdrop-blur-sm flex items-center gap-3 px-4">
        <button
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 md:hidden">
          <div className="w-7 h-7 rounded-lg bg-[#2779a7] flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-gray-800 text-sm">Superadmin</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setShowTrash(true)}
          className="relative flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          {companyTrash.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{companyTrash.length}</span>
          )}
        </button>
        <button
          onClick={() => { setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwMsg(''); setShowAccount(true); }}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-[#2779a7] hover:bg-[#2779a7]/10 transition-colors"
          title="Hesabım"
        >
          <KeyRound className="w-4 h-4" />
        </button>
        <button
          onClick={() => { logout(); router.push('/login'); }}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Çıxış"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* Mobile sidebar overlay */}
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

        {/* Desktop sidebar */}
        <aside className={`hidden md:block flex-shrink-0 sticky top-16 self-start h-[calc(100vh-4rem)] transition-all duration-200 border-r border-gray-100/60 ${collapsed ? 'w-14' : 'w-56'}`}>
          <SidebarContent />
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 bg-gray-50 rounded-tl-2xl border-l border-t border-gray-100/60 p-6 md:p-8 overflow-y-auto">
          <div className="mb-6">
            <h1 className="text-lg font-semibold text-gray-900">Şirkətlər</h1>
            <p className="text-sm text-gray-500 mt-0.5">Şirkətləri idarə et</p>
          </div>

          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm text-gray-400">{companies.length} şirkət</p>
              <button
                onClick={() => setShowCompanyForm(true)}
                className="flex items-center gap-2 bg-[#2779a7] hover:bg-[#21678e] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" /> Yeni şirkət
              </button>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24">
                <span className="w-8 h-8 border-2 border-gray-200 border-t-[#2779a7] rounded-full animate-spin" />
                <p className="text-sm text-gray-400">Yüklənir...</p>
              </div>
            ) : companies.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-16 text-center">
                <Building2 className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-400">Şirkət yoxdur</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {companies.map((c, i) => (
                  <div key={c.id} className={`flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors ${i < companies.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="w-9 h-9 rounded-lg bg-[#49c5b6]/15 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-[#49c5b6]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingCompanyId === c.id ? (
                        <input
                          autoFocus
                          value={editingCompanyName}
                          onChange={e => setEditingCompanyName(e.target.value)}
                          onBlur={async () => {
                            const trimmed = editingCompanyName.trim();
                            if (trimmed && trimmed !== c.name) {
                              await updateCompanyName(c.id, trimmed);
                              loadData();
                            }
                            setEditingCompanyId(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setEditingCompanyId(null);
                          }}
                          className="font-semibold text-gray-800 text-sm border-b border-[#2779a7] focus:outline-none bg-transparent w-full"
                        />
                      ) : (
                        <p
                          className="font-semibold text-gray-800 cursor-pointer hover:text-[#2779a7] transition-colors text-sm"
                          onClick={() => { setEditingCompanyId(c.id); setEditingCompanyName(c.name); }}
                          title="Adı dəyişmək üçün klikləyin"
                        >
                          {c.name}
                        </p>
                      )}
                      <p className="text-xs text-gray-400">
                        {c.ownerUser ? `@${c.ownerUser.username}` : 'Hesab yoxdur'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {expiryBadge(c.expiresAt)}
                      <button
                        onClick={() => openProfileModal(c)}
                        className="text-xs text-gray-400 hover:text-[#2779a7] transition-colors"
                        title="Tarixi dəyişmək üçün profili açın"
                      >
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('az-AZ') : '+ tarix'}
                      </button>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.active ? 'Aktiv' : 'Deaktiv'}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openProfileModal(c)}
                        title="Profil və admin hesabı"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-[#2779a7]/10 hover:text-[#49c5b6] transition-colors"
                      >
                        <UserCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleCompanyActive(c.id, !c.active).then(loadData)}
                        title={c.active ? 'Deaktiv et' : 'Aktiv et'}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
                      >
                        {c.active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`"${c.name}" şirkəti zibil qutusuna göndərilsin?`)) return;
                          await trashCompany({ id: c.id, name: c.name, slug: c.slug, active: c.active, expiresAt: c.expiresAt, ownerName: c.ownerName, address: c.address, phone: c.phone });
                          loadData();
                          fetchCompanyTrash().then(setCompanyTrash);
                        }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Company Trash Modal */}
      {showTrash && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-gray-400" />
                <h3 className="text-base font-semibold text-gray-800">Zibil qutusu</h3>
              </div>
              <button onClick={() => setShowTrash(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {companyTrash.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Zibil qutusu boşdur</p>
              ) : companyTrash.map(item => {
                const c = item.data as Record<string, unknown>;
                const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(item.deletedAt.slice(0, 10) + 'T12:00:00').getTime()) / 86400000));
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-gray-100 hover:bg-gray-50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{String(c.name)}</p>
                      <p className="text-xs text-gray-400">{daysLeft} gün qalıb</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={async () => {
                          await restoreCompany(item);
                          setCompanyTrash(t => t.filter(x => x.id !== item.id));
                          loadData();
                        }}
                        className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 px-2 py-1 rounded-lg hover:bg-green-50 transition-colors font-medium"
                      >
                        <RotateCcw className="w-3 h-3" /> Bərpa et
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`"${String(c.name)}" həmişəlik silinsin?`)) return;
                          await permanentlyDeleteCompany(item.id, String(c.id));
                          setCompanyTrash(t => t.filter(x => x.id !== item.id));
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

      {/* Create Company Modal */}
      {showCompanyForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800">Yeni şirkət</h3>
              <button onClick={() => setShowCompanyForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCompany} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Şirkət adı</label>
                <input
                  value={companyName}
                  onChange={e => { setCompanyName(e.target.value); setCompanySlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')); }}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7]"
                  placeholder="Restoran adı"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Slug</label>
                <input
                  value={companySlug}
                  onChange={e => setCompanySlug(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2779a7]"
                  placeholder="restoran-adi"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-[#2779a7] hover:bg-[#21678e] disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors mt-2"
              >
                {saving ? 'Yaradılır...' : 'Yarat'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Superadmin Account / Password Modal */}
      {showAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#2779a7]" />
                <h3 className="font-bold text-gray-800">Şifrəni dəyiş</h3>
              </div>
              <button onClick={() => setShowAccount(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Cari şifrə</label>
                <div className="relative">
                  <input
                    type={pwShowCurrent ? 'text' : 'password'}
                    value={pwCurrent}
                    onChange={e => setPwCurrent(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-[#2779a7]"
                    placeholder="••••••"
                  />
                  <button type="button" onClick={() => setPwShowCurrent(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {pwShowCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Yeni şifrə</label>
                <div className="relative">
                  <input
                    type={pwShowNew ? 'text' : 'password'}
                    value={pwNew}
                    onChange={e => setPwNew(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-[#2779a7]"
                    placeholder="••••••"
                  />
                  <button type="button" onClick={() => setPwShowNew(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {pwShowNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Yeni şifrəni təsdiqlə</label>
                <input
                  type="password"
                  value={pwConfirm}
                  onChange={e => setPwConfirm(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7]"
                  placeholder="••••••"
                />
              </div>
              <button
                onClick={handleChangePassword}
                disabled={pwSaving}
                className="w-full bg-[#2779a7] hover:bg-[#21678e] disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors mt-1"
              >
                {pwSaving ? 'Yoxlanılır...' : 'Şifrəni dəyiş'}
              </button>
              {pwMsg && (
                <p className={`text-xs font-medium text-center ${pwMsg.includes('dəyişdirildi') ? 'text-green-600' : 'text-red-500'}`}>{pwMsg}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Company Profile + Admin Account Modal */}
      {profileCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <UserCircle className="w-5 h-5 text-[#2779a7]" />
                <h3 className="font-bold text-gray-800">{profileCompany.name}</h3>
              </div>
              <button onClick={() => setProfileCompany(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Şirkət məlumatları</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><User className="w-3.5 h-3.5" />Sahibin adı</label>
                <input value={profOwner} onChange={e => setProfOwner(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7]" placeholder="Ad Soyad" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><MapPin className="w-3.5 h-3.5" />Ünvan</label>
                <input value={profAddress} onChange={e => setProfAddress(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7]" placeholder="Şəhər, küçə, ev" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><Phone className="w-3.5 h-3.5" />Mobil nömrə</label>
                <input value={profPhone} onChange={e => setProfPhone(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7]" placeholder="+994 50 000 00 00" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><Calendar className="w-3.5 h-3.5" />Abunəlik müddəti</label>
                <div className="flex items-center gap-1.5 mb-2">
                  {[{ label: '1 ay', months: 1 }, { label: '3 ay', months: 3 }, { label: '6 ay', months: 6 }, { label: '1 il', months: 12 }].map(({ label, months }) => (
                    <button
                      key={months}
                      type="button"
                      onClick={() => { addMonthsToExpiry(months); setShowCustomDate(false); }}
                      className="flex-1 text-xs py-1.5 rounded-lg border border-[#2779a7]/30 text-[#2779a7] hover:bg-[#2779a7] hover:text-white font-medium transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowCustomDate(v => !v)}
                    title="Özəl tarix"
                    className={`w-8 h-7 flex items-center justify-center rounded-lg border text-xs font-bold transition-colors shrink-0 ${showCustomDate ? 'bg-[#2779a7] text-white border-[#2779a7]' : 'border-gray-200 text-gray-400 hover:border-[#2779a7] hover:text-[#2779a7]'}`}
                  >
                    +
                  </button>
                </div>
                {showCustomDate && (
                  <input
                    type="date"
                    autoFocus
                    defaultValue={profExpiry ? profExpiry.slice(0, 10) : ''}
                    onChange={e => {
                      if (e.target.value) setProfExpiry(new Date(e.target.value + 'T12:00:00').toISOString());
                    }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7] mb-2"
                  />
                )}
                {profExpiry && (
                  <p className="text-xs text-gray-400">
                    Bitmə tarixi: <span className="font-medium text-gray-600">{new Date(profExpiry.slice(0, 10) + 'T12:00:00').toLocaleDateString('az-AZ')}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleSaveProfile} disabled={profSaving} className="flex-1 bg-[#2779a7] hover:bg-[#21678e] disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                  {profSaving ? 'Saxlanır...' : 'Yadda saxla'}
                </button>
                {profMsg && <span className="text-xs text-green-600 font-medium">{profMsg}</span>}
              </div>
            </div>

            <div className="border-t border-gray-100 my-5" />

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Admin hesabı</p>
            {modalOwnerUser ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><User className="w-3.5 h-3.5" />Ad</label>
                  <input value={ownerName} onChange={e => setOwnerName(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7]" placeholder="Tam ad" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">İstifadəçi adı</label>
                  <input value={ownerUsername} onChange={e => setOwnerUsername(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2779a7]" placeholder="login" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1">
                    <KeyRound className="w-3.5 h-3.5" />Yeni şifrə <span className="text-gray-300 font-normal">(boş = dəyişdirmə)</span>
                  </label>
                  <input type="password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7]" placeholder="••••••" />
                </div>
                <div className="flex items-center justify-between py-0.5">
                  <span className="text-xs font-medium text-gray-500">Hesab statusu</span>
                  <button
                    onClick={handleToggleOwnerActive}
                    className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${modalOwnerUser.active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  >
                    {modalOwnerUser.active ? 'Aktiv' : 'Deaktiv'}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleSaveOwner} disabled={ownerSaving} className="flex-1 bg-[#2779a7] hover:bg-[#21678e] disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                    {ownerSaving ? 'Saxlanır...' : 'Yadda saxla'}
                  </button>
                  <button onClick={handleDeleteOwner} className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors border border-gray-200">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {ownerMsg && <p className={`text-xs font-medium ${ownerMsg.startsWith('Xəta') ? 'text-red-500' : 'text-green-600'}`}>{ownerMsg}</p>}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 mb-1">Bu şirkət üçün admin hesabı yoxdur.</p>
                <div>
                  <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><User className="w-3.5 h-3.5" />Ad</label>
                  <input value={ownerName} onChange={e => setOwnerName(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7]" placeholder="Tam ad" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">İstifadəçi adı</label>
                  <input value={ownerUsername} onChange={e => setOwnerUsername(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2779a7]" placeholder="login" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><KeyRound className="w-3.5 h-3.5" />Şifrə</label>
                  <input type="password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2779a7]" placeholder="••••••" />
                </div>
                <button onClick={handleCreateOwner} disabled={ownerSaving} className="w-full bg-[#2779a7] hover:bg-[#21678e] disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                  {ownerSaving ? 'Yaradılır...' : '+ Hesab yarat'}
                </button>
                {ownerMsg && <p className={`text-xs font-medium ${ownerMsg.startsWith('Xəta') ? 'text-red-500' : 'text-green-600'}`}>{ownerMsg}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
