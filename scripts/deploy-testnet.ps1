# YouLi-AI-600 Testnet Deployment Script (PowerShell)
# This script deploys the trading bot to Solana testnet

$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting Testnet Deployment..." -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Green

# 1. Check environment
Write-Host "`n📋 Step 1: Checking environment..." -ForegroundColor Cyan
if (-not (Test-Path ".env.testnet")) {
    Write-Host "❌ .env.testnet not found!" -ForegroundColor Red
    Write-Host "Please create .env.testnet from .env.testnet.example" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Environment file found" -ForegroundColor Green

# 2. Load environment
Write-Host "`n📋 Step 2: Loading environment..." -ForegroundColor Cyan
Get-Content .env.testnet | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$' -and $_ -notmatch '^#') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}
Write-Host "✅ Environment loaded" -ForegroundColor Green

# 3. Check Solana CLI
Write-Host "`n📋 Step 3: Checking Solana CLI..." -ForegroundColor Cyan
try {
    $null = solana --version
    Write-Host "✅ Solana CLI installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Solana CLI not found!" -ForegroundColor Red
    Write-Host "Please install Solana CLI first" -ForegroundColor Yellow
    exit 1
}

# 4. Check Solana connection
Write-Host "`n🔗 Step 4: Checking Solana connection..." -ForegroundColor Cyan
solana config set --url $env:SOLANA_RPC_URL
try {
    $clusterVersion = solana cluster-version
    Write-Host "✅ Connected to Solana testnet" -ForegroundColor Green
    Write-Host "   Cluster version: $clusterVersion" -ForegroundColor Gray
} catch {
    Write-Host "❌ Failed to connect to Solana testnet" -ForegroundColor Red
    exit 1
}

# 5. Check wallet
Write-Host "`n💰 Step 5: Checking wallet..." -ForegroundColor Cyan
$walletPath = $env:SOLANA_WALLET_PATH -replace '~', $env:USERPROFILE
if (-not (Test-Path $walletPath)) {
    Write-Host "⚠️  Wallet not found. Creating new wallet..." -ForegroundColor Yellow
    $walletDir = Split-Path $walletPath
    if (-not (Test-Path $walletDir)) {
        New-Item -ItemType Directory -Path $walletDir -Force | Out-Null
    }
    solana-keygen new --outfile $walletPath --no-bip39-passphrase
}

$walletAddress = solana address
Write-Host "✅ Wallet address: $walletAddress" -ForegroundColor Green

# 6. Check balance
Write-Host "`n💰 Step 6: Checking wallet balance..." -ForegroundColor Cyan
$balanceOutput = solana balance
$balance = [double]($balanceOutput -replace '[^\d.]', '')
Write-Host "   Current balance: $balance SOL" -ForegroundColor Gray

if ($balance -lt 1) {
    Write-Host "⚠️  Low balance! Requesting airdrop..." -ForegroundColor Yellow
    solana airdrop 2
    Start-Sleep -Seconds 5
    $balanceOutput = solana balance
    $balance = [double]($balanceOutput -replace '[^\d.]', '')
    Write-Host "   New balance: $balance SOL" -ForegroundColor Gray
}
Write-Host "✅ Sufficient balance" -ForegroundColor Green

# 7. Install dependencies
Write-Host "`n📦 Step 7: Installing dependencies..." -ForegroundColor Cyan
npm install
Write-Host "✅ Dependencies installed" -ForegroundColor Green

# 8. Build project
Write-Host "`n🔨 Step 8: Building project..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Build successful" -ForegroundColor Green
} else {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}

# 9. Run tests (optional)
Write-Host "`n🧪 Step 9: Running tests..." -ForegroundColor Cyan
$runTests = Read-Host "Run tests before deployment? (y/n)"
if ($runTests -eq 'y' -or $runTests -eq 'Y') {
    npm test
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ All tests passed" -ForegroundColor Green
    } else {
        Write-Host "❌ Some tests failed" -ForegroundColor Red
        $continue = Read-Host "Continue anyway? (y/n)"
        if ($continue -ne 'y' -and $continue -ne 'Y') {
            exit 1
        }
    }
}

# 10. Create logs directory
Write-Host "`n📁 Step 10: Creating logs directory..." -ForegroundColor Cyan
if (-not (Test-Path "logs")) {
    New-Item -ItemType Directory -Path "logs" | Out-Null
}
Write-Host "✅ Logs directory ready" -ForegroundColor Green

# 11. Completion
Write-Host "`n🤖 Step 11: Deployment complete!" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Green
Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the bot, run:" -ForegroundColor Yellow
Write-Host "  npm run start:testnet" -ForegroundColor White
Write-Host ""
Write-Host "To monitor the bot, run:" -ForegroundColor Yellow
Write-Host "  npm run monitor" -ForegroundColor White
Write-Host ""
Write-Host "To stop the bot, run:" -ForegroundColor Yellow
Write-Host "  npm run stop" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  Remember: This is testnet. Monitor carefully!" -ForegroundColor Yellow
