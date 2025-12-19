
import { Connection } from "@solana/web3.js";
import { MultiWalletManager } from "../src/sniper/multiWalletManager";
import { PortfolioAnalyzer } from "../src/portfolio/portfolioAnalyzer";
import { logger } from "../src/logger";

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const walletManager = new MultiWalletManager(connection);

// Mock a wallet if none active or provide a stub
// In this environment we probably don't have private keys loaded, so we test unit logic structure
// or try to add a public wallet address if Manager allows pubkeys only (it requires Keypair from private key usually)

async function testPortfolio() {
    logger.info("Initializing Portfolio Analyzer Test...");
    const analyzer = new PortfolioAnalyzer(connection, walletManager);

    // Add a dummy wallet if manager empty? 
    // Manager expects private key JSON. 
    // We will skip adding and expect empty return, ensuring no crash.

    logger.info("Running analysis (Expect empty/zero results if no wallets loaded)...");
    const report = await analyzer.analyzePortfolio();

    console.log("Analysis Result:", JSON.stringify(report, null, 2));
}

testPortfolio().then(() => console.log("Done"));
