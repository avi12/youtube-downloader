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

BUN_PIN=1.4.5
if [ "$("$HOME/.bun/bin/bun" -v 2>/dev/null)" != "$BUN_PIN" ]; then
  echo "[provision] Installing bun@$BUN_PIN..."
  curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_PIN"
  export PATH="$HOME/.bun/bin:$PATH"
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
echo "[provision] bun install --frozen-lockfile..."
CI=true bun install --frozen-lockfile

echo "[provision] Done."
