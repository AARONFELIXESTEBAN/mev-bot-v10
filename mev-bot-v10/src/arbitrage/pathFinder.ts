import { ethers, BigNumber } from 'ethers';
import { DecodedTransactionInput } from '../../mempool-ingestion-service/src/services/transactionDecoder'; // Adjust path as needed, or define a shared type
import { TokenInfo, DexPair } from '../utils/typeUtils'; // Assuming these are defined in shared types
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
    // blockNumber?: number; // Optional: block number if transaction is already mined (less likely for mempool)
    txTimestamp: number; // Timestamp from when the tx was observed/processed
}

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
    // We need to find a path TokenX -> BaseToken on another (or same) DEX (Leg 2)
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
            // Check if pool contains TokenX and BaseToken
            const poolToken0Addr = pool.token0.address.toLowerCase();
            const poolToken1Addr = pool.token1.address.toLowerCase();

            if ((poolToken0Addr === tokenX.address.toLowerCase() && poolToken1Addr === baseToken.address.toLowerCase()) ||
                (poolToken1Addr === tokenX.address.toLowerCase() && poolToken0Addr === baseToken.address.toLowerCase())) {

                // Found a potential Leg 2 pool
                const leg1DexName = mempoolSwap.routerName; // Or derive more specifically if possible
                // We need pair address for leg 1. This is tricky from router tx alone without more context.
                // Assuming for now the mempoolSwap might contain LP address or we can infer it.
                // For MVP, we might need to pass more info into mempoolSwap or make assumptions.
                // Let's say mempoolSwap.pairAddress (hypothetical field) gives the LP of the first swap.
                const leg1PairAddress = (mempoolSwap as any).pairAddress || "UNKNOWN_LEG1_PAIR";


                const path: ArbitragePath = {
                    id: `${leg1PairAddress}-${pool.pairAddress}-${tokenX.symbol}`,
                    sourceTxHash: mempoolSwap.txHash,
                    tokenPath: [baseToken, tokenX, baseToken],
                    leg1: {
                        dexName: leg1DexName,
                        pairAddress: leg1PairAddress, // Needs to be determined more reliably
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
                    // blockNumber: mempoolSwap.blockNumber
                };
                opportunities.push(path);
                logger.info({ pathId: path.id, leg1Dex: path.leg1.dexName, leg2Dex: path.leg2.dexName }, `PathFinder: Potential 2-hop opportunity found for ${baseToken.symbol}->${tokenX.symbol}->${baseToken.symbol}`);
            }
        }
    }
    // Scenario 2: Mempool swap is TokenX -> BaseToken (Less common to trigger from this direction for A->B->A, but possible for other patterns)
    // else if (tokenOutAddr === baseToken.address.toLowerCase() && tokenInAddr !== baseToken.address.toLowerCase()) {
    //     const tokenXAddr = tokenInAddr;
    //     // ... logic for finding BaseToken -> TokenX as Leg 1 ...
    // }

    return opportunities;
}


// Helper to find token info if only address is known from path
function findTokenInfo(address: string, symbolHint: string, knownTokens: TokenInfo[]): TokenInfo | undefined {
    let token = knownTokens.find(t => t.address.toLowerCase() === address.toLowerCase());
    if (token) return token;
    // If not found by address, try by symbol (less reliable)
    token = knownTokens.find(t => t.symbol.toUpperCase() === symbolHint.toUpperCase());
    if (token) { // If found by symbol, create a new object with the correct address from path
        return { ...token, address: address };
    }
    // If still not found, create a placeholder (decimals would be unknown, problematic for calcs)
    // logger.warn(`PathFinder: Token info for address ${address} (hint: ${symbolHint}) not found in whitelisted tokens. Using placeholder.`);
    // return { address, symbol: symbolHint || "UNKNOWN", decimals: 18 }; // Defaulting decimals, bad idea
    return undefined;
}