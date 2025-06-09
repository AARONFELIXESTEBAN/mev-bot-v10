// In mev-bot-v10/src/arbitrage/pathFinder.ts

import { ethers, BigNumber } from 'ethers';
// +++ FIX: Corrected the relative path from '../../../../' to '../../../'
import { DecodedTransactionInput } from '@shared/types';
import { TokenInfo, DexPair } from '../utils/typeUtils';
import { getLogger } from '../core/logger/loggerService';

const logger = getLogger();

// Define a simplified DecodedMempoolTransaction for pathfinding context
// This should align with what mempool-ingestion-service provides
export interface DecodedMempoolSwap {
    txHash: string;
    routerName: string; // e.g., "UniswapV2Router02"
    routerAddress: string;
    functionName: string; // e.g., "swapExactETHForTokens"
    path: string[]; // Token addresses [tokenIn, tokenOut] or [tokenIn, tokenIntermediate, tokenOut]
    amountIn?: BigNumber;
    amountOutMin?: BigNumber; // For exact input swaps
    amountOut?: BigNumber;    // For exact output swaps
    amountInMax?: BigNumber;  // For exact output swaps
    recipient: string;
    txTimestamp: number; // Timestamp from when the tx was observed/processed
    leg1PairAddress?: string; // Address of the pair for the first leg of the swap
    blockNumber?: number; // Block number of the triggering tx
}

// Represents a specific leg of an arbitrage
export interface ArbitrageLeg {
    dexName: string;
    pairAddress: string; // LP address
    tokenIn: TokenInfo;
    tokenOut: TokenInfo;
}

// Represents a 2-hop arbitrage path
export interface ArbitragePath {
    id: string; // e.g., Leg1PairAddr_Leg2PairAddr_TokenIntermediateSymbol
    sourceTxHash: string; // Hash of the mempool tx that triggered this path search
    tokenPath: [TokenInfo, TokenInfo, TokenInfo]; // e.g., [WETH, TOKEN_A, WETH]
    leg1: ArbitrageLeg;
    leg2: ArbitrageLeg;
    discoveryTimestamp: number; // When this path was found
    sourceTxBlockNumber?: number; // Block number of the source transaction
}

// Information about available DEX pools needed by the pathfinder
export interface DexPoolInfo {
    pairAddress: string;
    dexName: string; // e.g., "UniswapV2", "SushiSwap"
    token0: TokenInfo;
    token1: TokenInfo;
}

/**
 * Identifies potential 2-hop arbitrage opportunities (e.g., WETH -> TokenA -> WETH)
 * triggered by an observed mempool swap.
 */
export function findTwoHopOpportunities(
    mempoolSwap: DecodedMempoolSwap,
    baseToken: TokenInfo, // e.g. WETH
    coreWhitelistedTokens: TokenInfo[],
    availableDexPools: DexPoolInfo[]
): ArbitragePath[] {
    const opportunities: ArbitragePath[] = [];
    logger.debug({ txHash: mempoolSwap.txHash, path: mempoolSwap.path }, "PathFinder: Analyzing mempool swap for 2-hop arbitrage.");

    if (!mempoolSwap.path || mempoolSwap.path.length < 2) {
        logger.debug({ txHash: mempoolSwap.txHash }, "PathFinder: Mempool swap path is too short.");
        return opportunities;
    }

    const tokenInAddr = mempoolSwap.path[0].toLowerCase();
    const tokenOutAddr = mempoolSwap.path[mempoolSwap.path.length - 1].toLowerCase();

    // Scenario 1: Mempool swap is BaseToken -> TokenX (Leg 1: BaseToken -> TokenX)
    if (tokenInAddr === baseToken.address.toLowerCase() && tokenOutAddr !== baseToken.address.toLowerCase()) {
        const tokenXAddr = tokenOutAddr;
        const tokenX = coreWhitelistedTokens.find(t => t.address.toLowerCase() === tokenXAddr) ||
                         (mempoolSwap.path.length > 1 ? findTokenInfo(tokenXAddr, mempoolSwap.path[1], coreWhitelistedTokens) : undefined);

        if (!tokenX) {
            logger.debug({ txHash: mempoolSwap.txHash, tokenXAddr }, "PathFinder: Intermediate token (TokenX) from Leg 1 is not whitelisted or info not found.");
            return opportunities;
        }

        logger.debug({ txHash: mempoolSwap.txHash, baseToken: baseToken.symbol, tokenX: tokenX.symbol }, `PathFinder: Leg 1 identified: ${baseToken.symbol} -> ${tokenX.symbol} via mempool tx on ${mempoolSwap.routerName}.`);

        // Find Leg 2: TokenX -> BaseToken from available DEX pools
        for (const pool of availableDexPools) {
            const poolToken0Addr = pool.token0.address.toLowerCase();
            const poolToken1Addr = pool.token1.address.toLowerCase();

            if ((poolToken0Addr === tokenX.address.toLowerCase() && poolToken1Addr === baseToken.address.toLowerCase()) ||
                (poolToken1Addr === tokenX.address.toLowerCase() && poolToken0Addr === baseToken.address.toLowerCase())) {

                const leg1DexName = mempoolSwap.routerName;
                const leg1PairAddress = mempoolSwap.leg1PairAddress || "UNKNOWN_LEG1_PAIR";

                const path: ArbitragePath = {
                    id: `${leg1PairAddress}-${pool.pairAddress}-${tokenX.symbol}`,
                    sourceTxHash: mempoolSwap.txHash,
                    tokenPath: [baseToken, tokenX, baseToken],
                    leg1: {
                        dexName: leg1DexName,
                        pairAddress: leg1PairAddress,
                        tokenIn: baseToken,
                        tokenOut: tokenX,
                    },
                    leg2: {
                        dexName: pool.dexName,
                        pairAddress: pool.pairAddress,
                        tokenIn: tokenX,
                        tokenOut: baseToken,
                    },
                    discoveryTimestamp: Date.now(),
                    sourceTxBlockNumber: mempoolSwap.blockNumber,
                };
                opportunities.push(path);
                logger.info({ pathId: path.id, leg1Dex: path.leg1.dexName, leg2Dex: path.leg2.dexName }, `PathFinder: Potential 2-hop opportunity found for ${baseToken.symbol}->${tokenX.symbol}->${baseToken.symbol}`);
            }
        }
    }

    return opportunities;
}

// Helper to find token info if only address is known from path
function findTokenInfo(address: string, symbolHint: string, knownTokens: TokenInfo[]): TokenInfo | undefined {
    let token = knownTokens.find(t => t.address.toLowerCase() === address.toLowerCase());
    if (token) return token;

    token = knownTokens.find(t => t.symbol.toUpperCase() === symbolHint.toUpperCase());
    if (token) {
        return { ...token, address: address };
    }

    return undefined;
}