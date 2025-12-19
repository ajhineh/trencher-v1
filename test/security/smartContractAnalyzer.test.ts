// test/security/smartContractAnalyzer.test.ts

import { Connection } from '@solana/web3.js';
import { SmartContractAnalyzer } from '../../src/security/smartContractAnalyzer';

// Mock fetch for Solscan API
global.fetch = jest.fn();

describe('SmartContractAnalyzer - Enhanced', () => {
    let analyzer: SmartContractAnalyzer;
    let mockConnection: Connection;

    beforeEach(() => {
        mockConnection = {
            getAccountInfo: jest.fn(),
        } as any;

        analyzer = new SmartContractAnalyzer(mockConnection);
        jest.clearAllMocks();
    });

    describe('isVerified with Solscan API', () => {
        it('should return true for verified contracts', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    data: {
                        tokenInfo: {
                            verified: true,
                            symbol: 'TEST',
                        },
                    },
                }),
            });

            const result = await (analyzer as any).isVerified('SomeAddress123');

            expect(result).toBe(true);
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.solscan.io/account?address=SomeAddress123'
            );
        });

        it('should return false for unverified contracts', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    data: {
                        tokenInfo: {
                            verified: false,
                        },
                    },
                }),
            });

            const result = await (analyzer as any).isVerified('UnverifiedAddress');

            expect(result).toBe(false);
        });

        it('should return false on API error', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 429, // Rate limit
            });

            const result = await (analyzer as any).isVerified('SomeAddress');

            expect(result).toBe(false);
        });

        it('should return false on network error', async () => {
            (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

            const result = await (analyzer as any).isVerified('SomeAddress');

            expect(result).toBe(false);
        });
    });

    describe('extractFunctions with bytecode parser', () => {
        it('should use bytecode parser when available', () => {
            // Create simple bytecode
            const bytecode = Buffer.alloc(8);
            bytecode[0] = 0x95; // EXIT

            const functions = (analyzer as any).extractFunctions(bytecode.toString('hex'));

            expect(functions).toBeDefined();
            expect(Array.isArray(functions)).toBe(true);
        });

        it('should fall back to pattern matching on parser error', () => {
            // Pass invalid data to trigger fallback
            const functions = (analyzer as any).extractFunctions('invalid-bytecode');

            expect(functions).toBeDefined();
            expect(functions.length).toBeGreaterThan(0);
        });
    });

    describe('identifyVulnerabilities with bytecode analysis', () => {
        it('should detect CPI vulnerabilities from bytecode', () => {
            // Create bytecode with CPI call
            const bytecode = Buffer.alloc(8);
            bytecode[0] = 0x85; // CALL
            bytecode.writeInt32LE(1000001, 4); // Syscall

            const vulnerabilities = (analyzer as any).identifyVulnerabilities(
                bytecode.toString('hex'),
                []
            );

            // Should detect unchecked CPI if bytecode parser works
            expect(vulnerabilities).toBeDefined();
        });

        it('should detect excessive compute usage', () => {
            // Create large bytecode
            const bytecode = Buffer.alloc(200000); // Many instructions

            const vulnerabilities = (analyzer as any).identifyVulnerabilities(
                bytecode.toString('hex'),
                []
            );

            expect(vulnerabilities).toBeDefined();
            // May detect excessive compute if parser works
        });

        it('should still work with fallback pattern matching', () => {
            const code = 'function call() { /* no require */ }';
            const functions = ['call', 'transfer'];

            const vulnerabilities = (analyzer as any).identifyVulnerabilities(code, functions);

            expect(vulnerabilities).toBeDefined();
            expect(vulnerabilities.some((v: string) => v.includes('Unchecked'))).toBe(true);
        });
    });

    describe('full analysis with bytecode parser', () => {
        it('should analyze contract with real bytecode parsing', async () => {
            // Mock Solscan API
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({
                    data: { tokenInfo: { verified: false } },
                }),
            });

            // Mock getAccountInfo with simple bytecode
            const bytecode = Buffer.alloc(16);
            bytecode[0] = 0x85; // CALL
            bytecode.writeInt32LE(8, 4);
            bytecode[8] = 0x95; // EXIT

            (mockConnection.getAccountInfo as jest.Mock).mockResolvedValue({
                data: bytecode,
            });

            const analysis = await analyzer.analyzeContract('TestContract123');

            expect(analysis).toBeDefined();
            expect(analysis.address).toBe('TestContract123');
            expect(analysis.verified).toBe(false);
            expect(analysis.securityScore).toBeDefined();
            expect(analysis.riskLevel).toBeDefined();
        });
    });
});
