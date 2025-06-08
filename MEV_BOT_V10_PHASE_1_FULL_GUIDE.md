# MEV Bot V10 - Phase 1: Full Implementation, Setup, and Deployment Guide

## Overview

This document provides a comprehensive guide for the development, setup, implementation, and deployment of the MEV Bot V10 - Phase 1. It consolidates individual guides covering environment setup, specific service implementations (Mempool Ingestion, Core Bot Services, Opportunity Identification & Simulation for Mempool-driven 2-hop DEX Arbitrage), and deployment to Google Compute Engine (GCE).

This guide is intended for developers, DevOps engineers, and anyone involved in building, deploying, or maintaining the MEV Bot V10.

## Table of Contents

1.  [**Part 1: Environment Setup Guide**](#part-1-environment-setup-guide)
    *   [1.1. Windows Setup](#11-windows-setup)
    *   [1.2. GCP GCE Setup](#12-gcp-gce-setup)
    *   [1.3. Common Configuration](#13-common-configuration)
2.  [**Part 2: Service Implementation Guides (MVP)**](#part-2-service-implementation-guides-mvp)
    *   [2.1. Mempool Ingestion Service](#21-mempool-ingestion-service)
        *   (Focus on Streaming Output)
    *   [2.2. Core Bot Services](#22-core-bot-services)
        *   (DataCollectionService using Firestore)
    *   [2.3. Mempool-Driven DEX Arbitrage & Simulation Service](#23-mempool-driven-dex-arbitrage--simulation-service)
        *   (Focus on 2-hop DEX Arbitrage)
3.  [**Part 3: Integration & End-to-End "Dry Run" Testing (Mempool DEX Arbitrage MVP)**](#part-3-integration--end-to-end-dry-run-testing-mempool-dex-arbitrage-mvp)
    *   [3.1. System Architecture for Dry Run](#31-system-architecture-for-dry-run)
    *   [3.2. Trading Orchestrator: `MevBot_V10.ts`](#32-trading-orchestrator-mevbotv10ts)
    *   [3.3. Integration of Phase 1 Services](#33-integration-of-phase-1-services)
    *   [3.4. End-to-End "Dry Run" Workflow (2-hop DEX Paper Trading)](#34-end-to-end-dry-run-workflow-2-hop-dex-paper-trading)
    *   [3.5. Basic Monitoring Setup](#35-basic-monitoring-setup)
    *   [3.6. Testing Strategy for Dry Run](#36-testing-strategy-for-dry-run)
    *   [3.7. Success Criteria for MVP Dry Run](#37-success-criteria-for-mvp-dry-run)
4.  [**Part 4: Deployment Guide (GCE)**](#part-4-deployment-guide-gce)
    *   [4.1. Introduction](#41-introduction)
    *   [4.2. General GCE VM Preparation](#42-general-gce-vm-preparation)
    *   [4.3. Deploying the MempoolIngestionService](#43-deploying-the-mempoolingestionservice)
    *   [4.4. Deploying the MevBot_V10 (Main Bot Orchestrator - Node.js Focus)](#44-deploying-the-mevbotv10-main-bot-orchestrator---nodejs-focus)
    *   [4.5. Post-Deployment & Maintenance](#45-post-deployment--maintenance)
    *   [4.6. Troubleshooting](#46-troubleshooting)
5.  [**Conclusion**](#conclusion)

---

## Part 1: Environment Setup Guide

*(Content from ENVIRONMENT_SETUP_GUIDE.md)*

This guide provides comprehensive instructions for setting up the development environment on both Windows workstations and Google Cloud Platform (GCP) Google Compute Engine (GCE) instances.

### 1.1. Windows Setup

#### 1.1.1. Windows Prerequisites
*   Windows 10 or later (Pro, Enterprise, or Education editions recommended for Hyper-V)
*   Administrator privileges on the Windows machine.
*   Stable internet connection.

#### 1.1.2. Chocolatey Installation
Chocolatey is a package manager for Windows. It simplifies software installation.
1.  **Open PowerShell as Administrator.**
2.  **Run the installation script:**
    ```powershell
    Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    ```
3.  **Verify installation:** `choco -v`

#### 1.1.3. Git Installation
1.  **Install Git using Chocolatey:** `choco install git -y`
2.  **Verify installation:** `git --version`

#### 1.1.4. Python Installation
1.  **Install Python using Chocolatey:** `choco install python --version=PYTHON_VERSION -y` (Replace `PYTHON_VERSION` per SSOT).
2.  **Verify installation:** `python --version`, `pip --version`
3.  **(Optional) Create a Virtual Environment:** `python -m venv .venv`, `.\.venv\Scripts\activate`

#### 1.1.5. IDE Setup (VS Code)
1.  **Install VS Code:** `choco install vscode -y`
2.  **Recommended Extensions:** `Python` (ms-python.python), `Pylance` (ms-python.vscode-pylance), `GitLens` (eamodio.gitlens).

#### 1.1.6. Google Cloud SDK Installation
1.  **Install Google Cloud SDK:** `choco install gcloudsdk -y`
2.  **Initialize SDK:** `gcloud init` (Log in, choose project, configure region/zone).
3.  **Verify:** `gcloud --version`
4.  **Install components:** `gcloud components install gke-gcloud-auth-plugin kubectl`

#### 1.1.7. Windows Project Initialization
1.  **Clone Repository:** `git clone REPOSITORY_URL`, `cd <repository-name>`
2.  **Install Dependencies:** `pip install -r requirements.txt` (if Python project)

### 1.2. GCP GCE Setup

#### 1.2.1. GCP Prerequisites
*   GCP account with billing.
*   Google Cloud SDK installed locally.
*   Project ID, desired region/zone.

#### 1.2.2. GCE Instance Creation
Refer to SSOT for naming, machine type, disk, OS image.
```bash
gcloud compute instances create INSTANCE_NAME \
    --project=PROJECT_ID \
    --zone=ZONE \
    --machine-type=MACHINE_TYPE \
    --image-family=IMAGE_FAMILY \
    --image-project=IMAGE_PROJECT \
    --boot-disk-size=DISK_SIZE \
    --scopes=https://www.googleapis.com/auth/cloud-platform \
    --tags=http-server,https-server # Adjust as needed
```
Firewall Rules (if needed, e.g., for health checks):
```bash
gcloud compute firewall-rules create allow-http --allow=tcp:80 --target-tags=http-server
```

#### 1.2.3. Connecting to GCE Instance
```bash
gcloud compute ssh INSTANCE_NAME --zone=ZONE --project=PROJECT_ID
```

#### 1.2.4. Software Installation on GCE (Debian/Ubuntu example)
1.  **Update Package List:** `sudo apt update && sudo apt upgrade -y`
2.  **Install Git:** `sudo apt install git -y`
3.  **Install Python:** `sudo apt install python3 python3-pip python3-venv -y`
4.  **Install Google Cloud SDK (Optional on GCE):** (Commands from original doc)
5.  **Install other dependencies (e.g., Node.js for MevBot_V10, PM2):**
    ```bash
    # Node.js LTS
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
    # PM2
    sudo npm install pm2 -g
    ```

#### 1.2.5. GCE Project Initialization
1.  **Clone Repository.**
2.  **Create Virtual Environment (Python):** `python3 -m venv .venv`, `source .venv/bin/activate`
3.  **Install Dependencies.**

### 1.3. Common Configuration

Applicable to both Windows and GCE.

#### 1.3.1. Git Configuration
```bash
git config --global user.name "Your Name"
git config --global user.email "youremail@example.com"
```

#### 1.3.2. SSH Key Generation
1.  **Check for existing keys:** `ls ~/.ssh`
2.  **Generate new key (Ed25519 recommended):** `ssh-keygen -t ed25519 -C "youremail@example.com"`
3.  **Add to SSH agent:** `eval $(ssh-agent -s)`, `ssh-add ~/.ssh/id_ed25519`
4.  **Add public key to Git hosting service.**

#### 1.3.3. Environment Variables
*   Refer to SSOT for required variables.
*   Set via shell (`export VAR="value"`, `~/.bashrc`), PowerShell (`$env:VAR="value"`), or `.env` files.
*   Ensure `.env` files are in `.gitignore`.

---

## Part 2: Service Implementation Guides (MVP)

### 2.1. Mempool Ingestion Service

*(Content from IMPLEMENTATION_GUIDE_MEMPOOL_INGESTION_MVP.md, with modifications for streaming emphasis)*

#### 2.1.1. Introduction
The Mempool Ingestion Service connects to blockchain mempools, fetches transaction data, performs minimal transformations, and outputs this data in a **streaming fashion** for near real-time consumption by downstream services like price analysis or opportunity identification. MVP focuses on a single mempool source.

#### 2.1.2. Project Structure (Illustrative Python)
```
mempool_ingestion_service/
├── app/
│   ├── main.py
│   ├── connectors/mempool_websocket.py
│   ├── processing/transformers.py
│   └── output_streams/ # Changed from storage
│       └── stream_forwarder.py # Forwards data to next service/queue
├── config/
│   └── config.yaml.example
├── requirements.txt
└── README.md
```

#### 2.1.3. Key Files and Components
*   **Configuration Files**: `config.yaml`, `.env`.
*   **Main Application Script (`app/main.py`)**: Initializes and coordinates modules, runs the main data fetching and streaming loop.
*   **Mempool Connector Module (`app/connectors/mempool_websocket.py`)**: Connects to mempool (e.g., WebSocket).
*   **Data Processing Module (`app/processing/transformers.py`)**: Minimal transformations (timestamping, basic validation).
*   **Output Streaming Module (`app/output_streams/stream_forwarder.py`)**:
    *   Instead of batching to storage like GCS for this primary path, this module is responsible for immediately forwarding the processed data.
    *   This could be via:
        *   A message queue (e.g., Redis Pub/Sub, Kafka, GCP Pub/Sub - advanced for MVP).
        *   Direct gRPC/HTTP call to the next service (e.g., Price Service or Opportunity Identification Service).
        *   Writing to a fast, shared file stream or named pipe if co-located.
    *   For MVP, if direct calls or complex queues are out of scope, it might write to GCS but in very small, frequent files, with downstream services polling rapidly. **However, the ideal is a push-based or low-latency pull mechanism.** The original guide's GCS approach for archival/batch is secondary to this streaming need. SSOT 2.2.4 mentions "Data Storage/Streaming Interface" - this emphasizes the streaming part.

#### 2.1.4. Core Logic (MVP)
1.  **Initialization**: Load config, setup logging.
2.  **Connecting to Mempool Source**: Persistent WebSocket connection.
3.  **Fetching Mempool Data**: Listen for new transactions.
4.  **Basic Data Transformation**: Timestamp, ensure format.
5.  **Streaming Data Output**:
    *   The `stream_forwarder.py` module immediately sends the transformed data to the next component in the pipeline.
    *   If GCS is used as an intermediary for streaming (less ideal), files must be small and written frequently, with a clear naming convention for polling. Example: `gs://<bucket>/<mempool_stream>/<YYYYMMDDHHMMSS_ms_txid>.json`.
    *   The primary design goal is **low latency** for data availability to the arbitrage detection logic.

#### 2.1.5. Configuration Management
*   Environment Variables (`.env`).
*   `config/config.yaml`:
    ```yaml
    mempool_source:
      url: "wss://your_mempool_ws_url" # Ethereum focused for DEX arb
    output_stream: # New/modified section
      type: "direct_call" # or "redis_pubsub", "gcs_files_stream"
      target_url: "http://localhost:PORT_OF_NEXT_SERVICE/newdata" # if direct_call
      # gcs_bucket_name: "your-mempool-stream-bucket" # if using GCS as stream buffer
    logging:
      level: "INFO"
    ```

#### 2.1.6. Data Flow (MVP)
Mempool Source -> Mempool Connector -> Data Processing -> **Output Streaming (e.g., direct call or fast queue/poll)** -> Next Service (e.g., Opportunity Identifier or Price Updater).

#### 2.1.7. Testing, Deployment, Future Enhancements
(Similar to original guide, but testing should also cover streaming throughput and latency).

### 2.2. Core Bot Services

*(Content from IMPLEMENTATION_GUIDE_CORE_BOT_SERVICES_MVP.md, with DataCollectionService modified for Firestore)*

#### 2.2.1. Introduction
Core Bot Services provide foundational capabilities: Configuration, Logging, RPC, KMS Signing, Data Collection, and Smart Contract Interaction. MVP focuses on robust, secure, configurable versions.

#### 2.2.2. Overall Architecture & Project Structure
(As per original guide - diagram showing interaction, illustrative Python monorepo structure)

#### 2.2.3. Common Components
*   **Configuration Service (SSOT 5.4)**: Centralized config loading (YAML, .env).
*   **Logger Service (SSOT 2.10)**: Standardized logging (Python `logging`, console, Cloud Logging).

#### 2.2.4. RPC Service (SSOT 2.7)
*   Abstracts Ethereum RPC connections (`web3.py`).
*   MVP: Read-only calls, error handling, multi-network config.

#### 2.2.5. KMS Signing Service (SSOT 2.8)
*   Secure transaction signing via GCP KMS (`google-cloud-kms`).
*   MVP: Sign Ethereum tx, get address from KMS key. Config via SSOT 6.1.

#### 2.2.6. Data Collection Service v1 (SSOT 2.9) - Firestore Focus
*   **Purpose**: To collect and store structured data generated or observed by bots (e.g., trades, significant logs, portfolio snapshots).
*   **Key Functionality (MVP - SSOT 9.2.2)**:
    *   Provide a simple interface for other services to submit data (Python dictionaries/objects).
    *   Store this data into designated **Cloud Firestore collections**.
    *   Data structured with clear document IDs and fields.
*   **Implementation (`services/data_collection_service/collector.py`)**:
    *   Uses `google-cloud-firestore` library.
    *   `DataCollector` class initialized with Firestore client (project should be picked up by ADC or config).
    *   Method `store_data(collection_name: str, document_id: str, data_payload: dict, sub_collections: list = None)`:
        *   `collection_name`: e.g., "paper_trades", "error_logs", "portfolio_snapshots".
        *   `document_id`: A unique ID for the record (e.g., transaction hash, timestamp-based UUID).
        *   `data_payload`: The dictionary data to store.
        *   `sub_collections`: Optional list of tuples like `(sub_collection_name, sub_doc_id, sub_data_payload)` for nested data.
        *   Writes data: `db.collection(collection_name).document(document_id).set(data_payload)`.
*   **Data Storage (MVP - SSOT 2.9.4 Database)**:
    *   Data stored in Firestore. Documents represent individual records.
    *   Allows for some querying capabilities, which is an advantage over plain GCS JSON files for this type of data.
*   **Configuration (`configs/global_config.yaml`)**:
    ```yaml
    data_collection:
      type: "firestore"
      # project_id: "your-gcp-project-id" # Optional if same as GCE instance project
      # database_id: "(default)" # Optional
    ```
*   **IAM Permissions**: Ensure the service account for the bot has `roles/datastore.user` for Firestore access.

#### 2.2.7. Smart Contract Interaction Service (SSOT 2.12)
*   Abstracts read-only smart contract calls (`web3.py`).
*   MVP: Load ABIs, call view/pure functions.

#### 2.2.8. Testing & Deployment Considerations
(As per original guide, but Data Collection tests target Firestore mocks/emulator).

### 2.3. Mempool-Driven DEX Arbitrage & Simulation Service

*(Rewritten from IMPLEMENTATION_GUIDE_OPPORTUNITY_SIMULATION_MVP.md to focus on 2-hop DEX Arbitrage, driven by mempool insights)*

#### 2.3.1. Introduction
This service identifies and simulates **mempool-driven 2-hop (or triangular) DEX arbitrage opportunities**. It relies on near real-time price information, potentially derived from mempool activity (via Mempool Ingestion Service and Price Service) or very frequent DEX pool polling. The MVP focuses on a specific, predefined 2-hop arbitrage path.

*   **SSOT 9.2.3 (MVP Features)**: Focus on one simple DEX arbitrage type (e.g., TokenA -> TokenB on DEX1, then TokenB -> TokenA on DEX2, or WETH -> TokenX -> WETH' across two DEXs or a triangular WETH -> TKN1 -> TKN2 -> WETH path).

#### 2.3.2. Overall Architecture (MVP Interaction)
```
+---------------------------+      +---------------------------------+
| Mempool Ingestion Svc     |----->| Price Service (v1)              |
| (provides raw mempool txs |      | (SSOT 2.3)                      |
|  or events for DEX state  |      | - Derives DEX prices from       |
|  changes)                 |      |   mempool or direct queries     |
+---------------------------+      +-------------+-------------------+
                                                 | (DEX Price Feeds/Updates)
                                                 v
+--------------------------------+<----+-----------------------------+
| Core Bot Services              |     | Opportunity Identification  |
| - RPC Service (for DEX queries)|     | Service (v1) (SSOT 2.5)     |
| - Logger, Config               |     | - Identifies 2-hop DEX arb  |
+--------------------------------+     +-------------+---------------+
                                                       | (Potential Opportunity)
                                                       v
+----------------------------+       +-----------------------------+
| Paper Trading Module (v1)  |<------| Simulation Service (v1)     |
| (within Trading Orchestrator|       | (SSOT 8.3)                  |
|  SSOT 2.11)                |       | - Simulates 2 DEX swaps     |
+----------------------------+       +-----------------------------+
```

#### 2.3.3. Price Service (v1 - SSOT 2.3 - DEX Focus)
*   **Purpose**: Provide timely DEX prices, especially reacting to mempool activity.
*   **Key Functionality (MVP - SSOT 9.2.3)**:
    *   Process transaction streams from Mempool Ingestion Service to update local representation of relevant DEX pool states (e.g., Uniswap V2/V3 reserves).
    *   Alternatively, or in conjunction, frequently query DEX pool contracts via RPC Service for prices of configured pairs (e.g., WETH/USDC, WETH/TARGET_TOKEN, TARGET_TOKEN/USDC).
    *   Calculate effective prices considering pool reserves and potential price impact of a typical swap size.
*   **Data Sources (MVP)**: Ethereum mempool stream (via Mempool Ingestion Service), direct DEX contract queries (e.g., Uniswap `getReserves()`, `slot0`, or quoter contract calls).
*   **Configuration (`configs/price_sources.yaml`)**:
    ```yaml
    dex_sources:
      uniswap_v2_mainnet:
        router_address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
        pairs: # Address of LP token or tokens
          - "WETH_USDC_LP_ADDRESS"
          - "WETH_TARGET_TOKEN_LP_ADDRESS"
      sushiswap_mainnet: # Example for another DEX
        router_address: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
        pairs: []
    price_update_interval_ms: 500 # If polling pools directly
    mempool_stream_source: "http://localhost:PORT_OF_MEMPOOL_SVC/stream" # If mempool svc provides a stream
    ```

#### 2.3.4. Opportunity Identification Service (v1 - SSOT 2.5 - 2-hop DEX Arbitrage)
*   **Purpose**: Identify 2-hop DEX arbitrage opportunities from Price Service data.
*   **Key Functionality (MVP - SSOT 9.2.3)**:
    *   Monitor prices for a configured 2-hop path (e.g., WETH -> TokenA on DEX1, then TokenA -> WETH on DEX2).
    *   Example Path: Buy TokenA with WETH on Uniswap; Sell TokenA for WETH on Sushiswap.
    *   Calculation:
        *   `amount_token_a_out_dex1 = get_amount_out(WETH_in, WETH_pool_dex1, TokenA_pool_dex1)`
        *   `amount_weth_out_dex2 = get_amount_out(amount_token_a_out_dex1, TokenA_pool_dex2, WETH_pool_dex2)`
        *   If `amount_weth_out_dex2 > WETH_in * (1 + min_profit_threshold_after_gas_estimate)`, an opportunity exists.
    *   Consider initial estimated gas for two transactions.
*   **Configuration (`configs/opportunity_params.yaml`)**:
    ```yaml
    dex_arbitrage_2hop:
      paths:
        # Path 1: WETH -> WBTC (UniswapV2) -> WETH (Sushiswap)
        - name: "WETH_WBTC_WETH_UniSush"
          token_start: "WETH_ADDRESS"
          token_intermediate: "WBTC_ADDRESS"
          token_end: "WETH_ADDRESS"
          dex1: "uniswap_v2_mainnet" # Key from price_sources.yaml
          dex2: "sushiswap_mainnet"  # Key from price_sources.yaml
          # Add specific pool addresses if not inferred by pair tokens
          pool1_address: "0xBb2b8038a1640196FbE3e38816F3e67Cba72D940" # ETH/WBTC UniV2
          pool2_address: "0x795065dCc9f64b5614C407a6EFDC400DA6221FB0" # WBTC/ETH Sushi
      min_profit_threshold_percentage: 0.2 # Before detailed simulation, after rough gas estimate
      default_trade_size_weth: 1.0 # Nominal trade size to check for opportunities
    ```

#### 2.3.5. Simulation Service (v1 - SSOT 8.3 - DEX Swaps)
*   **Purpose**: Simulate the execution of the identified 2-hop DEX arbitrage.
*   **Key Functionality (MVP - SSOT 9.2.3)**:
    *   Take a potential 2-hop opportunity.
    *   Simulate the two DEX swaps using `eth_call` to query router contracts (`getAmountsOut` or equivalent like Uniswap V3 Quoter) for more accurate slippage and price impact based on `default_trade_size_weth`.
    *   Fetch current gas prices (via Core RPC Service) and estimate total gas cost for two transactions.
    *   Calculate net P&L: `amount_weth_out_dex2 - WETH_in - total_gas_cost_in_weth`.
*   **Configuration (`configs/simulation_params.yaml`)**:
    ```yaml
    dex_swap_simulation:
      slippage_tolerance_percentage: 0.5 # Not used for quoting, but for final tx params if real
      gas_estimation:
        safety_margin_multiplier: 1.2 # e.g., 20% margin on gas estimate
        # Gas limits for typical swap, swap_and_transfer_on_uniswap_router
        gas_limit_dex_swap: 200000
        gas_limit_second_dex_swap: 250000
    ```

#### 2.3.6. Paper Trading Module (v1 Logic - SSOT 2.11 Context)
*   **Purpose**: Track performance of simulated 2-hop DEX arbitrage using a virtual portfolio.
*   **Key Functionality (MVP - SSOT 9.2.3)**:
    *   Initialize virtual portfolio (e.g., virtual WETH).
    *   When Simulation Service confirms a profitable 2-hop opportunity:
        *   Update virtual WETH balance based on simulated net P&L.
        *   Record paper trade details (path, simulated amounts, gas, P&L) via Data Collection Service (Firestore).

---

## Part 3: Integration & End-to-End "Dry Run" Testing (Mempool DEX Arbitrage MVP)

*(Rewritten from IMPLEMENTATION_GUIDE_E2E_DRY_RUN_MVP.md to focus on Mempool-driven 2-hop DEX Arbitrage)*

### 3.0. Introduction
This part focuses on integrating the Phase 1 services for a mempool-driven 2-hop DEX arbitrage strategy. The `MevBot_V10.ts` orchestrator manages the flow, performing paper trading. Basic monitoring setup is also covered.

*   **MVP Goal (SSOT 9.2.4)**: Demonstrate a functional end-to-end paper trading loop for a predefined 2-hop DEX arbitrage strategy, driven by mempool data or rapid DEX state polling, with P&L tracking and basic monitoring.

### 3.1. System Architecture for Dry Run (2-hop DEX Arbitrage)
```
+---------------------------+      +---------------------------------+
| Mempool Ingestion Svc     |----->| Price Service (DEX-focused)     |
| (SSOT 2.2)                |      | (SSOT 2.3)                      |
+---------------------------+      +-----------------+---------------+
                                                     | (DEX Prices/Events)
                                                     v
+--------------------------------------------------------------------------------------+
|                                MevBot_V10.ts Orchestrator (SSOT 2.11)                |
|--------------------------------------------------------------------------------------|
| - Coordinates services for 2-hop DEX arbitrage strategy                              |
|   +--------------------------+     +---------------------------+     +-------------+  |
|   | Opportunity ID Svc       |<--->| Simulation Svc            |<--->| Paper       |  |
|   | (2-hop DEX Arb)          |     | (2 DEX Swaps)             |     | Trading Mod.|  |
|   +--------------------------+     +---------------------------+     +-------------+  |
|         ^       ^                                      ^                               |
|         |       | (Core Bot Services: Config, Logger, RPC, Data Collection-Firestore)|
|   (DEX Prices)  +--------------------------------------------------------------------+  |
+--------------------------------------------------------------------------------------+
         |                                      |
         v                                      v
+---------------------------+      +---------------------------------+
| Monitoring System (MVP)   |      | Firestore (via Data Coll. Svc)  |
| (Cloud Logging, Dashboards|      |                                 |
|  SSOT 12.1)               |      +---------------------------------+
+---------------------------+
```

### 3.2. Trading Orchestrator: `MevBot_V10.ts` (SSOT 2.11)
*   **Purpose**: Coordinate services for the 2-hop DEX arbitrage paper trading strategy.
*   **Key Responsibilities (MVP - SSOT 9.2.4)**:
    *   Initialize services.
    *   Implement main control loop for 2-hop DEX arbitrage.
    *   Manage data flow between Price Service, Opportunity ID, Simulation, and Paper Trading.
*   **Core Logic Flow (Illustrative TypeScript/Pseudocode for 2-hop DEX Arb)**:
    ```typescript
    // MevBot_V10.ts - Main Orchestrator for 2-hop DEX Arbitrage
    async function main() {
        // 1. Initialize Core Bot Services (Config, Logger, RPC, DataCollector to Firestore)
        // 2. Initialize Application Services (PriceService (DEX), OpportunityID (2-hop), Simulation, PaperTrader)

        logger.info("MevBot_V10.ts Orchestrator Initialized for 2-hop DEX Arbitrage Dry Run.");

        // 3. Main Execution Loop (driven by new price data or interval)
        // Could be event-driven from PriceService on significant DEX price changes (from mempool)
        // Or interval-based polling from PriceService
        priceService.on('significantPriceUpdate', async (updatedPairs) => { // Hypothetical event
             // Or setInterval(async () => { ... priceService.getLatestDexPrices(); ... }, ...)
            try {
                const opportunities = await opportunityIdentifier.identifyDex2HopOpportunities(updatedPairs);

                for (const opp of opportunities) { // opp details a 2-hop path
                    logger.info(`Potential 2-hop DEX opportunity: ${JSON.stringify(opp)}`);
                    const simulationResult = await tradeSimulator.simulateDex2HopTrade(opp);
                    if (simulationResult.isProfitable) {
                        logger.info(`2-hop DEX Simulation profitable: ${JSON.stringify(simulationResult)}`);
                        await paperTrader.executePaperTrade(simulationResult); // Records to Firestore
                    }
                }
            } catch (error) {
                logger.error("Error in 2-hop DEX arbitrage loop:", error);
            }
        });
        // Start price service listening/polling
        await priceService.start();
    }
    main().catch(error => console.error("Critical error starting orchestrator:", error));
    ```
*   **Configuration**: Orchestrator config to specify 2-hop strategy parameters.

### 3.3. Integration of Phase 1 Services
*   **Mempool Ingestion Service**: Crucial for providing the data that allows Price Service to rapidly update DEX prices/states. The "streaming output" modification is key here.
*   **Core Bot Services**: Config, Logger, RPC (for DEX queries, gas price), Data Collection (to Firestore). KMS is passive. Smart Contract Interaction (for reading DEX pool states).
*   **DEX Arbitrage & Simulation Services**: Price Service (DEX prices from mempool/polling), Opportunity ID (2-hop logic), Simulation (2 DEX swaps), Paper Trading (virtual WETH portfolio).

### 3.4. End-to-End "Dry Run" Workflow (2-hop DEX Paper Trading)
1.  **Initialization**: `MevBot_V10.ts` starts services. Paper Trading Module loads virtual WETH balance.
2.  **Mempool Monitoring & Price Updates**:
    *   Mempool Ingestion Service streams transaction data (e.g., Uniswap swaps, liquidity changes).
    *   Price Service consumes this stream (or polls DEX contracts frequently via RPC Service) to maintain current prices for relevant pairs on monitored DEXs.
3.  **Opportunity Identification (2-hop DEX)**:
    *   Opportunity Identification Service receives updated DEX prices.
    *   Checks configured 2-hop paths (e.g., WETH -> TKN_A on DEX1, TKN_A -> WETH on DEX2).
4.  **Simulation (2 DEX Swaps)**:
    *   If a path seems profitable, Simulation Service:
        *   Quotes leg 1 (e.g., WETH -> TKN_A on DEX1) for expected output amount.
        *   Quotes leg 2 (e.g., TKN_A -> WETH on DEX2) using output from leg 1.
        *   Calculates total gas cost for two transactions.
        *   Determines net P&L in WETH.
5.  **Paper Trading Execution**: If simulated P&L > threshold:
    *   Paper Trading Module updates virtual WETH balance.
    *   Records the 2-hop paper trade (path, amounts, prices, gas, P&L) to Firestore via Data Collection Service.
6.  **Logging**: All steps logged via Logger Service to console and Cloud Logging.
7.  **Loop**: Orchestrator continues processing new price data / checking opportunities.

### 3.5. Basic Monitoring Setup (MVP - SSOT 12.1, 9.2.4)
*   **Key Metrics**:
    *   Mempool Ingestion: Rate of incoming mempool transactions.
    *   Price Service: Number of DEX price updates, latency of updates.
    *   Opportunity ID: Number of 2-hop opportunities found.
    *   Simulation: Success/failure rate of simulations.
    *   Paper Trading: P&L of virtual portfolio, number of paper trades.
    *   Service health: Error rates, RPC call latencies.
*   **Tools**: Google Cloud Logging, Cloud Monitoring Dashboards (from log-based metrics or custom metrics if possible).
*   **Log Aggregation**: Centralized logging to Cloud Logging.
*   **Alerting**: Basic alerts for critical errors or service downtime.

### 3.6. Testing Strategy for Dry Run
*   **Integration Tests**: Test Mempool Ingestion -> Price Service link. Test Price Service -> Opportunity ID. Test Opportunity ID -> Simulation -> Paper Trading.
*   **E2E Scenario Testing**:
    *   Craft or find real (past) scenarios of 2-hop DEX arbitrage. Feed relevant mempool data / DEX states.
    *   Verify correct identification, simulation, and paper trading.
    *   Test with high/low gas price scenarios.
    *   Test different 2-hop paths if multiple are configured.

### 3.7. Success Criteria for MVP Dry Run (SSOT 9.2.4 - adapted for 2-hop DEX)
*   `MevBot_V10.ts` orchestrates services for the 2-hop DEX arbitrage strategy.
*   System identifies 2-hop DEX arbitrage from mempool-driven/queried DEX prices.
*   Simulation Service accurately models 2 DEX swaps with gas costs.
*   Paper Trading Module records trades and P&L to Firestore.
*   Logs are viewable in Cloud Logging. System stable for a test period.

---

## Part 4: Deployment Guide (GCE)

*(Content from DEPLOYMENT_GUIDE_GCE.md, with Node.js focus for MevBot_V10 emphasized)*

### 4.1. Introduction
Deploying `MempoolIngestionService` and `MevBot_V10` (Main Bot Orchestrator, assumed Node.js/TypeScript) to GCE.

#### 4.1.1. Prerequisites
GCE instances provisioned (per SSOT Appendix D), SSH access, Git repo, GCP IAM permissions.

#### 4.1.2. Target Services and VMs
*   `MempoolIngestionService`: On `gce-mempool-ingestion-vm-prod`.
*   `MevBot_V10`: On `gce-mevbot-v10-vm-prod`. Assumed to be Node.js/TypeScript. Core Bot Services and other strategy components are part of this deployment unit.

### 4.2. General GCE VM Preparation
(Common steps for both VMs: SSH, system updates, Git, Node.js, npm, PM2, Python if needed for specific services like Mempool Ingestion if it's Python).

Ensure Node.js is the primary focus for `gce-mevbot-v10-vm-prod`.
```bash
# On both VMs, ensure Node.js and PM2 are installed:
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install pm2 -g
# Install Python3/pip/venv if MempoolIngestionService is Python
sudo apt-get install -y python3 python3-pip python3-venv # If needed
```

### 4.3. Deploying the MempoolIngestionService
(As per original guide, assuming it might be Python. If it's Node.js, deployment steps mirror MevBot_V10 more closely).
*   **PM2 Config for Python (example from original guide):**
    ```javascript
    // ecosystem.config.js for MempoolIngestionService (if Python)
    module.exports = { /* ... as in original ... */ }
    ```
    Key is that its output must be streamable/quickly accessible by `MevBot_V10`'s Price Service.

### 4.4. Deploying the MevBot_V10 (Main Bot Orchestrator - Node.js Focus)
On `gce-mevbot-v10-vm-prod`.
#### 4.4.1. Code Transfer & Dependencies
```bash
export DEPLOY_DIR="/opt/mevbot_v10"
# ... (sudo mkdir, chown, cd) ...
git clone YOUR_GIT_REPO_URL_FOR_MEVBOT .
npm install      # Install Node.js dependencies
npm run build    # Compile TypeScript to JavaScript (e.g., into 'dist')
```

#### 4.4.2. Configuration Setup
Place all config files (`.yaml`, `.env` with Firestore details, RPC endpoints, contract addresses, KMS keys, etc.). Ensure `.env` is secure and `GOOGLE_APPLICATION_CREDENTIALS` is set up if not using VM's ADC for Firestore/KMS.

#### 4.4.3. PM2 Configuration (`ecosystem.config.js` for Node.js)
```javascript
// $DEPLOY_DIR/ecosystem.config.js for MevBot_V10 (Node.js/TypeScript)
module.exports = {
  apps : [{
    name   : "mevbot-v10-orchestrator",
    script : "dist/main.js", // Main entry point for the Node.js app
    cwd    : __dirname,
    node_args: "--max-old-space-size=2048", // Example: Increase heap memory if needed
    env_production: { // PM2 uses env_production by default if NODE_ENV is not set
      "NODE_ENV": "production",
      // Other ENV VARS can be set here or loaded via .env file by the application
    },
    autorestart: true,
    watch  : false, // Disable watch in production
    max_memory_restart: '2G', // Adjust as needed
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // For Cloud Logging, ensure app logs to stdout/stderr.
    // Following can be removed if relying on console logs piped to Cloud Logging.
    // out_file: '/var/log/pm2/mevbot-out.log',
    // error_file: '/var/log/pm2/mevbot-err.log',
    // merge_logs: true, // if using PM2 log files
    combine_logs: true, // Recommended if using PM2 log files
    instance_var: 'INSTANCE_ID', // Useful for clustered mode, not strictly for MVP single instance
  }]
}
```

#### 4.4.4. Starting and Verifying Service
```bash
cd $DEPLOY_DIR
pm2 start ecosystem.config.js # No --env production needed if env_production is set
pm2 list
pm2 logs mevbot-v10-orchestrator
# Application-specific checks: Firestore data, logs for 2-hop DEX arb activity.
```

### 4.5. Post-Deployment & Maintenance
(Checking logs with `pm2 logs APP_NAME`, `pm2 monit`, code updates with `git pull`, `npm install`, `npm run build`, `pm2 restart APP_NAME`, PM2 startup script `pm2 startup`, `pm2 save`).

### 4.6. Troubleshooting
(As per original guide: permissions, service start failures, GCP connectivity, dependency conflicts).

---

## Conclusion

This comprehensive guide provides the foundational documentation for Phase 1 of the MEV Bot V10 project. By following the outlined steps for environment setup, service implementation (with a focus on mempool-driven 2-hop DEX arbitrage and Firestore for data collection), integration, and GCE deployment, the team can effectively build and deploy a functional MVP. Adherence to the SSOT document and continuous testing are crucial for success.
```
