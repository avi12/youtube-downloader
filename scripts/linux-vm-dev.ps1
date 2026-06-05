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

# After the VM dev-server is up, poll for x11vnc on port 5900 then open VNC viewer.
$vncExe = "C:\Program Files\RealVNC\VNC Viewer\vncviewer.exe"
$null = Start-Job -ScriptBlock {
  param($port, $exe)
  Start-Sleep -Seconds 15
  for ($i = 0; $i -lt 30; $i++) {
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
      $tcp.Connect("127.0.0.1", $port)
      $tcp.Close()
      Start-Process $exe -ArgumentList "localhost::$port"
      break
    } catch {
      try { $tcp.Close() } catch {}
      Start-Sleep -Seconds 2
    }
  }
} -ArgumentList $VncPort, $vncExe

$branch = (& git -C (Resolve-Path "$PSScriptRoot\..").Path rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Syncing branch '$branch' from host -> VM working tree..."

# Pass the script via -c so stdin doesn't have to be piped (which deadlocks
# under `multipass exec`).
$sync = @"
set -euo pipefail
cd $VmWorkDir
git fetch host
git reset --hard HEAD 2>/dev/null || true
git checkout -B '$branch' host/'$branch' 2>/dev/null || git checkout -B '$branch' FETCH_HEAD
CI=true pnpm install --frozen-lockfile

# x11vnc supervisor: restart whenever Xvfb is up but x11vnc isn't running.
# set +e: ps/grep return 1 when Xvfb not yet up; must not kill the loop.
# disown: detach from bash job table so xvfb-run exit can't HUP it.
( set +e +o pipefail
  trap '' HUP
  while true; do
    XVFB_DISPLAY=`$(ps -o args= -C Xvfb | awk 'NR==1{print `$2}')
    XVFB_AUTH=`$(ps -o args= -C Xvfb | grep -oP 'auth \K\S+' | head -1)
    if [ -n "`$XVFB_DISPLAY" ] && [ -n "`$XVFB_AUTH" ] && ! pgrep -x x11vnc >/dev/null 2>&1; then
      x11vnc -display "`$XVFB_DISPLAY" -auth "`$XVFB_AUTH" \
        -rfbport $VncPort -listen 0.0.0.0 -nopw -forever -shared \
        -o /tmp/x11vnc.log 2>&1
    fi
    sleep 2
  done ) &
disown `$!

pkill -f "[c]hrome-linux64" 2>/dev/null || true
sleep 1

echo 'Launching dev-server under xvfb-run...'
exec xvfb-run -a pnpm dev </dev/null
"@

& multipass exec $VmName -- bash -c ($sync -replace "`r", "")
