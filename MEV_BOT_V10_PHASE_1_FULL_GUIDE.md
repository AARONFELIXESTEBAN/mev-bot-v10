# MEV Bot V10 - Phase 1: Full Implementation, Setup, and Deployment Guide

## Overview

This document provides a comprehensive guide for the development, setup, implementation, and deployment of the MEV Bot V10 - Phase 1. It consolidates information on environment setup, specific service implementations (Mempool Ingestion, Core Bot Services, Opportunity Identification & Simulation for Mempool-driven 2-hop DEX Arbitrage), local dry run procedures, and deployment to Google Compute Engine (GCE).

This guide is intended for developers, DevOps engineers, and anyone involved in building, deploying, or maintaining the MEV Bot V10. The primary services (`mempool-ingestion-service` and `mev-bot-v10`) are developed in Node.js and TypeScript.

## Table of Contents

1.  [**Part 1: Environment Setup Guide**](#part-1-environment-setup-guide)
2.  [**Part 2: Service Implementation Guides (MVP)**](#part-2-service-implementation-guides-mvp)
    *   [2.1. Mempool Ingestion Service (`mempool-ingestion-service`)](#21-mempool-ingestion-service-mempool-ingestion-service)
    *   [2.2. Core Bot Services (`mev-bot-v10`)](#22-core-bot-services-mev-bot-v10)
    *   [2.3. Mempool-Driven DEX Arbitrage Strategy (`mev-bot-v10`)](#23-mempool-driven-dex-arbitrage-strategy-mev-bot-v10)
3.  [**Part 3: Integration & End-to-End Local Dry Run Testing**](#part-3-integration--end-to-end-local-dry-run-testing)
4.  [**Part 4: Deployment Guide (GCE)**](#part-4-deployment-guide-gce)
5.  [**Conclusion**](#conclusion)

---

## Part 1: Environment Setup Guide

*(Content transcluded from `ENVIRONMENT_SETUP_GUIDE.md` - Refer to that file in the repository root for the most up-to-date environment setup instructions, including Node.js/TypeScript setup, Git, Google Cloud SDK, and other common configurations.)*

---

## Part 2: Service Implementation Guides (MVP)

This section details the implementation of the core services for the Phase 1 MVP, focusing on Node.js/TypeScript.

### 2.1. Mempool Ingestion Service (`mempool-ingestion-service`)

#### 2.1.1. Introduction
The Mempool Ingestion Service connects to an Ethereum mempool stream (via a WebSocket RPC provider), fetches details for pending transactions, filters them based on interactions with known DEX routers, decodes common swap functions, and then publishes these processed transactions via a local WebSocket server. This output is consumed by the `mev-bot-v10` orchestrator.

#### 2.1.2. Project Structure (Node.js/TypeScript)
Located in the `mempool-ingestion-service/` directory. Key components include:
```
mempool-ingestion-service/
├── src/
│   ├── connectors/websocketConnector.ts  # Manages WebSocket connection to mempool
│   ├── services/
│   │   ├── transactionFetcher.ts   # Fetches full tx details
│   │   ├── transactionDecoder.ts   # Decodes swap functions
│   │   ├── filter.ts               # Filters relevant transactions
│   │   └── publisher.ts            # WebSocket server to publish data
│   ├── utils/
│   │   ├── config.ts               # Configuration loading
│   │   └── logger.ts               # Logging utility
│   ├── main.ts                     # Service entry point
├── config/
│   └── config.yaml.example         # Example YAML configuration
├── .env.example                    # Example environment variables
└── package.json
```

#### 2.1.3. Core Logic (Phase 1 MVP)
1.  **Initialization**: Loads configuration from `.env` and `config/config.yaml`. Sets up logging.
2.  **Mempool Connection**: `WebsocketConnector` establishes and maintains a persistent WebSocket connection to the configured Ethereum RPC endpoint (e.g., Alchemy, Infura). Handles reconnections.
3.  **Transaction Hash Ingestion**: Receives pending transaction hashes from the mempool stream.
4.  **Transaction Fetching**: `TransactionFetcher` retrieves the full transaction details for each hash using an Ethereum RPC provider.
5.  **Filtering**: `FilterService` checks if the transaction is directed to a known DEX router address (configured in `config.knownRouters`).
6.  **Decoding**: `TransactionDecoder` attempts to decode the transaction data if it targets a known router, identifying common swap functions and their parameters.
7.  **Publishing**: `PublisherService` starts a local WebSocket server on a configured port. Processed transactions (either raw or decoded) are published on this server for the `mev-bot-v10` service to consume.

#### 2.1.4. Configuration
*   Uses `.env` for sensitive/environment-specific values (RPC URLs, ports). See `.env.example`.
*   Uses `config/config.yaml` for other parameters (log levels, default router addresses if not in ENV). See `config.yaml.example`.
*   Key configurations: `MEMPOOL_WS_URL`, `PUBLISHER_PORT`, `MEMPOOL_KNOWN_ROUTER_ADDRESSES_CSV`.

#### 2.1.5. Data Flow
Mempool (External RPC) -> `WebsocketConnector` -> `TransactionFetcher` -> `FilterService` -> `TransactionDecoder` -> `PublisherService` -> `mev-bot-v10` (via WebSocket client).

### 2.2. Core Bot Services (`mev-bot-v10`)

These foundational services are part of the `mev-bot-v10` application.

#### 2.2.1. Configuration Service (`src/core/config/configService.ts`)
*   Loads configuration from `config/config.yaml` (falling back to `config.yaml.example`) and overrides with environment variables defined in `.env`.
*   Provides methods like `get()` and `getOrThrow()` for type-safe access to configuration values.

#### 2.2.2. Logger Service (`src/core/logger/loggerService.ts`)
*   Provides a standardized Pino logger instance for consistent logging across the application.
*   Configurable log level via environment or YAML. Outputs structured JSON logs.

#### 2.2.3. RPC Service (`src/core/rpc/rpcService.ts`)
*   Manages connections to Ethereum RPC endpoints (HTTP and WSS) for various networks.
*   Used for fetching on-chain data like gas prices, block numbers, and contract states.

#### 2.2.4. Smart Contract Interaction Service (`src/core/smartContract/smartContractService.ts`)
*   Provides utilities for interacting with smart contracts (e.g., reading data, calling view/pure functions).
*   Used by other services to query DEX pair contracts (`getReserves`, `token0`, `token1`), factory contracts (`getPair`), and ERC20 token contracts (symbol, decimals, name).

#### 2.2.5. Data Collection Service (`src/core/dataCollection/firestoreService.ts`) - Firestore Focus
*   Provides an interface for other services to log data to Google Cloud Firestore.
*   Connects to live Firestore or the Firestore emulator (if `FIRESTORE_EMULATOR_HOST` is set).
*   Key method: `logData(data, subCollectionName, documentId)` stores provided data objects into specified collections.
*   Used for logging paper trades, discarded opportunities, and potentially other operational data.

#### 2.2.6. KMS Signing Service (`src/core/kms/kmsService.ts`)
*   Manages interaction with Google Cloud Key Management Service for signing transactions.
*   **Note:** For Phase 1 MVP (paper trading), this service is initialized but not actively used for on-chain signing. A placeholder private key (`LOCAL_DEV_PRIVATE_KEY`) is used for local identity if needed, but no real signing occurs.

### 2.3. Mempool-Driven DEX Arbitrage Strategy (`mev-bot-v10`)

This describes the services within `mev-bot-v10` that implement the 2-hop DEX arbitrage strategy.

#### 2.3.1. Price Service (`src/services/price/priceService.ts`)
*   Responsible for fetching and providing reserve data for DEX liquidity pools.
*   Key methods:
    *   `getReservesByPairAddress(pairAddress, network)`: Fetches current reserves (`reserve0`, `reserve1`) and token addresses for a given UniswapV2-like pair.
    *   `calculateAmountOut(...)`: Calculates the expected output amount for a swap given input amount and reserves (ignores fees for raw price calculation).
    *   `getUsdPrice(tokenSymbol)`: Provides USD price for tokens (e.g., WETH for P&L conversion).

#### 2.3.2. Opportunity Identification Service (`src/services/opportunity/opportunityService.ts`)
*   Identifies potential 2-hop arbitrage opportunities based on incoming mempool transactions.
*   Receives a `ProcessedMempoolTransaction` (representing the first leg of a potential arbitrage).
*   **Logic:**
    1.  Validates the first leg (e.g., input token is base token like WETH).
    2.  Uses `PriceService.getReservesByPairAddress()` to get fresh reserves for the first leg's pool.
    3.  Iterates through configured DEXs to find a second leg swapping the intermediate token from leg 1 back to the base token.
    4.  Uses `SmartContractInteractionService.getPairAddress()` (via its internal helper) with DEX factory addresses to find the pair address for the second leg.
    5.  Uses `PriceService.getReservesByPairAddress()` for the second leg's pool.
    6.  Constructs `PotentialOpportunity` objects containing `PathSegment` details for both legs if valid pools with reserves are found.

#### 2.3.3. Simulation Service (`src/services/simulation/simulationService.ts`)
*   Takes a `PotentialOpportunity` object.
*   Simulates the arbitrage path using `getAmountsOut` calls on the respective DEX router contracts (via `SmartContractInteractionService`). This fetches the most current on-chain reserves for the simulation.
*   Estimates gas costs for the two swaps using current gas prices from `RpcService` and configured gas units.
*   Calculates net profit/loss in the base token and USD (using `PriceService`).
*   Performs checks: opportunity freshness, block age of triggering transaction, profit realism (to filter out impossibly high profits).
*   Returns a `SimulationResult` object.

#### 2.3.4. Dex Arbitrage Strategy & Paper Trading (`src/strategies/dexArbitrageStrategy.ts`)
*   Receives `SimulationResult`.
*   If a simulation is profitable and passes all checks:
    *   Updates an in-memory virtual portfolio with the paper trade's P&L.
    *   Logs the paper trade details (path, amounts, simulated profit, gas costs) to Firestore via `DataCollectionService`.

---

## Part 3: Integration & End-to-End Local Dry Run Testing

For detailed step-by-step instructions on running a local end-to-end dry run, please refer to `LOCAL_DRY_RUN_GUIDE.md` in the repository root. This section provides a higher-level overview.

The local dry run involves running the `mempool-ingestion-service` and the `mev-bot-v10` orchestrator locally, using the Firestore emulator, and connecting to a live Ethereum mempool via a third-party RPC provider. No real funds are used as trading is paper-based.

### Key Components in Dry Run:
*   **Firestore Emulator:** Simulates Firestore for data logging.
*   **Mempool Ingestion Service:** Connects to live mempool, processes transactions, and publishes them locally.
*   **MEV Bot V10 Orchestrator (`src/main.ts` and `src/core/MevBotV10Orchestrator.ts`):**
    *   Initializes all services (Config, Logger, RPC, SC Interaction, Data Collection, Price, Opportunity ID, Simulation, Dex Strategy).
    *   Connects to the Mempool Ingestion Service's publisher.
    *   Listens for new transactions.
    *   Passes transactions to `OpportunityIdentificationService`.
    *   Passes identified opportunities to `SimulationService`.
    *   If simulation is profitable, passes the result to `DexArbitrageStrategy` for paper trading and logging.
    *   Logs discarded opportunities if configured.

Refer to `LOCAL_DRY_RUN_GUIDE.md` for verification steps, including monitoring logs and checking Firestore data.

---

## Part 4: Deployment Guide (GCE)

This section outlines deploying the Node.js-based services (`mempool-ingestion-service` and `mev-bot-v10`) to Google Compute Engine (GCE) VMs using PM2.

### 4.1. Prerequisites
*   GCE instances provisioned and configured as per `ENVIRONMENT_SETUP_GUIDE.md` (Node.js, npm, PM2 installed).
*   Git repository accessible from the VMs.
*   GCP IAM permissions set up for Firestore, KMS (if used in future), Secret Manager (if used), and Cloud Logging.
*   Completed service configurations (production `.env` files, `config.yaml`).

### 4.2. General Deployment Steps (for each service on its respective VM)

1.  **Connect to VM:** `gcloud compute ssh <your-vm-name> --zone=<your-zone>`
2.  **Clone/Update Code:**
    ```bash
    export DEPLOY_DIR="/opt/app/mempool-ingestion" # or /opt/app/mev-bot-v10
    sudo mkdir -p $DEPLOY_DIR && sudo chown $USER:$USER $DEPLOY_DIR
    cd $DEPLOY_DIR
    git clone <your-repository-url> . # Or git pull if updating
    ```
3.  **Install Dependencies:**
    ```bash
    npm install --production # Install only production dependencies
    ```
4.  **Build TypeScript:**
    ```bash
    npm run build
    ```
5.  **Configure Environment:**
    *   Create a production `.env` file in the service directory. Populate with production RPC URLs, API keys, GCP project ID, Firestore collection names, etc.
    *   Ensure `config/config.yaml` contains production-ready settings if not fully covered by `.env`.
    *   For `mev-bot-v10`, ensure `GOOGLE_APPLICATION_CREDENTIALS` is set if not relying on the GCE VM's default service account with sufficient permissions for Firestore/KMS.
6.  **PM2 Ecosystem File (`ecosystem.config.js`):**
    Create an `ecosystem.config.js` in the root of each service directory.

    **Example for `mempool-ingestion-service`:**
    ```javascript
    // /opt/app/mempool-ingestion/ecosystem.config.js
    module.exports = {
      apps : [{
        name   : "mempool-ingestion-svc",
        script : "dist/main.js", // Entry point after build
        cwd    : __dirname,
        env_production: {
          "NODE_ENV": "production",
        },
        autorestart: true,
        watch  : false,
        max_memory_restart: '1G', // Adjust as needed
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        combine_logs: true,
      }]
    }
    ```
    **Example for `mev-bot-v10`:**
    ```javascript
    // /opt/app/mev-bot-v10/ecosystem.config.js
    module.exports = {
      apps : [{
        name   : "mev-bot-v10-orchestrator",
        script : "dist/main.js", // Entry point after build
        cwd    : __dirname,
        node_args: "--max-old-space-size=2048", // Optional: increase heap memory
        env_production: {
          "NODE_ENV": "production",
        },
        autorestart: true,
        watch  : false,
        max_memory_restart: '2G', // Adjust as needed
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        combine_logs: true,
      }]
    }
    ```
7.  **Start Services with PM2:**
    ```bash
    cd $DEPLOY_DIR
    pm2 start ecosystem.config.js
    pm2 save # Save current process list to resurrect on reboot
    pm2 startup # To generate and configure startup script for system reboot
    ```
8.  **Verify:**
    ```bash
    pm2 list
    pm2 logs <app-name>
    ```
    Check application-specific logs and functionality (e.g., data appearing in Firestore for `mev-bot-v10`).

### 4.3. Post-Deployment & Maintenance
*   **Logging:** Monitor logs via `pm2 logs` or preferably through integrated Google Cloud Logging.
*   **Monitoring:** Set up Cloud Monitoring dashboards and alerts for VM health, CPU/memory usage, and key application metrics derived from logs.
*   **Updates:** `git pull`, `npm install --production`, `npm run build`, `pm2 restart <app-name>`.

---

## Conclusion

This guide provides a blueprint for developing, testing, and deploying Phase 1 of the MEV Bot V10. By focusing on a mempool-driven 2-hop DEX arbitrage strategy with paper trading, this phase establishes a solid foundation for future expansion. The use of Node.js/TypeScript for the core services, coupled with detailed local dry run procedures and a clear GCE deployment plan, aims for a robust and maintainable system.
```
