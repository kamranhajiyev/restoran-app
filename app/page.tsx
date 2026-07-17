'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  QrCode, Zap, BarChart2, Users, LayoutGrid, ShieldCheck, ChevronDown,
} from 'lucide-react';
import { getSession, homeFor } from '@/lib/auth';

const BENTO = [
  {
    icon: QrCode,
    subtitle: 'Bir QR. Sonsuz rahatlıq.',
    desc: 'Müştəri masadan telefonuyla sifariş verir. Kağız menyu yoxdur, gözləmə vaxtı yoxdur.',
  },
  {
    icon: Zap,
    subtitle: 'Sifariş mətbəxə dərhal çatır.',
    desc: 'Ofisiant çağırmadan, gecikmədən. Hər şey real vaxtda axır.',
  },
  {
    icon: BarChart2,
    subtitle: 'Hər günün hesabatı.',
    desc: 'Satış, populyar məhsullar, iş saatı analizi.',
  },
  {
    icon: Users,
    subtitle: 'Hər kəs öz işini görür.',
    desc: 'Admin, ofisiant, satıcı. Hər biri öz panelinə daxil olur.',
  },
  {
    icon: LayoutGrid,
    subtitle: 'Real vaxtda açıq sifarişlər.',
    desc: 'Bütün masaların statusu bir baxışda görünür.',
  },
];

const FAQS = [
  {
    q: 'Possiblle platformu kimə uyğundur?',
    a: 'Kiçik kafedən böyük restorana qədər hər ölçülü müəssisəyə uyğundur.',
  },
  {
    q: 'Müştəri tətbiq yükləməlidir?',
    a: 'Xeyr. Müştəri sadəcə QR kodu skan edir və brauzer üzərindən sifariş verir.',
  },
  {
    q: 'Neçə masa dəstəklənir?',
    a: 'Limitsiz. İstədiyiniz qədər masa əlavə edə bilərsiniz.',
  },
  {
    q: 'Məlumatlar haradadır?',
    a: 'Supabase infrastrukturunda, şifrəli formada saxlanılır.',
  },
];

function IconBox({ Icon }: { Icon: React.ElementType }) {
  return (
    <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
      <Icon className="w-5 h-5 text-white" />
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen(o => !o)}
      className="w-full text-left border border-black/10 rounded-xl px-5 py-4 hover:border-black/30 transition-colors"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="font-medium text-sm text-gray-900">{q}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && <p className="mt-3 text-xs text-gray-500 leading-relaxed">{a}</p>}
    </button>
  );
}

export default function Home() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (session) {
      router.replace(homeFor(session));
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <p className="text-gray-300 text-sm">Yüklənir...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">

      {/* Nav */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-black/8">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-bold text-base tracking-tight">possiblle</span>
          <nav className="hidden sm:flex items-center gap-6 text-xs text-gray-400 font-medium">
            <a href="#features" className="hover:text-black transition-colors">Xüsusiyyətlər</a>
            <a href="#faq" className="hover:text-black transition-colors">FAQ</a>
          </nav>
          <Link
            href="/login"
            className="px-5 py-2 rounded-full bg-black text-white text-xs font-semibold hover:bg-gray-800 transition-colors"
          >
            Daxil ol
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-20 pb-16">
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-gray-500 border border-black/10 rounded-full px-3 py-1 mb-7">
          <span className="w-1.5 h-1.5 bg-black rounded-full" />
          Restoran idarəetmə sistemi
        </span>
        <p className="text-6xl sm:text-8xl font-bold tracking-tight leading-none mb-6">possiblle</p>
        <h1 className="text-xl sm:text-2xl font-semibold leading-snug tracking-tight max-w-lg text-gray-700">
          Everything{' '}
          <span className="text-black border-b-[3px] border-black pb-0.5">possible</span>
          {' '}with us.
        </h1>
        <p className="mt-5 text-gray-400 text-sm sm:text-base max-w-md leading-relaxed">
          QR sifariş, real vaxt masa izlənməsi, mətbəx bildirişləri
          və tam satış hesabatları. Hamısı bir platformada.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Link
            href="/login"
            className="px-7 py-3 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition-colors"
          >
            İndi başla →
          </Link>
          <a
            href="#features"
            className="px-7 py-3 rounded-full border border-black/15 text-gray-600 text-sm font-semibold hover:border-black/40 transition-colors"
          >
            Daha çox
          </a>
        </div>
      </section>

      {/* Stat bar */}
      <div className="border-y border-black/8 py-6 px-6">
        <div className="max-w-5xl mx-auto flex flex-wrap justify-center gap-10 text-center">
          {[
            { n: 'Limitsiz', l: 'Masa' },
            { n: 'Real vaxt', l: 'Bildiriş' },
            { n: '100%', l: 'Brauzer əsaslı' },
          ].map(s => (
            <div key={s.l}>
              <p className="text-2xl font-bold">{s.n}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Bento features */}
      <section id="features" className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-end justify-between mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold leading-tight max-w-xs">
              Bir platformada<br />hər şey.
            </h2>
            <p className="hidden sm:block text-sm text-gray-400 max-w-xs text-right leading-relaxed">
              Restoranınızın hər aspektini<br />idarə etmək üçün lazım olan alətlər.
            </p>
          </div>

          {/* Row 1 — Profit first */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {/* Stats / Profit — hero card */}
            <div className="bg-[#f5f5f5] rounded-2xl p-8 flex flex-col justify-between min-h-[260px]">
              <IconBox Icon={BENTO[2].icon} />
              <div className="mt-6">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-4xl font-bold">12,450 ₼</span>
                  <span className="text-xs font-semibold bg-black text-white px-2.5 py-1 rounded-full">↑ 18%</span>
                </div>
                <p className="text-sm text-gray-400">bu ay ümumi qazanc</p>
              </div>
              <div>
                <p className="text-2xl font-bold leading-snug">{BENTO[2].subtitle}</p>
                <p className="text-sm text-gray-400 mt-1 leading-relaxed">{BENTO[2].desc}</p>
              </div>
            </div>
            {/* QR Menu */}
            <div className="bg-[#f5f5f5] rounded-2xl p-8 flex flex-col justify-between min-h-[260px]">
              <IconBox Icon={BENTO[0].icon} />
              <div className="mt-6 flex items-center gap-2">
                <span className="text-4xl font-bold">47</span>
                <span className="text-sm text-gray-400">sifariş bu gün</span>
              </div>
              <div>
                <p className="text-2xl font-bold leading-snug">{BENTO[0].subtitle}</p>
                <p className="text-sm text-gray-400 mt-1 leading-relaxed">{BENTO[0].desc}</p>
              </div>
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {/* Notifications */}
            <div className="bg-[#f5f5f5] rounded-2xl p-7 flex flex-col justify-between min-h-[220px]">
              <IconBox Icon={BENTO[1].icon} />
              <div className="mt-6 flex items-baseline gap-2">
                <span className="text-2xl font-bold">~2 dəq</span>
                <span className="text-xs text-gray-400">çatdırılma</span>
              </div>
              <div>
                <p className="text-base font-bold leading-snug">{BENTO[1].subtitle}</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{BENTO[1].desc}</p>
              </div>
            </div>
            {/* Team */}
            <div className="bg-[#f5f5f5] rounded-2xl p-7 flex flex-col justify-between min-h-[220px]">
              <IconBox Icon={BENTO[3].icon} />
              <div className="mt-6 flex flex-wrap gap-1.5">
                {['Admin', 'Ofisiant', 'Satıcı'].map(r => (
                  <span key={r} className="text-xs font-medium bg-black text-white px-2.5 py-1 rounded-full">{r}</span>
                ))}
              </div>
              <div>
                <p className="text-base font-bold leading-snug">{BENTO[3].subtitle}</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{BENTO[3].desc}</p>
              </div>
            </div>
            {/* Tables */}
            <div className="bg-[#f5f5f5] rounded-2xl p-7 flex flex-col justify-between min-h-[220px]">
              <IconBox Icon={BENTO[4].icon} />
              <div className="mt-6 grid grid-cols-4 gap-1.5">
                {[1,2,3,4,5,6,7,8].map(n => (
                  <div key={n} className={`h-7 rounded-md text-[10px] font-bold flex items-center justify-center ${n <= 5 ? 'bg-black text-white' : 'bg-black/10 text-gray-400'}`}>{n}</div>
                ))}
              </div>
              <div>
                <p className="text-base font-bold leading-snug">{BENTO[4].subtitle}</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{BENTO[4].desc}</p>
              </div>
            </div>
          </div>

          {/* Row 3 — full width dark card */}
          <div className="bg-black rounded-2xl p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-bold text-lg">Təhlükəsiz. PIN giriş. Tam nəzarət.</p>
                <p className="text-white/50 text-sm mt-1">Rol icazələri, şifrəli saxlama. Hər kəs yalnız öz datasına giriş edir.</p>
              </div>
            </div>
            <Link
              href="/login"
              className="flex-shrink-0 px-6 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-100 transition-colors"
            >
              Daxil ol →
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 px-6 border-t border-black/8">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-8">FAQ</h2>
          <div className="space-y-3">
            {FAQS.map(f => <FaqItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/8 py-6 px-6 mt-auto">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-gray-400">
          <span className="font-bold text-black text-sm">possiblle</span>
          <span>© {new Date().getFullYear()} Bütün hüquqlar qorunur.</span>
        </div>
      </footer>

    </div>
  );
}
