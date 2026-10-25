// Monta super-app.zip: pasta super-app/ com dist/, iniciar.bat, iniciar.sh e LEIAME.md.
// Escreve o .zip à mão (sem dependências) para rodar igual no Windows, Mac e Linux.
import { crc32, deflateRawSync } from 'node:zlib';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'super-app.zip');
const TOP = 'super-app';

const entries = []; // { name, data, mode }
const add = async (file, name, mode = 0o644) => entries.push({ name: `${TOP}/${name}`, data: await readFile(file), mode });

async function walk(dir, rel) {
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, `${rel}/${e.name}`);
    else if (!e.name.endsWith('.map')) await add(full, `${rel}/${e.name}`);
  }
}

if (!(await stat(path.join(root, 'dist/server.mjs')).catch(() => null))) {
  console.error('dist/ não existe. Rode `npm run build` antes.');
  process.exit(1);
}
await walk(path.join(root, 'dist'), 'dist');
await add(path.join(root, 'iniciar.bat'), 'iniciar.bat');
await add(path.join(root, 'iniciar.sh'), 'iniciar.sh', 0o755);
await add(path.join(root, 'README.md'), 'LEIAME.md');

const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

const parts = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const name = Buffer.from(e.name, 'utf8');
  const packed = deflateRawSync(e.data, { level: 9 });
  const useDeflate = packed.length < e.data.length;
  const body = useDeflate ? packed : e.data;
  const crc = crc32(e.data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  parts.push(local, name, body);

  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE((3 << 8) | 20, 4); // criado no Unix: guarda as permissões
  head.writeUInt16LE(20, 6);
  head.writeUInt16LE(0x0800, 8);
  head.writeUInt16LE(useDeflate ? 8 : 0, 10);
  head.writeUInt16LE(dosTime, 12);
  head.writeUInt16LE(dosDate, 14);
  head.writeUInt32LE(crc, 16);
  head.writeUInt32LE(body.length, 20);
  head.writeUInt32LE(e.data.length, 24);
  head.writeUInt16LE(name.length, 28);
  head.writeUInt32LE(((0o100000 | e.mode) << 16) >>> 0, 38);
  head.writeUInt32LE(offset, 42);
  central.push(head, name);

  offset += local.length + name.length + body.length;
}

const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

await writeFile(out, Buffer.concat([...parts, ...central, end]));
const size = (await stat(out)).size;
console.log(`super-app.zip: ${entries.length} arquivos, ${(size / 1048576).toFixed(2)} MB`);
