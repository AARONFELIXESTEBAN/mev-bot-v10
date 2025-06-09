# MEV Bot V10 Orchestrator

This service is the core orchestrator for the MEV Bot V10. It connects to the `mempool-ingestion-service`, identifies arbitrage opportunities (currently 2-hop DEX arbitrage for Phase 1 MVP), simulates their profitability, and (for Phase 1) executes paper trades, logging results to Firestore.

## Features (Phase 1 MVP)

*   Connects to the `mempool-ingestion-service` publisher.
*   Processes incoming mempool transactions to identify potential 2-hop DEX arbitrage opportunities.
*   Uses `PriceService` to fetch current DEX pool reserves.
*   Uses `SimulationService` to simulate identified opportunities, calculating potential P&L considering gas costs.
*   Applies various checks (freshness, block age, profit realism).
*   Executes paper trades for profitable opportunities using `DexArbitrageStrategy`.
*   Logs paper trades and discarded opportunities to Google Cloud Firestore.
*   Configurable via `.env` and `config.yaml` files.

## Prerequisites

*   Node.js (LTS version, refer to root `ENVIRONMENT_SETUP_GUIDE.md`)
*   npm
*   Access to a Firestore instance (live or emulator).
*   Access to an Ethereum mainnet RPC provider (for price/gas data).
*   The `mempool-ingestion-service` should be running and publishing data.

## Setup

1.  **Clone the repository** (if you haven't already). This service is part of the `mev-bot-v10` monorepo.
2.  **Navigate to this service directory:** `cd mev-bot-v10`
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Configure Environment:**
    *   Copy `.env.example` to `.env`: `cp .env.example .env`
    *   Edit `.env` to set:
        *   `LOG_LEVEL`: (e.g., `info`, `debug`)
        *   `LOCAL_DEV_PRIVATE_KEY`: A placeholder private key for local paper trading runs.
        *   `RPC_URL_MAINNET_HTTP` and `RPC_URL_MAINNET_WSS`: Your Ethereum mainnet RPC URLs.
        *   `GCP_PROJECT_ID`: Your GCP project ID (used for Firestore).
        *   `MEMPOOL_PUBLISHER_URL`: URL of the running `mempool-ingestion-service` (e.g., `ws://localhost:3001`).
        *   `FIRESTORE_EMULATOR_HOST`: (Optional) Set to `localhost:8080` if using the Firestore emulator. Otherwise, ensure ADC or `GOOGLE_APPLICATION_CREDENTIALS` is set up for live Firestore.
    *   Review `config/config.yaml.example` and copy/rename to `config/config.yaml`. Adjust settings like DEX addresses, token lists, paper trading portfolio, and simulation parameters as needed.

## Running the Service

Ensure the `mempool-ingestion-service` is running first, and the Firestore emulator (or live Firestore) is accessible.

1.  **Build TypeScript:**
    ```bash
    npm run build
    ```
2.  **Start the service:**
    ```bash
    npm start
    ```
    The service will attempt to connect to the mempool publisher and begin processing opportunities.

## Development

*   Run in development mode (with auto-restarting on file changes):
    ```bash
    npm run dev
    ```
*   Run linters/formatters:
    ```bash
    npm run lint
    npm run format
    ```
*   Run tests:
    ```bash
    npm run test
    ```

Refer to `LOCAL_DRY_RUN_GUIDE.md` in the repository root for instructions on running an end-to-end local test with both services and the Firestore emulator.
