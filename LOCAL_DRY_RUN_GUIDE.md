# Local Dry Run Guide - MEV Bot V10 (Phase 1 MVP)

This guide provides instructions for setting up and running the Phase 1 End-to-End (E2E) local dry run for the MEV Bot V10. This setup will use live mempool data from a third-party RPC provider for opportunity identification and simulation, but will only perform paper trading (no real funds involved).

## Prerequisites

1.  **Environment Setup:** Ensure you have completed the common environment setup as per `ENVIRONMENT_SETUP_GUIDE.md`, including Node.js, npm, TypeScript, and Git.
2.  **Google Cloud SDK:** Installed and initialized (`gcloud init`).
3.  **Firestore Emulator:** Install the Firestore emulator:
    ```bash
    gcloud components install cloud-firestore-emulator
    ```
4.  **Third-Party RPC URL:** You will need a WebSocket RPC URL for Ethereum mainnet from a provider like Alchemy or Infura.

## Configuration

1.  **`mempool-ingestion-service` Configuration:**
    *   Navigate to the `mempool-ingestion-service` directory.
    *   Copy `.env.example` to `.env`: `cp .env.example .env`
    *   Edit `.env` and set:
        *   `LOG_LEVEL`: `info` or `debug` for detailed output.
        *   `MEMPOOL_WS_URL`: Your Ethereum mainnet WebSocket RPC URL.
        *   `PUBLISHER_PORT`: Ensure this matches `MEMPOOL_PUBLISHER_URL` in the `mev-bot-v10`'s `.env` file (default is `3001`).
        *   Comment out or ensure Firestore related variables are correctly set if you want the mempool service itself to also log to Firestore (optional for this dry run's primary path).

2.  **`mev-bot-v10` Configuration:**
    *   Navigate to the `mev-bot-v10` directory.
    *   Copy `.env.example` to `.env`: `cp .env.example .env`
    *   Edit `.env` and set:
        *   `LOG_LEVEL`: `info` or `debug`.
        *   `LOCAL_DEV_PRIVATE_KEY`: Can be any valid private key format; it's not used for on-chain signing in paper trading mode.
        *   `RPC_URL_MAINNET_HTTP` and `RPC_URL_MAINNET_WSS`: Your Ethereum mainnet HTTP and WebSocket RPC URLs. These are used by the bot's RPC service for things like getting gas prices, token details, and simulating swaps via `getAmountsOut`.
        *   `GCP_PROJECT_ID`: Set this to a valid GCP project ID (even for emulator, some client libraries expect it).
        *   `MEMPOOL_PUBLISHER_URL`: Should be `ws://localhost:3001` (or the port configured in `mempool-ingestion-service`).
        *   `FIRESTORE_EMULATOR_HOST`: Set to `localhost:8080` (default Firestore emulator port).

    *   Review `config/config.yaml` (or create it from `config.yaml.example`):
        *   Ensure `opportunity_service.base_token_address` (WETH) and `opportunity_service.core_whitelisted_tokens_csv` (e.g., USDC, DAI) are correctly set for mainnet.
        *   Ensure `opportunity_service.known_dex_pools_config`, `dex_factories`, and `dex_routers` point to correct mainnet UniswapV2 and Sushiswap addresses.
        *   Verify `paper_trading_config.enabled: true`.
        *   Verify `paper_trading_config.initial_portfolio` is set up with base token (WETH) and potentially some stablecoins.
        *   Verify `execution_config.enabled: false`.

## Running the Local Stack

You will need two separate terminal windows.

1.  **Terminal 1: Start Firestore Emulator**
    ```bash
    gcloud emulators firestore start --host-port="localhost:8080"
    ```
    Keep this terminal running. Note the `FIRESTORE_EMULATOR_HOST` it outputs, ensure it matches your `.env` config for `mev-bot-v10`.

2.  **Terminal 2: Start Mempool Ingestion Service**
    *   Navigate to the `mempool-ingestion-service` directory.
    *   Install dependencies: `npm install`
    *   Build the service: `npm run build`
    *   Start the service: `npm start`
    *   You should see logs indicating it's connecting to the mempool WebSocket and attempting to publish transactions.

3.  **Terminal 3: Start MEV Bot V10 Orchestrator**
    *   Navigate to the `mev-bot-v10` directory.
    *   Install dependencies: `npm install`
    *   Build the service: `npm run build`
    *   Start the service: `npm start`
    *   You should see logs indicating it's initializing services and connecting to the mempool ingestion publisher.

## Testing and Verification

Once both services are running and connected:

**Test Scenario 1: Successful Paper Trade**
1.  **Monitor Logs:**
    *   In the `mempool-ingestion-service` terminal, look for logs of transactions being published, especially those involving known routers and swap functions.
    *   In the `mev-bot-v10` terminal, look for:
        *   Messages about receiving transactions from the mempool service.
        *   Logs from `OpportunityIdentificationService` indicating potential 2-hop opportunities found.
        *   Logs from `SimulationService` showing simulation results (gross profit, gas costs, net profit).
        *   Crucially, logs indicating a "Profitable opportunity identified and passed all checks!"
        *   Logs from `DexArbitrageStrategy` (Paper Trading) like "Paper trading mode: Logging paper trade." or "Strategy: Paper trade executed."
2.  **Check Firestore Emulator Data:**
    *   The Firestore emulator usually has a web UI, typically at `http://localhost:4000/firestore` (check emulator startup logs for UI address if different).
    *   Navigate to the collection specified in `mev-bot-v10/config/config.yaml` for `paper_trading_config.firestore_collection_paper_trades` (e.g., `paper_trades_v10_dex_arb`), prefixed by the `firestore_config.main_collection_v10` (e.g. `mevBotV10Data/paper_trades_v10_dex_arb`).
    *   Look for new documents representing successful paper trades. Verify the schema and data (path, amounts, profit, etc.).
3.  **Virtual Portfolio (Conceptual):**
    *   The `DexArbitrageStrategy` updates an in-memory portfolio. For Phase 1, observing successful trade logging in Firestore is the primary verification. P&L can be calculated from these logged trades.

**Test Scenario 2: Opportunity Discarded**
1.  **Monitor Logs (`mev-bot-v10` terminal):**
    *   Look for logs like "Opportunity discarded. Reason: [specific reason]". Reasons could include:
        *   "Not profitable after simulation"
        *   "Net profit USD ... is less than min threshold ..."
        *   "Freshness check failed"
        *   "Profit realism check failed"
        *   "SimulationService: Opportunity failed ..." (various specific check failures from simulation)
2.  **Check Firestore Emulator Data (Optional):**
    *   If `data_collection.log_discarded_opportunities` is true in `mev-bot-v10/config/config.yaml`, check the `discarded_opportunities_v10` subcollection (under the main collection) in the Firestore emulator for records of these discards.

**Stability**
*   Let the integrated system run for at least 1-2 hours.
*   Monitor both service terminals for any crashes, unhandled errors, or excessive memory consumption (using system monitoring tools).
*   Check if connections (to RPC, to mempool publisher) are maintained or re-established correctly after any transient issues.

## Troubleshooting Tips

*   **Check Ports:** Ensure `PUBLISHER_PORT` in `mempool-ingestion-service` matches the port in `MEMPOOL_PUBLISHER_URL` in `mev-bot-v10`. Ensure `FIRESTORE_EMULATOR_HOST` is consistent.
*   **API Keys:** Double-check your third-party RPC API keys in the respective `.env` files.
*   **Log Levels:** Set `LOG_LEVEL=debug` in `.env` files for more detailed output if you're not seeing expected activity.
*   **Firewall:** Ensure no local firewall is blocking connections between the services or to the emulator.
*   **Dependencies:** Ensure `npm install` was successful in both service directories.
*   **Build Step:** Ensure `npm run build` completed without errors in both service directories.
*   **GCP Project ID:** Ensure `GCP_PROJECT_ID` in `mev-bot-v10/.env` is set, even if just to a dummy/test project ID when using the emulator, as some Google client libraries might require it for initialization before they detect the emulator host.
```
