import { ethers, BigNumber } from 'ethers';
// Updated import statement:
import { DecodedMempoolSwap } from '../interfaces/mempoolEvents.interface'; // Removed DecodedTransactionInput as it's part of DecodedMempoolSwap
import { TokenInfo, DexPair } from '../utils/typeUtils'; // Assuming these are defined in shared types
import { getLogger } from '../core/logger/loggerService';

const logger = getLogger();

// Local definition of DecodedMempoolSwap REMOVED

// Represents a specific leg of an arbitrage
export interface ArbitrageLeg {
    dexName: string;
    pairAddress: string; // LP address
    tokenIn: TokenInfo;
    tokenOut: TokenInfo;
    // Optional: reserveIn and reserveOut at the time of path discovery can be useful
    // reserveIn?: BigNumber;
    // reserveOut?: BigNumber;
}

// Represents a 2-hop arbitrage path
export interface ArbitragePath {
    id: string; // e.g., Leg1PairAddr_Leg2PairAddr_TokenIntermediateSymbol
    sourceTxHash: string; // Hash of the mempool tx that triggered this path search
    tokenPath: [TokenInfo, TokenInfo, TokenInfo]; // e.g., [WETH, TOKEN_A, WETH]
    leg1: ArbitrageLeg;
    leg2: ArbitrageLeg;
    // blockNumber?: number; // Block number of the triggering tx, if available
    discoveryTimestamp: number; // When this path was found
}

// Information about available DEX pools needed by the pathfinder
export interface DexPoolInfo {
    pairAddress: string;
    dexName: string; // e.g., "UniswapV2", "SushiSwap"
    token0: TokenInfo;
    token1: TokenInfo;
    // Optionally include reserves if readily available to pathfinder, reduces lookups
    // reserve0?: BigNumber;
    // reserve1?: BigNumber;
}


/**
 * Identifies potential 2-hop arbitrage opportunities (e.g., WETH -> TokenA -> WETH)
 * triggered by an observed mempool swap.
 *
 * @param mempoolSwap The decoded swap transaction from the mempool.
 * @param baseToken The base token for the arbitrage (e.g., WETH).
 * @param coreWhitelistedTokens A list of whitelisted intermediate tokens.
 * @param availableDexPools A list of known DEX pools where the second hop might occur.
 * @returns An array of potential ArbitragePath objects.
 */
export function findTwoHopOpportunities(
    mempoolSwap: DecodedMempoolSwap, // Now using imported interface
    baseToken: TokenInfo, // e.g. WETH
    coreWhitelistedTokens: TokenInfo[],
    availableDexPools: DexPoolInfo[]
): ArbitragePath[] {
    const opportunities: ArbitragePath[] = [];
    // Accessing decodedInput directly from the imported DecodedMempoolSwap type
    logger.debug({ txHash: mempoolSwap.hash, path: mempoolSwap.decodedInput.path }, "PathFinder: Analyzing mempool swap for 2-hop arbitrage.");

    if (!mempoolSwap.decodedInput.path || mempoolSwap.decodedInput.path.length < 2) {
        logger.debug({ txHash: mempoolSwap.hash }, "PathFinder: Mempool swap path is too short.");
        return opportunities;
    }

    const tokenInAddr = mempoolSwap.decodedInput.path[0].toLowerCase();
    const tokenOutAddr = mempoolSwap.decodedInput.path[mempoolSwap.decodedInput.path.length - 1].toLowerCase();

    // Scenario 1: Mempool swap is BaseToken -> TokenX (Leg 1: BaseToken -> TokenX)
    // We need to find a path TokenX -> BaseToken on another (or same) DEX (Leg 2)
    if (tokenInAddr === baseToken.address.toLowerCase() && tokenOutAddr !== baseToken.address.toLowerCase()) {
        const tokenXAddr = tokenOutAddr;
        // Use findTokenInfo helper, assuming it's robust or coreWhitelistedTokens is comprehensive
        const tokenX = coreWhitelistedTokens.find(t => t.address.toLowerCase() === tokenXAddr) ||
                       findTokenInfo(tokenXAddr, mempoolSwap.decodedInput.path[1], coreWhitelistedTokens);


        if (!tokenX) {
            logger.debug({ txHash: mempoolSwap.hash, tokenXAddr }, "PathFinder: Intermediate token (TokenX) from Leg 1 is not whitelisted or info not found.");
            return opportunities;
        }

        logger.debug({ txHash: mempoolSwap.hash, baseToken: baseToken.symbol, tokenX: tokenX.symbol }, `PathFinder: Leg 1 identified: ${baseToken.symbol} -> ${tokenX.symbol} via mempool tx on ${mempoolSwap.decodedInput.routerName}.`);

        // Find Leg 2: TokenX -> BaseToken from available DEX pools
        for (const pool of availableDexPools) {
            // Check if pool contains TokenX and BaseToken
            const poolToken0Addr = pool.token0.address.toLowerCase();
            const poolToken1Addr = pool.token1.address.toLowerCase();

            if ((poolToken0Addr === tokenX.address.toLowerCase() && poolToken1Addr === baseToken.address.toLowerCase()) ||
                (poolToken1Addr === tokenX.address.toLowerCase() && poolToken0Addr === baseToken.address.toLowerCase())) {

                const leg1DexName = mempoolSwap.decodedInput.routerName;
                // The pairAddress for leg1 should ideally be part of DecodedMempoolSwap if known by mempool-ingestion
                // For now, we'll use a placeholder or assume it might be part of an enriched mempoolSwap object
                const leg1PairAddress = (mempoolSwap as any).pairAddress || `PAIR_FOR_${mempoolSwap.decodedInput.path.join('_')}_ON_${leg1DexName}`;


                const path: ArbitragePath = {
                    id: `${leg1PairAddress}-${pool.pairAddress}-${tokenX.symbol}`,
                    sourceTxHash: mempoolSwap.hash, // Use hash from the root of DecodedMempoolSwap
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
                    // blockNumber: mempoolSwap.blockNumber // if available on DecodedMempoolSwap
                };
                opportunities.push(path);
                logger.info({ pathId: path.id, leg1Dex: path.leg1.dexName, leg2Dex: path.leg2.dexName }, `PathFinder: Potential 2-hop opportunity found for ${baseToken.symbol}->${tokenX.symbol}->${baseToken.symbol}`);
            }
        }
    }
    // Scenario 2: Mempool swap is TokenX -> BaseToken (Less common to trigger from this direction for A->B->A, but possible for other patterns)
    // This logic would be similar but inverted.

    return opportunities;
}


// Helper to find token info if only address is known from path
function findTokenInfo(address: string, symbolHint: string | undefined, knownTokens: TokenInfo[]): TokenInfo | undefined {
    let token = knownTokens.find(t => t.address.toLowerCase() === address.toLowerCase());
    if (token) return token;

    if (symbolHint) { // Only search by symbol if a hint is available
        token = knownTokens.find(t => t.symbol.toUpperCase() === symbolHint.toUpperCase());
        if (token) {
            // If found by symbol, ensure we return it with the correct address from the path
            return { ...token, address: address };
        }
    }
    return undefined;
}
