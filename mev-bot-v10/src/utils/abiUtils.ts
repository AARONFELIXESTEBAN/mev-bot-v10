// Placeholder for ABI Utilities
import fs from 'fs/promises';
import path from 'path';
import { utils as ethersUtils } from 'ethers';

// Path to the ABIs directory.
// Assuming 'src/abis' is copied to 'dist/abis' during build,
// and this file 'abiUtils.js' will be in 'dist/utils'.
// So, the path from 'dist/utils' to 'dist/abis' is '../abis'.
const ABI_DIR = path.join(__dirname, '../abis');

export interface IAbiCache {
    loadAbi(name: string, filePath?: string): Promise<ethersUtils.Fragment[] | null>;
    getAbi(name: string): Promise<ethersUtils.Fragment[] | null>;
    // Allow addAbi to take string arrays which will be converted, or Fragment arrays
    addAbi(name: string, abi: ethersUtils.Fragment[] | ReadonlyArray<string>): void;
}

export class AbiCache implements IAbiCache {
    private cache: Map<string, ethersUtils.Fragment[]> = new Map();

    constructor(preloadAbis?: { name: string, path?: string, abi?: ethersUtils.Fragment[] | ReadonlyArray<string> }[]) {
        if (preloadAbis) {
            for (const item of preloadAbis) {
                if (item.abi) {
                    this.addAbi(item.name, item.abi);
                } else if (item.path) { // Ensure path is provided if abi is not
                    this.loadAbi(item.name, item.path); // Fire-and-forget loading
                }
            }
        }
    }

    async loadAbi(name: string, filePath?: string): Promise<ethersUtils.Fragment[] | null> {
        const lowerCaseName = name.toLowerCase();
        if (this.cache.has(lowerCaseName)) {
            return this.cache.get(lowerCaseName)!;
        }
        const fPath = filePath || path.join(ABI_DIR, `${name}.json`); // Use name for filename, cache with lowerCaseName
        try {
            const abiString = await fs.readFile(fPath, 'utf-8');
            // JSON.parse will produce an array of objects/strings, which Interface constructor can handle
            const abiInput = JSON.parse(abiString) as (string | ethersUtils.JsonFragment)[];
            const iface = new ethersUtils.Interface(abiInput);
            const fragments = iface.fragments;
            this.cache.set(lowerCaseName, fragments);
            console.log(`ABI Cache: Loaded ABI for ${name} from ${fPath}`);
            return fragments;
        } catch (error) {
            console.error(`ABI Cache: Error loading ABI for ${name} from ${fPath}:`, error);
            return null;
        }
    }

    async getAbi(name: string): Promise<ethersUtils.Fragment[] | null> {
        const lowerCaseName = name.toLowerCase();
        if (!this.cache.has(lowerCaseName)) {
            return this.loadAbi(name); // loadAbi handles caching with lowerCaseName key from original name
        }
        return this.cache.get(lowerCaseName) || null;
    }

    addAbi(name: string, abi: ethersUtils.Fragment[] | ReadonlyArray<string>): void {
        const lowerCaseName = name.toLowerCase();
        try {
            const iface = new ethersUtils.Interface(abi);
            this.cache.set(lowerCaseName, iface.fragments);
            console.log(`ABI Cache: Manually added/processed ABI for ${name}`);
        } catch (error) {
            console.error(`ABI Cache: Error processing ABI for ${name}:`, error);
        }
    }
}

// Pre-defined ABIs (can be loaded from JSON files as well)
// Changed type annotation to ReadonlyArray<string>
export const ERC20ABI: ReadonlyArray<string> = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint amount) returns (bool)",
    "function approve(address spender, uint amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

export const UniswapV2PairABI: ReadonlyArray<string> = [
    "function name() external pure returns (string memory)",
    "function symbol() external pure returns (string memory)",
    "function decimals() external pure returns (uint8)",
    "function totalSupply() external view returns (uint)",
    "function balanceOf(address owner) external view returns (uint)",
    "function allowance(address owner, address spender) external view returns (uint)",
    "function approve(address spender, uint value) external returns (bool)",
    "function transfer(address to, uint value) external returns (bool)",
    "function transferFrom(address from, address to, uint value) external returns (bool)",
    "function DOMAIN_SEPARATOR() external view returns (bytes32)",
    "function PERMIT_TYPEHASH() external pure returns (bytes32)",
    "function nonces(address owner) external view returns (uint)",
    "function permit(address owner, address spender, uint value, uint deadline, uint8 v, bytes32 r, bytes32 s) external",
    "event Approval(address indexed owner, address indexed spender, uint value)",
    "event Transfer(address indexed from, address indexed to, uint value)",
    "function MINIMUM_LIQUIDITY() external pure returns (uint)",
    "function factory() external view returns (address)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function price0CumulativeLast() external view returns (uint)",
    "function price1CumulativeLast() external view returns (uint)",
    "function kLast() external view returns (uint)",
    "event Mint(address indexed sender, uint amount0, uint amount1)",
    "event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)",
    "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
    "event Sync(uint112 reserve0, uint112 reserve1)",
    "function initialize(address, address) external",
    "function skim(address to) external",
    "function sync() external"
];

export const UniswapV2RouterABI: ReadonlyArray<string> = [
    "constructor(address _factory, address _WETH)",
    "function WETH() view returns (address)",
    "function factory() view returns (address)",
    "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
    "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)",
    "function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) pure returns (uint256 amountIn)",
    "function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256 amountOut)",
    "function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)",
    "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
    "function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256 amountB)",
    "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)",
    "function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)",
    "function removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountETH)",
    "function removeLiquidityETHWithPermit(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountToken, uint256 amountETH)",
    "function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountETH)",
    "function removeLiquidityWithPermit(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountA, uint256 amountB)",
    "function swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
    "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
    "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
    "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
    "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapTokensForExactETH(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
    "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)"
];

// Initialize a default ABI cache instance
// The AbiCache's addAbi method will convert these string arrays to ethersUtils.Fragment[] by creating an Interface
export const globalAbiCache = new AbiCache([
    { name: 'ERC20', abi: ERC20ABI },
    { name: 'UniswapV2Pair', abi: UniswapV2PairABI },
    { name: 'UniswapV2Router02', abi: UniswapV2RouterABI },
]);

// Example: To load MEVBotV8Executor.json or SushiSwapRouter dynamically if not preloaded:
// globalAbiCache.loadAbi('MEVBotV8Executor');
// globalAbiCache.loadAbi('SushiSwapRouter'); // Assuming SushiSwapRouter.json is in ABI_DIR
// These will be loaded on first call to getAbi('MEVBotV8Executor') or getAbi('SushiSwapRouter') if not preloaded.
