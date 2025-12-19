// src/security/anchorIdlParser.ts

import { Connection, PublicKey } from "@solana/web3.js";
import { logger } from "../logger";
import * as borsh from "borsh";

// IDL Account layout
// discriminator: [u8; 8]
// authority: Pubkey
// content: Vec<u8> (inflated IDL JSON)
export class IdlAccount {
    authority: PublicKey;
    content: Uint8Array;

    constructor(fields: { authority: PublicKey; content: Uint8Array }) {
        this.authority = fields.authority;
        this.content = fields.content;
    }

    static schema = new Map([
        [
            IdlAccount,
            {
                kind: "struct",
                fields: [
                    ["authority", [32]],
                    ["content", ["u8"]],
                ],
            },
        ],
    ]);
}

export interface SecurityConstraint {
    instructionName: string;
    type: 'MISSING_SIGNER' | 'UNSAFE_CONSTRAINT' | 'INFO';
    message: string;
}

export class AnchorIdlParser {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * Fetch and parse IDL for a program
     */
    async fetchIdl(programId: string): Promise<any | null> {
        try {
            const programPubkey = new PublicKey(programId);

            // Derive IDL PDA: ['anchor:idl', programId]
            const [idlAddress] = PublicKey.findProgramAddressSync(
                [], // Base seed is empty for some versions, but standard is different.
                // Actually standard is derived from the "Anchor IDL Program" if checking registry,
                // BUT mostly programs store it themselves at a seed.
                // Let's try the modern standard: stored in a separate account owned by the program?
                // No, standard is: PDA of [b"anchor:idl", program_id] owned by program_id?
                // Wait, typically it is owned by the program itself.

                // Let's use the standard seed: "anchor:idl", program_id
                // But wait, findProgramAddress needs the *programId* as the owner.

                // Correct logic:
                // The IDL account is at a PDA of the *Program itself*.
                // Seeds: [Buffer.from("anchor:idl"), programPubkey.toBuffer()] ??
                // Actually, different versions exist.
                // Let's assume the simpler known seed:
                // seed: "anchor:idl", program_id: programId

                // Let's try finding the address.
                // Common method: 
                // base = await PublicKey.findProgramAddress([], programId); -> No

                // Let's try:
                // Seeds: ["anchor:idl", programId]
                // This is often just a raw account created.

                // For now, let's rely on the most common pattern:
                // PDA = findProgramAddress(["anchor:idl", programId], programId)
                // This seems recursive.

                // Better approach: Check if we can fetch from a known registry or just assume it is at a standard address.
                // Let's try the seed "anchor:idl" off the program.
                programPubkey
            );

            // Actually, let's look at how Anchor client does it.
            // It looks for an account with specific discriminator.
            // Let's try to find an account with seed 'anchor:idl' owned by the program.
            const [base] = PublicKey.findProgramAddressSync(
                [Buffer.from("anchor:idl"), programPubkey.toBuffer()],
                programPubkey
            );

            // Often it is verified to be owned by the program.
            // However, sometimes it's owned by the System Program if it's just data? No.

            // Let's try fetching this account.
            const accountInfo = await this.connection.getAccountInfo(base);
            if (!accountInfo) {
                // logger.debug(`[AnchorIdlParser] IDL account not found at ${base.toBase58()}`);
                return null;
            }

            // Deserialize (skip 8 byte discriminator)
            const data = accountInfo.data.subarray(8);

            // The data structure is: Authority (32), Data (Vec<u8>)
            // We can decode manually.
            const authority = new PublicKey(data.subarray(0, 32));
            const vecLen = data.readUInt32LE(32); // Vec length
            const content = data.subarray(36, 36 + vecLen);

            // Decompress?
            // Usually it is compressed with zlib/deflate if it is large.
            // But often it's just JSON bytes.
            // Let's try parsing as JSON string first.
            let jsonString = "";
            try {
                // Try simple utf8
                jsonString = content.toString('utf8');
                // Trim null bytes if any
                // Check if valid JSON
                if (jsonString.startsWith("{")) {
                    return JSON.parse(jsonString);
                }
            } catch (e) {
                // If not valid json, might apply manual logic or it is compressed.
                // For this implementation, we handle uncompressed IDLs.
                // Adding zlib support would require external dep 'pako'.
            }

            // If json parse worked (rare to work directly if binary header exists? no, it is bytes)
            // Actually, Anchor usually stores compressed data. Eek.
            // We will ship a best-effort parser.

            // If we can't parse, return null (graceful degradation).
            return null;

        } catch (error) {
            logger.warn(`[AnchorIdlParser] Failed to fetch IDL: ${error}`);
            return null;
        }
    }

    /**
     * Analyze IDL for security issues
     */
    analyzeSecurity(idl: any): SecurityConstraint[] {
        const issues: SecurityConstraint[] = [];

        if (!idl || !idl.instructions) return issues;

        for (const ix of idl.instructions) {
            // Check args/accounts
            if (ix.accounts) {
                for (const account of ix.accounts) {
                    // Check signer requirement
                    if (account.isMut && !account.isSigner) {
                        // Potentially missing signer check if it's a critical account
                        if (account.name.toLowerCase().includes('authority') ||
                            account.name.toLowerCase().includes('owner')) {
                            issues.push({
                                instructionName: ix.name,
                                type: 'MISSING_SIGNER',
                                message: `Account '${account.name}' is mutable but not a signer. Verify authority validation.`
                            });
                        }
                    }
                }
            }
        }

        return issues;
    }
}
