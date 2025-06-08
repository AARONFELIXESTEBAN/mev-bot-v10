# Implementation Guide - Initial Opportunity Identification & Simulation (Paper Trading - MVP)

This document provides an implementation overview for the Minimum Viable Product (MVP) focused on Opportunity Identification, Price Tracking, Simulation, and Paper Trading logic. These components work together to identify potential trading opportunities from market data, simulate their execution, and track hypothetical performance without risking real assets. This guide references SSOT Sections 9.2.3 (MVP Features for Opportunity Identification and Simulation), 2.3 (Price Service), 2.5 (Opportunity Identification Service), 8.3 (Simulation Service), and 2.11 (Trading Orchestrator - as context for the Paper Trading Module).

## Table of Contents

1.  [Introduction](#introduction)
2.  [Overall Architecture (MVP Interaction)](#overall-architecture)
3.  [Project Structure (Illustrative)](#project-structure)
4.  [Price Service (v1 - SSOT 2.3)](#price-service)
    *   [Purpose](#price-purpose)
    *   [Key Functionality (MVP - SSOT 9.2.3)](#price-key-functionality-mvp)
    *   [Data Sources (MVP)](#price-data-sources-mvp)
    *   [Configuration](#price-configuration)
5.  [Opportunity Identification Service (v1 - SSOT 2.5)](#opportunity-identification-service)
    *   [Purpose](#opportunity-purpose)
    *   [Key Functionality (MVP - SSOT 9.2.3)](#opportunity-key-functionality-mvp)
    *   [Example Strategy (MVP)](#opportunity-example-strategy-mvp)
    *   [Configuration](#opportunity-configuration)
6.  [Simulation Service (v1 - SSOT 8.3)](#simulation-service)
    *   [Purpose](#simulation-purpose)
    *   [Key Functionality (MVP - SSOT 9.2.3)](#simulation-key-functionality-mvp)
    *   [Interaction with Core Bot Services](#simulation-interaction-core)
    *   [Configuration](#simulation-configuration)
7.  [Paper Trading Module (v1 Logic - SSOT 2.11 Context)](#paper-trading-module)
    *   [Purpose](#paper-trading-purpose)
    *   [Key Functionality (MVP - SSOT 9.2.3)](#paper-trading-key-functionality-mvp)
    *   [State Management](#paper-trading-state-management)
    *   [Integration](#paper-trading-integration)
8.  [Data Flow (MVP)](#data-flow-mvp)
9.  [Testing Considerations (MVP)](#testing-considerations-mvp)
10. [Deployment (General Considerations for MVP)](#deployment-mvp)

## 1. Introduction

The MVP for Opportunity Identification and Simulation aims to establish a foundational framework for detecting and evaluating trading strategies in a risk-free paper trading environment. This involves fetching market prices, identifying simple opportunities (e.g., CEX-DEX arbitrage), simulating their execution considering hypothetical gas fees and slippage, and tracking the performance of these paper trades.

*   **SSOT 9.2.3 (MVP Features)**: Defines the specific, limited scope for each service in this MVP phase. Key themes include focusing on one simple arbitrage type, using CEX and DEX price feeds, basic simulation parameters, and straightforward paper trading P&L tracking.

## 2. Overall Architecture (MVP Interaction)

```
+-------------------------+      +-----------------------------+
| Mempool Ingestion Svc   |----->| Price Service (v1)          |
| (provides DEX prices    |      | (SSOT 2.3, 9.2.3)           |
|  indirectly via logs    |      | - Aggregates CEX/DEX prices |
|  or direct feed)        |      +-------------+---------------+
+-------------------------+                    | (Price Feeds)
                                               v
+--------------------------------+<----+-----------------------------+
| Core Bot Services              |     | Opportunity Identification  |
| - RPC Service (for DEX prices) |     | Service (v1) (SSOT 2.5, 9.2.3)|
| - Logger Service               |     | - Identifies simple arbitrage |
| - Configuration Service        |     +-------------+---------------+
+--------------------------------+                   | (Potential Opportunity)
              ^                                      v
              | (Execution Params)   +-----------------------------+
              |                      | Simulation Service (v1)     |
+----------------------------+       | (SSOT 8.3, 9.2.3)           |
| Paper Trading Module (v1)  |<------| - Simulates execution       |
| (within Trading Orchestrator|       | - Calculates P&L            |
|  SSOT 2.11, 9.2.3)         |       +-----------------------------+
| - Manages virtual portfolio|
| - Records paper trades     |
+----------------------------+
              |
              v (Data for Storage)
+--------------------------------+
| Data Collection Service (v1)   |
| (from Core Bot Services)       |
+--------------------------------+
```

## 3. Project Structure (Illustrative)

This might be part of a larger bot monorepo or a dedicated repository.

```
opportunity_simulation_mvp/
├── .venv/
├── services/
│   ├── __init__.py
│   ├── price_service/
│   │   └── client.py           # Fetches and aggregates prices
│   ├── opportunity_identification_service/
│   │   └── detector.py         # Implements arbitrage logic
│   ├── simulation_service/
│   │   └── simulator.py        # Simulates trades
│   └── paper_trading_module/   # Could be part of a strategy orchestrator
│       └── manager.py          # Manages paper trading logic and portfolio
├── configs/
│   ├── global_config.yaml
│   ├── price_sources.yaml
│   ├── opportunity_params.yaml
│   └── simulation_params.yaml
├── strategies/                 # Specific strategy configurations using the services
│   └── cex_dex_arb_mvp.py      # Example orchestrator for the MVP strategy
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── requirements.txt
└── README.md
```

## 4. Price Service (v1 - SSOT 2.3)

*   **Purpose (SSOT 2.3.1)**: To provide timely and accurate price information for various assets from multiple sources (CEXs, DEXs).
*   **Key Functionality (MVP - SSOT 9.2.3)**:
    *   Fetch prices for configured trading pairs (e.g., ETH/USDC) from:
        *   One selected CEX API (e.g., Binance, Kraken - as per SSOT 2.3.3).
        *   One selected DEX (e.g., Uniswap V2/V3 on a specific network - as per SSOT 2.3.3), using the RPC Service from Core Bot Services to query contract state.
    *   Provide an interface to get the latest bid/ask or last traded price.
    *   Basic error handling for API/RPC calls.
*   **Implementation (`services/price_service/client.py`)**:
    *   `PriceClient` class.
    *   Methods like `get_cex_price(pair, exchange_name)` and `get_dex_price(pair, dex_name, network_name)`.
    *   Uses libraries like `requests` for CEX APIs and `web3.py` (via Core RPC Service) for DEXs.
    *   May involve calculating TWAP or VWAP if specified by MVP, but likely direct price for simplicity first. SSOT 9.2.3 implies direct price observation.
*   **Data Sources (MVP - SSOT 2.3.3, 9.2.3)**:
    *   CEX: API of one major exchange (e.g., Binance `GET /api/v3/ticker/bookTicker` for best bid/ask).
    *   DEX: On-chain calls to a specific DEX (e.g., Uniswap V3 `slot0` for current price, or `quoter` contract for simulated swaps to get price impact). For MVP, direct pool reserves or `slot0` might be simpler than full quote.
*   **Configuration (`configs/price_sources.yaml`)**:
    ```yaml
    cex_sources:
      binance:
        api_url: "https://api.binance.com"
        pairs: ["ETHUSDT", "BTCUSDT"]
    dex_sources:
      uniswap_v3_mainnet:
        router_address: "0x..." # Or quoter address
        fee_tiers: [3000] # Example for ETH/USDC
        pairs:
          - token0: "USDC_ADDRESS"
            token1: "WETH_ADDRESS"
    # Update intervals if polling, or specify WebSocket if used
    ```

## 5. Opportunity Identification Service (v1 - SSOT 2.5)

*   **Purpose (SSOT 2.5.1)**: To analyze market data (prices, order books, mempool) to identify potential trading opportunities.
*   **Key Functionality (MVP - SSOT 9.2.3)**:
    *   Utilize the Price Service to get current CEX and DEX prices for configured pairs.
    *   Implement logic for one specific type of arbitrage: **CEX-DEX arbitrage** (buy on cheaper, sell on more expensive).
    *   Identify opportunities that exceed a configurable minimum profit threshold (considering estimated fees but before full simulation).
*   **Implementation (`services/opportunity_identification_service/detector.py`)**:
    *   `OpportunityDetector` class.
    *   Method `check_cex_dex_arbitrage(pair)`:
        *   Fetches CEX price (e.g., Binance ask) and DEX price (e.g., Uniswap bid, obtainable by simulating a sell).
        *   Compares `cex_ask` vs `dex_bid` and `dex_ask` vs `cex_bid`.
        *   If `dex_bid > cex_ask * (1 + min_profit_threshold + estimated_fees_percentage)`: potential opportunity to buy CEX, sell DEX.
        *   If `cex_bid > dex_ask * (1 + min_profit_threshold + estimated_fees_percentage)`: potential opportunity to buy DEX, sell CEX.
        *   `estimated_fees_percentage` is a rough estimate at this stage.
*   **Example Strategy (MVP - SSOT 9.2.3)**: Simple CEX-DEX arbitrage for ETH/USDC.
*   **Configuration (`configs/opportunity_params.yaml`)**:
    ```yaml
    cex_dex_arbitrage:
      pairs: ["ETH/USDC"] # Standardized pair format
      min_profit_threshold_percentage: 0.5 # e.g., 0.5%
      # Rough estimate of fees for initial check, refined in simulation
      estimated_fees_percentage: 0.2 # Combined CEX + DEX rough estimate
    ```

## 6. Simulation Service (v1 - SSOT 8.3)

*   **Purpose (SSOT 8.3.1)**: To simulate the execution of identified trading opportunities against historical or live market data to estimate performance and risk.
*   **Key Functionality (MVP - SSOT 9.2.3)**:
    *   Take a potential opportunity from the Opportunity Identification Service.
    *   Simulate the execution of the two legs of the CEX-DEX arbitrage:
        *   **CEX leg**: Simulate maker/taker order based on configured behavior and CEX fee structure.
        *   **DEX leg**: Simulate swap on the DEX, considering estimated gas fees (from Core RPC Service `eth_gasPrice` or config) and slippage (from configured DEX parameters or by calling a DEX quoter).
    *   Calculate estimated Profit and Loss (P&L) for the opportunity after simulated costs.
    *   Use Core Bot Services: RPC Service (for gas price, DEX quote simulation), Configuration Service.
*   **Implementation (`services/simulation_service/simulator.py`)**:
    *   `TradeSimulator` class.
    *   Method `simulate_cex_dex_arbitrage(opportunity_details, cex_config, dex_config)`:
        *   `opportunity_details`: Output from OpportunityIdentificationService.
        *   `cex_config`: Fees, order type (taker/maker).
        *   `dex_config`: Slippage tolerance, gas fee estimation method.
        *   Simulate CEX trade: `amount_out = amount_in * price * (1 - cex_fee)`.
        *   Simulate DEX trade: Use RPC service to call DEX router's `getAmountsOut` (or equivalent for specific DEX like Uniswap Quoter `quoteExactInputSingle`) for expected output amount given input from CEX trade. Subtract estimated gas cost.
        *   Calculate net P&L.
*   **Configuration (`configs/simulation_params.yaml`)**:
    ```yaml
    cex_simulation:
      default_fee_percentage: 0.1 # Taker fee on CEX
      default_order_type: "taker"
    dex_simulation:
      slippage_tolerance_percentage: 0.5
      gas_estimation:
        method: "fixed" # or "rpc_gas_price"
        fixed_gas_limit_gwei: 200000 # For a typical swap
        fixed_gas_price_gwei: 20   # If using fixed, otherwise fetched
    ```

## 7. Paper Trading Module (v1 Logic - SSOT 2.11 Context)

*   **Purpose**: To track the performance of simulated trades over time using a virtual portfolio, without executing real trades. This logic would typically reside within or be managed by a Trading Orchestrator (SSOT 2.11).
*   **Key Functionality (MVP - SSOT 9.2.3)**:
    *   Initialize a virtual portfolio with starting balances for relevant assets (e.g., virtual USDC, virtual ETH - as per SSOT 9.2.3).
    *   When the Simulation Service confirms a profitable opportunity:
        *   "Execute" the paper trade: Deduct input assets, add output assets to the virtual portfolio based on simulated execution results.
        *   Record the paper trade details (pair, amounts, simulated prices, fees, P&L).
    *   Periodically report the overall P&L of the paper trading strategy.
    *   Data (trades, portfolio snapshots) stored using the Data Collection Service.
*   **Implementation (`services/paper_trading_module/manager.py` or within a strategy orchestrator script like `strategies/cex_dex_arb_mvp.py`)**:
    *   `PaperTradingManager` class.
    *   `virtual_portfolio = {"USDC": 10000, "ETH": 5}` (loaded from config).
    *   Method `execute_paper_trade(simulated_trade_result)`:
        *   Updates `virtual_portfolio`.
        *   Logs trade and P&L.
        *   Sends record to Data Collection Service.
    *   Method `get_portfolio_summary()`.
*   **State Management**: Virtual portfolio balances and trade history. For MVP, can be in-memory if the service is long-running for a session, with persistence via Data Collection Service. More robust state management (e.g., Redis, DB) is post-MVP.
*   **Integration**: Receives data from Simulation Service. Uses Data Collection Service and Logger Service. Configured by Configuration Service.

## 8. Data Flow (MVP)

1.  **Price Service**: Fetches CEX prices via API and DEX prices via Core RPC Service. Makes aggregated prices available.
2.  **Opportunity Identification Service**: Consumes prices from Price Service. Identifies potential CEX-DEX arbitrage.
3.  **Simulation Service**: Takes opportunity. Simulates CEX trade (fee). Simulates DEX swap (gas, slippage) using Core RPC Service for gas price/quotes. Calculates net P&L.
4.  **Paper Trading Module**: Receives profitable simulated trade. Updates virtual portfolio. Records trade using Data Collection Service.
5.  **Core Bot Services**: Used throughout (Config, Logger, RPC).

## 9. Testing Considerations (MVP)

*   **Unit Tests**:
    *   Price Service: Mock CEX API responses, mock RPC calls for DEX prices.
    *   Opportunity ID: Test logic with various price scenarios (profit, no profit, edge cases).
    *   Simulation Service: Test P&L calculation with different fees, gas prices, slippage. Mock RPC calls for DEX quotes.
    *   Paper Trading Module: Test portfolio updates, P&L tracking.
*   **Integration Tests (Limited Scope for MVP)**:
    *   Test Price Service with live (testnet) DEX and a sandbox CEX API if available.
    *   Test the flow: Price Service -> Opportunity ID -> Simulation -> Paper Trading with mocked inputs at the start of the chain.
    *   Verify data is correctly formatted for Data Collection Service.

## 10. Deployment (General Considerations for MVP)

*   **Containerization**: Package services (individually or as a suite) using Docker.
*   **GCP**: Deploy on GCE/GKE.
*   **Scheduling**: The main loop (Price -> Opportunity -> Simulation -> PaperTrade) might be run periodically (e.g., every few seconds/minutes) via a scheduler if not event-driven from price changes. For MVP, a simple loop in `strategies/cex_dex_arb_mvp.py` could manage this.
*   **IAM**: Permissions for GCS (Data Collection), KMS (if Core Bot Services are used by these services for some reason, though not directly anticipated for this flow's MVP), RPC node access.

---

This guide outlines the MVP implementation for identifying and paper-trading simple arbitrage opportunities. Adherence to SSOT sections is key for developing a functional and aligned initial system.
```
