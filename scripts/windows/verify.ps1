Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Run-Native([string]$Command, [string[]]$Arguments = @()) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed (exit code $LASTEXITCODE): $Command $($Arguments -join ' ')"
  }
}

function Ensure-ProppingDatabase {
  $exists = & docker compose exec -T postgres psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='propping';"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to check PostgreSQL database existence for 'propping'."
  }

  if ($exists.Trim() -eq "1") {
    Write-Host "Database 'propping' already exists"
    return
  }

  Run-Native "docker" @("compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "postgres", "-c", "CREATE DATABASE propping;")
  Write-Host "Created database 'propping'"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
Set-Location $repoRoot

Step "Checking prerequisites"
Ensure-Command "node"
Ensure-Command "npm"
Ensure-Command "docker"

Step "Checking Docker Compose services"
Run-Native "docker" @("compose", "ps")
Ensure-ProppingDatabase

Step "Applying Prisma migrations"
Run-Native "npm" @("run", "prisma", "--", "migrate", "deploy")

Step "Generating Prisma client"
Run-Native "npm" @("run", "db:generate")

Step "Running tests"
Run-Native "npm" @("test")

Step "Running Stage 2 smoke check"
Run-Native "npm" @("run", "smoke:stage2")

Step "Running Stage 3 smoke check"
Run-Native "npm" @("run", "smoke:stage3")

Step "Running Stage 4 smoke check"
Run-Native "npm" @("run", "smoke:stage4")

Step "Running Stage 5 smoke check"
Run-Native "npm" @("run", "smoke:stage5")

Step "Resetting Next.js build cache"
if (Test-Path ".next") {
  Remove-Item ".next" -Recurse -Force -ErrorAction SilentlyContinue
}

Step "Building app"
Run-Native "npm" @("run", "build")

Step "Worker smoke test (single cycle)"
$env:WORKER_ONCE = "1"
try {
  Run-Native "npm" @("run", "worker")
}
finally {
  Remove-Item Env:WORKER_ONCE -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Verification complete." -ForegroundColor Green
