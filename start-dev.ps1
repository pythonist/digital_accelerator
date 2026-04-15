[CmdletBinding()]
param(
    [switch]$MlopsOnly
)

$ErrorActionPreference = "Stop"

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

    try {
        return Resolve-PythonLaunchSpec -RepoRoot $RepoRoot -BackendDir $BackendDir
    } catch {
        Write-Host "No Python with Flask found. Bootstrapping backend\.venv..." -ForegroundColor Yellow
    }

    $bootstrapSpec = Resolve-AnyPythonExecutable -RepoRoot $RepoRoot -BackendDir $BackendDir
    $bootstrapExe = $bootstrapSpec.Executable
    $bootstrapArgs = @($bootstrapSpec.Arguments)
    $backendVenv = Join-Path $BackendDir ".venv"
    $backendVenvPy = Join-Path $backendVenv "Scripts\python.exe"
    $requirementsFile = Join-Path $BackendDir "requirements.txt"

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

    return Resolve-PythonLaunchSpec -RepoRoot $RepoRoot -BackendDir $BackendDir
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
$backendProfileCommand = if ($MlopsOnly) { "$env:AML_BACKEND_PROFILE='mlops'; " } else { "" }

$backendCommand = "Set-Location -LiteralPath '$backendDirLiteral'; $backendProfileCommand & '$pythonExecutableLiteral' $pythonArgLiteral '$backendAppPathLiteral'"
$frontendCommand = "Set-Location -LiteralPath '$frontendDirLiteral'; npm run dev"

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
