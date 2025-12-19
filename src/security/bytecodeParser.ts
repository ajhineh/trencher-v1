// src/security/bytecodeParser.ts

/**
 * Solana BPF Bytecode Parser
 * Disassembles Solana program bytecode to extract function signatures and analyze structure
 */

import { logger } from '../logger';

// Solana BPF instruction opcodes (subset of most common ones)
export enum BPFOpcode {
    // Load/Store
    LDXB = 0x71,    // Load byte
    LDXH = 0x69,    // Load half-word
    LDXW = 0x61,    // Load word
    LDXDW = 0x79,   // Load double-word

    // Arithmetic
    ADD = 0x07,
    SUB = 0x17,
    MUL = 0x27,
    DIV = 0x37,

    // Bitwise
    OR = 0x47,
    AND = 0x57,
    LSH = 0x67,
    RSH = 0x77,

    // Jumps
    JA = 0x05,      // Jump always
    JEQ = 0x15,     // Jump if equal
    JGT = 0x25,     // Jump if greater
    JGE = 0x35,     // Jump if greater or equal

    // Call/Return
    CALL = 0x85,    // Function call
    EXIT = 0x95,    // Return
}

export interface BPFInstruction {
    offset: number;
    opcode: number;
    dst: number;
    src: number;
    immediate: number;
    description: string;
}

export interface FunctionEntry {
    offset: number;
    name?: string;
    instructions: BPFInstruction[];
    callsTo: number[];  // Offsets of functions this calls
    calledBy: number[]; // Offsets of functions that call this
}

export interface CPICall {
    offset: number;
    programId?: string;
    validated: boolean; // Whether proper account validation exists
}

export interface AccountAccess {
    offset: number;
    accountIndex: number;
    isMutable: boolean;
    hasSignerCheck: boolean;
}

export interface ParsedBytecode {
    entryPoints: FunctionEntry[];
    cpiCalls: CPICall[];
    accountAccesses: AccountAccess[];
    computeUnits: number;
    suspiciousPatterns: string[];
}

export class BytecodeParser {
    /**
     * Parse Solana program bytecode
     */
    static parse(bytecode: Buffer | string): ParsedBytecode {
        const buffer = typeof bytecode === 'string'
            ? Buffer.from(bytecode, 'hex')
            : bytecode;

        logger.info(`[BytecodeParser] Parsing ${buffer.length} bytes`);

        // Extract instructions
        const instructions = this.extractInstructions(buffer);

        // Identify function entry points
        const entryPoints = this.identifyFunctions(instructions);

        // Detect CPI calls
        const cpiCalls = this.detectCPICalls(instructions);

        // Analyze account accesses
        const accountAccesses = this.analyzeAccountAccesses(instructions);

        // Estimate compute units
        const computeUnits = this.estimateComputeUnits(instructions);

        // Detect suspicious patterns
        const suspiciousPatterns = this.detectSuspiciousPatterns(instructions, entryPoints);

        return {
            entryPoints,
            cpiCalls,
            accountAccesses,
            computeUnits,
            suspiciousPatterns,
        };
    }

    /**
     * Extract BPF instructions from bytecode
     */
    private static extractInstructions(buffer: Buffer): BPFInstruction[] {
        const instructions: BPFInstruction[] = [];

        // BPF instructions are 8 bytes each
        for (let i = 0; i < buffer.length; i += 8) {
            if (i + 8 > buffer.length) break;

            const opcode = buffer[i];
            const dst = buffer[i + 1] & 0x0F;
            const src = (buffer[i + 1] >> 4) & 0x0F;
            const offset = buffer.readInt16LE(i + 2);
            const immediate = buffer.readInt32LE(i + 4);

            const instruction: BPFInstruction = {
                offset: i,
                opcode,
                dst,
                src,
                immediate,
                description: this.describeInstruction(opcode, dst, src, immediate),
            };

            instructions.push(instruction);
        }

        logger.debug(`[BytecodeParser] Extracted ${instructions.length} instructions`);
        return instructions;
    }

    /**
     * Describe instruction in human-readable format
     */
    private static describeInstruction(opcode: number, dst: number, src: number, imm: number): string {
        switch (opcode) {
            case BPFOpcode.CALL:
                return `call ${imm}`;
            case BPFOpcode.EXIT:
                return 'exit';
            case BPFOpcode.JA:
                return `jump ${imm}`;
            case BPFOpcode.JEQ:
                return `jump if r${dst} == r${src}`;
            case BPFOpcode.ADD:
                return `r${dst} += ${imm}`;
            case BPFOpcode.SUB:
                return `r${dst} -= ${imm}`;
            case BPFOpcode.LDXW:
                return `r${dst} = *(u32 *)(r${src} + ${imm})`;
            default:
                return `opcode 0x${opcode.toString(16)}`;
        }
    }

    /**
     * Identify function entry points
     */
    private static identifyFunctions(instructions: BPFInstruction[]): FunctionEntry[] {
        const functions: FunctionEntry[] = [];
        const callTargets = new Set<number>();

        // Find all CALL targets
        for (const instr of instructions) {
            if (instr.opcode === BPFOpcode.CALL) {
                callTargets.add(instr.immediate);
            }
        }

        // First instruction is always entry point
        callTargets.add(0);

        // Create function entries
        const sortedTargets = Array.from(callTargets).sort((a, b) => a - b);

        for (let i = 0; i < sortedTargets.length; i++) {
            const start = sortedTargets[i];
            const end = i < sortedTargets.length - 1
                ? sortedTargets[i + 1]
                : instructions.length * 8;

            const funcInstructions = instructions.filter(
                instr => instr.offset >= start && instr.offset < end
            );

            const callsTo = funcInstructions
                .filter(instr => instr.opcode === BPFOpcode.CALL)
                .map(instr => instr.immediate);

            functions.push({
                offset: start,
                name: start === 0 ? 'entrypoint' : `func_${start}`,
                instructions: funcInstructions,
                callsTo,
                calledBy: [],
            });
        }

        // Build calledBy relationships
        for (const func of functions) {
            for (const target of func.callsTo) {
                const callee = functions.find(f => f.offset === target);
                if (callee) {
                    callee.calledBy.push(func.offset);
                }
            }
        }

        logger.info(`[BytecodeParser] Identified ${functions.length} functions`);
        return functions;
    }

    /**
     * Detect Cross-Program Invocation (CPI) calls
     */
    private static detectCPICalls(instructions: BPFInstruction[]): CPICall[] {
        const cpiCalls: CPICall[] = [];

        // CPI is typically done via syscall with specific function IDs
        // Solana syscall for invoke is 0x85 (CALL) with specific immediate values
        for (const instr of instructions) {
            if (instr.opcode === BPFOpcode.CALL) {
                // Syscall numbers for CPI:
                // - sol_invoke_signed_c: immediate value in specific range
                // This is a heuristic - actual detection would need more context
                if (instr.immediate > 1000000) { // Heuristic for syscall
                    cpiCalls.push({
                        offset: instr.offset,
                        validated: false, // Will be determined by surrounding instructions
                    });
                }
            }
        }

        logger.debug(`[BytecodeParser] Detected ${cpiCalls.length} potential CPI calls`);
        return cpiCalls;
    }

    /**
     * Analyze account accesses
     */
    private static analyzeAccountAccesses(instructions: BPFInstruction[]): AccountAccess[] {
        const accesses: AccountAccess[] = [];

        // Account accesses are typically LDXW/LDXDW from account info structs
        for (const instr of instructions) {
            if (instr.opcode === BPFOpcode.LDXW || instr.opcode === BPFOpcode.LDXDW) {
                // Heuristic: if loading from r1 (first parameter), it's likely account access
                if (instr.src === 1) {
                    accesses.push({
                        offset: instr.offset,
                        accountIndex: instr.immediate, // Offset in account info array
                        isMutable: false, // Would need more analysis
                        hasSignerCheck: false, // Would need to scan nearby instructions
                    });
                }
            }
        }

        logger.debug(`[BytecodeParser] Detected ${accesses.length} account accesses`);
        return accesses;
    }

    /**
     * Estimate compute units used
     */
    private static estimateComputeUnits(instructions: BPFInstruction[]): number {
        // Rough estimate: each instruction costs ~1 compute unit
        // Calls and jumps cost more
        let units = 0;

        for (const instr of instructions) {
            switch (instr.opcode) {
                case BPFOpcode.CALL:
                    units += 10; // Function calls are expensive
                    break;
                case BPFOpcode.MUL:
                case BPFOpcode.DIV:
                    units += 5; // Arithmetic is moderately expensive
                    break;
                default:
                    units += 1;
            }
        }

        return units;
    }

    /**
     * Detect suspicious patterns in bytecode
     */
    private static detectSuspiciousPatterns(
        instructions: BPFInstruction[],
        functions: FunctionEntry[]
    ): string[] {
        const patterns: string[] = [];

        // 1. Excessive compute usage
        const totalInstructions = instructions.length;
        if (totalInstructions > 10000) {
            patterns.push(`Excessive instruction count: ${totalInstructions}`);
        }

        // 2. Too many function calls (potential obfuscation)
        const callCount = instructions.filter(i => i.opcode === BPFOpcode.CALL).length;
        if (callCount > 100) {
            patterns.push(`Excessive function calls: ${callCount}`);
        }

        // 3. Unreachable code (dead code or hidden functions)
        const reachableFunctions = new Set<number>([0]); // Start from entrypoint
        const queue = [0];

        while (queue.length > 0) {
            const current = queue.shift()!;
            const func = functions.find(f => f.offset === current);

            if (func) {
                for (const target of func.callsTo) {
                    if (!reachableFunctions.has(target)) {
                        reachableFunctions.add(target);
                        queue.push(target);
                    }
                }
            }
        }

        const unreachableCount = functions.length - reachableFunctions.size;
        if (unreachableCount > 0) {
            patterns.push(`Unreachable functions detected: ${unreachableCount}`);
        }

        // 4. Self-modifying code (writes to instruction memory)
        // This would be detected by stores to low memory addresses
        const selfModifying = instructions.some(
            instr => (instr.opcode & 0xF0) === 0x60 && instr.immediate < 1000
        );
        if (selfModifying) {
            patterns.push('Potential self-modifying code detected');
        }

        return patterns;
    }

    /**
     * Extract function names from common patterns
     */
    static extractFunctionNames(bytecode: Buffer | string): string[] {
        const parsed = this.parse(bytecode);

        // Map function offsets to names
        const names = parsed.entryPoints.map(func => {
            // Try to infer function purpose from its characteristics
            const hasLoops = func.instructions.some(i =>
                i.opcode === BPFOpcode.JA && i.immediate < 0
            );
            const hasCalls = func.callsTo.length > 0;
            const isLeaf = func.callsTo.length === 0;

            if (func.offset === 0) return 'entrypoint';
            if (isLeaf && func.instructions.length < 10) return 'helper';
            if (hasLoops) return 'loop_function';
            if (hasCalls) return 'complex_function';

            return func.name || `func_${func.offset}`;
        });

        return names;
    }
}
