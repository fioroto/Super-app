// Reconstrói a interface e o servidor a cada mudança e reinicia o servidor.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extra = process.argv.slice(2);
const procs = [
  spawn(process.execPath, ['scripts/build.mjs', '--watch'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, ['--watch-path=dist/server.mjs', '--watch', 'dist/server.mjs', ...extra], { cwd: root, stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
