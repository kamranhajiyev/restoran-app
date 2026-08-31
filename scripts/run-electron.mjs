// Starts the desktop shell for development.
//
// Why not just `electron .`: VS Code's integrated terminal exports
// ELECTRON_RUN_AS_NODE=1, which tells Electron to boot as plain Node. In that
// mode `require('electron')` hands back the path to the binary instead of the
// API, and the app dies on its first line with a confusing
// "Cannot read properties of undefined (reading 'app')". Stripping the variable
// here means the app starts the same way from any terminal.
//
// Packaged builds are never affected — this is a development-only wrapper.

import { spawn } from 'node:child_process';
import electronBinary from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Under plain Node the electron package exports the binary's path — which is
// exactly what we need to launch it ourselves.
// Extra arguments go straight through, so `-- --url=https://…` picks the site.
const child = spawn(electronBinary, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', code => process.exit(code ?? 0));
