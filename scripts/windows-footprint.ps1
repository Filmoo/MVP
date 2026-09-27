# Launches the real desktop app on Windows and measures its footprint:
# private memory and idle CPU of Scout.exe plus every WebView2 child process.
# Fails when a budget is exceeded. Results: reports/footprint.json
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [int]$SettleSeconds = 10,
  [int]$SampleSeconds = 10,
  [double]$MaxPrivateMB = 300,
  [double]$MaxIdleCpuPercent = 2.0
)
$ErrorActionPreference = "Stop"

function Get-ProcessTree([int]$RootId) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
  $ids = [System.Collections.Generic.List[int]]::new()
  $ids.Add($RootId)
  for ($i = 0; $i -lt $ids.Count; $i++) {
    foreach ($p in $all | Where-Object { $_.ParentProcessId -eq $ids[$i] }) {
      if (-not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId) }
    }
  }
  return $ids
}

function Get-Snapshot([int[]]$Ids) {
  $rows = foreach ($id in $Ids) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p) {
      [pscustomobject]@{
        Id = $p.Id; Name = $p.ProcessName
        PrivateMB = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
        WorkingSetMB = [math]::Round($p.WorkingSet64 / 1MB, 1)
        CpuSeconds = $p.TotalProcessorTime.TotalSeconds
      }
    }
  }
  return @($rows)
}

$proc = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds $SettleSeconds
$ids = Get-ProcessTree $proc.Id
$before = Get-Snapshot $ids
Start-Sleep -Seconds $SampleSeconds
$after = Get-Snapshot $ids

$cores = [Environment]::ProcessorCount
$cpuDelta = ($after | Measure-Object CpuSeconds -Sum).Sum - ($before | Measure-Object CpuSeconds -Sum).Sum
$idleCpu = [math]::Round(100 * $cpuDelta / $SampleSeconds / $cores, 2)
$private = [math]::Round(($after | Measure-Object PrivateMB -Sum).Sum, 1)
$workingSet = [math]::Round(($after | Measure-Object WorkingSetMB -Sum).Sum, 1)

$result = [pscustomobject]@{
  processes = $after | Select-Object Name, PrivateMB, WorkingSetMB
  totalPrivateMB = $private
  totalWorkingSetMB = $workingSet
  idleCpuPercent = $idleCpu
  cores = $cores
}
New-Item -ItemType Directory -Force -Path reports | Out-Null
$result | ConvertTo-Json -Depth 4 | Set-Content reports/footprint.json
$after | Format-Table Name, Id, PrivateMB, WorkingSetMB -AutoSize | Out-String | Write-Host
Write-Host "Total private: $private MB · working set: $workingSet MB · idle CPU: $idleCpu % ($cores cores)"

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }

$failed = $false
if ($private -gt $MaxPrivateMB) { Write-Host "::error::Private memory $private MB exceeds $MaxPrivateMB MB"; $failed = $true }
if ($idleCpu -gt $MaxIdleCpuPercent) { Write-Host "::error::Idle CPU $idleCpu % exceeds $MaxIdleCpuPercent %"; $failed = $true }
if ($failed) { exit 1 }
