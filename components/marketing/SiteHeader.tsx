import Link from 'next/link';

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-black/8">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="font-bold text-base tracking-tight">possiblle</Link>
        <nav className="hidden sm:flex items-center gap-6 text-xs text-gray-400 font-medium">
          <Link href="/xususiyyetler" className="hover:text-black transition-colors">Xüsusiyyətlər</Link>
          <Link href="/yukle" className="hover:text-black transition-colors">Windows tətbiqi</Link>
          <Link href="/#faq" className="hover:text-black transition-colors">FAQ</Link>
        </nav>
        <Link
          href="/login"
          className="px-5 py-2 rounded-full bg-black text-white text-xs font-semibold hover:bg-gray-800 transition-colors"
        >
          Daxil ol
        </Link>
      </div>
    </header>
  );
}
