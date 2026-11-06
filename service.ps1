param([ValidateSet('start','stop','restart','status')][string]$Action='status')
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$python=Join-Path $projectRoot '.venv\Scripts\python.exe'
$pidFile=Join-Path $projectRoot 'data\service.pid'
function Get-ServiceProcess {
    if (Test-Path -LiteralPath $pidFile) {
        $serviceId=[int](Get-Content -LiteralPath $pidFile)
        $process=Get-CimInstance Win32_Process -Filter "ProcessId=$serviceId"
        if ($process -and $process.ExecutablePath -eq $python -and $process.CommandLine -like '*uvicorn backend.main:app*--port 8768*') { return $process }
    }
}
function Stop-ServiceProcess {
    $process=Get-ServiceProcess
    if ($process) {
        Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.ProcessId)" | Where-Object { $_.CommandLine -like '*uvicorn backend.main:app*--port 8768*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
        Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile }
}
if ($Action -in 'stop','restart') { Stop-ServiceProcess }
if ($Action -in 'start','restart') {
    if (-not (Get-ServiceProcess)) {
        if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath (Join-Path $projectRoot 'app\dist\index.html'))) { throw 'Run setup.cmd first.' }
        if (Get-NetTCPConnection -LocalPort 8768 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8768 is already occupied. No process was stopped.' }
        New-Item -ItemType Directory -Path (Join-Path $projectRoot 'data') -Force | Out-Null
        $process=Start-Process -FilePath $python -ArgumentList '-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8768' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'data-server.log') -RedirectStandardError (Join-Path $projectRoot 'data-server-error.log') -PassThru
        Set-Content -LiteralPath $pidFile -Value $process.Id
        Start-Sleep -Seconds 2
    }
}
if ($Action -ne 'stop') {
    $process=Get-ServiceProcess
    if ($process) {
        $health=Invoke-RestMethod 'http://127.0.0.1:8768/api/health' -TimeoutSec 5
        Write-Output "RUNNING PID=$($process.ProcessId) health=$($health.status) http://127.0.0.1:8768"
    } else { Write-Output 'STOPPED' }
} else { Write-Output 'STOPPED' }
