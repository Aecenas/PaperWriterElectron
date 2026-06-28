$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$FrontendDir = Join-Path $ProjectRoot "apps\writer\frontend"
$ElectronDir = Join-Path $ProjectRoot "apps\writer\electron"
$LogDir = Join-Path $ProjectRoot "logs\launcher"
$PidFile = Join-Path $LogDir "paperwriter-dev-pids.json"
$HostName = "127.0.0.1"
$FrontendPort = 5174
$FrontendUrl = "http://${HostName}:${FrontendPort}"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Stop-KnownProcess {
  param([int]$ProcessId)

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process) {
    return
  }

  if ($process.ProcessName -in @("electron", "node")) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Stop-PreviousLaunch {
  if (Test-Path -LiteralPath $PidFile) {
    try {
      $state = Get-Content -LiteralPath $PidFile -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($id in @($state.frontend_pid, $state.electron_pid)) {
        if ($id) {
          Stop-KnownProcess -ProcessId ([int]$id)
        }
      }
    } catch {
      # Ignore stale launcher state.
    }
  }

  $owners = Get-NetTCPConnection -LocalAddress $HostName -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($owner in $owners) {
    Stop-KnownProcess -ProcessId ([int]$owner)
  }

  Start-Sleep -Milliseconds 600
}

function Require-Command {
  param([string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command not found: $Name"
  }
  return $command.Source
}

function Ensure-NpmDependencies {
  param(
    [string]$Directory,
    [string]$MarkerPath,
    [string]$Name
  )

  if (Test-Path -LiteralPath $MarkerPath) {
    return
  }

  Push-Location $Directory
  try {
    & $npm install
    if ($LASTEXITCODE -ne 0) {
      throw "$Name npm install failed."
    }
  } finally {
    Pop-Location
  }
}

function Wait-Http {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 700
    }
  } while ((Get-Date) -lt $deadline)

  throw "Frontend did not become ready at $Url"
}

function Get-ListenerProcessId {
  param([int]$Port)

  $connection = Get-NetTCPConnection -LocalAddress $HostName -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if ($connection) {
    return [int]$connection.OwningProcess
  }

  return $null
}

Stop-PreviousLaunch

$npm = Require-Command "npm.cmd"
$electronExe = Join-Path $ElectronDir "node_modules\electron\dist\electron.exe"

Ensure-NpmDependencies `
  -Directory $FrontendDir `
  -MarkerPath (Join-Path $FrontendDir "node_modules\vite") `
  -Name "Frontend"

Ensure-NpmDependencies `
  -Directory $ElectronDir `
  -MarkerPath $electronExe `
  -Name "Electron"

$frontend = Start-Process `
  -FilePath $npm `
  -ArgumentList @("run", "dev", "--", "--host", $HostName, "--port", [string]$FrontendPort) `
  -WorkingDirectory $FrontendDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $LogDir "frontend.out.log") `
  -RedirectStandardError (Join-Path $LogDir "frontend.err.log") `
  -PassThru

Wait-Http -Url $FrontendUrl

$frontendPid = Get-ListenerProcessId -Port $FrontendPort
$recordedFrontendPid = if ($frontendPid) { $frontendPid } else { $frontend.Id }

$env:PAPERWRITER_FRONTEND_URL = $FrontendUrl

$electron = Start-Process `
  -FilePath $electronExe `
  -ArgumentList @(".") `
  -WorkingDirectory $ElectronDir `
  -PassThru

@{
  frontend_pid = $recordedFrontendPid
  electron_pid = $electron.Id
  frontend_url = $FrontendUrl
  started_at = (Get-Date).ToString("s")
} | ConvertTo-Json | Set-Content -LiteralPath $PidFile -Encoding UTF8
