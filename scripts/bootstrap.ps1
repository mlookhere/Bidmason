param([switch]$CI)
$ErrorActionPreference = "Stop"
if (-not $CI) { throw "Usage: ./scripts/bootstrap.ps1 -CI" }
Push-Location (Join-Path $PSScriptRoot "..")
try {
    & python --version
    if ($LASTEXITCODE -ne 0) { throw "Python bootstrap failed" }
}
finally { Pop-Location }
