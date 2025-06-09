import { FilterService, FilterableTransaction } from './filter';
import config from '../utils/config'; // Import the actual config
import { BigNumber, ethers } from 'ethers'; // For TransactionResponse type

// Mock the config module
jest.mock('../utils/config', () => ({
    __esModule: true, // This is important for ES modules
    default: {
        // Initialize with some default mock values
        // These can be overridden in tests if needed by re-mocking or using jest.spyOn
        knownRouters: [
            "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".toLowerCase(), // UniswapV2Router02
            "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F".toLowerCase(), // SushiSwapRouter
        ],
        logLevel: 'info', // Add any other properties that might be accessed
        // during FilterService initialization or usage, if any.
    },
}));


describe('FilterService', () => {
    const knownRouter1 = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // UniswapV2
    const knownRouter2 = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"; // SushiSwap
    const unknownRouter = "0x1234567890123456789012345678901234567890";

    // Helper to create a mock FilterableTransaction
    // Only 'to' and 'hash' are strictly needed for isTransactionToKnownRouter
    const createMockFilterableTx = (toAddress: string | null): FilterableTransaction => {
        return {
            to: toAddress,
            hash: "0xmockTxHashForFilterTest",
            // Fill in other required fields for ethers.providers.TransactionResponse
            // if they were accessed by the methods under test, but for isTransactionToKnownRouter,
            // only 'to' is essential.
            from: "0xMockFromAddress",
            nonce: 1,
            gasLimit: BigNumber.from("21000"),
            gasPrice: BigNumber.from("10000000000"), // 10 Gwei
            data: "0x",
            value: BigNumber.from(0),
            chainId: 1,
            confirmations: 0,
            blockHash: null,
            blockNumber: null,
            timestamp: null,
            wait: jest.fn() as jest.MockedFunction<ethers.providers.TransactionResponse['wait']>,
        } as FilterableTransaction;
    };

    describe('isTransactionToKnownRouter', () => {
        beforeEach(() => {
            // Ensure config is freshly mocked for each test if needed,
            // or rely on the global mock and ensure it's set up as expected.
            // For this static method, it directly accesses the imported 'config.knownRouters'.
            // The global jest.mock should cover this.
        });

        it('should return true if transaction.to is a known router address', () => {
            const txToKnownRouter = createMockFilterableTx(knownRouter1);
            expect(FilterService.isTransactionToKnownRouter(txToKnownRouter)).toBe(true);

            const txToAnotherKnownRouter = createMockFilterableTx(knownRouter2);
            expect(FilterService.isTransactionToKnownRouter(txToAnotherKnownRouter)).toBe(true);
        });

        it('should return true if transaction.to is a known router address (case insensitive)', () => {
            const txToKnownRouterUpperCase = createMockFilterableTx(knownRouter1.toUpperCase());
            // config.knownRouters are stored in lowercase, so this test depends on the implementation
            // of isTransactionToKnownRouter doing a lowercase comparison for tx.to.
            // The implementation `config.knownRouters.includes(transaction.to.toLowerCase())` handles this.
            expect(FilterService.isTransactionToKnownRouter(txToKnownRouterUpperCase)).toBe(true);
        });

        it('should return false if transaction.to is not a known router address', () => {
            const txToUnknownRouter = createMockFilterableTx(unknownRouter);
            expect(FilterService.isTransactionToKnownRouter(txToUnknownRouter)).toBe(false);
        });

        it('should return false if transaction.to is null or undefined', () => {
            const txWithNullTo = createMockFilterableTx(null);
            expect(FilterService.isTransactionToKnownRouter(txWithNullTo)).toBe(false);

            const txWithUndefinedTo = { ...createMockFilterableTx("someAddress"), to: undefined } as FilterableTransaction;
            expect(FilterService.isTransactionToKnownRouter(txWithUndefinedTo)).toBe(false);
        });

        it('should use the knownRouters from the mocked config', () => {
            // This test confirms that the mock is effective.
            const txToKnownRouter1 = createMockFilterableTx(knownRouter1);
            expect(config.knownRouters).toContain(knownRouter1.toLowerCase());
            expect(FilterService.isTransactionToKnownRouter(txToKnownRouter1)).toBe(true);

            const txToUnknown = createMockFilterableTx(unknownRouter);
            expect(config.knownRouters).not.toContain(unknownRouter.toLowerCase());
            expect(FilterService.isTransactionToKnownRouter(txToUnknown)).toBe(false);
        });
    });

    // Test for passesComplexFilter could be added here if its logic were defined
    // For now, it's a placeholder as per the current implementation.
    describe('passesComplexFilter', () => {
        it('should return true by default if no specific complex logic is implemented', () => {
            const mockTx: FilterableTransaction = {
                ...createMockFilterableTx(knownRouter1),
                decodedInput: { // Needs decodedInput to pass the initial check
                    functionName: "anyFunction",
                    signature: "any()",
                    args: [],
                    routerName: "AnyRouter"
                }
            };
            expect(FilterService.passesComplexFilter(mockTx)).toBe(true);
        });

        it('should log a warning and return false if decodedInput is missing', () => {
            const loggerWarnSpy = jest.spyOn(require('../utils/logger').default, 'warn');
            const mockTx: FilterableTransaction = createMockFilterableTx(knownRouter1);
            // Ensure decodedInput is undefined
            mockTx.decodedInput = undefined;

            expect(FilterService.passesComplexFilter(mockTx)).toBe(false);
            expect(loggerWarnSpy).toHaveBeenCalledWith(
                { txHash: mockTx.hash },
                "Complex filter called without decoded input."
            );
            loggerWarnSpy.mockRestore();
        });
    });
});
