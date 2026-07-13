[CmdletBinding()]
param(
  [switch]$Dev,
  [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$FrontendDir = Join-Path $ProjectRoot "apps\writer\frontend"
$ElectronDir = Join-Path $ProjectRoot "apps\writer\electron"
$LogDir = Join-Path $ProjectRoot "logs\launcher"
$PidFile = Join-Path $LogDir "paperwriter-pids.json"
$LegacyPidFile = Join-Path $LogDir "paperwriter-dev-pids.json"
$HostName = "127.0.0.1"
$FrontendPort = 5174
$FrontendUrl = "http://${HostName}:${FrontendPort}"
$StartupProbeMilliseconds = 2500

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-SamePath {
  param(
    [AllowNull()][string]$Left,
    [AllowNull()][string]$Right
  )

  if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) {
    return $false
  }

  try {
    $leftPath = [IO.Path]::GetFullPath($Left).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $rightPath = [IO.Path]::GetFullPath($Right).TrimEnd([IO.Path]::DirectorySeparatorChar)
    return [string]::Equals($leftPath, $rightPath, [StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function Get-ProcessRecord {
  param([int]$ProcessId)

  if ($ProcessId -le 0 -or $ProcessId -eq $PID) {
    return $null
  }

  return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Test-ExpectedElectronProcess {
  param(
    [int]$ProcessId,
    [string]$ElectronExecutable
  )

  $process = Get-ProcessRecord -ProcessId $ProcessId
  if (-not $process -or $process.Name -ne "electron.exe") {
    return $false
  }

  if (-not (Test-SamePath -Left ([string]$process.ExecutablePath) -Right $ElectronExecutable)) {
    return $false
  }

  $commandLine = [string]$process.CommandLine
  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    return $false
  }

  return $commandLine.IndexOf($ElectronDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-ExpectedFrontendProcess {
  param([int]$ProcessId)

  $process = Get-ProcessRecord -ProcessId $ProcessId
  if (-not $process -or $process.Name -ne "node.exe") {
    return $false
  }

  $commandLine = [string]$process.CommandLine
  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    return $false
  }

  $vitePattern = '[\\/]node_modules[\\/](?:\.bin[\\/]+\.\.[\\/]+)?vite[\\/]bin[\\/]vite\.js(?:"|\s)'
  return (
    $commandLine.IndexOf($FrontendDir, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine -match $vitePattern -and
    $commandLine -match "(?:^|\s)--host(?:=|\s+)$([Regex]::Escape($HostName))(?:\s|$)" -and
    $commandLine -match "(?:^|\s)--port(?:=|\s+)$FrontendPort(?:\s|$)"
  )
}

function Stop-OwnedProcessTree {
  param([int]$ProcessId)

  if ($ProcessId -le 0 -or $ProcessId -eq $PID) {
    return
  }

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in @($children)) {
    Stop-OwnedProcessTree -ProcessId ([int]$child.ProcessId)
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Read-LauncherState {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Test-StateBelongsToProject {
  param([object]$State)

  if (-not $State) {
    return $false
  }

  $projectRootProperty = $State.PSObject.Properties["project_root"]
  if (-not $projectRootProperty -or [string]::IsNullOrWhiteSpace([string]$projectRootProperty.Value)) {
    # Legacy state files did not include a project root. Individual process
    # signatures still have to pass before anything may be stopped.
    return $true
  }

  return Test-SamePath -Left ([string]$projectRootProperty.Value) -Right $ProjectRoot
}

function Get-ListenerProcessIds {
  param([int]$Port)

  return @(
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
}

function Wait-PortReleased {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 5
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $listenerPids = @(Get-ListenerProcessIds -Port $Port)
    if ($listenerPids.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)

  throw "Development port $Port is still in use. No unverified process was stopped."
}

function Stop-PreviousDevelopmentLaunch {
  param([string]$ElectronExecutable)

  $stateFiles = @(
    @{ Path = $PidFile; Legacy = $false },
    @{ Path = $LegacyPidFile; Legacy = $true }
  )

  foreach ($stateFile in $stateFiles) {
    $state = Read-LauncherState -Path $stateFile.Path
    if (-not (Test-StateBelongsToProject -State $state)) {
      continue
    }

    $modeProperty = $state.PSObject.Properties["mode"]
    $isDevelopment = $stateFile.Legacy -or (
      $modeProperty -and [string]$modeProperty.Value -eq "development"
    )
    if (-not $isDevelopment) {
      continue
    }

    $frontendProperty = $state.PSObject.Properties["frontend_pid"]
    if ($frontendProperty -and $frontendProperty.Value) {
      $frontendPid = [int]$frontendProperty.Value
      if (Test-ExpectedFrontendProcess -ProcessId $frontendPid) {
        Stop-OwnedProcessTree -ProcessId $frontendPid
      }
    }

    $electronProperty = $state.PSObject.Properties["electron_pid"]
    if ($electronProperty -and $electronProperty.Value) {
      $electronPid = [int]$electronProperty.Value
      if (Test-ExpectedElectronProcess -ProcessId $electronPid -ElectronExecutable $ElectronExecutable) {
        Stop-OwnedProcessTree -ProcessId $electronPid
      }
    }
  }

  # A prior development server can outlive a stale PID file. It is safe to
  # stop only when its executable and full Vite command line match this repo.
  foreach ($owner in Get-ListenerProcessIds -Port $FrontendPort) {
    $ownerPid = [int]$owner
    if (Test-ExpectedFrontendProcess -ProcessId $ownerPid) {
      Stop-OwnedProcessTree -ProcessId $ownerPid
      continue
    }

    $process = Get-ProcessRecord -ProcessId $ownerPid
    $processName = if ($process) { [string]$process.Name } else { "unknown" }
    throw "Development port $FrontendPort is owned by unrecognized process $ownerPid ($processName). Stop it manually or choose another port; the launcher will not terminate it."
  }

  Wait-PortReleased -Port $FrontendPort
}

function Require-Command {
  param([string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command not found: $Name"
  }
  return $command.Source
}

function Get-DependencyFingerprint {
  param([string]$Directory)

  $packagePath = Join-Path $Directory "package.json"
  $lockPath = Join-Path $Directory "package-lock.json"
  foreach ($requiredFile in @($packagePath, $lockPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
      throw "Required dependency manifest is missing: $requiredFile"
    }
  }

  $packageHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
  $lockHash = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
  return "$packageHash`:$lockHash"
}

function Test-NpmDependencyTree {
  param([string]$Directory)

  Push-Location $Directory
  try {
    & $npm ls --depth=0 --silent *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }
}

function Ensure-NpmDependencies {
  param(
    [string]$Directory,
    [string[]]$RequiredPaths,
    [string]$Name,
    [string]$StampName
  )

  $fingerprint = Get-DependencyFingerprint -Directory $Directory
  $stampPath = Join-Path $LogDir $StampName
  $recordedFingerprint = if (Test-Path -LiteralPath $stampPath -PathType Leaf) {
    (Get-Content -LiteralPath $stampPath -Raw -Encoding UTF8).Trim()
  } else {
    ""
  }
  $requiredPathsPresent = -not ($RequiredPaths | Where-Object {
    -not (Test-Path -LiteralPath $_)
  } | Select-Object -First 1)

  if ($requiredPathsPresent -and $recordedFingerprint -eq $fingerprint) {
    return
  }

  $needsCleanInstall = -not $requiredPathsPresent -or (
    $recordedFingerprint -and $recordedFingerprint -ne $fingerprint
  )

  if (-not $needsCleanInstall -and -not (Test-NpmDependencyTree -Directory $Directory)) {
    $needsCleanInstall = $true
  }

  if ($needsCleanInstall) {
    Write-Host "Restoring $Name dependencies from package-lock.json..."
    Push-Location $Directory
    try {
      & $npm ci --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) {
        throw "$Name npm ci failed."
      }
    } finally {
      Pop-Location
    }
  }

  if (-not (Test-NpmDependencyTree -Directory $Directory)) {
    throw "$Name dependency validation failed."
  }
  foreach ($requiredPath in $RequiredPaths) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
      throw "$Name dependency artifact is missing after install: $requiredPath"
    }
  }

  Set-Content -LiteralPath $stampPath -Value $fingerprint -Encoding UTF8 -NoNewline
}

function Get-FrontendBuildInputs {
  $inputs = [Collections.Generic.List[IO.FileInfo]]::new()
  foreach ($path in @(
    (Join-Path $FrontendDir "src"),
    (Join-Path $FrontendDir "public")
  )) {
    if (Test-Path -LiteralPath $path -PathType Container) {
      foreach ($file in Get-ChildItem -LiteralPath $path -File -Recurse) {
        $inputs.Add($file)
      }
    }
  }

  foreach ($path in @(
    (Join-Path $FrontendDir "index.html"),
    (Join-Path $FrontendDir "package.json"),
    (Join-Path $FrontendDir "package-lock.json")
  )) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Required frontend build input is missing: $path"
    }
    $inputs.Add((Get-Item -LiteralPath $path))
  }

  foreach ($config in Get-ChildItem -LiteralPath $FrontendDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^(?:vite\.config\.|tsconfig(?:\.|$)|jsconfig(?:\.|$))" }) {
    $inputs.Add($config)
  }

  return $inputs
}

function Test-FrontendBuildIntegrity {
  $distDir = Join-Path $FrontendDir "dist"
  $distIndex = Join-Path $distDir "index.html"
  if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) {
    return $false
  }

  $indexFile = Get-Item -LiteralPath $distIndex
  if ($indexFile.Length -le 0) {
    return $false
  }

  $html = Get-Content -LiteralPath $distIndex -Raw -Encoding UTF8
  $references = [Regex]::Matches(
    $html,
    '(?:src|href)\s*=\s*[''"](?<url>[^''"]+)[''"]',
    [Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  $localScriptCount = 0
  $distRoot = [IO.Path]::GetFullPath($distDir).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $distPrefix = "$distRoot$([IO.Path]::DirectorySeparatorChar)"

  foreach ($reference in $references) {
    $url = [string]$reference.Groups["url"].Value
    if (
      [string]::IsNullOrWhiteSpace($url) -or
      $url.StartsWith("#") -or
      $url.StartsWith("//") -or
      $url -match "^[a-z][a-z0-9+.-]*:"
    ) {
      continue
    }

    $cleanUrl = ($url -split "[?#]", 2)[0]
    try {
      $cleanUrl = [Uri]::UnescapeDataString($cleanUrl)
    } catch {
      return $false
    }
    $relativePath = $cleanUrl.TrimStart("/", "\").Replace("/", [IO.Path]::DirectorySeparatorChar)
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
      continue
    }

    $assetPath = [IO.Path]::GetFullPath((Join-Path $distDir $relativePath))
    if (-not $assetPath.StartsWith($distPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
    if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
      return $false
    }
    if ((Get-Item -LiteralPath $assetPath).Length -le 0) {
      return $false
    }
    if ([IO.Path]::GetExtension($assetPath) -in @(".js", ".mjs")) {
      $localScriptCount += 1
    }
  }

  return $localScriptCount -gt 0
}

function Test-FrontendBuildStale {
  if (-not (Test-FrontendBuildIntegrity)) {
    return $true
  }

  $distTimestamp = (Get-Item -LiteralPath (Join-Path $FrontendDir "dist\index.html")).LastWriteTimeUtc
  return [bool](Get-FrontendBuildInputs |
    Where-Object { $_.LastWriteTimeUtc -gt $distTimestamp } |
    Select-Object -First 1)
}

function Ensure-FrontendBuild {
  if (-not (Test-FrontendBuildStale)) {
    return
  }

  Write-Host "Building the production frontend..."
  Push-Location $FrontendDir
  try {
    & $npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend production build failed."
    }
  } finally {
    Pop-Location
  }

  if (Test-FrontendBuildStale) {
    throw "Frontend build output is missing, incomplete, or older than its inputs."
  }
}

function Wait-DevelopmentFrontend {
  param(
    [Diagnostics.Process]$LauncherProcess,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $listenerPids = @(Get-ListenerProcessIds -Port $FrontendPort)
    foreach ($listenerPid in $listenerPids) {
      $listenerPid = [int]$listenerPid
      if (-not (Test-ExpectedFrontendProcess -ProcessId $listenerPid)) {
        throw "Development port $FrontendPort was claimed by an unrecognized process."
      }

      try {
        $response = Invoke-WebRequest -Uri $FrontendUrl -UseBasicParsing -TimeoutSec 2
        if (
          $response.StatusCode -eq 200 -and
          [string]$response.Content -match '<div\s+id=["'']root["'']'
        ) {
          return $listenerPid
        }
      } catch {
        # Vite can own the port briefly before its first response is ready.
      }
    }

    $LauncherProcess.Refresh()
    if ($LauncherProcess.HasExited -and $listenerPids.Count -eq 0) {
      throw "Frontend development process exited before becoming ready. See logs\launcher\frontend.err.log."
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)

  throw "Frontend did not become ready at $FrontendUrl"
}

function Start-DevelopmentFrontend {
  $viteEntry = Join-Path $FrontendDir "node_modules\vite\bin\vite.js"
  $viteArgument = '"' + $viteEntry.Replace('"', '\"') + '"'
  $frontendLauncher = Start-Process `
    -FilePath $node `
    -ArgumentList @($viteArgument, "--host", $HostName, "--port", [string]$FrontendPort) `
    -WorkingDirectory $FrontendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "frontend.out.log") `
    -RedirectStandardError (Join-Path $LogDir "frontend.err.log") `
    -PassThru

  try {
    return Wait-DevelopmentFrontend -LauncherProcess $frontendLauncher
  } catch {
    Stop-OwnedProcessTree -ProcessId $frontendLauncher.Id
    throw
  }
}

function Get-RecordedElectronPid {
  param([string]$ElectronExecutable)

  $state = Read-LauncherState -Path $PidFile
  if (-not (Test-StateBelongsToProject -State $state)) {
    return $null
  }

  $electronProperty = $state.PSObject.Properties["electron_pid"]
  if (-not $electronProperty -or -not $electronProperty.Value) {
    return $null
  }

  $electronPid = [int]$electronProperty.Value
  if (Test-ExpectedElectronProcess -ProcessId $electronPid -ElectronExecutable $ElectronExecutable) {
    return $electronPid
  }

  return $null
}

function Start-ElectronAndVerify {
  param([string]$ElectronExecutable)

  $electronAppArgument = '"' + $ElectronDir.Replace('"', '\"') + '"'
  $electron = Start-Process `
    -FilePath $ElectronExecutable `
    -ArgumentList $electronAppArgument `
    -WorkingDirectory $ElectronDir `
    -PassThru

  Start-Sleep -Milliseconds $StartupProbeMilliseconds
  $electron.Refresh()
  if (-not $electron.HasExited) {
    return [pscustomobject]@{
      status = "running"
      process_id = $electron.Id
      exit_code = $null
    }
  }

  $exitCode = $electron.ExitCode
  if ($exitCode -ne 0) {
    throw "Electron exited during startup with code $exitCode."
  }

  # With Electron's single-instance lock, a second launcher exits normally
  # after asking the existing instance to focus its window.
  return [pscustomobject]@{
    status = "delegated"
    process_id = $null
    exit_code = $exitCode
  }
}

function Write-LauncherState {
  param(
    [AllowNull()][object]$FrontendPid,
    [AllowNull()][object]$ElectronPid,
    [string]$Mode,
    [string]$Status
  )

  $tempPath = "$PidFile.$PID.tmp"
  @{
    schema_version = 2
    project_root = $ProjectRoot
    frontend_pid = $FrontendPid
    electron_pid = $ElectronPid
    frontend_url = if ($Mode -eq "development") { $FrontendUrl } else { "" }
    mode = $Mode
    status = $Status
    started_at = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $tempPath -Encoding UTF8
  Move-Item -LiteralPath $tempPath -Destination $PidFile -Force
}

$npm = Require-Command "npm.cmd"
$node = Require-Command "node.exe"
$electronExe = Join-Path $ElectronDir "node_modules\electron\dist\electron.exe"
$recordedElectronPid = if (Test-Path -LiteralPath $electronExe -PathType Leaf) {
  Get-RecordedElectronPid -ElectronExecutable $electronExe
} else {
  $null
}

# Production startup never stops an existing Electron or a process on the Vite
# port. If this project's instance is already known, launch only the tiny
# second-instance handoff and avoid touching its dependencies while it runs.
if (-not $Dev -and -not $CheckOnly -and $recordedElectronPid) {
  Remove-Item Env:PAPERWRITER_FRONTEND_URL -ErrorAction SilentlyContinue
  $launchResult = Start-ElectronAndVerify -ElectronExecutable $electronExe
  if ($launchResult.status -eq "running") {
    if (Test-ExpectedElectronProcess -ProcessId $recordedElectronPid -ElectronExecutable $electronExe) {
      # This is the process created by this launcher, not the existing editor.
      # Stop it rather than allowing an accidental second writable instance.
      Stop-OwnedProcessTree -ProcessId $launchResult.process_id
      throw "The existing PaperWriter instance did not accept the single-instance handoff. It was left running; restart it before trying again."
    }
    # The recorded instance exited while the handoff was starting, so retain
    # the newly started replacement.
    Write-LauncherState -FrontendPid $null -ElectronPid $launchResult.process_id -Mode "production" -Status "running"
  } else {
    Write-Host "PaperWriter is already running; the existing window was activated."
  }
  return
}

if ($Dev -and -not $CheckOnly) {
  # Only development mode performs cleanup, and every target must pass a
  # project-specific executable and command-line check first.
  Stop-PreviousDevelopmentLaunch -ElectronExecutable $electronExe
}

Ensure-NpmDependencies `
  -Directory $FrontendDir `
  -RequiredPaths @((Join-Path $FrontendDir "node_modules\vite\bin\vite.js")) `
  -Name "Frontend" `
  -StampName "frontend-dependencies.sha256"

Ensure-NpmDependencies `
  -Directory $ElectronDir `
  -RequiredPaths @($electronExe) `
  -Name "Electron" `
  -StampName "electron-dependencies.sha256"

if (-not $Dev) {
  Ensure-FrontendBuild
}

if ($CheckOnly) {
  $modeName = if ($Dev) { "development" } else { "production" }
  Write-Host "PaperWriter $modeName prerequisites are valid. No process was started or stopped."
  return
}

$recordedFrontendPid = $null
if ($Dev) {
  $recordedFrontendPid = Start-DevelopmentFrontend
  $env:PAPERWRITER_FRONTEND_URL = $FrontendUrl
} else {
  Remove-Item Env:PAPERWRITER_FRONTEND_URL -ErrorAction SilentlyContinue
}

try {
  $launchResult = Start-ElectronAndVerify -ElectronExecutable $electronExe
  if ($Dev -and $launchResult.status -eq "delegated") {
    if ($recordedFrontendPid -and (Test-ExpectedFrontendProcess -ProcessId $recordedFrontendPid)) {
      Stop-OwnedProcessTree -ProcessId $recordedFrontendPid
    }
    throw "Another PaperWriter instance is already running. Close it before starting development mode."
  }

  if ($launchResult.status -eq "running") {
    Write-LauncherState `
      -FrontendPid $recordedFrontendPid `
      -ElectronPid $launchResult.process_id `
      -Mode $(if ($Dev) { "development" } else { "production" }) `
      -Status "running"
  } else {
    Write-Host "PaperWriter is already running; the existing window was activated."
  }
} catch {
  if ($Dev -and $recordedFrontendPid -and (Test-ExpectedFrontendProcess -ProcessId $recordedFrontendPid)) {
    Stop-OwnedProcessTree -ProcessId $recordedFrontendPid
  }
  throw
}
