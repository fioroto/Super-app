import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Os testes rodam contra o build real: a interface empacotada, não o código-fonte.
export default function setup() {
  const root = path.resolve(import.meta.dirname, '..');
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
}
