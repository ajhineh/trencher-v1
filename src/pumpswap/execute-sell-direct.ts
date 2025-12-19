
import {
    Connection,
    PublicKey,
    Transaction,
    Keypair,
} from "@solana/web3.js";
import BN from "bn.js";
import {
    OnlinePumpAmmSdk,
    PUMP_AMM_SDK,
} from "@pump-fun/pump-swap-sdk";
import { logger } from "../logger";

export async function executeDirectSell(
    connection: Connection,
    poolKey: PublicKey,
    mint: PublicKey,
    keypair: Keypair,
    tokenAmount: bigint,   // Amount of tokens to sell in lamports (base unit)
    slippageBps: number,   // e.g. 300 = 3%
    skipPreflight: boolean
): Promise<string | null> {
    try {
        if (tokenAmount <= 0n) {
            logger.warn("[SELL-DIRECT] tokenAmount must be > 0");
            return null;
        }

        const onlineSdk = new OnlinePumpAmmSdk(connection);
        const user = keypair.publicKey;

        // 1) Get pool state
        const swapState = await onlineSdk.swapSolanaState(poolKey, user);

        const amount = new BN(tokenAmount.toString());
        const slippagePercent = slippageBps / 100;

        logger.info(
            `[SELL-DIRECT] swapState loaded for pool=${poolKey.toBase58()}, amount=${amount.toString()}, slippage=${slippagePercent}%`
        );

        // 2) Build sell instructions (base -> quote)
        // sellBaseInput usually takes (state, amountBaseIn, slippageTolerance)
        const ixs = await PUMP_AMM_SDK.sellBaseInput(
            swapState,
            amount,
            slippagePercent
        );

        if (!ixs || ixs.length === 0) {
            logger.error(
                "[SELL-DIRECT] PUMP_AMM_SDK.sellBaseInput returned no instructions"
            );
            return null;
        }

        // 3) Build and send transaction
        const latest = await connection.getLatestBlockhash("confirmed");

        const tx = new Transaction({
            feePayer: user,
            recentBlockhash: latest.blockhash,
        }).add(...ixs);

        tx.sign(keypair);

        const raw = tx.serialize();
        const sig = await connection.sendRawTransaction(raw, { skipPreflight });

        logger.info(`[SELL-DIRECT] Sent tx: ${sig}`);

        await connection.confirmTransaction(
            {
                signature: sig,
                blockhash: latest.blockhash,
                lastValidBlockHeight: latest.lastValidBlockHeight,
            },
            "confirmed"
        );

        logger.info(
            `[SELL-DIRECT] ✅ Confirmed Sell: https://solscan.io/tx/${sig}`
        );

        return sig;
    } catch (e: any) {
        logger.error(
            `[SELL-DIRECT] executeDirectSell error for pool=${poolKey.toBase58()} mint=${mint.toBase58()}: ${e?.message ?? e}`
        );
        return null;
    }
}
