import Link from 'next/link';
import { FEATURES } from '@/lib/features';

export default function SiteFooter() {
  return (
    <footer className="border-t border-black/8 py-10 px-6 mt-auto">
      <div className="max-w-5xl mx-auto">
        {/* Every feature page reachable from every page — internal links are what get
            the deeper pages crawled in the first place. */}
        <nav className="flex flex-wrap gap-x-5 gap-y-2 mb-8">
          {FEATURES.map(f => (
            <Link
              key={f.slug}
              href={`/xususiyyetler/${f.slug}`}
              className="text-xs text-gray-400 hover:text-black transition-colors"
            >
              {f.nav}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <Link href="/" className="font-bold text-black text-sm">possiblle</Link>
          <span>© {new Date().getFullYear()} Bütün hüquqlar qorunur.</span>
        </div>
      </div>
    </footer>
  );
}
