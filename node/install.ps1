<#
.SYNOPSIS
  Spindle node installer for Windows (Docker Desktop + WSL2).
.DESCRIPTION
  Downloads OUR compiled agent as a docker build context from the Spindle API (token-gated, sha256-verified)
  and builds the node image locally on the pinned official base image. Nothing is pulled from a Spindle registry.
.EXAMPLE
  & ([scriptblock]::Create((irm <api>/v1/node/install.ps1))) -Token <TOKEN> -Engine ollama
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute("PSAvoidUsingWriteHost", "", Justification = "interactive installer")]
[CmdletBinding()]
param(
  [string]$Token = $env:SPINDLE_TOKEN,
  [string]$UpdateToken = '',
  [ValidateSet('ollama', 'vllm')][string]$Engine = 'ollama',
  [string]$Model = '',
  [string]$Models = $env:SPINDLE_MODELS,
  [string]$Name = '',
  [string]$Api = '',
  [switch]$Update,
  [switch]$DryRun,
  [switch]$Uninstall,
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'
$Container = 'spindle-node'
$Volume = 'spindle-node'
$Image = "spindle-node:$Engine"
# The API serves this script with its own URL templated in. (Split so the server's substitution leaves the test alone.)
$ApiHttp = '__SPINDLE_API_URL__'
$Placeholder = '__SPINDLE_API' + '_URL__'
if ($Api) { $ApiHttp = $Api }
if ($ApiHttp -eq $Placeholder -or -not $ApiHttp) { $ApiHttp = $env:SPINDLE_API_URL }

function Invoke-Docker {
  param([string[]]$DockerArgs, [switch]$Quiet)
  if ($DryRun) {
    $shown = ($DockerArgs | ForEach-Object { $_ -replace 'SPINDLE_TOKEN=.*', 'SPINDLE_TOKEN=***' }) -join ' '
    Write-Host "+ docker $shown"
    return
  }
  if ($Quiet) { & docker @DockerArgs 2>&1 | Out-Null } else { & docker @DockerArgs }
}

# ---- Docker Desktop installed and reachable ----
if (-not $DryRun) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is not installed. Install Docker Desktop with the WSL2 backend: https://docs.docker.com/desktop/setup/install/windows-install/'
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot reach the Docker daemon. Start Docker Desktop and wait until it says "running".' }
  $osType = (& docker info --format '{{.OSType}}' 2>$null)
  if ($osType -ne 'linux') { throw 'Docker Desktop is in Windows-container mode. Switch to Linux containers (tray icon -> "Switch to Linux containers").' }
  $wsl = (& docker info --format '{{.KernelVersion}}' 2>$null)
  if ($wsl -notmatch 'microsoft|WSL') {
    Write-Warning 'Docker does not appear to use the WSL2 backend. Enable it in Docker Desktop -> Settings -> General -> "Use the WSL 2 based engine".'
  }
}

# ---- uninstall / purge ----
if ($Uninstall -or $Purge) {
  Invoke-Docker -DockerArgs @('rm', '-f', $Container) -Quiet
  Write-Host "Container $Container removed."
  if ($Purge) {
    Write-Host "This deletes volume '$Volume', including the node key. The node would have to re-enroll and re-register as a NEW node."
    if ($DryRun) {
      Write-Host "+ (would ask for confirmation, then) docker volume rm $Volume"
    } else {
      $answer = Read-Host "Type '$Volume' to delete the volume"
      if ($answer -ne $Volume) { throw 'Confirmation mismatch; volume kept.' }
      & docker volume rm $Volume
      Write-Host 'Volume removed.'
    }
  } else {
    Write-Host "Data volume '$Volume' kept (node key preserved). Re-run the installer to bring the node back."
  }
  return
}

if (-not $ApiHttp) { throw 'Unknown API URL: fetch this script from your Spindle API (.../v1/node/install.ps1) or pass -Api <url>.' }
$ApiHttp = ($ApiHttp -replace '^wss://', 'https://' -replace '^ws://', 'http://').TrimEnd('/')
$ApiWs = $ApiHttp -replace '^https://', 'wss://' -replace '^http://', 'ws://'
$apiHost = ([uri]$ApiHttp).Host
$localApi = @('localhost', '127.0.0.1', '0.0.0.0') -contains $apiHost
if ($localApi) { $ApiWs = $ApiWs -replace "//$([regex]::Escape($apiHost))", '//host.docker.internal' }

if ($Engine -eq 'vllm' -and -not $Model) { throw '-Model is required with -Engine vllm' }
if ($Update) {
  $Token = ''
  if (-not $DryRun) {
    & docker volume inspect $Volume *> $null
    if ($LASTEXITCODE -ne 0) { throw "No node data volume '$Volume' here: nothing to update. Use an install command from the dashboard." }
  }
}
$dlToken = if ($UpdateToken) { $UpdateToken } else { $Token }

# ---- the node image: download our agent, verify, build locally ----
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
if ($Engine -eq 'vllm' -and $arch -ne 'amd64') { throw 'The vllm engine is amd64 only.' }
if ($DryRun) {
  Write-Host "+ download $ApiHttp/v1/node/dist/$Engine/$arch/context.tar.gz (Authorization: Bearer ***), verify its sha256 against the manifest"
  Write-Host "+ docker build -t $Image --label spindle.context-sha256=<sha256> - < context.tar.gz"
} else {
  $manifest = Invoke-RestMethod -Uri "$ApiHttp/v1/node/dist/manifest.json"
  $entry = $manifest.contexts."$Engine/$arch"
  if (-not $entry) { throw "No $Engine build for $arch on this server." }
  $haveSha = (& docker image inspect -f '{{ index .Config.Labels "spindle.context-sha256" }}' $Image 2>$null)
  if ($haveSha -eq $entry.sha256) {
    Write-Host "Image $Image is already up to date (agent $($manifest.agentVersion)); skipping the download."
  } else {
    if (-not $dlToken) { throw 'A token is needed to download the agent. Generate a command in the dashboard (Compute tab).' }
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("spindle-node-" + [guid]::NewGuid().ToString('N') + '.tar.gz')
    try {
      Write-Host "Downloading the Spindle node agent $($manifest.agentVersion) ($Engine, $arch)..."
      $ProgressPreference = 'SilentlyContinue'
      try {
        Invoke-WebRequest -Uri "$ApiHttp/v1/node/dist/$Engine/$arch/context.tar.gz" -Headers @{ Authorization = "Bearer $dlToken" } -OutFile $tmp
      } catch {
        throw 'Download failed. The command may have expired (they last 15 minutes): generate a new one in the dashboard.'
      }
      $got = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
      if ($got -ne $entry.sha256) { throw "sha256 mismatch (got $got, expected $($entry.sha256)): refusing to build." }
      Write-Host "sha256 verified. Building $Image locally on the official base image (the first build downloads about 2 GB from Docker Hub)..."
      # `docker build -` reads the tarball from stdin; cmd.exe redirection avoids PowerShell's text pipeline.
      & cmd.exe /c "docker build -t $Image --label spindle.context-sha256=$got --label spindle.agent-version=$($manifest.agentVersion) - < `"$tmp`""
      if ($LASTEXITCODE -ne 0) { throw 'docker build failed.' }
    } finally {
      Remove-Item -Force -ErrorAction SilentlyContinue $tmp
    }
  }
}

# ---- GPU detection (NVIDIA through WSL2), using the freshly built image: no extra pulls ----
$gpuArgs = @()
$haveGpu = $false
if (-not $DryRun) {
  & docker run --rm --gpus all --entrypoint nvidia-smi $Image -L *> $null
  $haveGpu = ($LASTEXITCODE -eq 0)
}
if ($haveGpu) {
  $gpuArgs = @('--gpus', 'all')
  Write-Host 'NVIDIA GPU detected: enabling --gpus all.'
} elseif ($Engine -eq 'vllm' -and -not $DryRun) {
  throw 'The vllm engine needs a working NVIDIA GPU in Docker (install the latest NVIDIA Windows driver; WSL2 GPU support is built in).'
} else {
  Write-Warning 'No GPU available to containers: running the node in CPU mode (only small models are offered). (NVIDIA: update the Windows driver; AMD/Intel GPUs are not supported in containers.)'
}

# ---- (re)create the container; the volume is never touched ----
Invoke-Docker -DockerArgs @('rm', '-f', $Container) -Quiet

$runArgs = @('run', '-d', '--name', $Container, '--restart', 'unless-stopped', '-v', "${Volume}:/data") + $gpuArgs + @(
  '-e', "SPINDLE_API_URL=$ApiWs", '-e', "SPINDLE_ENGINE=$Engine")
if ($localApi) { $runArgs += @('--add-host', 'host.docker.internal:host-gateway') }
if ($Token) { $runArgs += @('-e', "SPINDLE_TOKEN=$Token") }
if ($Name) { $runArgs += @('-e', "SPINDLE_NAME=$Name") }
if ($Model) { $runArgs += @('-e', "SPINDLE_VLLM_MODEL=$Model") }
if ($Models) { $runArgs += @('-e', "SPINDLE_MODELS=$Models") }
$runArgs += $Image
Invoke-Docker -DockerArgs $runArgs -Quiet:(-not $DryRun)

if (-not $DryRun) {
  Write-Host "Spindle node started. Follow the log with:  docker logs -f $Container"
  if ($Update) {
    Write-Host 'Updated; the node keeps its identity.'
  } else {
    if (-not $Token) { Write-Host 'No token given: the log will show a pairing code and URL; open it and approve the node.' }
    Write-Host 'Then register the node in the dashboard (Compute tab); it receives jobs only once registered on-chain.'
  }
}
