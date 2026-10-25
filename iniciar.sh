#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado." >&2
  echo "Instale o Node.js 22 ou superior: https://nodejs.org" >&2
  exit 1
fi

if [ ! -f dist/server.mjs ]; then
  echo "Arquivo dist/server.mjs não encontrado." >&2
  echo "Descompacte o arquivo .zip inteiro antes de rodar este programa." >&2
  exit 1
fi

exec node dist/server.mjs "$@"
