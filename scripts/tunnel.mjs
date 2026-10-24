// npm run tunnel: a public link to this Mac's dev site (localhost:3000) for
// testers, with the Mac kept awake only while it runs. Ctrl+C stops both.
// Every start gives a new link.

import { spawn } from 'node:child_process';

const tunnel = spawn('caffeinate', ['-dims', 'npx', '-y', 'cloudflared', 'tunnel', '--url', 'http://localhost:3000'], {
  stdio: ['ignore', 'ignore', 'pipe'],
});

let shown = false;
tunnel.stderr.on('data', chunk => {
  const link = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (link && !shown) {
    shown = true;
    console.log(`\nLink:   ${link}\nTill:   ${link}/seller\nAdmin:  ${link}/admin\n\nCtrl+C to stop (the Mac may sleep again after).`);
  }
});
tunnel.on('exit', code => process.exit(code ?? 0));
process.on('SIGINT', () => tunnel.kill('SIGINT'));
