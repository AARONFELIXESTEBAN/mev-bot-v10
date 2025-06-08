# Implementation Guide - Core Bot Services (MVP)

This document provides an implementation overview for the Minimum Viable Product (MVP) of the Core Bot Services. These services form the foundational layer for bot operations, providing essential functionalities like configuration management, blockchain interaction, secure signing, data handling, and logging. This guide references SSOT Sections 9.2.2 (Core Bot Services MVP Features), 2.7 (RPC Service), 2.8 (KMS Signing Service), 2.9 (Data Collection Service v1), 2.10 (Logger Service), 2.12 (Smart Contract Interaction Service), 5.4 (General Configuration Management), and 6.1 (KMS Configuration).

## Table of Contents

1.  [Introduction](#introduction)
2.  [Overall Architecture (Core Services Interaction)](#overall-architecture)
3.  [Project Structure (Illustrative)](#project-structure)
4.  [Common Components](#common-components)
    *   [Configuration Service (SSOT 5.4)](#configuration-service)
    *   [Logger Service (SSOT 2.10)](#logger-service)
5.  [RPC Service (SSOT 2.7)](#rpc-service)
    *   [Purpose](#rpc-purpose)
    *   [Key Functionality (MVP - SSOT 9.2.2)](#rpc-key-functionality-mvp)
    *   [Configuration](#rpc-configuration)
    *   [Error Handling](#rpc-error-handling)
6.  [KMS Signing Service (SSOT 2.8)](#kms-signing-service)
    *   [Purpose](#kms-purpose)
    *   [Key Functionality (MVP - SSOT 9.2.2)](#kms-key-functionality-mvp)
    *   [Configuration (SSOT 6.1)](#kms-configuration)
    *   [Security Considerations](#kms-security-considerations)
7.  [Data Collection Service v1 (SSOT 2.9)](#data-collection-service-v1)
    *   [Purpose](#data-collection-purpose)
    *   [Key Functionality (MVP - SSOT 9.2.2)](#data-collection-key-functionality-mvp)
    *   [Data Storage (MVP)](#data-collection-data-storage-mvp)
    *   [Configuration](#data-collection-configuration)
8.  [Smart Contract Interaction Service (SSOT 2.12)](#smart-contract-interaction-service)
    *   [Purpose](#sc-purpose)
    *   [Key Functionality (MVP - Read-Only - SSOT 9.2.2)](#sc-key-functionality-mvp)
    *   [Configuration](#sc-configuration)
    *   [ABI Management](#sc-abi-management)
9.  [Testing Considerations (MVP)](#testing-considerations-mvp)
10. [Deployment (General Considerations for MVP)](#deployment-mvp)

## 1. Introduction

The Core Bot Services are a suite of interconnected modules designed to provide the fundamental capabilities required for automated bot operations in the blockchain environment. The MVP focuses on establishing robust, secure, and configurable versions of these services. Each service will be developed as a distinct module, promoting separation of concerns and maintainability.

*   **SSOT 9.2.2 (Core Bot Services MVP Features)**: Defines the specific, limited scope for each service in this MVP phase. Key MVP themes include read-only operations where applicable, basic error handling, secure key management via KMS, and foundational data collection.

## 2. Overall Architecture (Core Services Interaction)

The Core Bot Services are designed to be used by higher-level bot strategy implementations.

```
+-----------------------------+
| Bot Strategy Logic          |
| (e.g., Arbitrage Bot,      |
|  Liquidation Bot - Future)  |
+-------------+---------------+
              |
              v (requests/data)
+--------------------------------------------------------------------+
|                             Core Bot Services                      |
|--------------------------------------------------------------------|
| +-------------------+ +-----------------+ +----------------------+ |
| | Configuration Svc | |  Logger Svc     | | RPC Svc              | |
| | (SSOT 5.4)        | |  (SSOT 2.10)    | | (SSOT 2.7)           | |
| +-------------------+ +-----------------+ +----------------------+ |
|         ^                     ^                   ^                |
|         | (config data)       | (log messages)    | (RPC calls)    |
|---------+---------------------+-------------------+----------------|
|         |                     |                   |                |
|         v (config data)       v (log messages)    v (signed tx)    |
| +-------------------+ +------------------------------------------+ |
| | KMS Signing Svc   | | Smart Contract Interaction Svc (Read-Only)| |
| | (SSOT 2.8, 6.1)   | | (SSOT 2.12)                              | |
| +-------------------+ +------------------------------------------+ |
|         ^                     ^                   |                |
|         |(tx data for signing)| (contract calls)  |                |
|-------------------------------|-------------------+----------------|
|                               v (data to store)                    |
|                       +------------------------+                   |
|                       | Data Collection Svc v1 |                   |
|                       | (SSOT 2.9)             |                   |
|                       +------------------------+                   |
+--------------------------------------------------------------------+
```

## 3. Project Structure (Illustrative)

A monorepo or multi-repo approach can be taken. For simplicity, an illustrative structure for a Python-based monorepo:

```
core_bot_services/
├── .venv/
├── services/
│   ├── __init__.py
│   ├── config_service/
│   │   └── manager.py
│   ├── logger_service/
│   │   └── logger.py
│   ├── rpc_service/
│   │   └── client.py
│   ├── kms_signing_service/
│   │   └── signer.py
│   ├── data_collection_service/
│   │   └── collector.py
│   ├── smart_contract_service/
│   │   └── interaction.py
│   └── utils/                  # Shared utilities
│       └── ...
├── configs/                    # Centralized configuration files
│   ├── global_config.yaml
│   ├── rpc_endpoints.yaml
│   ├── contract_addresses.yaml
│   └── kms_config.yaml
├── tests/
│   ├── unit/
│   │   └── ...
│   └── integration/
│       └── ... # Limited for MVP
├── .env.example
├── requirements.txt
└── README.md
```

## 4. Common Components

### Configuration Service (SSOT 5.4)

*   **Purpose**: To provide a centralized and consistent way for all other services to access configuration parameters.
*   **Implementation**:
    *   A module (e.g., `services/config_service/manager.py`) that loads configuration from YAML files (e.g., `configs/global_config.yaml`, `configs/rpc_endpoints.yaml`) and environment variables.
    *   Environment variables should override file-based configurations.
    *   Provides simple functions like `get_rpc_url(network_name)`, `get_kms_key_id(key_name)`, `get_contract_address(contract_name)`.
    *   Utilizes Python libraries like `PyYAML` for YAML parsing and `python-dotenv` for `.env` file loading.
*   **MVP Scope (SSOT 9.2.2)**: Load and provide access to predefined configuration parameters necessary for other MVP services (RPC URLs, KMS key IDs, GCS bucket for data collection).

### Logger Service (SSOT 2.10)

*   **Purpose**: To provide a standardized logging facility for all services.
*   **Implementation**:
    *   A module (e.g., `services/logger_service/logger.py`) that configures Python's built-in `logging` module.
    *   Configuration (log level, format, output handlers like console and optionally file/Cloud Logging) driven by the Configuration Service.
    *   Provides a simple interface to get a logger instance (e.g., `logger = get_logger(__name__)`).
*   **MVP Scope (SSOT 9.2.2)**: Console logging with configurable log levels. Basic log formatting (timestamp, service name, level, message). Integration with GCP Cloud Logging if deployed on GCP.

## 5. RPC Service (SSOT 2.7)

*   **Purpose**: To abstract and manage connections to blockchain RPC endpoints.
*   **Key Functionality (MVP - SSOT 9.2.2)**:
    *   Connect to Ethereum-compatible RPC endpoints (specified in config).
    *   Make **read-only calls** (e.g., `eth_getBlockByNumber`, `eth_getTransactionReceipt`, `eth_call`).
    *   Handle basic connection errors and retries (configurable).
    *   Support for multiple networks (e.g., mainnet, testnets) via configuration.
*   **Implementation (`services/rpc_service/client.py`)**:
    *   Uses a library like `web3.py`.
    *   The `RPCClient` class would take a network name, retrieve the URL from Configuration Service.
    *   Methods like `get_block(block_number)`, `get_transaction_receipt(tx_hash)`.
*   **Configuration (`configs/rpc_endpoints.yaml`)**:
    ```yaml
    networks:
      mainnet: "YOUR_MAINNET_RPC_URL"
      sepolia: "YOUR_SEPOLIA_RPC_URL"
    connection_retries: 3
    request_timeout: 10 # seconds
    ```
*   **Error Handling**: Catch common `web3.py` exceptions, connection errors, and timeouts. Log errors via Logger Service.

## 6. KMS Signing Service (SSOT 2.8)

*   **Purpose**: To provide secure transaction signing using a Key Management Service (KMS), abstracting private key handling from bot logic.
*   **Key Functionality (MVP - SSOT 9.2.2)**:
    *   Interface with GCP KMS (as per SSOT 2.8.3).
    *   Sign Ethereum transactions using a key stored in GCP KMS.
    *   Retrieve the public key / address associated with a KMS key.
*   **Implementation (`services/kms_signing_service/signer.py`)**:
    *   Uses `google-cloud-kms` library.
    *   `KMSSigner` class initialized with KMS key path (from Configuration Service).
    *   Method `sign_transaction(raw_transaction_dict)`:
        *   Takes an EIP-1559 or legacy transaction dictionary.
        *   Serializes, hashes, and sends the hash to KMS for signing.
        *   Reconstructs the signed transaction.
    *   Method `get_address()`: Derives the Ethereum address from the public key retrieved from KMS.
*   **Configuration (SSOT 6.1, in `configs/kms_config.yaml`)**:
    ```yaml
    default_key_project_id: "your-gcp-project"
    default_key_location_id: "global" # or specific region
    default_key_keyring_id: "your-bot-keyring"
    keys:
      main_operational_key: "projects/your-gcp-project/locations/global/keyRings/your-bot-keyring/cryptoKeys/main-op-key/cryptoKeyVersions/1"
      # Add other keys as needed
    ```
*   **Security Considerations**:
    *   Strict IAM permissions for the service account using KMS keys (`roles/cloudkms.signerVerifier`).
    *   KMS key policies should be carefully configured.
    *   Avoid logging sensitive parts of transactions or signatures.

## 7. Data Collection Service v1 (SSOT 2.9)

*   **Purpose**: To collect and store data generated or observed by bots.
*   **Key Functionality (MVP - SSOT 9.2.2)**:
    *   Provide a simple interface for other services to submit data (e.g., Python dictionaries or JSON strings).
    *   Store this data into a designated Google Cloud Storage (GCS) bucket.
    *   Data should be stored in a structured way (e.g., by date, bot name, data type).
*   **Implementation (`services/data_collection_service/collector.py`)**:
    *   Uses `google-cloud-storage` library.
    *   `DataCollector` class initialized with GCS bucket name (from Configuration Service).
    *   Method `store_data(data_payload, category, sub_category)`:
        *   `data_payload`: The actual data to store.
        *   `category`: e.g., "mempool_event", "arbitrage_opportunity", "error_log".
        *   `sub_category`: e.g., "uniswap_v2", "eth_usdc_pair".
        *   Constructs a GCS object path like `gs://<bucket>/<category>/<sub_category>/<YYYYMMDD>/<timestamp_uuid>.json`.
        *   Uploads data as JSON.
*   **Data Storage (MVP)**:
    *   Raw JSON objects stored in GCS.
    *   No database or complex querying capabilities for MVP.
*   **Configuration (`configs/global_config.yaml`)**:
    ```yaml
    data_collection:
      gcs_bucket_name: "your-bot-data-bucket"
    ```

## 8. Smart Contract Interaction Service (SSOT 2.12)

*   **Purpose**: To abstract interactions with smart contracts.
*   **Key Functionality (MVP - Read-Only - SSOT 9.2.2)**:
    *   Load contract ABIs (from local files or config).
    *   Call **read-only functions** (`view` or `pure`) on specified smart contracts.
    *   Utilize the RPC Service for on-chain calls.
    *   Support for multiple contracts and networks.
*   **Implementation (`services/smart_contract_service/interaction.py`)**:
    *   Uses `web3.py`.
    *   `ContractInteractor` class.
    *   Method `load_abi(contract_name, abi_file_path)` or load from a central ABI store defined in config.
    *   Method `call_function(network_name, contract_address, contract_name_in_abi_store, function_name, *args)`:
        *   Gets `web3` instance from RPC Service.
        *   Loads contract using address and ABI.
        *   Calls the specified view/pure function.
*   **Configuration (`configs/contract_addresses.yaml`, `configs/global_config.yaml`)**:
    ```yaml
    # contract_addresses.yaml
    contracts:
      mainnet:
        my_token: "0x..."
        some_protocol_router: "0x..."
      sepolia:
        my_token: "0x..."

    # global_config.yaml
    smart_contract_service:
      abi_paths:
        my_token: "path/to/MyTokenABI.json"
        some_protocol_router: "path/to/RouterABI.json"
    ```
*   **ABI Management**: For MVP, ABIs can be stored as JSON files within the project and paths configured.

## 9. Testing Considerations (MVP)

*   **Unit Tests**:
    *   Each service module should have comprehensive unit tests.
    *   Mock external dependencies:
        *   RPC calls (mock `web3.py` responses).
        *   KMS signing (mock `google-cloud-kms` client responses).
        *   GCS uploads (mock `google-cloud-storage` client).
        *   Configuration loading.
    *   Test error handling and retry logic.
*   **Integration Tests (Limited Scope for MVP)**:
    *   Test interaction between Configuration Service and other services.
    *   Test RPC Service against a live testnet RPC endpoint for a few basic calls.
    *   Test Smart Contract Interaction Service for read-only calls against deployed testnet contracts.
    *   KMS and GCS integration tests might be more complex for MVP automated CI; manual verification or local scripts might be used initially.

## 10. Deployment (General Considerations for MVP)

*   **Containerization**: Each service, or the Core Bot Services suite as a whole, can be containerized using Docker for consistent deployment.
*   **GCP**: Services likely deployed on GCE or GKE.
*   **IAM**: Proper IAM roles for KMS access, GCS access, and potentially other GCP services (e.g., Cloud Logging).
*   **Configuration Management**: Securely manage production configurations and secrets (e.g., using GCP Secret Manager, though direct env vars or config files in secure locations for MVP might be used initially).

---

This guide provides the foundational plan for implementing the Core Bot Services MVP. Adherence to the specified SSOT sections is crucial for alignment with overall project goals.
```
