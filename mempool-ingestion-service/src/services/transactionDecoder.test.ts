import { ethers, BigNumber } from 'ethers';
import { initializeDefaultDecoder, TransactionDecoder } from './transactionDecoder';
import UniswapV2Router02ABI from '../abis/UniswapV2Router02.json'; // Used for encoding test data
import { DecodedTransactionInput } from '@shared/types';

// Mock config for knownRouters, assuming these addresses are used by initializeDefaultDecoder
jest.mock('../utils/config', () => ({
    __esModule: true,
    default: {
        knownRouters: [
            "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".toLowerCase(), // UniswapV2Router02
            "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F".toLowerCase(), // SushiSwapRouter
        ],
        // Add other config properties if they are accessed by the decoder directly or indirectly
    },
}));


describe('TransactionDecoder', () => {
    let decoder: TransactionDecoder;
    const uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const sushiswapRouterAddress = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
    const uniswapInterface = new ethers.utils.Interface(UniswapV2Router02ABI); // For encoding

    beforeAll(() => {
        decoder = initializeDefaultDecoder(); // Uses the default routers
    });

    const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
    const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const recipientAddress = "0x1234567890123456789012345678901234567890";
    const mockTxHash = "0xmockTxHash";
    const mockBlockNumber = 123456;

    // Helper to create a mock TransactionResponse
    const createMockTx = (to: string, data: string, value?: BigNumber): ethers.providers.TransactionResponse => {
        return {
            hash: mockTxHash,
            to: to,
            from: "0xMockFromAddress",
            nonce: 1,
            gasLimit: BigNumber.from("210000"),
            gasPrice: BigNumber.from("50000000000"), // 50 gwei
            data: data,
            value: value || BigNumber.from(0),
            chainId: 1,
            confirmations: 1,
            blockHash: "0xMockBlockHash",
            blockNumber: mockBlockNumber,
            timestamp: Math.floor(Date.now() / 1000),
            wait: async (confirmations?: number) => this as any, // Mock wait function
        } as ethers.providers.TransactionResponse;
    };

    describe('UniswapV2 / SushiSwap Style Swaps', () => {
        it('should correctly decode swapExactETHForTokens', () => {
            const amountOutMin = BigNumber.from("1000000000000000000"); // 1 DAI
            const path = [WETH_ADDRESS, DAI_ADDRESS];
            const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
            const ethValue = BigNumber.from("100000000000000000"); // 0.1 ETH

            const data = uniswapInterface.encodeFunctionData("swapExactETHForTokens", [
                amountOutMin,
                path,
                recipientAddress,
                deadline
            ]);
            const mockTransaction = createMockTx(uniswapRouterAddress, data, ethValue);
            const decoded = decoder.decodeTransaction(mockTransaction);

            expect(decoded).not.toBeNull();
            expect(decoded?.routerName).toBe("UniswapV2Router02");
            expect(decoded?.functionName).toBe("swapExactETHForTokens");
            expect(decoded?.amountOutMin?.toString()).toBe(amountOutMin.toString());
            expect(decoded?.path).toEqual(path);
            expect(decoded?.to).toBe(recipientAddress);
            // No amountIn for swapExactETHForTokens as it's msg.value
            expect(decoded?.amountIn).toBeUndefined();
        });

        it('should correctly decode swapExactETHForTokensSupportingFeeOnTransferTokens', () => {
            const amountOutMin = BigNumber.from("2000000000000000000");
            const path = [WETH_ADDRESS, USDC_ADDRESS];
            const deadline = Math.floor(Date.now() / 1000) + 600;
            const ethValue = BigNumber.from("200000000000000000"); // 0.2 ETH

            const data = uniswapInterface.encodeFunctionData("swapExactETHForTokensSupportingFeeOnTransferTokens", [
                amountOutMin,
                path,
                recipientAddress,
                deadline
            ]);
            const mockTransaction = createMockTx(sushiswapRouterAddress, data, ethValue); // Test with SushiSwap
            const decoded = decoder.decodeTransaction(mockTransaction);

            expect(decoded).not.toBeNull();
            expect(decoded?.routerName).toBe("SushiSwapRouter");
            expect(decoded?.functionName).toBe("swapExactETHForTokensSupportingFeeOnTransferTokens");
            expect(decoded?.amountOutMin?.toString()).toBe(amountOutMin.toString());
            expect(decoded?.path).toEqual(path);
            expect(decoded?.to).toBe(recipientAddress);
            expect(decoded?.amountIn).toBeUndefined();
        });

        it('should correctly decode swapExactTokensForETH', () => {
            const amountIn = BigNumber.from("5000000000000000000"); // 5 DAI
            const amountOutMin = BigNumber.from("50000000000000000"); // 0.05 ETH
            const path = [DAI_ADDRESS, WETH_ADDRESS];
            const deadline = Math.floor(Date.now() / 1000) + 300;

            const data = uniswapInterface.encodeFunctionData("swapExactTokensForETH", [
                amountIn,
                amountOutMin,
                path,
                recipientAddress,
                deadline
            ]);
            const mockTransaction = createMockTx(uniswapRouterAddress, data);
            const decoded = decoder.decodeTransaction(mockTransaction);

            expect(decoded).not.toBeNull();
            expect(decoded?.routerName).toBe("UniswapV2Router02");
            expect(decoded?.functionName).toBe("swapExactTokensForETH");
            expect(decoded?.amountIn?.toString()).toBe(amountIn.toString());
            expect(decoded?.amountOutMin?.toString()).toBe(amountOutMin.toString());
            expect(decoded?.path).toEqual(path);
            expect(decoded?.to).toBe(recipientAddress);
        });

        it('should correctly decode swapExactTokensForETHSupportingFeeOnTransferTokens', () => {
            const amountIn = BigNumber.from("6000000000000000000"); // 6 USDC
            const amountOutMin = BigNumber.from("60000000000000000"); // 0.06 ETH
            const path = [USDC_ADDRESS, WETH_ADDRESS];
            const deadline = Math.floor(Date.now() / 1000) + 300;

            const data = uniswapInterface.encodeFunctionData("swapExactTokensForETHSupportingFeeOnTransferTokens", [
                amountIn,
                amountOutMin,
                path,
                recipientAddress,
                deadline
            ]);
            const mockTransaction = createMockTx(sushiswapRouterAddress, data);
            const decoded = decoder.decodeTransaction(mockTransaction);

            expect(decoded).not.toBeNull();
            expect(decoded?.routerName).toBe("SushiSwapRouter");
            expect(decoded?.functionName).toBe("swapExactTokensForETHSupportingFeeOnTransferTokens");
            expect(decoded?.amountIn?.toString()).toBe(amountIn.toString());
            expect(decoded?.amountOutMin?.toString()).toBe(amountOutMin.toString());
            expect(decoded?.path).toEqual(path);
            expect(decoded?.to).toBe(recipientAddress);
        });


        it('should correctly decode swapExactTokensForTokens', () => {
            const amountIn = BigNumber.from("10000000000000000000"); // 10 DAI
            const amountOutMin = BigNumber.from("9900000"); // 9.9 USDC (6 decimals)
            const path = [DAI_ADDRESS, USDC_ADDRESS];
            const deadline = Math.floor(Date.now() / 1000) + 300;

            const data = uniswapInterface.encodeFunctionData("swapExactTokensForTokens", [
                amountIn,
                amountOutMin,
                path,
                recipientAddress,
                deadline
            ]);
            const mockTransaction = createMockTx(uniswapRouterAddress, data);
            const decoded = decoder.decodeTransaction(mockTransaction);

            expect(decoded).not.toBeNull();
            expect(decoded?.routerName).toBe("UniswapV2Router02");
            expect(decoded?.functionName).toBe("swapExactTokensForTokens");
            expect(decoded?.amountIn?.toString()).toBe(amountIn.toString());
            expect(decoded?.amountOutMin?.toString()).toBe(amountOutMin.toString());
            expect(decoded?.path).toEqual(path);
            expect(decoded?.to).toBe(recipientAddress);
        });

        it('should correctly decode swapExactTokensForTokensSupportingFeeOnTransferTokens', () => {
            const amountIn = BigNumber.from("12000000"); // 12 USDC
            const amountOutMin = BigNumber.from("11000000000000000000"); // 11 DAI
            const path = [USDC_ADDRESS, DAI_ADDRESS];
            const deadline = Math.floor(Date.now() / 1000) + 300;

            const data = uniswapInterface.encodeFunctionData("swapExactTokensForTokensSupportingFeeOnTransferTokens", [
                amountIn,
                amountOutMin,
                path,
                recipientAddress,
                deadline
            ]);
            const mockTransaction = createMockTx(sushiswapRouterAddress, data);
            const decoded = decoder.decodeTransaction(mockTransaction);

            expect(decoded).not.toBeNull();
            expect(decoded?.routerName).toBe("SushiSwapRouter");
            expect(decoded?.functionName).toBe("swapExactTokensForTokensSupportingFeeOnTransferTokens");
            expect(decoded?.amountIn?.toString()).toBe(amountIn.toString());
            expect(decoded?.amountOutMin?.toString()).toBe(amountOutMin.toString());
            expect(decoded?.path).toEqual(path);
            expect(decoded?.to).toBe(recipientAddress);
        });
    });

    describe('Non-target transactions', () => {
        it('should return null for a non-router address', () => {
            const nonRouterAddress = "0x0000000000000000000000000000000000000001";
            const data = uniswapInterface.encodeFunctionData("swapExactETHForTokens", [
                BigNumber.from(1), [WETH_ADDRESS, DAI_ADDRESS], recipientAddress, Math.floor(Date.now() / 1000) + 300
            ]);
            const mockTransaction = createMockTx(nonRouterAddress, data, BigNumber.from(100));
            const decoded = decoder.decodeTransaction(mockTransaction);
            expect(decoded).toBeNull();
        });

        it('should return null for data that does not match any ABI function', () => {
            const mockTransaction = createMockTx(uniswapRouterAddress, "0x12345678"); // Invalid data
            const decoded = decoder.decodeTransaction(mockTransaction);
            expect(decoded).toBeNull();
        });

        it('should return null for a transaction with no data', () => {
            const mockTransaction = createMockTx(uniswapRouterAddress, "0x");
            const decoded = decoder.decodeTransaction(mockTransaction);
            expect(decoded).toBeNull();
        });

        it('should return null for a transaction with no "to" address', () => {
            const mockTransaction = createMockTx(null as any, "0xSomeData");
            const decoded = decoder.decodeTransaction(mockTransaction);
            expect(decoded).toBeNull();
        });

        it('should return null for a non-swap function if not explicitly handled to return data', () => {
            // Example: approve function call to a router (though not typical)
            // Or a different function like 'addLiquidity' which is handled but not a 'swap'
            const data = uniswapInterface.encodeFunctionData("addLiquidity", [
                DAI_ADDRESS,
                USDC_ADDRESS,
                BigNumber.from("100000000000000000000"), // amountADesired
                BigNumber.from("100000000"),             // amountBDesired
                BigNumber.from("99000000000000000000"),  // amountAMin
                BigNumber.from("99000000"),              // amountBMin
                recipientAddress,
                Math.floor(Date.now() / 1000) + 300
            ]);
            const mockTransaction = createMockTx(uniswapRouterAddress, data);
            const decoded = decoder.decodeTransaction(mockTransaction);

            // This test depends on whether addLiquidity is fully decoded for common params.
            // The current extractCommonParams does handle addLiquidity.
            expect(decoded).not.toBeNull();
            expect(decoded?.functionName).toBe("addLiquidity");
            expect(decoded?.routerName).toBe("UniswapV2Router02");
            expect(decoded?.tokenA).toBe(DAI_ADDRESS);
            expect(decoded?.tokenB).toBe(USDC_ADDRESS);
        });
    });
});
