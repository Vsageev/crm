#!/usr/bin/env bash
# Generate local development TLS certificates using mkcert.
# Certificates are placed in the project root /certs directory.
#
# Prerequisites: mkcert (https://github.com/FiloSottile/mkcert)
#   macOS:   brew install mkcert && mkcert -install
#   Linux:   see https://github.com/FiloSottile/mkcert#installation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CERT_DIR="$PROJECT_ROOT/certs"

mkdir -p "$CERT_DIR"

if ! command -v mkcert &>/dev/null; then
  echo "Error: mkcert is not installed."
  echo "  macOS:  brew install mkcert && mkcert -install"
  echo "  Linux:  see https://github.com/FiloSottile/mkcert#installation"
  exit 1
fi

# Ensure the local CA is installed (idempotent)
mkcert -install 2>/dev/null || true

echo "Generating certificates in $CERT_DIR ..."

mkcert \
  -cert-file "$CERT_DIR/localhost.pem" \
  -key-file "$CERT_DIR/localhost-key.pem" \
  localhost 127.0.0.1 ::1

echo ""
echo "Done! Certificates created:"
echo "  $CERT_DIR/localhost.pem"
echo "  $CERT_DIR/localhost-key.pem"
