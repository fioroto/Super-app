import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const vaultPath = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--') && args[i - 1] !== '--no-open'));

const run = await startServer({
  vaultPath: vaultPath ? resolve(vaultPath) : process.env.SUPERAPP_VAULT,
  port: flag('--port') ? Number(flag('--port')) : undefined,
  webRoot: process.env.SUPERAPP_WEB ?? join(here, 'web'),
  home: process.env.SUPERAPP_HOME ?? here,
  open: !args.includes('--no-open') && !process.env.SUPERAPP_NO_OPEN,
  // Só o `npm run dev` define isto: o servidor reinicia a cada mudança e o cookie do navegador precisa continuar valendo.
  token: process.env.SUPERAPP_DEV_TOKEN || undefined,
});

console.log(`Super-app rodando. Se o navegador não abrir, use:\n  ${run.url}\nCtrl+C para encerrar.`);
const stop = () => run.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
