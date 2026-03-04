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

function Resolve-PythonLaunchCommand {
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
                $pythonSource = Convert-ToSingleQuotedLiteral -PathValue $candidate
                return "& '$pythonSource'"
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
                    return "& py $version"
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
                $pythonSource = Convert-ToSingleQuotedLiteral -PathValue $pythonCmd.Source
                return "& '$pythonSource'"
            }
        } catch {
        }
    }

    throw "No usable Python with Flask found. Activate the correct venv or install backend dependencies into backend\\.venv."
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
$pythonLaunchCommand = Resolve-PythonLaunchCommand -RepoRoot $repoRoot -BackendDir $backendDir
$backendProfileCommand = if ($MlopsOnly) { "$env:AML_BACKEND_PROFILE='mlops'; " } else { "" }

$backendCommand = "Set-Location -LiteralPath '$backendDirLiteral'; $backendProfileCommand $pythonLaunchCommand app.py"
$frontendCommand = "Set-Location -LiteralPath '$frontendDirLiteral'; npm run dev"

Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $backendCommand
) | Out-Null

Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $frontendCommand
) | Out-Null

Write-Host "Started backend using $pythonLaunchCommand and frontend (npm run dev) in separate PowerShell windows."
