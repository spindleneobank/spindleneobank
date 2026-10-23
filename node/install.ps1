<#
.SYNOPSIS
  Spindle node installer for Windows (Docker Desktop + WSL2).
.EXAMPLE
  .\install.ps1 -Token <TOKEN>
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute("PSAvoidUsingWriteHost", "", Justification = "interactive installer")]
[CmdletBinding()]
param(
  [string]$Token = $env:SPINDLE_TOKEN,
  [ValidateSet('ollama', 'vllm')][string]$Engine = 'ollama',
  [string]$Model = '',
  [string]$Name = '',
  # TODO(owner): set the production API URL and the Docker Hub namespace before publishing.
  [string]$Api = $(if ($env:SPINDLE_API_URL) { $env:SPINDLE_API_URL } else { 'wss://api.spindle.example' }),
  [string]$Image = $(if ($env:SPINDLE_IMAGE) { $env:SPINDLE_IMAGE } else { 'spindle/spindle-node' }),
  [string]$Tag = '',
  [switch]$NoPull,
  [switch]$DryRun,
  [switch]$Uninstall,
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'
$Container = 'spindle-node'
$Volume = 'spindle-node'
if (-not $Tag) { $Tag = $Engine }

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

if ($Engine -eq 'vllm' -and -not $Model) { throw '-Model is required with -Engine vllm' }

# ---- GPU detection (NVIDIA through WSL2) ----
$gpuArgs = @()
$haveGpu = $false
if ($DryRun) {
  $haveGpu = $false
} else {
  & docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi -L *> $null
  $haveGpu = ($LASTEXITCODE -eq 0)
}
if ($haveGpu) {
  $gpuArgs = @('--gpus', 'all')
  Write-Host 'NVIDIA GPU detected: enabling --gpus all.'
} elseif ($Engine -eq 'vllm') {
  throw 'The vllm engine needs a working NVIDIA GPU in Docker (install the latest NVIDIA Windows driver; WSL2 GPU support is built in).'
} else {
  Write-Warning 'No GPU available to containers: running in CPU mode. Only small models will be offered. (NVIDIA: update the Windows driver; AMD/Intel GPUs are not supported in containers.)'
}

# ---- (re)create the container; the volume is never touched ----
if (-not $NoPull) { Invoke-Docker -DockerArgs @('pull', "${Image}:${Tag}") }
Invoke-Docker -DockerArgs @('rm', '-f', $Container) -Quiet

$runArgs = @('run', '-d', '--name', $Container, '--restart', 'unless-stopped', '-v', "${Volume}:/data") + $gpuArgs + @(
  '-e', "SPINDLE_API_URL=$Api", '-e', "SPINDLE_ENGINE=$Engine")
if ($Token) { $runArgs += @('-e', "SPINDLE_TOKEN=$Token") }
if ($Name) { $runArgs += @('-e', "SPINDLE_NAME=$Name") }
if ($Model) { $runArgs += @('-e', "SPINDLE_VLLM_MODEL=$Model") }
$runArgs += "${Image}:${Tag}"
Invoke-Docker -DockerArgs $runArgs -Quiet:(-not $DryRun)

if (-not $DryRun) {
  Write-Host "Spindle node started. Follow the log with:  docker logs -f $Container"
  if (-not $Token) { Write-Host 'No token given: the log will show a pairing code and URL; open it and approve the node.' }
  Write-Host 'Then register the node in the dashboard (Compute tab); it receives jobs only once registered on-chain.'
}
