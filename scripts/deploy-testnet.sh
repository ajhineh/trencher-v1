#!/bin/bash

# YouLi-AI-600 Testnet Deployment Script
# This script deploys the trading bot to Solana testnet

set -e  # Exit on error

echo "🚀 Starting Testnet Deployment..."
echo "=================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 1. Check environment
echo -e "${GREEN}📋 Step 1: Checking environment...${NC}"
if [ ! -f ".env.testnet" ]; then
    echo -e "${RED}❌ .env.testnet not found!${NC}"
    echo "Please create .env.testnet from .env.testnet.example"
    exit 1
fi
echo -e "${GREEN}✅ Environment file found${NC}"

# 2. Load environment
echo -e "${GREEN}📋 Step 2: Loading environment...${NC}"
export $(cat .env.testnet | grep -v '^#' | xargs)
echo -e "${GREEN}✅ Environment loaded${NC}"

# 3. Check Solana CLI
echo -e "${GREEN}📋 Step 3: Checking Solana CLI...${NC}"
if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Solana CLI not found!${NC}"
    echo "Please install Solana CLI first"
    exit 1
fi
echo -e "${GREEN}✅ Solana CLI installed${NC}"

# 4. Check Solana connection
echo -e "${GREEN}🔗 Step 4: Checking Solana connection...${NC}"
solana config set --url $SOLANA_RPC_URL
CLUSTER_VERSION=$(solana cluster-version 2>&1)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Connected to Solana testnet${NC}"
    echo "   Cluster version: $CLUSTER_VERSION"
else
    echo -e "${RED}❌ Failed to connect to Solana testnet${NC}"
    exit 1
fi

# 5. Check wallet
echo -e "${GREEN}💰 Step 5: Checking wallet...${NC}"
if [ ! -f "$SOLANA_WALLET_PATH" ]; then
    echo -e "${YELLOW}⚠️  Wallet not found. Creating new wallet...${NC}"
    solana-keygen new --outfile $SOLANA_WALLET_PATH --no-bip39-passphrase
fi

WALLET_ADDRESS=$(solana address)
echo -e "${GREEN}✅ Wallet address: $WALLET_ADDRESS${NC}"

# 6. Check balance
echo -e "${GREEN}💰 Step 6: Checking wallet balance...${NC}"
BALANCE=$(solana balance | awk '{print $1}')
echo "   Current balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 1" | bc -l) )); then
    echo -e "${YELLOW}⚠️  Low balance! Requesting airdrop...${NC}"
    solana airdrop 2
    sleep 5
    BALANCE=$(solana balance | awk '{print $1}')
    echo "   New balance: $BALANCE SOL"
fi
echo -e "${GREEN}✅ Sufficient balance${NC}"

# 7. Install dependencies
echo -e "${GREEN}📦 Step 7: Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✅ Dependencies installed${NC}"

# 8. Build project
echo -e "${GREEN}🔨 Step 8: Building project...${NC}"
npm run build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

# 9. Run tests (optional)
echo -e "${GREEN}🧪 Step 9: Running tests...${NC}"
read -p "Run tests before deployment? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm test
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ All tests passed${NC}"
    else
        echo -e "${RED}❌ Some tests failed${NC}"
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
fi

# 10. Create logs directory
echo -e "${GREEN}📁 Step 10: Creating logs directory...${NC}"
mkdir -p logs
echo -e "${GREEN}✅ Logs directory ready${NC}"

# 11. Start bot
echo -e "${GREEN}🤖 Step 11: Starting bot...${NC}"
echo "=================================="
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "To start the bot, run:"
echo "  npm run start:testnet"
echo ""
echo "To monitor the bot, run:"
echo "  npm run monitor"
echo ""
echo "To stop the bot, run:"
echo "  npm run stop"
echo ""
echo -e "${YELLOW}⚠️  Remember: This is testnet. Monitor carefully!${NC}"
