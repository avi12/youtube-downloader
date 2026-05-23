# scripts/setup-linux-vm.ps1
# One-time setup: provisions an Ubuntu Multipass VM with the toolchain needed
# to run scripts/dev-server.ts. Mounts the Windows repo read-only at /host-repo
# so the VM can `git fetch host` after Windows-side commits. Establishes a
# netsh portproxy so the VM's CDP port (9233) is reachable at localhost:9233,
# matching .mcp.json's chrome-devtools-mcp-linux entry.
#
# Prerequisites: Hyper-V Windows feature enabled, Multipass installed
# (run scripts\install-hyperv-multipass.ps1 first; reboot required).

$ErrorActionPreference = "Stop"

$VmName = "ytdl-linux"
$VmCpus = 4
$VmMemory = "4G"
$VmDisk = "20G"
$UbuntuRelease = "24.04"
# Inside the VM, dev-server.ts binds Chrome to 9233 (CDP_PORT_LINUX).
# On Windows, that other Chrome from youtube-auto-feed already owns 9233, so
# we expose the VM via a different host port and point .mcp.json at it.
$HostCdpPort = 9234
$VmCdpPort = 9233
$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path
$VmHostMount = "/host-repo"
$VmWorkDir = "/home/ubuntu/youtube-downloader"

function Assert-Multipass {
  if (-not (Get-Command multipass -ErrorAction SilentlyContinue)) {
    Write-Error "multipass not found on PATH. Run scripts\install-hyperv-multipass.ps1 (elevated) and reboot first."
    exit 1
  }
}

function Ensure-Vm {
  $info = & multipass info $VmName 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "VM '$VmName' already exists." -ForegroundColor DarkGray
    return
  }
  Write-Host "Creating VM '$VmName' (Ubuntu $UbuntuRelease, $VmCpus CPU, $VmMemory RAM, $VmDisk disk)..."
  & multipass launch $UbuntuRelease --name $VmName --cpus $VmCpus --memory $VmMemory --disk $VmDisk
  if ($LASTEXITCODE -ne 0) { throw "multipass launch failed" }
}

function Ensure-Mount {
  $mounts = & multipass info $VmName --format json | ConvertFrom-Json
  $existing = $mounts.info.$VmName.mounts.PSObject.Properties.Name
  if ($existing -contains $VmHostMount) {
    Write-Host "Mount $VmHostMount already configured." -ForegroundColor DarkGray
    return
  }
  Write-Host "Mounting $ProjectDir -> ${VmName}:${VmHostMount} (classic, host -> guest)..."
  & multipass mount $ProjectDir "${VmName}:${VmHostMount}" --type classic
  if ($LASTEXITCODE -ne 0) { throw "multipass mount failed" }
}

function Provision-Vm {
  Write-Host "Provisioning VM toolchain (Node 22, pnpm, bun, ffmpeg, Xvfb, Chrome deps)..."
  # Normalise CRLF -> LF on the provision script so bash doesn't choke on it
  # when read through the Windows-mounted /host-repo path.
  $scriptHostPath = Join-Path $PSScriptRoot "linux-vm-provision.sh"
  $raw = [IO.File]::ReadAllText($scriptHostPath)
  $lf = $raw -replace "`r`n", "`n"
  if ($raw -ne $lf) {
    [IO.File]::WriteAllText($scriptHostPath, $lf)
  }
  & multipass exec $VmName -- bash /host-repo/scripts/linux-vm-provision.sh
  if ($LASTEXITCODE -ne 0) { throw "Provision step failed" }
}

function Get-VmIp {
  $json = & multipass info $VmName --format json | ConvertFrom-Json
  return $json.info.$VmName.ipv4[0]
}

function Set-PortProxy {
  param([string]$Ip)
  $isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator)

  $cmds = @(
    "netsh interface portproxy delete v4tov4 listenport=$HostCdpPort listenaddress=127.0.0.1",
    "netsh interface portproxy add v4tov4 listenport=$HostCdpPort listenaddress=127.0.0.1 connectport=$VmCdpPort connectaddress=$Ip"
  )
  # cmd.exe chains with `&`, not `;` (which is PowerShell). Using `&` so both
  # commands actually execute under `cmd /c`.
  $combined = $cmds -join " & "

  if ($isAdmin) {
    Write-Host "Configuring netsh portproxy 127.0.0.1:$HostCdpPort -> ${Ip}:$VmCdpPort..."
    foreach ($c in $cmds) {
      cmd /c $c 2>$null | Out-Null
    }
    return
  }

  Write-Host "Elevating to configure netsh portproxy 127.0.0.1:$HostCdpPort -> ${Ip}:$VmCdpPort..."
  Start-Process -FilePath cmd.exe -ArgumentList "/c", $combined -Verb RunAs -Wait
}

Assert-Multipass
Ensure-Vm
Ensure-Mount
Provision-Vm

$ip = Get-VmIp
if (-not $ip) { throw "Could not determine VM IP" }
Write-Host "VM IP: $ip"
Set-PortProxy -Ip $ip

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "  pnpm dev:linux          - run dev-server inside the VM (Chrome on CDP 9233)"
Write-Host "  multipass shell $VmName - open a shell inside the VM"
Write-Host "  multipass stop $VmName  - shut down the VM"
