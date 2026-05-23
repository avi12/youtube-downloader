# scripts/install-hyperv-multipass.ps1
# Elevated prerequisites for the Multipass-backed Linux VM workflow:
#   1. Enable the Microsoft-Hyper-V Windows feature (required by Multipass)
#   2. Install Canonical.Multipass system-wide via winget
# A reboot is required after Hyper-V enablement; the script will print a
# reminder rather than auto-rebooting so the user controls timing.

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "Re-launching elevated..." -ForegroundColor Yellow
  Start-Process -FilePath pwsh.exe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $MyInvocation.MyCommand.Path -Verb RunAs
  exit 0
}

Write-Host "=== Enabling Microsoft-Hyper-V (online, no auto-restart) ==="
$result = Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart
$needsRestart = $result.RestartNeeded

Write-Host ""
Write-Host "=== Installing Canonical.Multipass (system scope) ==="
& winget install --id Canonical.Multipass --scope machine --silent `
  --accept-source-agreements --accept-package-agreements
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
  # -1978335189 = APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE (already installed)
  Write-Warning "winget install returned $LASTEXITCODE - verify Multipass install manually."
}

Write-Host ""
if ($needsRestart) {
  Write-Host "Hyper-V enablement requires a REBOOT before Multipass can launch a VM." -ForegroundColor Yellow
  Write-Host "Reboot, then run: pnpm setup:linux-vm" -ForegroundColor Yellow
} else {
  Write-Host "No reboot needed. Run: pnpm setup:linux-vm" -ForegroundColor Green
}

Write-Host ""
Write-Host "Press any key to close this elevated window..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
