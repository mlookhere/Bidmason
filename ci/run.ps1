param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("fast", "pr", "security", "web")]
    [string]$Stage
)
$ErrorActionPreference = "Stop"
Push-Location (Join-Path $PSScriptRoot "..")
try {
    & python (Join-Path $PSScriptRoot "run.py") $Stage
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally { Pop-Location }
