#!/usr/bin/env bash
# Render build command:  bash scripts/render-build.sh
# Installs dependencies and downloads Litestream (database backup tool) into ./bin.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci

LITESTREAM_VERSION=0.5.17
mkdir -p bin
curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz" \
  | tar -xz -C bin litestream
./bin/litestream version
