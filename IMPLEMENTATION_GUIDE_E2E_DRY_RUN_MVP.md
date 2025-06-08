# Implementation Guide - Integration & End-to-End "Dry Run" Testing (MVP)

This document outlines the implementation strategy for integrating the Phase 1 services and conducting end-to-end "dry run" testing for the MVP. The central component for this phase is the `MevBot_V10.ts` Trading Orchestrator, which will coordinate the previously defined services to perform paper trading of a CEX-DEX arbitrage strategy. The guide also covers setting up basic monitoring for this integrated system. This guide references SSOT Sections 9.2.4 (MVP E2E Dry Run & Basic Monitoring), 2.11 (Trading Orchestrator - MevBot_V10.ts), and 12 (Monitoring & Alerting - MVP Scope).

## Table of Contents

1.  [Introduction](#introduction)
    *   [MVP Goal (SSOT 9.2.4)](#mvp-goal)
2.  [System Architecture for Dry Run](#system-architecture-dry-run)
3.  [Trading Orchestrator: `MevBot_V10.ts` (SSOT 2.11)](#trading-orchestrator)
    *   [Purpose](#orchestrator-purpose)
    *   [Key Responsibilities (MVP - SSOT 9.2.4)](#orchestrator-key-responsibilities-mvp)
    *   [Core Logic Flow](#orchestrator-core-logic-flow)
    *   [Interaction with Services](#orchestrator-interaction-services)
    *   [Configuration](#orchestrator-configuration)
4.  [Integration of Phase 1 Services](#integration-phase-1-services)
    *   [Mempool Ingestion Service (SSOT 2.2, 9.2.1)](#integration-mempool)
    *   [Core Bot Services (SSOT 9.2.2 Suite)](#integration-core-bot)
    *   [Opportunity Identification & Simulation Services (SSOT 9.2.3 Suite)](#integration-opportunity)
5.  [End-to-End "Dry Run" Workflow (Paper Trading)](#e2e-dry-run-workflow)
    *   [Data Ingestion (DEX Side)](#e2e-data-ingestion-dex)
    *   [Price Feeds (CEX & DEX)](#e2e-price-feeds)
    *   [Opportunity Identification](#e2e-opportunity-id)
    *   [Simulation](#e2e-simulation)
    *   [Paper Trading Execution](#e2e-paper-trading)
    *   [Data Logging & Persistence](#e2e-data-logging)
6.  [Basic Monitoring Setup (MVP - SSOT 12.1, 9.2.4)](#basic-monitoring-setup)
    *   [Key Metrics to Monitor](#monitoring-key-metrics)
    *   [Tools for MVP](#monitoring-tools-mvp)
    *   [Log Aggregation](#monitoring-log-aggregation)
    *   [Simple Alerting (Conceptual)](#monitoring-simple-alerting)
7.  [Testing Strategy for Dry Run](#testing-strategy-dry-run)
    *   [Component Tests (Review)](#testing-component)
    *   [Integration Tests (Service-to-Service)](#testing-integration)
    *   [E2E Scenario Testing](#testing-e2e-scenario)
    *   [Manual Verification](#testing-manual-verification)
8.  [Deployment for Dry Run](#deployment-dry-run)
9.  [Success Criteria for MVP Dry Run (SSOT 9.2.4)](#success-criteria)

## 1. Introduction

This phase focuses on bringing together all previously defined MVP services: Mempool Ingestion, Core Bot Services (Config, Logger, RPC, KMS, Data Collection, Smart Contract Interaction), and the Opportunity/Simulation services (Price, Opportunity ID, Simulation, Paper Trading Module). The `MevBot_V10.ts` orchestrator will manage the overall flow to perform paper trading of a CEX-DEX arbitrage strategy. The "dry run" signifies that no real funds will be used.

### MVP Goal (SSOT 9.2.4)

The primary goal is to demonstrate a functional end-to-end paper trading loop for a single, predefined CEX-DEX arbitrage strategy. This includes:
*   Data flowing from mempool/CEX APIs through the system.
*   Opportunities being identified and simulated.
*   Paper trades being recorded and P&L tracked.
*   Basic system health monitoring.

## 2. System Architecture for Dry Run

The architecture mirrors the combined interactions of services defined in previous implementation guides, now orchestrated by `MevBot_V10.ts`.

```
+---------------------------+      +--------------------------+      +---------------------------------+
| External Sources          |----->| Mempool Ingestion Svc    |----->| Price Service (via Data Coll.)  |
| (Mempool Feeds, CEX APIs) |      | (SSOT 2.2)               |      | (SSOT 2.3)                      |
+---------------------------+      +--------------------------+      +-----------------+---------------+
                                                                                       | (Prices)
                                                                                       v
+--------------------------------------------------------------------------------------+
|                                MevBot_V10.ts Orchestrator (SSOT 2.11)                |
|--------------------------------------------------------------------------------------|
| - Initializes & coordinates all services                                             |
| - Contains main CEX-DEX arbitrage strategy logic (using Paper Trading Module logic)  |
| - Manages overall execution loop                                                     |
|                                                                                      |
|   +--------------------------+     +---------------------------+     +-------------+  |
|   | Opportunity ID Svc       |<--->| Simulation Svc            |<--->| Paper       |  |
|   | (SSOT 2.5)               |     | (SSOT 8.3)                |     | Trading Mod.|  |
|   +--------------------------+     +---------------------------+     +-------------+  |
|         ^       ^       ^                    ^               ^                         |
|         |       |       |                    |               |                         |
| (Prices)|       | (Config)|          (Sim Params)|      (Core Svc Calls)             |
|         |       |       |                    |               |                         |
|   +-----+-------+-------+--------------------+---------------+-----------------------+  |
|   |                 Core Bot Services (SSOT 9.2.2 Suite)                            |  |
|   | Config | Logger | RPC | KMS (indirect) | Data Collection | SC Interaction (RO)   |  |
|   +---------------------------------------------------------------------------------+  |
+--------------------------------------------------------------------------------------+
         |                                      |
         | (Logs, Metrics)                      | (Stored Paper Trades, Op. Data)
         v                                      v
+---------------------------+      +---------------------------------+
| Monitoring System (MVP)   |      | GCS (via Data Collection Svc)   |
| (Cloud Logging, Basic     |      |                                 |
|  Dashboards - SSOT 12.1)  |      +---------------------------------+
+---------------------------+

```
*Note: `MevBot_V10.ts` implies TypeScript, adjust service implementation names if they are Python-based as in prior guides. This guide assumes `.ts` refers to the orchestrator's language, while services might be Python or other.*

## 3. Trading Orchestrator: `MevBot_V10.ts` (SSOT 2.11)

*   **Purpose (SSOT 2.11.1)**: To coordinate various services and execute trading strategies. For MVP, it's focused on a single CEX-DEX paper trading strategy.
*   **Key Responsibilities (MVP - SSOT 9.2.4)**:
    *   Initialize all required services (Core Bot Services, Price Service, Opportunity ID Service, Simulation Service, Paper Trading Module logic).
    *   Implement the main control loop for the CEX-DEX arbitrage strategy.
    *   Pass data between services appropriately.
    *   Ensure configurations are loaded and applied.
    *   Manage the lifecycle of the paper trading session.
*   **Core Logic Flow (Illustrative TypeScript/Pseudocode)**:
    ```typescript
    // MevBot_V10.ts - Main Orchestrator Logic
    async function main() {
        // 1. Initialize Core Bot Services (already set up with their configs)
        const configService = new ConfigService();
        const logger = new LoggerService(configService.get('logging'));
        const rpcService = new RpcService(configService.get('rpc'));
        const dataCollector = new DataCollectionService(configService.get('data_collection'));
        // ... other core services as needed by strategy/sub-services

        // 2. Initialize Application Services
        const priceService = new PriceService(configService.get('price_sources'), rpcService, dataCollector /* if it logs prices */);
        const opportunityIdentifier = new OpportunityIdentificationService(priceService, configService.get('opportunity_params'));
        const tradeSimulator = new SimulationService(rpcService, configService.get('simulation_params'));
        const paperTrader = new PaperTradingModule(configService.get('paper_trading'), dataCollector, logger); // Manages virtual portfolio

        logger.info("MevBot_V10.ts Orchestrator Initialized for Paper Trading Dry Run.");

        // 3. Main Execution Loop
        setInterval(async () => {
            try {
                // a. Fetch Prices (PriceService might do this internally or orchestrator triggers)
                // For CEX-DEX, prices for target pairs are needed from both.
                // This might involve priceService.getLatestPrices(['ETH/USDC']);

                // b. Identify Opportunities
                const opportunities = await opportunityIdentifier.identifyOpportunities(); // e.g., identifyCexDexArbitrage()

                for (const opp of opportunities) {
                    logger.info(`Potential opportunity identified: ${JSON.stringify(opp)}`);

                    // c. Simulate Trade
                    const simulationResult = await tradeSimulator.simulateTrade(opp);

                    if (simulationResult.isProfitable) {
                        logger.info(`Simulation profitable: ${JSON.stringify(simulationResult)}`);
                        // d. Execute Paper Trade
                        await paperTrader.executePaperTrade(simulationResult);
                    } else {
                        logger.info(`Simulation not profitable: ${JSON.stringify(simulationResult)}`);
                    }
                }
            } catch (error) {
                logger.error("Error in main execution loop:", error);
            }
        }, configService.get('orchestrator').loop_interval_seconds * 1000);
    }

    main().catch(error => console.error("Critical error starting orchestrator:", error));
    ```
*   **Interaction with Services**: The orchestrator primarily calls methods on the initialized service clients/managers.
*   **Configuration (`configs/orchestrator_config.yaml` or similar)**:
    ```yaml
    orchestrator:
      loop_interval_seconds: 15 # How often to run the cycle
      strategy: "cex_dex_arbitrage_v1"
    # References to other service configs (paths or sections)
    ```

## 4. Integration of Phase 1 Services

### Mempool Ingestion Service (SSOT 2.2, 9.2.1)
*   **Role**: For DEX price discovery, it's assumed that mempool data (e.g., new pending transactions, swaps in blocks) is captured.
*   **Integration**:
    *   The raw data collected by Mempool Ingestion (e.g., stored in GCS files or a temporary DB/stream) needs to be accessible by the Price Service or a pre-processor that feeds into the Price Service.
    *   For MVP, the Price Service might directly query DEX contract state (pools) for prices, with Mempool Ingestion running in parallel to gather broader data for future use, rather than directly feeding the MVP price discovery loop. SSOT 9.2.3 implies Price Service fetches DEX prices using RPC. Mempool Ingestion's role for *this specific E2E test* might be more about ensuring it *can* run and collect data, rather than being a direct synchronous part of the paper trading price pipeline.
    *   *Clarification needed from SSOT or team*: How directly does Mempool Ingestion feed the MVP CEX-DEX arb price discovery? If it's indirect (e.g., by observing confirmed swaps to update a local DEX state model for the Price Service), this needs to be defined. For MVP, simpler direct DEX RPC calls by Price Service are assumed.

### Core Bot Services (SSOT 9.2.2 Suite)
*   **Configuration Service**: Used by all services, including the orchestrator, to load settings.
*   **Logger Service**: Used by all services for standardized logging. Output to console and Cloud Logging.
*   **RPC Service**: Used by Price Service (for DEX prices), Simulation Service (for gas estimates, DEX quotes), and potentially Smart Contract Interaction Service.
*   **KMS Signing Service**: Not directly used in paper trading loop (no real transactions). Important for overall bot security context but passive in this dry run.
*   **Data Collection Service**: Used by Paper Trading Module to store trade records and portfolio snapshots, and potentially by Price Service or Opportunity ID Service to log interesting events/data points.
*   **Smart Contract Interaction Service (Read-Only)**: Used by Price Service (if DEX interaction is complex) or Opportunity ID/Simulation if they need to read other contract states.

### Opportunity Identification & Simulation Services (SSOT 9.2.3 Suite)
*   **Price Service**: Provides CEX and DEX prices to Opportunity ID Service.
*   **Opportunity Identification Service**: Identifies CEX-DEX arbitrage opportunities based on prices.
*   **Simulation Service**: Simulates these opportunities, calculating potential P&L.
*   **Paper Trading Module (logic within Orchestrator or called by it)**: Takes profitable simulations and updates a virtual portfolio.

## 5. End-to-End "Dry Run" Workflow (Paper Trading)

1.  **Initialization**: `MevBot_V10.ts` starts, initializes all configured services. Virtual portfolio loaded by Paper Trading Module.
2.  **Data Ingestion/Price Feeds**:
    *   Price Service fetches CEX prices (e.g., ETH/USDC from Binance API).
    *   Price Service fetches DEX prices (e.g., ETH/USDC from Uniswap V3 pool data via RPC Service).
3.  **Opportunity Identification**: Opportunity Identification Service receives prices, checks for CEX-DEX arbitrage conditions (e.g., `Binance_ETH_Ask < Uniswap_ETH_Bid * (1 - threshold)`).
4.  **Simulation**: If a potential opportunity is found, Simulation Service calculates:
    *   Expected output from CEX leg (considering fees).
    *   Expected output from DEX leg (considering gas, slippage, fees) using RPC Service for quotes/gas.
    *   Net P&L.
5.  **Paper Trading Execution**: If Simulation Service reports profit > configured minimum:
    *   Paper Trading Module updates virtual ETH and USDC balances.
    *   Records the "trade" (pair, amounts, prices, simulated fees, P&L) via Data Collection Service to GCS.
6.  **Logging**: All significant events, decisions, errors are logged by relevant services via Logger Service.
7.  **Loop**: Process repeats at configured interval.

## 6. Basic Monitoring Setup (MVP - SSOT 12.1, 9.2.4)

### Key Metrics to Monitor
*   **System Health**:
    *   Orchestrator running (heartbeat log).
    *   Service health (e.g., error rates from key components like Price Service API calls, RPC calls).
*   **Strategy Performance (Paper Trading)**:
    *   Number of opportunities identified.
    *   Number of (paper) trades executed.
    *   Total simulated P&L.
    *   Current virtual portfolio balances.
*   **Data Flow**:
    *   Prices being successfully fetched from CEX/DEX.
    *   Data being successfully written to GCS by Data Collection Service.

### Tools for MVP (SSOT 12.1.2)
*   **Google Cloud Logging**: For collecting structured logs from all services (via Logger Service).
*   **Google Cloud Monitoring**:
    *   Basic dashboards built from log-based metrics (e.g., count of errors, number of trades).
    *   CPU/Memory usage of GCE instances/GKE pods running the services.

### Log Aggregation
*   Ensure all services use the centralized Logger Service.
*   Logger Service configured to output structured JSON logs to `stdout` (which Cloud Logging captures from containers/GCE agents).
*   Include common fields in logs: `timestamp`, `service_name`, `severity`, `message`, and context-specific data.

### Simple Alerting (Conceptual for MVP - SSOT 12.1.3)
*   While sophisticated alerting is post-MVP, basic alerts can be set up in Cloud Monitoring:
    *   Alert if error logs from critical services exceed a threshold.
    *   Alert if the orchestrator heartbeat log is missing for too long.
*   For MVP, this might be manual checks of dashboards or logs initially.

## 7. Testing Strategy for Dry Run

### Component Tests (Review)
*   Ensure all individual services have passed their unit and basic integration tests as per their respective Implementation Guides.

### Integration Tests (Service-to-Service)
*   Test interaction points:
    *   Orchestrator correctly initializes and calls Price Service.
    *   Price Service correctly calls RPC Service for DEX prices.
    *   Data Collection Service correctly receives and stores data from Paper Trading Module.
*   Use mocked data initially, then test with controlled live testnet data if possible.

### E2E Scenario Testing
*   **Happy Path**: Create market conditions (manually or by replaying historical data if possible, though complex for MVP) where a CEX-DEX arbitrage opportunity *should* be found, simulated profitably, and paper traded. Verify all steps.
*   **No Opportunity**: Market conditions where no opportunities exist. Verify system idles correctly.
*   **Simulation Not Profitable**: Opportunity identified, but simulation shows it's not profitable after costs. Verify no paper trade occurs.
*   **Error Conditions**:
    *   CEX API unavailable: Verify Price Service handles error, logs it, and system continues or pauses gracefully.
    *   RPC node error: Verify relevant service handles it.
    *   GCS write error: Verify Data Collection Service handles it.

### Manual Verification
*   Inspect GCS to confirm paper trades and other data are stored correctly.
*   Review Cloud Logging to trace the flow and check for errors.
*   Monitor basic dashboards in Cloud Monitoring.

## 8. Deployment for Dry Run (SSOT 9.2.4)

*   Services (Python/TypeScript/etc.) containerized using Docker.
*   Deployed to GCP (GCE or GKE, as per overall project decision). For MVP dry run, a single GCE instance or a small GKE cluster might suffice.
*   Ensure network connectivity between services and to external APIs/RPCs.
*   IAM permissions correctly configured for GCS, Cloud Logging/Monitoring, RPC access.
*   Configuration files/env variables deployed securely.

## 9. Success Criteria for MVP Dry Run (SSOT 9.2.4)

*   The `MevBot_V10.ts` orchestrator successfully initializes and manages the lifecycle of all integrated Phase 1 services.
*   The system can identify a predefined CEX-DEX arbitrage opportunity using live (or near-live) price feeds from the Price Service.
*   The Simulation Service correctly processes the opportunity and calculates estimated P&L including basic costs (fees, gas).
*   The Paper Trading Module successfully records profitable simulated trades, updating a virtual portfolio.
*   Key operational data (e.g., paper trades, portfolio status) is stored by the Data Collection Service in GCS.
*   Basic operational logs are generated and viewable in Cloud Logging.
*   The system demonstrates stability over a short operational period (e.g., a few hours).

---

This guide provides the roadmap for integrating Phase 1 services under the `MevBot_V10.ts` orchestrator and performing the crucial E2E dry run test. Successful completion will validate the core MVP functionality.
```
