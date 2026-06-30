[CmdletBinding()]
param(
    [switch]$MlopsOnly,
    [switch]$StopOnly,
    [int]$BackendPort = 5000,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"

function Stop-DevProcess {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId,
        [Parameter(Mandatory = $true)]
        [string]$Reason
    )

    if ($ProcessId -eq $PID) {
        return
    }

    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction Stop
        Write-Host "Stopping PID $ProcessId ($($proc.ProcessName)): $Reason" -ForegroundColor Yellow
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    } catch {
        Write-Host "PID $ProcessId already stopped or could not be stopped: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

function Stop-DevPortOwners {
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$Ports
    )

    foreach ($port in ($Ports | Sort-Object -Unique)) {
        try {
            $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($owner in $owners) {
                if ($owner -and $owner -ne 0) {
                    Stop-DevProcess -ProcessId ([int]$owner) -Reason "listening on dev port $port"
                }
            }
        } catch {
            Write-Host "Could not inspect port ${port}: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
    }
}

function Stop-ProjectDevProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [Parameter(Mandatory = $true)]
        [string]$BackendDir,
        [Parameter(Mandatory = $true)]
        [string]$FrontendDir,
        [Parameter(Mandatory = $true)]
        [int]$BackendPort,
        [Parameter(Mandatory = $true)]
        [int]$FrontendPort
    )

    $repoPattern = [regex]::Escape($RepoRoot)
    $backendPattern = [regex]::Escape($BackendDir)
    $frontendPattern = [regex]::Escape($FrontendDir)
    $matched = @{}

    $processes = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine }
    foreach ($proc in $processes) {
        $cmd = [string]$proc.CommandLine
        $pidValue = [int]$proc.ProcessId
        if ($pidValue -eq $PID) {
            continue
        }

        $isProjectBackend = (
            $cmd -match "app\.py" -and
            (
                $cmd -match $repoPattern -or
                $cmd -match $backendPattern -or
                ($cmd -match "python" -and $cmd -match "(^|[\\/\s`"'])app\.py([`"'\s]|$)")
            )
        )
        $isProjectFrontend = (
            $cmd -match "vite" -and
            (
                $cmd -match $repoPattern -or
                $cmd -match $frontendPattern -or
                $cmd -match "frontend"
            )
        )

        if ($isProjectBackend -or $isProjectFrontend) {
            $matched[$pidValue] = if ($isProjectBackend) { "project backend app.py process" } else { "project Vite frontend process" }
        }
    }

    foreach ($entry in $matched.GetEnumerator()) {
        Stop-DevProcess -ProcessId ([int]$entry.Key) -Reason ([string]$entry.Value)
    }

    Stop-DevPortOwners -Ports @($BackendPort, 5000, 5001, $FrontendPort)
}

function Convert-ToSingleQuotedLiteral {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    return $PathValue -replace "'", "''"
}

function New-PythonLaunchSpec {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [string[]]$Arguments = @()
    )

    return [pscustomobject]@{
        Executable = $Executable
        Arguments  = @($Arguments)
    }
}

function Test-PythonModule {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory = $true)]
        [string]$ModuleName
    )

    try {
        & $Executable @Arguments -c "import $ModuleName" *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Resolve-AnyPythonExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [Parameter(Mandatory = $true)]
        [string]$BackendDir
    )

    $candidatePaths = @()

    if ($env:VIRTUAL_ENV) {
        $candidatePaths += Join-Path $env:VIRTUAL_ENV "Scripts\python.exe"
    }

    $candidatePaths += @(
        (Join-Path $BackendDir ".venv\Scripts\python.exe"),
        (Join-Path $BackendDir ".venv312\Scripts\python.exe"),
        (Join-Path $BackendDir ".venv311\Scripts\python.exe"),
        (Join-Path $BackendDir ".venv310\Scripts\python.exe"),
        (Join-Path $RepoRoot ".venv\Scripts\python.exe")
    )

    foreach ($candidate in ($candidatePaths | Select-Object -Unique)) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return New-PythonLaunchSpec -Executable $candidate
        }
    }

    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCmd) {
        foreach ($version in @("-3.12", "-3.11", "-3.10", "-3")) {
            try {
                & $pyCmd.Source $version -c "import sys; print(sys.executable)" *> $null
                if ($LASTEXITCODE -eq 0) {
                    return New-PythonLaunchSpec -Executable $pyCmd.Source -Arguments @($version)
                }
            } catch {
            }
        }
    }

    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        return New-PythonLaunchSpec -Executable $pythonCmd.Source
    }

    throw "No usable Python launcher found. Install Python 3.10+ and ensure 'python' or 'py' works on PATH."
}

function Ensure-BackendPython {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [Parameter(Mandatory = $true)]
        [string]$BackendDir
    )

    $backendVenv = Join-Path $BackendDir ".venv"
    $backendVenvPy = Join-Path $backendVenv "Scripts\python.exe"
    $requirementsFile = Join-Path $BackendDir "requirements.txt"

    if (Test-Path -LiteralPath $backendVenvPy) {
        Write-Host "Using existing backend virtual environment: $backendVenvPy" -ForegroundColor Green
        if (-not (Test-PythonModule -Executable $backendVenvPy -ModuleName "flask")) {
            Write-Host "Existing backend venv is missing Flask or backend packages. Installing requirements..." -ForegroundColor Yellow
            & $backendVenvPy -m pip install --upgrade pip
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to upgrade pip in existing backend\.venv"
            }
            & $backendVenvPy -m pip install -r $requirementsFile
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to install backend requirements into existing backend\.venv"
            }
        }
        return New-PythonLaunchSpec -Executable $backendVenvPy
    }

    Write-Host "No backend virtual environment found. Bootstrapping backend\.venv..." -ForegroundColor Yellow
    $bootstrapSpec = Resolve-AnyPythonExecutable -RepoRoot $RepoRoot -BackendDir $BackendDir
    $bootstrapExe = $bootstrapSpec.Executable
    $bootstrapArgs = @($bootstrapSpec.Arguments)

    if (-not (Test-Path -LiteralPath $backendVenvPy)) {
        & $bootstrapExe @bootstrapArgs -m venv $backendVenv
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create backend virtual environment at $backendVenv"
        }
    }

    & $backendVenvPy -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upgrade pip in backend\.venv"
    }

    & $backendVenvPy -m pip install -r $requirementsFile
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install backend requirements into backend\.venv"
    }

    if (-not (Test-PythonModule -Executable $backendVenvPy -ModuleName "flask")) {
        throw "backend\.venv was created, but Flask still cannot be imported. Check requirements.txt and pip output."
    }

    return New-PythonLaunchSpec -Executable $backendVenvPy
}

function Resolve-PythonLaunchSpec {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [Parameter(Mandatory = $true)]
        [string]$BackendDir
    )

    $candidatePaths = @()

    if ($env:VIRTUAL_ENV) {
        $candidatePaths += Join-Path $env:VIRTUAL_ENV "Scripts\python.exe"
    }

    $candidatePaths += @(
        (Join-Path $BackendDir ".venv\Scripts\python.exe"),
        (Join-Path $BackendDir ".venv312\Scripts\python.exe"),
        (Join-Path $BackendDir ".venv311\Scripts\python.exe"),
        (Join-Path $BackendDir ".venv310\Scripts\python.exe"),
        (Join-Path $RepoRoot ".venv\Scripts\python.exe")
    )

    foreach ($candidate in ($candidatePaths | Select-Object -Unique)) {
        if (-not $candidate) { continue }
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        try {
            & $candidate -c "import flask" *> $null
            if ($LASTEXITCODE -eq 0) {
                return New-PythonLaunchSpec -Executable $candidate
            }
        } catch {
        }
    }

    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCmd) {
        foreach ($version in @("-3.12", "-3.11", "-3.10")) {
            try {
                & $pyCmd.Source $version -c "import flask" *> $null
                if ($LASTEXITCODE -eq 0) {
                    return New-PythonLaunchSpec -Executable $pyCmd.Source -Arguments @($version)
                }
            } catch {
            }
        }
    }

    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        try {
            & $pythonCmd.Source -c "import flask" *> $null
            if ($LASTEXITCODE -eq 0) {
                return New-PythonLaunchSpec -Executable $pythonCmd.Source
            }
        } catch {
        }
    }

    throw "No usable Python with Flask found."
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$backendEnvFile = Join-Path $backendDir ".env"
$backendEnvExample = Join-Path $backendDir ".env.example"
$frontendEnvFile = Join-Path $frontendDir ".env"
$frontendEnvExample = Join-Path $frontendDir ".env.example"
$frontendNodeModules = Join-Path $frontendDir "node_modules"

if (-not (Test-Path -LiteralPath $backendDir)) {
    throw "Backend directory not found: $backendDir"
}

if (-not (Test-Path -LiteralPath $frontendDir)) {
    throw "Frontend directory not found: $frontendDir"
}

Stop-ProjectDevProcesses -RepoRoot $repoRoot -BackendDir $backendDir -FrontendDir $frontendDir -BackendPort $BackendPort -FrontendPort $FrontendPort

if ($StopOnly) {
    Write-Host "Stopped stale backend/frontend dev processes. StopOnly was set, so nothing was started." -ForegroundColor Green
    return
}

if (-not (Test-Path -LiteralPath $backendEnvFile) -and (Test-Path -LiteralPath $backendEnvExample)) {
    Copy-Item -LiteralPath $backendEnvExample -Destination $backendEnvFile
}

if (-not (Test-Path -LiteralPath $frontendEnvFile) -and (Test-Path -LiteralPath $frontendEnvExample)) {
    Copy-Item -LiteralPath $frontendEnvExample -Destination $frontendEnvFile
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found on PATH. Install Node.js 22.x and retry."
}

if (-not (Test-Path -LiteralPath $frontendNodeModules)) {
    Push-Location $frontendDir
    try {
        if (Test-Path -LiteralPath (Join-Path $frontendDir "package-lock.json")) {
            npm ci
        } else {
            npm install
        }
    } finally {
        Pop-Location
    }
}

$backendDirLiteral = Convert-ToSingleQuotedLiteral -PathValue $backendDir
$frontendDirLiteral = Convert-ToSingleQuotedLiteral -PathValue $frontendDir
$pythonLaunchSpec = Ensure-BackendPython -RepoRoot $repoRoot -BackendDir $backendDir
$pythonExecutable = $pythonLaunchSpec.Executable
$pythonExecutableLiteral = Convert-ToSingleQuotedLiteral -PathValue $pythonExecutable
$pythonArgLiteral = @($pythonLaunchSpec.Arguments | ForEach-Object {
    "'$(Convert-ToSingleQuotedLiteral -PathValue $_)'"
}) -join " "
$backendAppPath = Join-Path $backendDir "app.py"
$backendAppPathLiteral = Convert-ToSingleQuotedLiteral -PathValue $backendAppPath
$backendProfileValue = if ($MlopsOnly) { "mlops" } else { "full" }

$backendCommand = "Set-Location -LiteralPath '$backendDirLiteral'; `$env:APP_PORT='$BackendPort'; `$env:PORT='$BackendPort'; `$env:AML_BACKEND_PROFILE='$backendProfileValue'; & '$pythonExecutableLiteral' $pythonArgLiteral '$backendAppPathLiteral'"
$frontendCommand = "Set-Location -LiteralPath '$frontendDirLiteral'; npm run dev -- --host 0.0.0.0 --port $FrontendPort"

Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", $backendCommand
) | Out-Null

Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", $frontendCommand
) | Out-Null

$pythonLaunchSummaryParts = @($pythonExecutable)
if ($pythonLaunchSpec.Arguments) {
    $pythonLaunchSummaryParts += $pythonLaunchSpec.Arguments
}
$pythonLaunchSummary = $pythonLaunchSummaryParts -join " "
Write-Host "Started backend using $pythonLaunchSummary and frontend (npm run dev) in separate PowerShell windows."
Write-Host "Backend:  http://127.0.0.1:${BackendPort}" -ForegroundColor Green
Write-Host "Frontend: http://127.0.0.1:${FrontendPort}" -ForegroundColor Green
