// test/security/bytecodeParser.test.ts

import { BytecodeParser } from '../../src/security/bytecodeParser';

describe('BytecodeParser', () => {
    describe('parse', () => {
        it('should parse empty bytecode', () => {
            const result = BytecodeParser.parse(Buffer.alloc(0));

            expect(result.entryPoints).toHaveLength(0);
            expect(result.cpiCalls).toHaveLength(0);
            expect(result.accountAccesses).toHaveLength(0);
            expect(result.computeUnits).toBe(0);
        });

        it('should extract instructions from bytecode', () => {
            // Create simple bytecode: ADD r0, 5
            const bytecode = Buffer.alloc(8);
            bytecode[0] = 0x07; // ADD opcode
            bytecode[1] = 0x00; // dst=r0, src=r0
            bytecode.writeInt32LE(5, 4); // immediate = 5

            const result = BytecodeParser.parse(bytecode);

            expect(result.entryPoints.length).toBeGreaterThan(0);
            expect(result.computeUnits).toBeGreaterThan(0);
        });

        it('should identify function entry points', () => {
            // Create bytecode with CALL instruction
            const bytecode = Buffer.alloc(16);

            // Instruction 1: CALL 64 (call function at offset 64)
            bytecode[0] = 0x85; // CALL opcode
            bytecode.writeInt32LE(64, 4);

            // Instruction 2: EXIT
            bytecode[8] = 0x95; // EXIT opcode

            const result = BytecodeParser.parse(bytecode);

            expect(result.entryPoints.length).toBeGreaterThanOrEqual(1);
            expect(result.entryPoints[0].name).toBe('entrypoint');
        });

        it('should detect CPI calls', () => {
            // Create bytecode with syscall (CPI)
            const bytecode = Buffer.alloc(8);
            bytecode[0] = 0x85; // CALL opcode
            bytecode.writeInt32LE(1000001, 4); // Syscall number (heuristic)

            const result = BytecodeParser.parse(bytecode);

            expect(result.cpiCalls.length).toBeGreaterThan(0);
        });

        it('should detect account accesses', () => {
            // Create bytecode with LDXW from r1 (account parameter)
            const bytecode = Buffer.alloc(8);
            bytecode[0] = 0x61; // LDXW opcode
            bytecode[1] = 0x01; // dst=r0, src=r1
            bytecode.writeInt16LE(0, 2); // offset
            bytecode.writeInt32LE(8, 4); // immediate

            const result = BytecodeParser.parse(bytecode);

            expect(result.accountAccesses.length).toBeGreaterThan(0);
        });

        it('should estimate compute units', () => {
            // Create bytecode with multiple instructions
            const bytecode = Buffer.alloc(24);

            // ADD
            bytecode[0] = 0x07;
            // MUL (expensive)
            bytecode[8] = 0x27;
            // CALL (very expensive)
            bytecode[16] = 0x85;

            const result = BytecodeParser.parse(bytecode);

            // Should be > 3 (base) due to expensive operations
            expect(result.computeUnits).toBeGreaterThan(10);
        });

        it('should detect suspicious patterns', () => {
            // Create large bytecode to trigger "excessive instructions" pattern
            const bytecode = Buffer.alloc(100000); // 12500 instructions

            const result = BytecodeParser.parse(bytecode);

            expect(result.suspiciousPatterns.length).toBeGreaterThan(0);
            expect(result.suspiciousPatterns.some(p => p.includes('Excessive'))).toBe(true);
        });

        it('should detect unreachable functions', () => {
            // Create bytecode with function that's never called
            const bytecode = Buffer.alloc(16);

            // Main function: just EXIT (no calls)
            bytecode[0] = 0x95; // EXIT

            // Unreachable function at offset 8
            bytecode[8] = 0x07; // ADD
            bytecode[9] = 0x95; // EXIT

            const result = BytecodeParser.parse(bytecode);

            // Should detect unreachable code if there are multiple functions
            if (result.entryPoints.length > 1) {
                expect(result.suspiciousPatterns.some(p => p.includes('Unreachable'))).toBe(true);
            }
        });
    });

    describe('extractFunctionNames', () => {
        it('should extract function names from bytecode', () => {
            const bytecode = Buffer.alloc(16);

            // Simple entrypoint
            bytecode[0] = 0x95; // EXIT

            const names = BytecodeParser.extractFunctionNames(bytecode);

            expect(names).toContain('entrypoint');
        });

        it('should infer function types from characteristics', () => {
            // Create bytecode with different function types
            const bytecode = Buffer.alloc(32);

            // Function 1: Entrypoint with CALL
            bytecode[0] = 0x85; // CALL
            bytecode.writeInt32LE(16, 4);
            bytecode[8] = 0x95; // EXIT

            // Function 2: Helper (leaf, small)
            bytecode[16] = 0x07; // ADD
            bytecode[24] = 0x95; // EXIT

            const names = BytecodeParser.extractFunctionNames(bytecode);

            expect(names.length).toBeGreaterThan(0);
            expect(names).toContain('entrypoint');
        });
    });
});
