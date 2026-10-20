// `pnpm demo`: builds Rolecall, tests the example agent twice (with the bug, then fixed), and opens the dashboard.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const example = fileURLToPath(new URL('../examples/invoice-agent/', import.meta.url));
const cli = fileURLToPath(new URL('../packages/cli/bin/rolecall.js', import.meta.url));
// biome-ignore lint/suspicious/noUndeclaredEnvVars: optional override for the dashboard port
const PORT = process.env.PORT ?? '4300';

const step = (n, text) => console.log(`\n\x1b[1m\x1b[36m[${n}/4]\x1b[0m \x1b[1m${text}\x1b[0m\n`);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', ...opts }).status ?? 1;

step(1, 'Building Rolecall (first time takes ~30 s)');
if (run('pnpm', ['build'], { cwd: root }) !== 0) process.exit(1);

rmSync(new URL('../examples/invoice-agent/.rolecall/runs', import.meta.url), {
  recursive: true,
  force: true,
});

step(2, 'Testing the example agent. It has a planted bug: "support" can refund above its limit');
run('node', [cli, 'run'], { cwd: example });

step(3, 'Same test after the bug is fixed');
run('node', [cli, 'run'], { cwd: example, env: { ...process.env, INVOICE_DEMO_FIXED: '1' } });

step(4, `Opening the dashboard on http://127.0.0.1:${PORT}  (Ctrl+C to stop)`);
const ui = spawn('node', [cli, 'ui', '--port', PORT], { cwd: example, stdio: 'inherit' });
setTimeout(() => {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [`http://127.0.0.1:${PORT}`], { stdio: 'ignore', shell: process.platform === 'win32' }).on(
    'error',
    () => {},
  );
}, 1500);
ui.on('exit', (code) => process.exit(code ?? 0));
