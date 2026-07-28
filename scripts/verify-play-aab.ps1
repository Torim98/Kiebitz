[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AabPath,
    [string]$AndroidSdk,
    [string]$JdkHome,
    [string]$BundletoolPath,
    [string]$ExpectedVersion,
    [switch]$SkipSignature
)

$ErrorActionPreference = "Stop"
$aab = (Resolve-Path -LiteralPath $AabPath).Path

if (-not $AndroidSdk) {
    $AndroidSdk = $env:ANDROID_HOME
}
if (-not $AndroidSdk -or -not (Test-Path -LiteralPath $AndroidSdk)) {
    throw "ANDROID_HOME is missing; pass -AndroidSdk."
}

if (-not $JdkHome) {
    $JdkHome = $env:JAVA_HOME
}
if (-not $JdkHome -or -not (Test-Path -LiteralPath (Join-Path $JdkHome "bin\jarsigner.exe"))) {
    $javaCommand = Get-Command java.exe -ErrorAction Stop
    $JdkHome = Split-Path -Parent (Split-Path -Parent $javaCommand.Source)
}

$java = Join-Path $JdkHome "bin\java.exe"
$jarsigner = Join-Path $JdkHome "bin\jarsigner.exe"
$readelf = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk "ndk") `
    -Recurse -File -Filter "llvm-readelf.exe" -ErrorAction Stop |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $readelf) {
    throw "llvm-readelf.exe was not found in the Android NDK."
}

$bundletoolVersion = "1.18.1"
$bundletoolSha256 = "675786493983787FFA11550BDB7C0715679A44E1643F3FF980A529E9C822595C"
if (-not $BundletoolPath) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $bundletoolDirectory = Join-Path $repoRoot "artifacts\tools"
    $BundletoolPath = Join-Path $bundletoolDirectory "bundletool-all-$bundletoolVersion.jar"
}
if (-not (Test-Path -LiteralPath $BundletoolPath)) {
    $bundletoolDirectory = Split-Path -Parent $BundletoolPath
    New-Item -ItemType Directory -Path $bundletoolDirectory -Force | Out-Null
    $bundletoolUrl = "https://github.com/google/bundletool/releases/download/$bundletoolVersion/bundletool-all-$bundletoolVersion.jar"
    Write-Host "Downloading Google bundletool $bundletoolVersion ..."
    Invoke-WebRequest -UseBasicParsing -Uri $bundletoolUrl -OutFile $BundletoolPath
}
$actualBundletoolHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $BundletoolPath).Hash
if ($actualBundletoolHash -ne $bundletoolSha256) {
    throw "bundletool checksum mismatch. Expected $bundletoolSha256, found $actualBundletoolHash."
}

if (-not $SkipSignature) {
    Write-Host "Checking AAB signature ..."
    $signatureOutput = & $jarsigner -verify -certs $aab 2>&1
    $signatureExitCode = $LASTEXITCODE
    $signatureText = $signatureOutput -join [Environment]::NewLine
    if ($signatureExitCode -ne 0 -or $signatureText -notmatch "jar verified") {
        throw "The AAB signature is invalid.`n$signatureText"
    }
}

Write-Host "Checking manifest ..."
$manifestOutput = & $java -jar $BundletoolPath dump manifest "--bundle=$aab" --module=base 2>&1
$manifestExitCode = $LASTEXITCODE
$manifest = $manifestOutput -join [Environment]::NewLine
if ($manifestExitCode -ne 0) {
    throw "The AAB manifest could not be read.`n$manifest"
}

$requiredManifestPatterns = @(
    'package="de.torim.kiebitz"',
    'targetSdkVersion="36"',
    'android.permission.INTERNET',
    'android.permission.CAMERA',
    'android.permission.POST_NOTIFICATIONS'
)
if ($ExpectedVersion) {
    $requiredManifestPatterns += "android:versionName=`"$ExpectedVersion`""
}
foreach ($pattern in $requiredManifestPatterns) {
    if ($manifest -notmatch [regex]::Escape($pattern)) {
        throw "Manifest check failed: '$pattern' is missing."
    }
}
foreach ($forbidden in @(
    "android.permission.USE_EXACT_ALARM",
    "android.permission.SCHEDULE_EXACT_ALARM",
    'android:debuggable="true"'
)) {
    if ($manifest -match [regex]::Escape($forbidden)) {
        throw "Manifest check failed: '$forbidden' is present."
    }
}

$tempRoot = [IO.Path]::GetTempPath()
$tempDirectory = Join-Path $tempRoot ("kiebitz-aab-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDirectory | Out-Null
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($aab, $tempDirectory)

    Write-Host "Checking that the external APK updater is absent ..."
    $rg = Get-Command rg.exe -ErrorAction Stop
    $externalUpdaterMatches = & $rg.Source -a -l -F `
        "github.com/Torim98/Kiebitz/releases/latest/download/latest.json" $tempDirectory 2>$null
    if ($LASTEXITCODE -eq 0 -and $externalUpdaterMatches) {
        throw "The Play build still contains the external GitHub APK updater: $externalUpdaterMatches"
    }

    Write-Host "Checking 16 KB ELF alignment ..."
    $nativeLibraries = Get-ChildItem -LiteralPath $tempDirectory -Recurse -File -Filter "*.so"
    if (-not $nativeLibraries) {
        throw "No native libraries were found in the AAB."
    }
    foreach ($library in $nativeLibraries) {
        $programHeaders = & $readelf -lW $library.FullName 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "ELF validation failed for $($library.Name)."
        }
        $loadHeaders = $programHeaders | Where-Object { $_ -match "^\s*LOAD\s" }
        if (-not $loadHeaders) {
            throw "No LOAD segments were found in $($library.Name)."
        }
        foreach ($header in $loadHeaders) {
            $columns = ($header.Trim() -split "\s+")
            $alignmentText = $columns[-1]
            $alignment = [Convert]::ToInt64($alignmentText.Replace("0x", ""), 16)
            if ($alignment -lt 0x4000) {
                throw "$($library.Name) is not 16 KB compatible: LOAD alignment $alignmentText."
            }
        }
        Write-Host "  $($library.Name): 16 KB compatible"
    }
} finally {
    $resolvedTemp = (Resolve-Path -LiteralPath $tempDirectory -ErrorAction SilentlyContinue).Path
    if ($resolvedTemp -and $resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}

$signatureStatus = if ($SkipSignature) { "signature skipped" } else { "signature valid" }
Write-Host "AAB verified: package, API 36, permissions, Play updater, $signatureStatus, and 16 KB alignment are correct."
