import { Inter } from 'next/font/google';

// The admin, the seller page and the kitchen screen read in Inter: plain and sharp for tables of
// numbers, where the app-wide Quicksand looked playful. latin-ext carries
// ə, ğ, ş, ı. One file, so the two pages can never drift onto different fonts.
const inter = Inter({ subsets: ['latin', 'latin-ext'] });

export default function AppFont({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* On body as well, so a pop-up portalled out of the wrapper keeps the
          font. A browser without :has() (old Android Chrome) skips this rule
          and only such a pop-up falls back to Quicksand. */}
      <style>{`body:has(.app-font){font-family:${inter.style.fontFamily};font-weight:400}`}</style>
      <div className={`${inter.className} app-font`}>{children}</div>
    </>
  );
}
