# Mempool Ingestion Service (MEV Bot V10)

This service is responsible for connecting to an Ethereum mempool stream, fetching pending transaction details, filtering for relevant transactions (e.g., those interacting with known DEX routers), decoding them, and publishing them for consumption by other services, primarily the MEV Bot V10 Orchestrator.

## Features (Phase 1 MVP)

*   Connects to an Ethereum mainnet WebSocket endpoint (configurable via `.env` and `config.yaml`).
*   Fetches full transaction details for incoming transaction hashes.
*   Filters transactions targeting known DEX routers (e.g., UniswapV2, Sushiswap).
*   Decodes common swap function calls on these routers.
*   Publishes processed transactions (raw or decoded) via a local WebSocket server on a configurable port.
*   Includes reconnection logic for the mempool stream.

## Prerequisites

*   Node.js (LTS version, refer to root `ENVIRONMENT_SETUP_GUIDE.md`)
*   npm

## Setup

1.  **Clone the repository** (if you haven't already). This service is part of the `mev-bot-v10` monorepo.
2.  **Navigate to this service directory:** `cd mempool-ingestion-service`
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Configure Environment:**
    *   Copy `.env.example` to `.env`: `cp .env.example .env`
    *   Edit `.env` to set:
        *   `LOG_LEVEL`: (e.g., `info`, `debug`)
        *   `MEMPOOL_WS_URL`: Your Ethereum mainnet WebSocket RPC URL (e.g., from Alchemy or Infura).
        *   `PUBLISHER_PORT`: Port for this service to broadcast transactions on (default `3001`). This needs to match `MEMPOOL_PUBLISHER_URL` in the `mev-bot-v10` orchestrator's configuration.
        *   `MEMPOOL_KNOWN_ROUTER_ADDRESSES_CSV` (Optional): Comma-separated list of DEX router addresses to monitor. Defaults to UniswapV2 and Sushiswap.
    *   Review `config/config.yaml.example` for other configurations like default known routers if not using the ENV var.

## Running the Service

1.  **Build TypeScript:**
    ```bash
    npm run build
    ```
2.  **Start the service:**
    ```bash
    npm start
    ```
    The service will attempt to connect to the mempool stream and start its publisher.

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
