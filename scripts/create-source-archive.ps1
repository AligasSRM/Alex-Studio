[CmdletBinding()]
param(
  [string]$OutputPath = "Alex-Studio-Phase-2-Source.zip"
)

$ErrorActionPreference = "Stop"
$repoRoot = (& git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
  throw "Run this script from inside the Alex Studio Git repository."
}
$repoRoot = $repoRoot.Trim()
if (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $repoRoot $OutputPath
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$sensitiveNamePattern = '(^|/)(\.env([^/]*)?|credentials(\.[^/]*)?|secrets?(\.[^/]*)?|id_rsa(\.[^/]*)?|id_ed25519(\.[^/]*)?)(/|$)|\.(pem|key|p12|pfx)$'
$trackedPaths = @(& git -C $repoRoot ls-files)
if ($LASTEXITCODE -ne 0) {
  throw "Could not enumerate tracked Git files."
}
$unsafeTracked = @($trackedPaths | Where-Object { $_ -match $sensitiveNamePattern })
if ($unsafeTracked.Count -gt 0) {
  Write-Error "Refusing to create source archive: sensitive-looking files are tracked by Git."
  $unsafeTracked | ForEach-Object { Write-Error $_ }
  exit 1
}

if (Test-Path -LiteralPath $OutputPath) {
  Remove-Item -LiteralPath $OutputPath -Force
}
& git -C $repoRoot archive --format=zip "--output=$OutputPath" HEAD -- . ':(exclude)workspace/**'
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $OutputPath)) {
  throw "Git could not create the source archive."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($OutputPath)
try {
  $archivePaths = @($archive.Entries | ForEach-Object { $_.FullName })
  $forbiddenPathPattern = '(^|/)(\.git|\.next|node_modules|workspace|\.alex)(/|$)|(^|/)\.env([^/]*)?$|\.(pem|key|p12|pfx)$'
  $unsafeArchivePaths = @($archivePaths | Where-Object {
    $_ -match $forbiddenPathPattern -or $_ -match $sensitiveNamePattern
  })
  if ($unsafeArchivePaths.Count -gt 0) {
    throw "Source archive contains a forbidden or sensitive path: $($unsafeArchivePaths -join ', ')"
  }
}
finally {
  $archive.Dispose()
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("alex-studio-source-archive-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
  [System.IO.Compression.ZipFile]::ExtractToDirectory($OutputPath, $tempRoot)
  $scanner = Join-Path $repoRoot "scripts/scan-source-archive-secrets.mjs"
  & node $scanner $tempRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Source archive content scan failed."
  }
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

Write-Output "Created and validated source archive: $OutputPath"
