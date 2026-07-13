[CmdletBinding()]
param(
  [switch]$Smoke
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$launcherPath = Join-Path $PSScriptRoot "Launch-PaperWriter.ps1"
$productionCmdPath = Join-Path $PSScriptRoot "PaperWriter.cmd"
$developmentCmdPath = Join-Path $PSScriptRoot "PaperWriter-Dev.cmd"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$readmePath = Join-Path $projectRoot "README.md"
$releasePath = Join-Path $projectRoot "docs\release.md"
$tokens = $null
$parseErrors = $null
[Management.Automation.Language.Parser]::ParseFile(
  $launcherPath,
  [ref]$tokens,
  [ref]$parseErrors
) | Out-Null

if ($parseErrors.Count -gt 0) {
  $messages = $parseErrors | ForEach-Object { $_.Message }
  throw "Launcher syntax validation failed: $($messages -join '; ')"
}

$source = Get-Content -LiteralPath $launcherPath -Raw -Encoding UTF8
$requiredPatterns = @(
  '(?s)if \(\$Dev -and -not \$CheckOnly\)\s*\{.*?Stop-PreviousDevelopmentLaunch',
  'Test-ExpectedElectronProcess',
  'Test-ExpectedFrontendProcess',
  'Ensure-FrontendBuild',
  'Start-ElectronAndVerify',
  '-FilePath \$node',
  'npm ci --no-audit --no-fund'
)
foreach ($pattern in $requiredPatterns) {
  if ($source -notmatch $pattern) {
    throw "Launcher safety assertion did not match: $pattern"
  }
}

foreach ($forbiddenPattern in @('function\s+Stop-ProjectProcesses', 'function\s+Stop-PreviousLaunch')) {
  if ($source -match $forbiddenPattern) {
    throw "Unsafe legacy launcher routine is still present: $forbiddenPattern"
  }
}

$developmentCleanupCalls = [Regex]::Matches(
  $source,
  '(?m)^\s*Stop-PreviousDevelopmentLaunch(?:\s|$)'
).Count
if ($developmentCleanupCalls -ne 1) {
  throw "Development cleanup must have exactly one guarded call; found $developmentCleanupCalls."
}

$productionCmd = Get-Content -LiteralPath $productionCmdPath -Raw -Encoding UTF8
$developmentCmd = Get-Content -LiteralPath $developmentCmdPath -Raw -Encoding UTF8
if ($productionCmd -notmatch 'Launch-PaperWriter\.ps1' -or $productionCmd -match '(?i)(?:^|\s)-Dev(?:\s|$)') {
  throw "PaperWriter.cmd must invoke the production launcher without -Dev."
}
if ($developmentCmd -notmatch 'Launch-PaperWriter\.ps1' -or $developmentCmd -notmatch '(?i)(?:^|\s)-Dev(?:\s|$)') {
  throw "PaperWriter-Dev.cmd must invoke the launcher with -Dev."
}

$readme = Get-Content -LiteralPath $readmePath -Raw -Encoding UTF8
$releaseNotes = Get-Content -LiteralPath $releasePath -Raw -Encoding UTF8
foreach ($documentedCommand in @(
  '.\scripts\Launch-PaperWriter.ps1 -CheckOnly',
  '.\scripts\Test-Launch-PaperWriter.ps1 -Smoke',
  'scripts\PaperWriter-Dev.cmd'
)) {
  if ($readme.IndexOf($documentedCommand, [StringComparison]::Ordinal) -lt 0) {
    throw "README is missing launcher command: $documentedCommand"
  }
}
if ($releaseNotes.IndexOf('.\scripts\Test-Launch-PaperWriter.ps1 -Smoke', [StringComparison]::Ordinal) -lt 0) {
  throw "Release instructions are missing the launcher smoke test."
}

if ($Smoke) {
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcherPath -CheckOnly
  if ($LASTEXITCODE -ne 0) {
    throw "Launcher prerequisite smoke test failed with exit code $LASTEXITCODE."
  }
}

Write-Host "Launcher static checks passed$(if ($Smoke) { ' and prerequisites are valid' } else { '' })."
