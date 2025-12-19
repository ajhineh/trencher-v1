// src/security/controlFlowAnalysis.ts

import { logger } from "../logger";
import { BPFInstruction, FunctionEntry, BPFOpcode } from "./bytecodeParser";

export interface BasicBlock {
    id: number;
    startOffset: number;
    endOffset: number;
    instructions: BPFInstruction[];
    predecessors: number[]; // Block IDs
    successors: number[];   // Block IDs
    type: 'ENTRY' | 'EXIT' | 'NORMAL';
}

export interface ControlFlowGraph {
    blocks: BasicBlock[];
    entryBlockId: number;
    edges: { from: number; to: number }[];
    cyclomaticComplexity: number;
}

export class ControlFlowAnalyzer {

    /**
     * Build CFG for a function
     */
    static buildCFG(func: FunctionEntry): ControlFlowGraph {
        const sortedInstrs = [...func.instructions].sort((a, b) => a.offset - b.offset);
        if (sortedInstrs.length === 0) {
            return { blocks: [], entryBlockId: -1, edges: [], cyclomaticComplexity: 0 };
        }

        // 1. Identify Leaders (basic block start points)
        // - First instruction is a leader
        // - Any instruction that is the target of a jump is a leader
        // - Any instruction that immediately follows a jump is a leader
        const leaders = new Set<number>();
        leaders.add(sortedInstrs[0].offset);

        const jumpOpcodes = [
            BPFOpcode.JA, BPFOpcode.JEQ, BPFOpcode.JGT, BPFOpcode.JGE,
            BPFOpcode.CALL, BPFOpcode.EXIT
        ];

        for (let i = 0; i < sortedInstrs.length; i++) {
            const instr = sortedInstrs[i];

            // If current is jump, next is leader
            if (jumpOpcodes.includes(instr.opcode)) {
                if (i + 1 < sortedInstrs.length) {
                    leaders.add(sortedInstrs[i + 1].offset);
                }

                // Jump target is leader (for conditional/unconditional jumps)
                // Note: immediate in BPF jumps is often relative offset in instructions (units of 8 bytes), NOT bytes.
                // But BytecodeParser currently treats immediate as raw value. 
                // Let's assume BytecodeParser normalizes immediate to *instruction count offset*.
                // standard BPF: off is int16, PC += off.
                // We need absolute offset.
                if (instr.opcode !== BPFOpcode.EXIT && instr.opcode !== BPFOpcode.CALL) {
                    // Calculate target offset
                    // target = current_offset + 8 + (immediate * 8)
                    // (immediate is count of instructions to skip)
                    const targetOffset = instr.offset + 8 + (instr.immediate * 8);

                    // Verify target is within function bounds
                    if (targetOffset >= sortedInstrs[0].offset && targetOffset <= sortedInstrs[sortedInstrs.length - 1].offset) {
                        leaders.add(targetOffset);
                    }
                }
            }
        }

        const sortedLeaders = Array.from(leaders).sort((a, b) => a - b);

        // 2. Build Blocks
        const blocks: BasicBlock[] = [];
        let edges: { from: number; to: number }[] = [];

        for (let i = 0; i < sortedLeaders.length; i++) {
            const start = sortedLeaders[i];
            const end = (i < sortedLeaders.length - 1) ? sortedLeaders[i + 1] : (sortedInstrs[sortedInstrs.length - 1].offset + 8);

            const blockInstrs = sortedInstrs.filter(ins => ins.offset >= start && ins.offset < end);

            blocks.push({
                id: i,
                startOffset: start,
                endOffset: end,
                instructions: blockInstrs,
                predecessors: [],
                successors: [],
                type: (i === 0) ? 'ENTRY' : 'NORMAL'
            });
        }

        // 3. Connect Blocks (Edges)
        const offsetToBlockId = new Map<number, number>();
        blocks.forEach(b => offsetToBlockId.set(b.startOffset, b.id));

        for (const block of blocks) {
            if (block.instructions.length === 0) continue;

            const lastInstr = block.instructions[block.instructions.length - 1];

            // Check flow type
            if (lastInstr.opcode === BPFOpcode.EXIT) {
                block.type = 'EXIT';
                continue; // No successors
            }
            if (lastInstr.opcode === BPFOpcode.JA) {
                // Unconditional Jump
                const targetOffset = lastInstr.offset + 8 + (lastInstr.immediate * 8);
                const targetId = offsetToBlockId.get(targetOffset);
                if (targetId !== undefined) {
                    this.addEdge(block, blocks[targetId], edges);
                }
            } else if ([BPFOpcode.JEQ, BPFOpcode.JGT, BPFOpcode.JGE].includes(lastInstr.opcode)) {
                // Conditional Jump
                // Branch 1: Jump taken
                const targetOffset = lastInstr.offset + 8 + (lastInstr.immediate * 8);
                const targetId = offsetToBlockId.get(targetOffset);
                if (targetId !== undefined) {
                    this.addEdge(block, blocks[targetId], edges);
                }

                // Branch 2: Fall through to next block
                // Only if not the last block physically
                if (block.id + 1 < blocks.length) {
                    this.addEdge(block, blocks[block.id + 1], edges);
                }
            } else {
                // Normal instruction, fall through
                if (block.id + 1 < blocks.length) {
                    this.addEdge(block, blocks[block.id + 1], edges);
                }
            }
        }

        // 4. Calculate Complexity (E - N + 2P)
        // Here P=1 (single component per function usually)
        const complexity = edges.length - blocks.length + 2;

        return {
            blocks,
            entryBlockId: 0,
            edges,
            cyclomaticComplexity: complexity
        };
    }

    private static addEdge(from: BasicBlock, to: BasicBlock, edges: { from: number; to: number }[]) {
        edges.push({ from: from.id, to: to.id });
        from.successors.push(to.id);
        to.predecessors.push(from.id);
    }

    /**
     * Detect loops in CFG
     * (Back edges detection: edge to ancestor in DFS tree)
     */
    static detectLoops(cfg: ControlFlowGraph): boolean {
        const visited = new Set<number>();
        const recursionStack = new Set<number>();

        const hasCycle = (blockId: number): boolean => {
            visited.add(blockId);
            recursionStack.add(blockId);

            const block = cfg.blocks.find(b => b.id === blockId);
            if (!block) return false;

            for (const neighborId of block.successors) {
                if (!visited.has(neighborId)) {
                    if (hasCycle(neighborId)) return true;
                } else if (recursionStack.has(neighborId)) {
                    return true; // Cycle detected
                }
            }

            recursionStack.delete(blockId);
            return false;
        };

        return hasCycle(cfg.entryBlockId);
    }

    /**
     * Detect Unreachable Blocks
     */
    static detectUnreachableBlocks(cfg: ControlFlowGraph): BasicBlock[] {
        const visited = new Set<number>();
        const queue = [cfg.entryBlockId];
        visited.add(cfg.entryBlockId);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const block = cfg.blocks.find(b => b.id === currentId);
            if (block) {
                for (const succ of block.successors) {
                    if (!visited.has(succ)) {
                        visited.add(succ);
                        queue.push(succ);
                    }
                }
            }
        }

        return cfg.blocks.filter(b => !visited.has(b.id));
    }
}
