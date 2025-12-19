
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { UltimateSniperSystem } from '../../src/sniper/ultimateSniperSystem';
import { SniperConfig, TokenOpportunity } from '../../src/sniper/types';
import * as executeBuyModule from '../../src/pumpswap/execute-buy-direct';
import * as bundleSystemModule from '../../src/sniper/preBuildBundleSystem';

// Mock dependencies
jest.mock('../../src/pumpswap/execute-buy-direct');
jest.mock('../../src/sniper/preBuildBundleSystem');
jest.mock('../../src/sniper/ultraFastRugDetector');
jest.mock('../../src/sniper/intelligentSeller');
jest.mock('../../src/sniper/aiSniperBot');
jest.mock('../../src/sniper/multiWalletManager');

describe('UltimateSniperSystem E2E Flow', () => {
    let connection: Connection;
    let system: UltimateSniperSystem;
    let mockExecuteDirectBuy: jest.SpyInstance;

    const mockConfig: SniperConfig = {
        maxBuyAmount: 0.1,
        minLiquidity: 10,
        maxSlippage: 100,
        aiConfidenceThreshold: 80,
        enableRugPullProtection: true,
        jitoTipAmount: 0.001
    };

    const mockWalletConfig = [{
        privateKey: JSON.stringify(Array.from(Keypair.generate().secretKey)),
        name: "Test Wallet",
        maxBuyAmount: 0.1
    }];

    beforeEach(() => {
        // Mock Connection
        connection = {
            getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: 'mock', lastValidBlockHeight: 100 }),
            sendRawTransaction: jest.fn().mockResolvedValue('mock_tx'),
            confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
            onLogs: jest.fn(),
            removeOnLogsListener: jest.fn()
        } as unknown as Connection;

        // Setup spies/mocks
        mockExecuteDirectBuy = jest.spyOn(executeBuyModule, 'executeDirectBuy');
        (executeBuyModule.executeDirectBuy as jest.Mock).mockResolvedValue('mock_tx_signature');

        // Mock MultiWalletManager behavior specifically if needed
        // Since we mocked the class, new MultiWalletManager() returns a basic mock.
        // But UltimateSniperSystem calls methods on it. 
        // We might need to ensure addWallets and getAllWallets work or are mocked.
        const { MultiWalletManager } = require('../../src/sniper/multiWalletManager');
        MultiWalletManager.mockImplementation(() => {
            return {
                addWallets: jest.fn(),
                getAllWallets: jest.fn().mockReturnValue([Keypair.generate()]), // Return at least one wallet
                getWalletCount: jest.fn().mockReturnValue(1)
            };
        });

        // Initialize system
        system = new UltimateSniperSystem(connection, mockWalletConfig, mockConfig);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should execute a complete cycle successfully', async () => {
        const opportunity: TokenOpportunity = {
            mint: new PublicKey('So11111111111111111111111111111111111111112'), // Wrapped SOL as placeholder
            poolKey: new PublicKey('So11111111111111111111111111111111111111112'),
            liquidity: 100,
            creatorAddress: new PublicKey('So11111111111111111111111111111111111111112'),
            timestamp: Date.now()
        };

        await system.executeCompleteCycle(opportunity);

        // Verify Buy Logic was triggered
        // Note: UltimateSniperSystem calls this.multiBuy -> executeDirectBuy via MultiWalletManager? 
        // Wait, UltimateSniperSystem.multiBuy helper iterates wallets and calls executeDirectBuy?
        // Let's verify internal logic by checking manual triggers or logs if possible.
        // Or better, check if the spy was called.

        // Since executeDirectBuy is imported in ultimateSniperSystem.ts (or multiWalletManager depending on refactor),
        // we need to be sure we mocked the right module usage.
        // Based on previous code view, UltimateSniperSystem imports `executeDirectBuy`.

        expect(mockExecuteDirectBuy).toHaveBeenCalled();
    });
});
