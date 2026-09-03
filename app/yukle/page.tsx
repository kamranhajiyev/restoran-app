import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, Printer, Usb, Wallet, MonitorCheck } from 'lucide-react';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import Faq from '@/components/marketing/Faq';
import { JsonLd } from '@/components/marketing/JsonLd';
import { IconBox } from '@/components/marketing/icons';
import type { FeatureFaq } from '@/lib/features';
import { DESKTOP_DOWNLOAD_URL, DESKTOP_VERSION, SITE_URL } from '@/lib/site';

// A server component, like the rest of the marketing pages: the whole page is in
// the HTML before any JavaScript runs, and the download is a plain <a href>. The
// installer's address lives in lib/site.ts — nothing about it is hardcoded here.
export const metadata: Metadata = {
  title: 'Windows proqramını yüklə',
  description:
    'Possiblle POS-un Windows tətbiqi: mətbəx printerinə birbaşa çap, USB çek printeri və pul çəkməcəsi. Quraşdırın, restoranınızın hesabı ilə daxil olun.',
  alternates: { canonical: '/yukle' },
};

// What the desktop shell adds over the browser. Each line is written from
// electron/main.ts — the window is the same web app; only these three are new.
const CAPABILITIES: { icon: React.ElementType; title: string; body: string }[] = [
  {
    icon: Printer,
    title: 'Mətbəx printerinə birbaşa çap',
    body:
      'Şəbəkədəki printerə (192.168.x.x) birbaşa qoşulur və sifariş düşən kimi mətbəx çekini çap edir. Brauzerə bu icazə verilmir — bunun üçün masaüstü tətbiqi lazımdır.',
  },
  {
    icon: Usb,
    title: 'USB çek printeri',
    body:
      'Kassadakı USB printer tətbiqin içindən işləyir: müştəri hesabı və ödəniş çeki eyni kompüterdən çap olunur.',
  },
  {
    icon: Wallet,
    title: 'Pul çəkməcəsi',
    body:
      'Nağd ödəniş qəbul ediləndə çəkməcə printer üzərindən avtomatik açılır. Kassada ayrıca düymə də var.',
  },
];

// The install run, end to end. Step 2 is the one that generates support calls:
// the installer is not code-signed, so Windows shows a blue SmartScreen panel
// and hides the "run anyway" button behind "More info".
const STEPS: { title: string; body: string }[] = [
  {
    title: 'Faylı yükləyin',
    body: 'Aşağıdakı düymə PossibllePOS-Setup.exe faylını yükləyir. Yükləmə bir neçə saniyə çəkir.',
  },
  {
    title: '“Yenə də işlət” seçin',
    body:
      'Windows tanımadığı proqram üçün mavi xəbərdarlıq göstərə bilər. “Ətraflı məlumat” (More info) yazısına klikləyin, sonra “Yenə də işlət” (Run anyway) düyməsini basın. Bu normaldır — fayl bizim GitHub buraxılışımızdan gəlir.',
  },
  {
    title: 'Quraşdırın',
    body:
      'Quraşdırıcı qovluq seçməyə imkan verir; standart qovluq da uyğundur. Administrator parolu tələb olunmur — tətbiq yalnız həmin istifadəçi üçün quraşdırılır.',
  },
  {
    title: 'Daxil olun',
    body:
      'Masaüstündəki “Possiblle POS” ikonasını açın və restoranınızın hesabı ilə daxil olun. Məlumatlar brauzerdəki ilə eynidir — ayrıca hesab yaratmaq lazım deyil.',
  },
];

const FAQS: FeatureFaq[] = [
  {
    q: 'Bu, brauzerdəki sistemdən fərqlidirmi?',
    a: 'Xeyr, eyni sistemdir və eyni məlumat bazası ilə işləyir. Masaüstü tətbiqi yalnız printerlərə və pul çəkməcəsinə birbaşa çıxış əlavə edir. Admin, ofisiant və mətbəx ekranlarını istənilən brauzerdən açmaq olar.',
  },
  {
    q: 'Hansı Windows versiyası lazımdır?',
    a: 'Windows 10 və ya Windows 11, 64-bit. Tətbiq quraşdırma zamanı əlavə sürücü tələb etmir.',
  },
  {
    q: 'Bütün kompüterlərə quraşdırmalıyam?',
    a: 'Xeyr. Yalnız printerlərin qoşulduğu kassa kompüterinə quraşdırmaq kifayətdir. Qalan ekranlar — ofisiant telefonu, mətbəx monitoru, admin paneli — brauzerdə işləyir.',
  },
  {
    q: 'Windows xəbərdarlıq göstərir, təhlükəlidir?',
    a: 'Fayl rəqəmsal imza ilə imzalanmadığı üçün Windows tanımadığı proqram kimi xəbərdarlıq edir. “Ətraflı məlumat → Yenə də işlət” seçin. Faylı yalnız bu səhifədəki linkdən yükləyin.',
  },
  {
    q: 'Mac və ya Linux üçün versiya varmı?',
    a: 'Hazırda yalnız Windows üçün. Digər əməliyyat sistemlərində sistemi brauzerdən istifadə edin — çap üçün isə şəbəkə printeri olan bir Windows kassası kifayətdir.',
  },
];

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'Possiblle POS',
          operatingSystem: 'Windows 10, Windows 11',
          applicationCategory: 'BusinessApplication',
          softwareVersion: DESKTOP_VERSION,
          downloadUrl: DESKTOP_DOWNLOAD_URL,
          url: `${SITE_URL}/yukle`,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'AZN' },
        }}
      />

      <SiteHeader />

      {/* Hero */}
      <section className="px-6 pt-16 pb-14 border-b border-black/8">
        <div className="max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-gray-500 border border-black/10 rounded-full px-3 py-1 mb-6">
            <span className="w-1.5 h-1.5 bg-black rounded-full" />
            Windows tətbiqi
          </span>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
            Possiblle POS-u Windows-a yükləyin
          </h1>
          <p className="mt-5 text-base text-gray-500 leading-relaxed max-w-2xl">
            Kassa kompüteriniz üçün masaüstü tətbiqi. Sistemin özü brauzerdə də tam
            işləyir — bu tətbiq mətbəx printerinə, USB çek printerinə və pul
            çəkməcəsinə birbaşa çıxış üçündür.
          </p>

          <div className="mt-9 flex flex-col sm:flex-row sm:items-center gap-4">
            <a
              href={DESKTOP_DOWNLOAD_URL}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition-colors"
            >
              <Download className="w-4 h-4" />
              Windows üçün yüklə
            </a>
            <p className="text-xs text-gray-400 leading-relaxed">
              PossibllePOS-Setup.exe · v{DESKTOP_VERSION}
              <br />
              Windows 10 / 11 · 64-bit
            </p>
          </div>
        </div>
      </section>

      {/* What the desktop app adds */}
      <section className="px-6 py-14">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight mb-3">
            Tətbiq nə əlavə edir?
          </h2>
          <p className="text-sm text-gray-400 leading-relaxed max-w-xl mb-10">
            Pəncərənin içindəki sistem brauzerdəki ilə eynidir. Fərq üç şeydədir —
            hər üçü də avadanlıqla bağlıdır.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {CAPABILITIES.map(c => (
              <div key={c.title} className="bg-[#f5f5f5] rounded-2xl p-6 flex flex-col min-h-[220px]">
                <IconBox Icon={c.icon} />
                <div className="mt-6">
                  <h3 className="font-bold text-base leading-snug">{c.title}</h3>
                  <p className="text-xs text-gray-400 mt-2 leading-relaxed">{c.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Install steps */}
      <section className="px-6 py-14 border-t border-black/8">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight mb-10">
            Quraşdırma — dörd addım
          </h2>

          <ol className="space-y-6">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-5">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-black text-white text-sm font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="pt-1">
                  <h3 className="font-bold text-base leading-snug">{s.title}</h3>
                  <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* The printer needs a one-time setup that the installer cannot do. */}
          <div className="mt-10 bg-black rounded-2xl p-8 flex flex-col sm:flex-row items-start gap-5">
            <IconBox Icon={MonitorCheck} dark />
            <div>
              <h3 className="text-white font-bold text-lg">Printer ilk dəfə qoşulanda</h3>
              <p className="text-white/50 text-sm mt-2 leading-relaxed">
                USB çek printeri ilk dəfə istifadə olunanda tətbiq cihazı seçməyi
                istəyir — siyahıdan printeri seçib “Bağlan” düyməsini basmaq
                kifayətdir. Mətbəx printeri üçün isə admin panelində printerin
                şəbəkə ünvanını yazmaq lazımdır. Quraşdırmada kömək lazımdırsa,
                bizə yazın — birlikdə edirik.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-14 border-t border-black/8">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-8">FAQ</h2>
          <Faq items={FAQS} />

          <p className="mt-10 text-sm text-gray-400">
            Sistemin nə etdiyini görmək üçün{' '}
            <Link href="/xususiyyetler" className="text-black font-semibold hover:underline">
              xüsusiyyətlərə baxın
            </Link>
            .
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
