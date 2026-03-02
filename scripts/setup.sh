#!/usr/bin/env bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; exit 1; }

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo -e "${CYAN}==============================${NC}"
echo -e "${CYAN}  Project Setup${NC}"
echo -e "${CYAN}==============================${NC}"
echo ""

# ── 1. Check Node.js ──────────────────────────────────────────────
info "Checking Node.js..."
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js 20+ and try again."
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  fail "Node.js 20+ required (found v$(node -v)). Please upgrade."
fi
ok "Node.js $(node -v)"

# ── 2. Enable corepack & install pnpm ─────────────────────────────
info "Enabling corepack for pnpm..."
if ! command -v corepack &>/dev/null; then
  warn "corepack not found, installing pnpm via npm..."
  npm install -g pnpm@9
else
  corepack enable
  corepack prepare --activate 2>/dev/null || true
fi

if ! command -v pnpm &>/dev/null; then
  fail "pnpm is still not available after setup. Install it manually: npm install -g pnpm@9"
fi
ok "pnpm $(pnpm -v)"

# ── 3. Install dependencies ───────────────────────────────────────
info "Installing dependencies..."
pnpm install
ok "Dependencies installed"

# ── 4. Copy environment files ─────────────────────────────────────
info "Setting up environment files..."

if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
else
  warn ".env already exists, skipping"
fi

if [ ! -f packages/backend/.env ]; then
  cp packages/backend/.env.example packages/backend/.env
  ok "Created packages/backend/.env from .env.example"
else
  warn "packages/backend/.env already exists, skipping"
fi

# ── 5. Create data directories ────────────────────────────────────
info "Creating data directories..."
mkdir -p packages/backend/data
mkdir -p packages/backend/uploads
mkdir -p packages/backend/backups
ok "Data directories ready"

# ── 6. Build shared package ───────────────────────────────────────
info "Building shared package..."
pnpm --filter shared build
ok "Shared package built"

# ── 7. Seed the database ──────────────────────────────────────────
info "Seeding database..."
cd packages/backend
pnpm db:seed
cd "$ROOT_DIR"
ok "Database seeded"

# ── 8. Done ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}==============================${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}==============================${NC}"
echo ""
echo "  Test accounts:"
echo "    admin@workspace.local   / admin123"
echo "    manager@workspace.local / manager123"
echo "    agent1@workspace.local  / agent123"
echo "    agent2@workspace.local  / agent123"
echo ""
echo "  Start development:"
echo "    pnpm dev              # backend + frontend"
echo "    pnpm dev:backend      # backend only"
echo "    pnpm dev:frontend     # frontend only"
echo ""
echo "  Or use Docker:"
echo "    pnpm docker:full      # full stack via docker-compose"
echo ""
