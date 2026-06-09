'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LogOut, Plus, Building2, Users, Trash2, EyeOff, Eye, X, Coffee, ShieldCheck,
} from 'lucide-react';
import { getSession, logout } from '@/lib/auth';
import {
  fetchCompanies, createCompany, deleteCompany, toggleCompanyActive,
  fetchAllUsers, createUser, deleteUser, toggleUserActive,
} from '@/lib/store';

type Tab = 'companies' | 'users';

interface Company {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  userCount?: number;
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
  const [userRole, setUserRole]           = useState<'owner' | 'seller'>('seller');
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
      userCount: usrs.filter(u => u.companyId === c.id).length,
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

  const visibleUsers = users.filter(u => u.role !== 'superadmin');

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
                      <p className="font-semibold text-gray-800">{c.name}</p>
                      <p className="text-xs text-gray-400">/{c.slug} · {c.userCount} istifadəçi</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.active ? 'Aktiv' : 'Deaktiv'}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
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
                <label className="text-xs font-medium text-gray-500 block mb-1">Rol</label>
                <select
                  value={userRole}
                  onChange={e => setUserRole(e.target.value as 'owner' | 'seller')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="owner">Owner</option>
                  <option value="seller">Seller</option>
                </select>
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
