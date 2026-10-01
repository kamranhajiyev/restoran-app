// Builds the WinUSB installer the desktop app ships, so a till never needs
// Zadig. See electron/printer-driver.ts for what it is used for.
//
// It is libwdi — the library inside Zadig — wrapped as a Node addon by
// winusb-driver-generator. Not a dependency in package.json: the package is
// Windows-only (npm refuses it on a Mac outright), the published binding does
// not do what the till needs (scripts/winusb/generator.cpp says why), and the
// installer leaves node_modules out of the app anyway. So it is fetched at a
// pinned version, given our generator.cpp, compiled, and only the resulting
// .node file is kept — libwdi and its installer exes are embedded in it.
//
// Needs Windows with Visual Studio's C++ tools, which the GitHub runner has.
// Anywhere else it says so and does nothing: the app runs without the file and
// simply never offers to install the driver.

import { cp, mkdir, rm, readdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, '.winusb-build');
const OUT = path.join(ROOT, 'native', 'winusb');
// Pinned: generator.cpp is written against this version's binding.gyp and libwdi.
const PACKAGE = 'winusb-driver-generator@2.1.10';

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', code =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)),
    );
  });
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[winusb] not on Windows — skipped; this build will not install the printer driver');
    return;
  }

  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });

  console.log(`[winusb] fetching ${PACKAGE}…`);
  await run('npm', ['pack', PACKAGE, '--pack-destination', WORK], ROOT);
  const tgz = (await readdir(WORK)).find(f => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack produced no tarball');
  await run('tar', ['-xzf', tgz], WORK);
  const pkg = path.join(WORK, 'package');

  await cp(path.join(ROOT, 'scripts', 'winusb', 'generator.cpp'), path.join(pkg, 'src', 'generator.cpp'));

  // --ignore-scripts: its install script would fetch the published prebuilt
  // binary, which is exactly the one that cannot do the job.
  await run('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], pkg);
  console.log('[winusb] compiling…');
  // Node-API, so a build against this Node loads in any Electron.
  await run('npx', ['--yes', 'node-gyp', 'rebuild'], pkg);

  const built = path.join(pkg, 'build', 'Release', 'Generator.node');
  await access(built);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(built, path.join(OUT, 'Generator.node'));
  console.log(`[winusb] ${path.relative(ROOT, OUT)}/Generator.node ready`);
}

main().catch(err => {
  console.error('[winusb] build failed:', err.message);
  process.exit(1);
});
