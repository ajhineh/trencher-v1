// test/benchmark/analysisBenchmark.ts

import { Connection, Keypair } from '@solana/web3.js';
import { getSmartContractAnalyzer } from '../../src/security/smartContractAnalyzer';
import { logger } from '../../src/logger';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
const analyzer = getSmartContractAnalyzer(connection);

// Mock contract data for benchmark (to avoid network latency affecting pure analysis speed)
// Use a real-ish bytecode string
const MOCK_BYTECODE_SIMPLE = Buffer.alloc(100).fill(0).toString('hex'); // Simple
// Complex mock: multiple functions, jumps
const MOCK_BYTECODE_COMPLEX = Buffer.alloc(5000).fill(0x85).toString('hex'); // lots of calls

async function runBenchmark() {
    console.log('Starting Analysis Benchmark...');
    console.log('--------------------------------');

    // Warmup
    await analyzer.analyzeContract(Keypair.generate().publicKey.toBase58()).catch(() => { });

    // Test 1: Simple Contract Analysis Speed (Mocked Fetch)
    // We will monkey-patch fetchContractCode to return immediate data
    const originalFetch = (analyzer as any).fetchContractCode;
    (analyzer as any).fetchContractCode = async () => MOCK_BYTECODE_SIMPLE;
    (analyzer as any).isVerified = async () => false; // Mock net call
    (analyzer as any).fetchIdl = async () => null; // Mock Anchor check

    const startSimple = process.hrtime();
    const ITERATIONS = 100;

    for (let i = 0; i < ITERATIONS; i++) {
        (analyzer as any).clearCache(); // Force re-analysis
        await analyzer.analyzeContract('SimpleMockAddress');
    }

    const endSimple = process.hrtime(startSimple);
    const timeSimple = (endSimple[0] * 1000 + endSimple[1] / 1e6);

    console.log(`Simple Contract Analysis (x${ITERATIONS}):`);
    console.log(`Total Time: ${timeSimple.toFixed(2)}ms`);
    console.log(`Avg Time: ${(timeSimple / ITERATIONS).toFixed(2)}ms / op`);
    console.log(`Throughput: ${(1000 / (timeSimple / ITERATIONS)).toFixed(2)} ops/sec`);
    console.log('--------------------------------');

    // Test 2: Complex Contract (CFG Stress Test)
    (analyzer as any).fetchContractCode = async () => MOCK_BYTECODE_COMPLEX;

    const startComplex = process.hrtime();
    const ITERATIONS_COMPLEX = 20;

    for (let i = 0; i < ITERATIONS_COMPLEX; i++) {
        (analyzer as any).clearCache();
        await analyzer.analyzeContract('ComplexMockAddress');
    }

    const endComplex = process.hrtime(startComplex);
    const timeComplex = (endComplex[0] * 1000 + endComplex[1] / 1e6);

    console.log(`Complex Contract Analysis (x${ITERATIONS_COMPLEX}) [Stress Test]:`);
    console.log(`Total Time: ${timeComplex.toFixed(2)}ms`);
    console.log(`Avg Time: ${(timeComplex / ITERATIONS_COMPLEX).toFixed(2)}ms / op`);
    console.log(`Throughput: ${(1000 / (timeComplex / ITERATIONS_COMPLEX)).toFixed(2)} ops/sec`);
    console.log('--------------------------------');

    // Restore
    (analyzer as any).fetchContractCode = originalFetch;
}

runBenchmark().catch(console.error).then(() => process.exit(0));
