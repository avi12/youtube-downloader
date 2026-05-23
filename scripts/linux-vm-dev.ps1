# scripts/linux-vm-dev.ps1
# Daily runner: ensures the VM is up, refreshes the host port proxy in case
# the VM IP changed, syncs the current Windows branch into the VM, and runs
# scripts/dev-server.ts under Xvfb so Chrome binds CDP on 9233.

$ErrorActionPreference = "Stop"

$VmName = "ytdl-linux"
$HostCdpPort = 9234   # Windows-side listen port (avoid clash with youtube-auto-feed's Chrome on 9233)
# Chrome binds CDP to 127.0.0.1:9233 inside the VM regardless of
# --remote-debugging-address (web-ext-run also passes --remote-debugging-pipe
# which suppresses external port binding). A socat bridge listens on
# 0.0.0.0:9235 inside the VM and forwards to 127.0.0.1:9233, so the netsh
# portproxy connects to the VM at 9235.
$VmChromePort = 9233
$VmSocatPort = 9235
$VncPort = 5900
$VmWorkDir = "/home/ubuntu/youtube-downloader"

if (-not (Get-Command multipass -ErrorAction SilentlyContinue)) {
  Write-Error "multipass not on PATH. Run scripts\install-hyperv-multipass.ps1 first."
  exit 1
}

$info = & multipass info $VmName --format json 2>$null | ConvertFrom-Json
if (-not $info) {
  Write-Error "VM '$VmName' not found. Run: pnpm setup:linux-vm"
  exit 1
}

if ($info.info.$VmName.state -ne "Running") {
  Write-Host "Starting VM '$VmName'..."
  & multipass start $VmName
  $info = & multipass info $VmName --format json | ConvertFrom-Json
}

$vmIp = $info.info.$VmName.ipv4[0]
Write-Host "VM IP: $vmIp"

$currentProxy = (& netsh interface portproxy show v4tov4) -join " "
$needCdpProxy = $currentProxy -notmatch "$vmIp\s+$VmSocatPort"
$needVncProxy = $currentProxy -notmatch "$vmIp\s+$VncPort"
if ($needCdpProxy -or $needVncProxy) {
  Write-Host "Refreshing portproxy entries (CDP 127.0.0.1:$HostCdpPort -> ${vmIp}:$VmSocatPort, VNC 127.0.0.1:$VncPort -> ${vmIp}:$VncPort)..."
  $cmds = @(
    "netsh interface portproxy delete v4tov4 listenport=$HostCdpPort listenaddress=127.0.0.1",
    "netsh interface portproxy delete v4tov4 listenport=$VncPort listenaddress=127.0.0.1",
    "netsh interface portproxy add v4tov4 listenport=$HostCdpPort listenaddress=127.0.0.1 connectport=$VmSocatPort connectaddress=$vmIp",
    "netsh interface portproxy add v4tov4 listenport=$VncPort listenaddress=127.0.0.1 connectport=$VncPort connectaddress=$vmIp"
  ) -join " & "
  Start-Process -FilePath cmd.exe -ArgumentList "/c", $cmds -Verb RunAs -Wait
}

Write-Host "Ensuring socat bridge ${VmSocatPort} -> 127.0.0.1:${VmChromePort} inside VM..."
& multipass exec $VmName -- bash -c "if ! pgrep -fx 'socat TCP-LISTEN:$VmSocatPort,reuseaddr,fork,bind=0.0.0.0 TCP:127.0.0.1:$VmChromePort' >/dev/null; then pgrep -x socat | xargs -r kill 2>/dev/null; nohup socat TCP-LISTEN:$VmSocatPort,reuseaddr,fork,bind=0.0.0.0 TCP:127.0.0.1:$VmChromePort >/tmp/socat.log 2>&1 </dev/null & disown; fi"

# x11vnc attaches to whatever Xvfb display xvfb-run started. We launch it AFTER
# the dev-server has spawned Xvfb (handled in the inner bash command below).

$branch = (& git -C (Resolve-Path "$PSScriptRoot\..").Path rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Syncing branch '$branch' from host -> VM working tree..."

# Pass the script via -c so stdin doesn't have to be piped (which deadlocks
# under `multipass exec`).
$sync = @"
set -euo pipefail
cd $VmWorkDir
git fetch host
git checkout -B '$branch' host/'$branch' 2>/dev/null || git checkout -B '$branch' FETCH_HEAD
CI=true pnpm install --frozen-lockfile

# After xvfb-run starts Xvfb, attach x11vnc so the Windows VNC viewer can see
# the same display Chrome paints to. Done in a background watcher because
# xvfb-run picks the display dynamically.
( for i in 1 2 3 4 5 6 7 8 9 10; do
    XVFB_DISPLAY=`$(ps -o args= -C Xvfb | grep -oP '^\s*:\d+' | head -1 | tr -d ' ')
    XVFB_AUTH=`$(ps -o args= -C Xvfb | grep -oP 'auth \K\S+' | head -1)
    if [ -n "`$XVFB_DISPLAY" ] && [ -n "`$XVFB_AUTH" ]; then
      if ! pgrep -x x11vnc >/dev/null; then
        nohup x11vnc -display "`$XVFB_DISPLAY" -auth "`$XVFB_AUTH" \
          -rfbport $VncPort -listen 0.0.0.0 -nopw -forever -shared -bg \
          -o /tmp/x11vnc.log >/dev/null 2>&1
      fi
      break
    fi
    sleep 1
  done ) &

echo 'Launching dev-server under xvfb-run...'
exec xvfb-run -a pnpm dev
"@

& multipass exec $VmName -- bash -c $sync
