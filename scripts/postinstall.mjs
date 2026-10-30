// Після npm install у корені ставить залежності і для learn/, щоб не робити це окремо.
// Пропускається в CI і в Docker-збірці (там learn/ збирається своїм Dockerfile).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.CI || process.env.SKIP_LEARN_INSTALL || !existsSync('learn/package.json')) process.exit(0);
if (existsSync('learn/node_modules')) process.exit(0);

console.log('learn/: ставлю залежності (один раз)');
const r = spawnSync('npm', ['install', '--prefix', 'learn', '--no-audit', '--no-fund'], { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
