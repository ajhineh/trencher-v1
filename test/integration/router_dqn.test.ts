
import { Connection, PublicKey } from '@solana/web3.js';
import { ConfidenceRouter, TokenContext } from '../../src/decision/confidenceRouter';
import { ConditionalDQNAgent } from '../../src/rl/conditionalDQN';
import * as conditionalDQNModule from '../../src/rl/conditionalDQN';
import * as securityModule from '../../src/analysis/enhancedSecurityIntegration';
import * as riskModule from '../../src/risk/riskScoringSystem';

// Mocks
jest.mock('../../src/analysis/enhancedSecurityIntegration');
jest.mock('../../src/risk/riskScoringSystem');
jest.mock('../../src/agents/async/asyncReviewManager', () => ({
    AsyncReviewManager: {
        getInstance: () => ({
            submitForReview: jest.fn().mockReturnValue({ shouldBuy: false, jobId: 'mock-job', message: 'mock' })
        })
    }
}));

// Mock the factory to return our spy agent
const mockSelectAction = jest.fn();
jest.spyOn(conditionalDQNModule, 'createConditionalDQN').mockImplementation(() => {
    return {
        selectActionConditional: mockSelectAction
    } as unknown as ConditionalDQNAgent;
});

describe('Router <-> DQN Integration', () => {
    let connection: Connection;
    let router: ConfidenceRouter;

    beforeEach(() => {
        connection = new Connection('https://api.mainnet-beta.solana.com');
        router = new ConfidenceRouter(connection);
        jest.clearAllMocks();
    });

    it('should route Medium Confidence tokens to DQN', async () => {
        // Setup: Mock Quick Rules to PASS (proceed=true)
        (securityModule.quickSecurityCheckV2 as jest.Mock).mockResolvedValue({
            isApproved: true,
            riskScore: 50,
            reason: 'pass'
        });

        // Setup: Mock Fast Classifier to return MEDIUM confidence
        // enhancedSecurity -> approved
        (securityModule.runEnhancedSecurityChecksV2 as jest.Mock).mockResolvedValue({
            isApproved: true,
            recommendations: 'ok'
        });
        // Risk -> 60 (Medium Risk)
        const mockRiskSystem = {
            calculateRisk: jest.fn().mockResolvedValue({ overall: 60, components: {} })
        };
        (riskModule.getRiskScoringSystem as jest.Mock).mockReturnValue(mockRiskSystem);

        // NOTE: we need calculateConfidence to return ~0.6 (Medium)
        // Since we import calculateConfidence in Router, and it's a direct import, mocking might be hard unless we mock the module.
        // But Router logic: 
        // if (!security.isApproved || risk >= 75) => BLOCK
        // else if (risk >= 50) => PROBE (and likely Medium Confidence)
        // We need to ensure isMediumConfidence() returns true inside Router.
        // `calculateConfidence` depends on risk/security agreement. low agreement / medium risk => medium confidence.

        // Actually, we can just spy on the methods and ensure the flow hits DQN.
        // In Router code: 
        // if (isMediumConfidence(classifierResult.confidence)) -> calls DQN.

        // Let's assume our mocks produce Medium Confidence.
        // If Risk is 60 and Security is Approved, calculateConfidence usually returns ~0.5-0.7.

        // Mock DQN to return "ALLOW" (Action 1)
        mockSelectAction.mockResolvedValue({
            action: 1, // ALLOW
            usedDQN: true,
            latency: 10,
            method: 'DQN'
        });

        const context: TokenContext = {
            mintAddress: 'mint123',
            creatorAddress: 'creator123',
            createdAtMs: Date.now()
        };

        const decision = await router.route('mint123', context);

        // Verify DQN was called
        expect(mockSelectAction).toHaveBeenCalled();
        expect(decision.method).toBe('DQN');
        expect(decision.action).toBe('ALLOW');
    });
});
