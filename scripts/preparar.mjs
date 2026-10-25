// Usado pelo iniciar.bat / iniciar.sh quando a pasta é um clone do git (tem package.json).
// Instala as dependências na primeira vez e compila quando o código mudou desde a última compilação.
// O .zip já vem compilado e não leva esta pasta scripts/: lá isto nunca roda.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** O que entra na compilação: se algo daqui é mais novo que o dist, o dist está velho. */
const SOURCES = ['web/src', 'server/src', 'web/index.html', 'web/canvas.html', 'web/vite.config.ts', 'scripts/build.mjs', 'package-lock.json'];

function newest(p) {
  let info;
  try { info = statSync(p); } catch { return 0; }
  if (!info.isDirectory()) return info.mtimeMs;
  let max = 0;
  for (const name of readdirSync(p)) max = Math.max(max, newest(path.join(p, name)));
  return max;
}

/** O que falta fazer nesta pasta antes de abrir o app. */
export function precisa(root) {
  const instalar = !existsSync(path.join(root, 'node_modules', '.package-lock.json'));
  const built = (() => { try { return statSync(path.join(root, 'dist', 'server.mjs')).mtimeMs; } catch { return 0; } })();
  const compilar = !built || SOURCES.some((s) => newest(path.join(root, s)) > built);
  return { instalar, compilar };
}

function run(cmd, root) {
  try {
    execSync(cmd, { cwd: root, stdio: 'inherit' });
  } catch {
    console.error(`\nNão consegui rodar "${cmd}". Veja o erro acima.`);
    console.error('Se a rede da empresa bloqueia o npm, use o super-app.zip, que já vem pronto e não instala nada.');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { instalar, compilar } = precisa(root);
  if (instalar) {
    console.log('Primeira vez nesta pasta: instalando as dependências (precisa de internet, leva 1 a 2 minutos)…');
    run('npm ci --no-audit --no-fund', root);
  }
  if (instalar || compilar) {
    console.log('Compilando o app…');
    run('npm run build', root);
  }
}
