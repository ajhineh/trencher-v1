// src/dataSources/holderAnalysis.ts

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';

export interface HolderDistribution {
    totalHolders: number;
    top10HoldersPercent: number;
    top5HoldersPercent: number;
    largestHolderPercent: number;
    isConcentrated: boolean; // true if top 5 holders own > 50%
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export async function analyzeHolderDistribution(
    connection: Connection,
    mintAddress: string
): Promise<HolderDistribution> {
    try {
        const mintPubkey = new PublicKey(mintAddress);

        // Get all token accounts for this mint
        const tokenAccounts = await connection.getParsedProgramAccounts(
            new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), // SPL Token Program
            {
                filters: [
                    {
                        dataSize: 165, // Size of token account
                    },
                    {
                        memcmp: {
                            offset: 0,
                            bytes: mintPubkey.toBase58(),
                        },
                    },
                ],
            }
        );

        if (tokenAccounts.length === 0) {
            return {
                totalHolders: 0,
                top10HoldersPercent: 0,
                top5HoldersPercent: 0,
                largestHolderPercent: 0,
                isConcentrated: false,
                riskLevel: 'HIGH',
            };
        }

        // Extract balances
        const balances: number[] = [];
        let totalSupply = 0;

        for (const account of tokenAccounts) {
            const parsedInfo = (account.account.data as any).parsed?.info;
            if (parsedInfo?.tokenAmount) {
                const balance = parsedInfo.tokenAmount.uiAmount || 0;
                if (balance > 0) {
                    balances.push(balance);
                    totalSupply += balance;
                }
            }
        }

        // Sort balances descending
        balances.sort((a, b) => b - a);

        const totalHolders = balances.length;
        const top5Balances = balances.slice(0, 5);
        const top10Balances = balances.slice(0, 10);

        const top5Sum = top5Balances.reduce((sum, b) => sum + b, 0);
        const top10Sum = top10Balances.reduce((sum, b) => sum + b, 0);

        const top5HoldersPercent = (top5Sum / totalSupply) * 100;
        const top10HoldersPercent = (top10Sum / totalSupply) * 100;
        const largestHolderPercent = (balances[0] / totalSupply) * 100;

        const isConcentrated = top5HoldersPercent > 50;

        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
        if (largestHolderPercent > 30 || top5HoldersPercent > 70) {
            riskLevel = 'HIGH';
        } else if (largestHolderPercent > 15 || top5HoldersPercent > 50) {
            riskLevel = 'MEDIUM';
        } else {
            riskLevel = 'LOW';
        }

        return {
            totalHolders,
            top10HoldersPercent,
            top5HoldersPercent,
            largestHolderPercent,
            isConcentrated,
            riskLevel,
        };
    } catch (error: any) {
        logger.error(`[HolderAnalysis] Error analyzing ${mintAddress}: ${error?.message ?? error}`);
        return {
            totalHolders: 0,
            top10HoldersPercent: 0,
            top5HoldersPercent: 0,
            largestHolderPercent: 0,
            isConcentrated: false,
            riskLevel: 'HIGH',
        };
    }
}
