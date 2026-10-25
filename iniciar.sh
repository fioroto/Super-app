#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado." >&2
  echo "Instale o Node.js 22 ou superior: https://nodejs.org" >&2
  exit 1
fi

# Clone do git: instala na primeira vez e compila quando o código mudou.
if [ -f package.json ]; then
  node scripts/preparar.mjs
fi

if [ ! -f dist/server.mjs ]; then
  echo "Arquivo dist/server.mjs não encontrado." >&2
  echo "Extraia o super-app.zip inteiro e rode o iniciar.sh da pasta extraída." >&2
  exit 1
fi

exec node dist/server.mjs "$@"
