#!/usr/bin/env bash
# Idempotent provision of the Multipass ytdl-linux VM. Invoked from PowerShell
# via `multipass exec ytdl-linux -- bash /host-repo/scripts/linux-vm-provision.sh`.

set -euo pipefail

if ! command -v node >/dev/null; then
  echo "[provision] Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "[provision] Installing apt packages..."
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ffmpeg xvfb git unzip socat x11vnc \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
  fonts-liberation libu2f-udev libvulkan1

PNPM_PIN=10.30.1
if ! command -v pnpm >/dev/null || [ "$(pnpm -v 2>/dev/null)" != "$PNPM_PIN" ]; then
  echo "[provision] Installing pnpm@$PNPM_PIN (matches Windows host)..."
  sudo npm i -g "pnpm@$PNPM_PIN"
fi

if ! command -v bun >/dev/null && [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "[provision] Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  if ! grep -q 'BUN_INSTALL' ~/.bashrc 2>/dev/null; then
    {
      echo 'export BUN_INSTALL="$HOME/.bun"'
      echo 'export PATH="$BUN_INSTALL/bin:$PATH"'
    } >> ~/.bashrc
  fi
fi

if [ ! -d ~/youtube-downloader/.git ]; then
  echo "[provision] Cloning /host-repo -> ~/youtube-downloader..."
  git clone /host-repo ~/youtube-downloader
  cd ~/youtube-downloader
  upstream="$(cd /host-repo && git config --get remote.origin.url || true)"
  if [ -n "$upstream" ]; then
    git remote set-url origin "$upstream"
  fi
  git remote add host /host-repo 2>/dev/null || git remote set-url host /host-repo
fi

cd ~/youtube-downloader
echo "[provision] pnpm install --frozen-lockfile..."
CI=true pnpm install --frozen-lockfile

echo "[provision] Done."
