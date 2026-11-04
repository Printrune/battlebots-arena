import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const result = spawnSync(process.execPath, [vite, 'build', '--outDir', 'dist/pages'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_STATIC_HOSTING: 'true', VITE_BASE_PATH: '/battlebots-arena/' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
