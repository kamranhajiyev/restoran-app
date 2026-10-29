import type { Metadata } from 'next';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';

// The privacy policy Google Play asks for (Play Console → App content). Each
// line must stay true of the app: the Data safety form in Play says the same,
// and tests/privacy-page.test.ts checks it against the Android manifest. Both
// languages: the restaurants read Azerbaijani, Google's reviewers English.
export const metadata: Metadata = {
  title: 'Məxfilik siyasəti',
  description: 'Possiblle POS hansı məlumatları saxlayır, harada saxlayır və necə silinir.',
  alternates: { canonical: '/privacy' },
};

const UPDATED = '28.10.2026';
const SUPPORT_EMAIL = 'help.possiblle@gmail.com';
const SUPPORT_WHATSAPP ='https://wa.me/994998989876';
const SUPPORT_PHONE = '+994 99 898 98 76';

type Section = { title: string; body: string };

const AZ: Section[] = [
  {
    title: 'Proqram kim üçündür',
    body: 'Possiblle POS restoran və kafelər üçün kassa proqramıdır. Ondan restoranın işçiləri istifadə edir, ictimaiyyət yox.',
  },
  {
    title: 'Nə saxlayırıq',
    body: 'Restoranın adı, ünvanı və telefonu; sahibin giriş e-poçtu; işçilərin adları və PIN kodları (PIN açıq saxlanmır); kuryerlərin adları və telefonları; menyu, sifarişlər, ödənişlər və növbə hesabatları; hansı işçinin nə vaxt daxil olduğu.',
  },
  {
    title: 'Nə toplamırıq',
    body: 'Yer (lokasiya), kontaktlar, şəkillər və reklam identifikatoru toplanmır. Reklam, analitika və izləmə yoxdur. Məlumatlar heç kimə satılmır və verilmir.',
  },
  {
    title: 'Harada saxlanılır',
    body: 'Serverlərimizdə (Supabase və Vercel), şifrələnmiş bağlantı (HTTPS) ilə göndərilir. İnternet kəsiləndə işləmək üçün proqram restoranın məlumatlarının bir nüsxəsini cihazda da saxlayır.',
  },
  {
    title: 'Kim görür',
    body: 'Yalnız restoranın öz işçiləri, sahibin verdiyi səlahiyyətə görə, və restoran kömək istəyəndə bizim dəstək komandamız.',
  },
  {
    title: 'Məlumatların silinməsi',
    body: 'Restoran sahibi hesabın və bütün məlumatların silinməsini bizdən istəyə bilər; 30 gün ərzində silirik. Proqramı silmək cihazdakı nüsxəni də silir.',
  },
];

const EN: Section[] = [
  {
    title: 'Who the app is for',
    body: 'Possiblle POS is a till app for restaurants and cafés. It is used by restaurant staff, not by the public.',
  },
  {
    title: 'What we store',
    body: "The restaurant's name, address and phone; the owner's login email; staff names and PIN codes (PINs are not stored in plain text); couriers' names and phone numbers; the menu, orders, payments and shift reports; and when each staff member logged in.",
  },
  {
    title: 'What we do not collect',
    body: 'No location, contacts, photos or advertising ID. No ads, no analytics, no tracking. We do not sell or share data with anyone.',
  },
  {
    title: 'Where it is kept',
    body: "On our servers (Supabase and Vercel), sent over encrypted connections (HTTPS). To keep working without internet, the app also keeps a copy of the restaurant's data on the device.",
  },
  {
    title: 'Who can see it',
    body: "Only the restaurant's own staff, by the role the owner gives them, and our support team when the restaurant asks for help.",
  },
  {
    title: 'Deleting data',
    body: 'The restaurant owner can ask us to delete the account and all its data; we delete it within 30 days. Uninstalling the app deletes the copy on the device.',
  },
];

function Sections({ items }: { items: Section[] }) {
  return (
    <div className="space-y-7">
      {items.map(s => (
        <div key={s.title}>
          <h3 className="font-bold text-base leading-snug">{s.title}</h3>
          <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <SiteHeader />

      <section className="px-6 pt-16 pb-14">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
            Məxfilik siyasəti
          </h1>
          <p className="mt-4 text-xs text-gray-400">Son yenilənmə: {UPDATED}</p>

          <div className="mt-10">
            <Sections items={AZ} />
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold leading-tight mt-16 mb-2">Privacy policy</h2>
          <p className="text-xs text-gray-400 mb-10">Last updated: {UPDATED}</p>
          <Sections items={EN} />

          <div className="mt-14 bg-[#f5f5f5] rounded-2xl p-6">
            <h3 className="font-bold text-base">Əlaqə / Contact</h3>
            <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
              Silmə istəyi və suallar üçün / For deletion requests and questions:{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-black font-semibold underline">
                {SUPPORT_EMAIL}
              </a>
              {' · '}
              <a href={SUPPORT_WHATSAPP} className="text-black font-semibold underline">
                WhatsApp {SUPPORT_PHONE}
              </a>
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
