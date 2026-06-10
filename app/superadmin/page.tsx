'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LogOut, Plus, Building2, Users, Trash2, EyeOff, Eye, X, Coffee, ShieldCheck, UserCircle, MapPin, Phone, User,
} from 'lucide-react';
import { getSession, logout } from '@/lib/auth';
import {
  fetchCompanies, createCompany, deleteCompany, toggleCompanyActive, updateCompanyName, updateCompanyExpiry,
  fetchAllUsers, createUser, deleteUser, toggleUserActive, updateCompanyProfile,
} from '@/lib/store';

type Tab = 'companies' | 'users';

interface Company {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
  userCount?: number;
  ownerName: string | null;
  address: string | null;
  phone: string | null;
}

interface SAUser {
  id: string;
  username: string;
  name: string;
  role: string;
  companyId: string | null;
  companyName?: string;
  active: boolean;
  createdAt: string;
}

const ROLE_COLORS: Record<string, string> = {
  superadmin: 'bg-purple-100 text-purple-700',
  owner:      'bg-blue-100 text-blue-700',
  seller:     'bg-amber-100 text-amber-700',
};
const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Superadmin',
  owner:      'Owner',
  seller:     'Seller',
};

export default function SuperadminPage() {
  const router = useRouter();
  const [tab, setTab]             = useState<Tab>('companies');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers]         = useState<SAUser[]>([]);
  const [loading, setLoading]     = useState(true);

  // inline name edit
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState('');

  // inline expiry edit
  const [editingExpiryId, setEditingExpiryId] = useState<string | null>(null);

  // company profile modal
  const [profileCompany, setProfileCompany] = useState<Company | null>(null);
  const [profOwner, setProfOwner] = useState('');
  const [profAddress, setProfAddress] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profSaving, setProfSaving] = useState(false);
  const [profMsg, setProfMsg] = useState('');

  function openProfileModal(c: Company) {
    setProfileCompany(c);
    setProfOwner(c.ownerName ?? '');
    setProfAddress(c.address ?? '');
    setProfPhone(c.phone ?? '');
    setProfMsg('');
  }

  async function handleSaveProfile() {
    if (!profileCompany) return;
    setProfSaving(true);
    await updateCompanyProfile(profileCompany.id, profOwner.trim(), profAddress.trim(), profPhone.trim());
    setProfMsg('Yadda saxlandı');
    setProfSaving(false);
    loadData();
    setTimeout(() => setProfMsg(''), 2000);
  }

  // company form
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [companyName, setCompanyName]         = useState('');
  const [companySlug, setCompanySlug]         = useState('');
  const [saving, setSaving]                   = useState(false);

  // user form
  const [showUserForm, setShowUserForm]   = useState(false);
  const [userName, setUserName]           = useState('');
  const [userUsername, setUserUsername]   = useState('');
  const [userPassword, setUserPassword]   = useState('');
  const [userRole] = useState<'owner'>('owner');
  const [userCompanyId, setUserCompanyId] = useState('');

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== 'superadmin') { router.replace('/login'); return; }
    loadData();
  }, [router]);

  async function loadData() {
    setLoading(true);
    const [comps, usrs] = await Promise.all([fetchCompanies(), fetchAllUsers()]);
    const withCounts = comps.map(c => ({
      ...c,
      userCount: usrs.filter(u => u.companyId === c.id && u.role === 'owner').length,
    }));
    const withCompNames = usrs.map(u => ({
      ...u,
      companyName: comps.find(c => c.id === u.companyId)?.name,
    }));
    setCompanies(withCounts);
    setUsers(withCompNames);
    setLoading(false);
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

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const err = await createUser(userUsername.trim(), userPassword, userName.trim(), userRole, userCompanyId || null);
    if (err) { alert('Xəta: ' + err); setSaving(false); return; }
    setUserName(''); setUserUsername(''); setUserPassword(''); setUserCompanyId('');
    setShowUserForm(false);
    setSaving(false);
    loadData();
  }

  function expiryBadge(expiresAt: string | null) {
    if (!expiresAt) return null;
    const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
    if (days < 0)  return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600 shrink-0">Müddəti bitib</span>;
    if (days <= 10) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700 shrink-0">{days} gün qaldı</span>;
    return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 shrink-0">{days} gün</span>;
  }

  const visibleUsers = users.filter(u => u.role === 'owner');

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="sticky top-0 z-50 h-14 border-b border-gray-100 bg-white flex items-center gap-3 px-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-purple-700 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-gray-800 text-sm">Superadmin Paneli</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => { logout(); router.push('/login'); }}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-500 transition-colors"
        >
          <LogOut className="w-4 h-4" /> Çıxış
        </button>
      </header>

      <div className="max-w-3xl mx-auto p-6">

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit mb-6">
          {([
            { id: 'companies' as Tab, label: 'Şirkətlər', icon: Building2 },
            { id: 'users' as Tab,     label: 'İstifadəçilər', icon: Users },
          ] as const).map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-purple-700 text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400">Yüklənir...</div>
        ) : tab === 'companies' ? (

          /* ── COMPANIES ── */
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">{companies.length} şirkət</h2>
              <button
                onClick={() => setShowCompanyForm(true)}
                className="flex items-center gap-1.5 bg-purple-700 hover:bg-purple-800 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
              >
                <Plus className="w-4 h-4" /> Yeni şirkət
              </button>
            </div>

            {companies.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>Şirkət yoxdur</p>
              </div>
            ) : (
              <div className="space-y-3">
                {companies.map(c => (
                  <div key={c.id} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-4">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-blue-600" />
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
                          className="font-semibold text-gray-800 text-sm border-b border-purple-400 focus:outline-none bg-transparent w-full"
                        />
                      ) : (
                        <p
                          className="font-semibold text-gray-800 cursor-pointer hover:text-purple-700 transition-colors"
                          onClick={() => { setEditingCompanyId(c.id); setEditingCompanyName(c.name); }}
                          title="Adı dəyişmək üçün klikləyin"
                        >
                          {c.name}
                        </p>
                      )}
                      <p className="text-xs text-gray-400">{c.userCount} istifadəçi</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {expiryBadge(c.expiresAt)}
                      {editingExpiryId === c.id ? (
                        <input
                          type="date"
                          autoFocus
                          defaultValue={c.expiresAt ? c.expiresAt.slice(0, 10) : ''}
                          onBlur={async e => {
                            const val = e.target.value;
                            await updateCompanyExpiry(c.id, val ? new Date(val).toISOString() : null);
                            setEditingExpiryId(null);
                            loadData();
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Escape') setEditingExpiryId(null);
                          }}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-400"
                        />
                      ) : (
                        <button
                          onClick={() => setEditingExpiryId(c.id)}
                          className="text-xs text-gray-400 hover:text-purple-700 transition-colors"
                          title="Tarix təyin et"
                        >
                          {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('az-AZ') : '+ tarix'}
                        </button>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.active ? 'Aktiv' : 'Deaktiv'}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openProfileModal(c)}
                        title="Profil məlumatları"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-purple-50 hover:text-purple-600 transition-colors"
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
                        onClick={() => { if (confirm(`"${c.name}" şirkəti silinsin?`)) deleteCompany(c.id).then(loadData); }}
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

        ) : (

          /* ── USERS ── */
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">{visibleUsers.length} istifadəçi</h2>
              <button
                onClick={() => setShowUserForm(true)}
                className="flex items-center gap-1.5 bg-purple-700 hover:bg-purple-800 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
              >
                <Plus className="w-4 h-4" /> Yeni istifadəçi
              </button>
            </div>

            {visibleUsers.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>İstifadəçi yoxdur</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleUsers.map(u => (
                  <div key={u.id} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-4">
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-700 font-bold text-sm shrink-0">
                      {u.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-800">{u.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-500'}`}>
                          {ROLE_LABELS[u.role] ?? u.role}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">@{u.username}{u.companyName ? ` · ${u.companyName}` : ''}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${u.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {u.active ? 'Aktiv' : 'Deaktiv'}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleUserActive(u.id, !u.active).then(loadData)}
                        title={u.active ? 'Deaktiv et' : 'Aktiv et'}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
                      >
                        {u.active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => { if (confirm(`"${u.name}" istifadəçisi silinsin?`)) deleteUser(u.id).then(err => { if (err) alert('Silinmədi: ' + err); else loadData(); }); }}
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
        )}
      </div>

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
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Restoran adı"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Slug</label>
                <input
                  value={companySlug}
                  onChange={e => setCompanySlug(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="restoran-adi"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-purple-700 hover:bg-purple-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors mt-2"
              >
                {saving ? 'Yaradılır...' : 'Yarat'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Company Profile Modal */}
      {profileCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <UserCircle className="w-5 h-5 text-purple-700" />
                <h3 className="font-bold text-gray-800">{profileCompany.name}</h3>
              </div>
              <button onClick={() => setProfileCompany(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><User className="w-3.5 h-3.5" />Sahibin adı</label>
                <input
                  value={profOwner}
                  onChange={e => setProfOwner(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Ad Soyad"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><MapPin className="w-3.5 h-3.5" />Ünvan</label>
                <input
                  value={profAddress}
                  onChange={e => setProfAddress(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Şəhər, küçə, ev"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-1"><Phone className="w-3.5 h-3.5" />Mobil nömrə</label>
                <input
                  value={profPhone}
                  onChange={e => setProfPhone(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="+994 50 000 00 00"
                />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSaveProfile}
                  disabled={profSaving}
                  className="flex-1 bg-purple-700 hover:bg-purple-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                >
                  {profSaving ? 'Saxlanır...' : 'Yadda saxla'}
                </button>
                {profMsg && <span className="text-xs text-green-600 font-medium">{profMsg}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showUserForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800">Yeni istifadəçi</h3>
              <button onClick={() => setShowUserForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Ad</label>
                <input
                  value={userName}
                  onChange={e => setUserName(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Tam ad"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">İstifadəçi adı</label>
                <input
                  value={userUsername}
                  onChange={e => setUserUsername(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="login"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Şifrə</label>
                <input
                  type="password"
                  value={userPassword}
                  onChange={e => setUserPassword(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Şirkət</label>
                <select
                  value={userCompanyId}
                  onChange={e => setUserCompanyId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">— Seçin —</option>
                  {companies.filter(c => c.active).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-purple-700 hover:bg-purple-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors mt-2"
              >
                {saving ? 'Yaradılır...' : 'Yarat'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
