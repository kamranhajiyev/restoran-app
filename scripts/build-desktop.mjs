// Builds the till as static files, for shipping inside the Windows installer.
//
// The desktop app must open with no internet, which means its HTML and JS have
// to be on the machine rather than fetched from possiblle.com. `next build`
// with output:'export' produces exactly that — but the flag is app-wide, and
// this repo also deploys to Vercel as a server app. Every route handler in
// app/api reads the incoming Request, which a static export does not support
// (node_modules/next/dist/docs/01-app/02-guides/static-exports.md), so turning
// the flag on in place would break the site.
//
// So the export runs against a copy of the repo with only the till's routes in
// it. The working tree is never modified: a build that mutates app/ and then
// restores it leaves a half-deleted site behind the moment it is interrupted,
// and the one interrupting it is usually CI.
//
// node_modules is symlinked rather than copied — it is the whole cost of the
// build otherwise, and nothing here writes to it.

import { cp, mkdir, rm, symlink, readdir, access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, '.desktop-build');
const OUT = 'out-desktop';

// Everything the till's module graph can reach. Erring wide is cheap; a missing
// directory surfaces as a module-not-found in the middle of the export.
const COPY = [
  'app',
  'components',
  'lib',
  'public',
  'types',
  'next.config.ts',
  'tsconfig.json',
  'postcss.config.mjs',
  'package.json',
  'next-env.d.ts',
];

// The routes that make up the desktop app. Everything else under app/ is the
// website — admin, the QR menu, marketing — and stays online-only by design:
// a report served from a stale local copy is worse than one that fails loudly.
//
// /s/<slug>/<token> is deliberately absent even though the desktop app opens a
// terminal link today. It is a dynamic route whose token cannot be known at
// build time, and it only re-renders app/seller/page.tsx anyway; in the exe the
// terminal's identity comes from local config instead of the URL.
const KEEP_APP = new Set([
  'layout.tsx',
  'globals.css',
  'seller',
  'login',
]);

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function stage() {
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  for (const entry of COPY) {
    const from = path.join(ROOT, entry);
    if (!(await exists(from))) continue;
    await cp(from, path.join(STAGE, entry), { recursive: true });
  }

  // Drop the website's routes from the copy.
  const appDir = path.join(STAGE, 'app');
  for (const entry of await readdir(appDir)) {
    if (!KEEP_APP.has(entry)) {
      await rm(path.join(appDir, entry), { recursive: true, force: true });
    }
  }

  // 'junction' on Windows, not 'dir'. A real directory symlink there needs
  // SeCreateSymbolicLinkPrivilege, which an unelevated build agent does not
  // have; a junction needs nothing and behaves the same for reads. This build
  // runs on a Windows runner (.github/workflows/desktop.yml), so the wrong
  // choice here fails only in CI — the one place nobody is watching a terminal.
  const kind = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'), kind);
}

// The Supabase URL and anon key, and nothing else.
//
// .env.local is deliberately not copied into the staging tree. It holds
// SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS for every company — the key
// this whole design exists to keep off customers' machines. Forwarding the
// NEXT_PUBLIC_ variables by name means there is no path by which the other
// three could end up baked into an installer, however the module graph changes.
//
// Anything already in the environment wins, so CI can point a build at a
// different project without a file.
async function publicEnv() {
  const env = {};

  try {
    const text = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // No file: the environment must already carry them. Checked below.
  }

  for (const key of Object.keys(process.env)) {
    if (key.startsWith('NEXT_PUBLIC_')) env[key] = process.env[key];
  }

  for (const required of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    if (!env[required]) {
      throw new Error(
        `${required} is not set. The till is built with its Supabase project baked in; ` +
        'put it in .env.local or the environment.',
      );
    }
  }

  return env;
}

function run(cmd, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', code =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

async function main() {
  const env = await publicEnv();

  console.log('[desktop] staging the till…');
  await stage();

  console.log(`[desktop] exporting against ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  await run('npx', ['next', 'build'], STAGE, { ...env, POS_DESKTOP: '1' });

  // Hand the result back to the repo root, where electron-builder and the dev
  // shell both look for it.
  const built = path.join(STAGE, OUT);
  if (!(await exists(built))) {
    throw new Error(`export produced no ${OUT}/ — did next.config.ts see POS_DESKTOP?`);
  }
  await rm(path.join(ROOT, OUT), { recursive: true, force: true });
  await cp(built, path.join(ROOT, OUT), { recursive: true });

  console.log(`[desktop] ${OUT}/ ready`);
}

main().catch(err => {
  console.error('[desktop] build failed:', err.message);
  process.exit(1);
});
