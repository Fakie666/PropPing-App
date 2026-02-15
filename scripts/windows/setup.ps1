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

function Get-NodeMajorVersion {
  $raw = (node -v).Trim()
  if ($raw -match "^v(\d+)") {
    return [int]$Matches[1]
  }
  throw "Unable to parse Node.js version: $raw"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
Set-Location $repoRoot

Step "Checking prerequisites"
Ensure-Command "node"
Ensure-Command "npm"
Ensure-Command "docker"

$nodeVersion = (& node -v).Trim()
$npmVersion = (& npm -v).Trim()
$dockerVersion = (& docker --version).Trim()
Write-Host "Node:   $nodeVersion"
Write-Host "npm:    $npmVersion"
Write-Host "Docker: $dockerVersion"

$nodeMajor = Get-NodeMajorVersion
if ($nodeMajor -ne 20) {
  Write-Warning "Recommended Node.js major version is 20 (current: $nodeMajor). The app may still run."
}

Step "Ensuring .env exists"
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
} else {
  Write-Host ".env already exists (kept as-is)"
}

Step "Installing npm dependencies"
Run-Native "npm" @("install")

Step "Starting PostgreSQL via Docker Compose"
Run-Native "docker" @("compose", "up", "-d")
Run-Native "docker" @("compose", "ps")
Ensure-ProppingDatabase

Step "Generating Prisma client"
Run-Native "npm" @("run", "db:generate")

Step "Applying Prisma migrations"
Run-Native "npm" @("run", "prisma", "--", "migrate", "deploy")

Step "Seeding demo data"
Run-Native "npm" @("run", "db:seed")

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

Step "Building Next.js app"
Run-Native "npm" @("run", "build")

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Start the app with: npm run dev"
