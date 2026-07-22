<#
.SYNOPSIS
  Validiert, versioniert, committet und veröffentlicht einen Kiebitz-Release.

.EXAMPLE
  .\scripts\release.ps1 -Version 0.4.5
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Fehlgeschlagen: $Command $($Arguments -join ' ')"
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot
try {
  if ((git branch --show-current).Trim() -ne "main") {
    throw "Releases dürfen nur vom main-Branch gestartet werden."
  }
  if (git status --porcelain) {
    throw "Der Working Tree muss vor einem Release sauber sein."
  }
  & git ls-remote --exit-code --tags origin "refs/tags/v$Version" *> $null
  if ($LASTEXITCODE -eq 0) {
    throw "Der Tag v$Version existiert bereits auf origin."
  }

  $tauriConfig = Join-Path $repoRoot "src-tauri\tauri.conf.json"
  $currentVersion = (Get-Content -Raw $tauriConfig | ConvertFrom-Json).version
  if ([Version]$Version -le [Version]$currentVersion) {
    throw "Die neue Version ($Version) muss höher als $currentVersion sein."
  }

  Write-Host "Validiere Release v$Version …" -ForegroundColor Cyan
  Invoke-Checked npm @("run", "build")
  Invoke-Checked npm @("run", "test:run")
  Invoke-Checked cargo @("test", "--manifest-path", "src-tauri/Cargo.toml")

  # npm hält package.json und package-lock.json konsistent, ohne selbst zu taggen.
  Invoke-Checked npm @("version", $Version, "--no-git-tag-version", "--ignore-scripts")

  $json = Get-Content -Raw $tauriConfig
  # ${1}/${2} halten die Regex-Gruppen von einer direkt folgenden, mit einer
  # Ziffer beginnenden Versionsnummer getrennt (sonst wird z. B. $1 + 0.5.0
  # von .NET als die nicht vorhandene Gruppe $10 interpretiert).
  $replacement = '${1}' + $Version + '${2}'
  $updated = $json -replace '("version"\s*:\s*")[^"]+("\s*,?)', $replacement
  if ($updated -eq $json) {
    throw "Die Version in src-tauri/tauri.conf.json konnte nicht aktualisiert werden."
  }
  try {
    $updatedConfig = $updated | ConvertFrom-Json
  }
  catch {
    throw "Die aktualisierte Tauri-Konfiguration ist kein gültiges JSON: $($_.Exception.Message)"
  }
  if ($updatedConfig.version -ne $Version) {
    throw "Die Tauri-Version wurde nicht korrekt auf $Version aktualisiert."
  }
  [System.IO.File]::WriteAllText(
    $tauriConfig,
    $updated,
    (New-Object System.Text.UTF8Encoding($false))
  )

  Invoke-Checked git @("add", "package.json", "package-lock.json", "src-tauri/tauri.conf.json")
  Invoke-Checked git @("commit", "-m", "Release v$Version")
  Invoke-Checked git @("tag", "-a", "v$Version", "-m", "Kiebitz v$Version")
  Invoke-Checked git @("push", "origin", "main", "v$Version")

  Write-Host "Release v$Version gestartet: https://github.com/Torim98/Kiebitz/actions" -ForegroundColor Green
}
finally {
  Pop-Location
}
