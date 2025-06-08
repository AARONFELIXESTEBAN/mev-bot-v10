# Implementation Guide - Mempool Ingestion Service (MVP)

This guide provides a detailed overview of the Mempool Ingestion Service's Minimum Viable Product (MVP) implementation. It covers the project structure, key components, core logic, configuration, and testing considerations. This document references details from SSOT Sections 2.2 (Mempool Ingestion Service) and 9.2.1 (MVP Features for Mempool Ingestion).

## Table of Contents

1.  [Introduction](#introduction)
2.  [Project Structure](#project-structure)
3.  [Key Files and Components](#key-files-and-components)
    *   [Configuration Files](#configuration-files)
    *   [Main Application Script](#main-application-script)
    *   [Mempool Connector Module](#mempool-connector-module)
    *   [Data Processing Module](#data-processing-module)
    *   [Storage Interface Module](#storage-interface-module)
4.  [Core Logic (MVP)](#core-logic-mvp)
    *   [Initialization](#initialization)
    *   [Connecting to Mempool Source](#connecting-to-mempool-source)
    *   [Fetching Mempool Data](#fetching-mempool-data)
    *   [Basic Data Transformation](#basic-data-transformation)
    *   [Storing Data](#storing-data)
    *   [Error Handling and Logging (Basic)](#error-handling-and-logging-basic)
5.  [Configuration Management](#configuration-management)
    *   [Environment Variables](#environment-variables)
    *   [Configuration File (`config.yaml`)](#configuration-file-configyaml)
6.  [Data Flow (MVP)](#data-flow-mvp)
7.  [Testing Considerations (MVP)](#testing-considerations-mvp)
    *   [Unit Tests](#unit-tests)
    *   [Integration Tests (Limited Scope for MVP)](#integration-tests-limited-scope-for-mvp)
    *   [Mocking External Dependencies](#mocking-external-dependencies)
8.  [Deployment Considerations (MVP)](#deployment-considerations-mvp)
9.  [Future Enhancements (Post-MVP)](#future-enhancements-post-mvp)

## 1. Introduction

The Mempool Ingestion Service is responsible for connecting to specified blockchain mempools, fetching transaction data, performing necessary transformations, and storing this data for further analysis. The MVP focuses on establishing the core pipeline for a single, predefined mempool source (e.g., Bitcoin testnet, as per SSOT 9.2.1) and storing raw or minimally processed data into a designated storage solution (e.g., Google Cloud Storage bucket, as per SSOT 2.2.4).

## 2. Project Structure

The anticipated project structure for the Mempool Ingestion Service (Python-based example) is as follows. Refer to SSOT Section 2.2.1 for high-level component design.

```
mempool_ingestion_service/
├── .venv/                       # Virtual environment directory
├── app/
│   ├── __init__.py
│   ├── main.py                  # Main application entry point
│   ├── connectors/
│   │   ├── __init__.py
│   │   └── mempool_websocket.py # Module for WebSocket connection to mempool
│   ├── processing/
│   │   ├── __init__.py
│   │   └── transformers.py      # Data transformation logic
│   ├── storage/
│   │   ├── __init__.py
│   │   └── gcs_uploader.py      # Module for uploading data to GCS
│   └── utils/
│       ├── __init__.py
│       └── logging_config.py    # Logging configuration
├── tests/
│   ├── __init__.py
│   ├── unit/
│   │   ├── __init__.py
│   │   ├── test_transformers.py
│   │   └── test_gcs_uploader.py
│   └── integration/
│       ├── __init__.py
│       └── test_mempool_pipeline.py # Limited scope for MVP
├── config/
│   └── config.yaml.example      # Example configuration file
├── .env.example                 # Example environment variables file
├── requirements.txt             # Python dependencies
├── Dockerfile                   # Docker configuration for containerization
└── README.md                    # Project overview and setup instructions
```

## 3. Key Files and Components

Details based on SSOT Section 2.2.

### Configuration Files

*   **`config/config.yaml` (or `config.json`, `config.toml`)**: Stores service configurations such as mempool source details (URL, connection parameters), storage parameters (bucket name, credentials path if not using ADC), and processing settings. An example file (`config.yaml.example`) should be provided.
    *   *SSOT 9.2.1*: For MVP, this will specify connection to a single, predefined mempool source.
*   **`.env`**: Stores sensitive information like API keys and service account credentials (e.g., `GOOGLE_APPLICATION_CREDENTIALS`). An `.env.example` file will be provided.

### Main Application Script

*   **`app/main.py`**:
    *   Entry point of the service.
    *   Initializes logging and loads configuration.
    *   Instantiates and coordinates the connector, processing, and storage modules.
    *   Contains the main loop for fetching, processing, and storing data.
    *   Handles startup and graceful shutdown.

### Mempool Connector Module

*   **`app/connectors/mempool_websocket.py`** (example for WebSocket, could be RPC based on mempool source):
    *   Responsible for establishing and maintaining connection to the mempool source (SSOT 2.2.2).
    *   Handles subscription to new transactions or periodic fetching.
    *   Manages connection retries and error handling related to the source.
    *   *SSOT 9.2.1*: For MVP, this will connect to a specific, predefined mempool source (e.g., a public Bitcoin testnet WebSocket feed).

### Data Processing Module

*   **`app/processing/transformers.py`**:
    *   Receives raw data from the connector.
    *   *SSOT 9.2.1*: For MVP, this module will perform minimal transformation. This might include:
        *   Timestamping the received data.
        *   Ensuring data is in a consistent format (e.g., JSON).
        *   Potentially extracting a few key fields if explicitly required by the MVP definition in SSOT (e.g., transaction ID, size, fee).
    *   No complex enrichment or filtering at the MVP stage.

### Storage Interface Module

*   **`app/storage/gcs_uploader.py`** (example for GCS):
    *   Responsible for writing the (minimally) processed data to the designated storage solution (SSOT 2.2.4).
    *   *SSOT 9.2.1*: For MVP, this will be a Google Cloud Storage (GCS) bucket.
    *   Handles authentication to the storage service (preferably using Application Default Credentials on GCP).
    *   Manages file naming conventions, batching (if applicable for efficiency), and error handling for storage operations. Data might be stored as raw JSON strings or line-delimited JSON.

## 4. Core Logic (MVP)

Based on SSOT Section 9.2.1 (MVP Features for Mempool Ingestion).

### Initialization

1.  Load configuration from `config.yaml` and environment variables (`.env`).
2.  Set up logging (e.g., using `app/utils/logging_config.py`).
3.  Initialize the Mempool Connector, Data Processing, and Storage Interface modules with the loaded configurations.

### Connecting to Mempool Source

1.  The Mempool Connector module uses the URI and any necessary parameters from the configuration to establish a connection.
2.  For MVP, this is a persistent WebSocket connection to the predefined source (e.g., `wss://mempool.space/api/v1/ws` for Bitcoin, adjust as per actual MVP target).
3.  Implement basic retry logic with backoff for initial connection failures.

### Fetching Mempool Data

1.  Once connected, the service listens for incoming messages (new transactions) from the WebSocket.
2.  Each message received is considered a raw mempool event.
3.  *SSOT 9.2.1*: Focus is on capturing incoming transactions as they are broadcast.

### Basic Data Transformation

1.  The raw data (likely JSON string) is passed to the Data Processing module.
2.  The `transformers.py` module will:
    *   Add an ingestion timestamp (UTC).
    *   Ensure the data is valid JSON. If not, log an error and potentially quarantine the data.
    *   (Optional, as per final MVP scope) Extract a minimal set of predefined fields if required for immediate indexing or basic querying in storage. Otherwise, store the raw transaction object.

### Storing Data

1.  The transformed data (still largely raw, but perhaps wrapped with a timestamp) is passed to the Storage Interface module.
2.  The `gcs_uploader.py` module will:
    *   Batch data if appropriate (e.g., collect data for 1 minute or X number of transactions) to optimize GCS writes. For MVP, individual writes per transaction might be acceptable to simplify.
    *   Construct a file path/object name (e.g., `gs://<bucket-name>/<mempool_source>/<YYYY>/<MM>/<DD>/<HH>/<timestamp_uuid_txid>.json`).
    *   Upload the data to the specified GCS bucket.
    *   Handle GCS upload errors with retries and logging.

### Error Handling and Logging (Basic)

*   Implement `try-except` blocks around I/O operations (network connections, file/object storage).
*   Log errors with meaningful context (e.g., which transaction failed, type of error).
*   For MVP, critical errors (e.g., persistent connection failure to mempool, GCS authentication failure) should cause the service to log the error and exit gracefully or attempt a limited number of restarts.
*   Successful operations (e.g., data batch stored) should also be logged at an INFO level.

## 5. Configuration Management

Refer to SSOT Section 2.2.5 for configuration details.

### Environment Variables (`.env` file)

*   `GOOGLE_APPLICATION_CREDENTIALS`: Path to the GCP service account key file (if not using ADC or running locally where ADC isn't configured for this service).
*   `LOG_LEVEL`: e.g., `INFO`, `DEBUG`.
*   Any other sensitive credentials or environment-specific settings.

### Configuration File (`config/config.yaml`)

```yaml
# Example config.yaml content
mempool_source:
  type: websocket # or rpc
  url: "wss://mempool.space/api/v1/ws" # Example for Bitcoin, per SSOT 9.2.1
  # subscription_message: '{"action": "want", "data": ["blocks", "mempool-blocks", "live-2nd-pool", "stats"]}' # Example
  connection_timeout: 30 # seconds
  retry_attempts: 5
  retry_delay: 10 # seconds

storage:
  type: gcs # Per SSOT 2.2.4 & 9.2.1
  bucket_name: "your-mempool-data-bucket-name" # Replace with actual bucket name from SSOT
  # credentials_path: "/path/to/gcp-credentials.json" # Optional, use GOOGLE_APPLICATION_CREDENTIALS env var preferably
  file_prefix: "raw_transactions/" # e.g. raw_transactions/bitcoin/mainnet/

processing:
  batch_size: 1 # For MVP, process one by one, or small batch e.g. 10
  batch_max_time_seconds: 60 # Max time to wait before flushing a batch

logging:
  level: "INFO" # Overridden by ENV var if set
  format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
```

## 6. Data Flow (MVP)

1.  **Mempool Source**: Live blockchain transactions (e.g., Bitcoin testnet/mainnet).
2.  **Mempool Connector (`mempool_websocket.py`)**: Establishes WebSocket connection, receives raw transaction data.
3.  **Main Application (`main.py`)**: Passes raw data to processing.
4.  **Data Processing (`transformers.py`)**: Adds ingestion timestamp, ensures JSON format. (Minimal other transformations for MVP).
5.  **Main Application (`main.py`)**: Passes transformed data to storage.
6.  **Storage Interface (`gcs_uploader.py`)**: Writes data to a specified GCS bucket, organized by date/time.

## 7. Testing Considerations (MVP)

Refer to SSOT Section 2.2.7 for general testing strategy.

### Unit Tests (`tests/unit/`)

*   Test individual functions in `transformers.py` (e.g., timestamp addition, basic validation).
*   Test helper functions in `gcs_uploader.py` (e.g., file path generation), mocking actual GCS calls.
*   Test parsing of configuration values.
*   Mock external dependencies (mempool connection, GCS client).

### Integration Tests (Limited Scope for MVP) (`tests/integration/`)

*   A simple test to verify the pipeline:
    *   Mock the mempool source to emit a few sample raw transactions.
    *   Verify that the service processes these and attempts to write them to a mocked GCS client.
    *   Check the format of the data being written.
*   Full end-to-end tests with live mempool and actual GCS are complex and likely out of scope for MVP unit/integration suites but should be performed manually during development.

### Mocking External Dependencies

*   Use Python's `unittest.mock` library extensively.
*   Mock the WebSocket client or RPC client used by `mempool_websocket.py`.
*   Mock the `google.cloud.storage` client used by `gcs_uploader.py`.

## 8. Deployment Considerations (MVP)

Refer to SSOT Section 2.2.6 for deployment environment.

*   **Containerization**: Package the service using Docker (`Dockerfile`). This ensures a consistent environment.
*   **GCP Compute Engine (GCE) or Google Kubernetes Engine (GKE)**: The Docker container will be deployed to one of these GCP services. For MVP, a single GCE instance running the Docker container might be sufficient.
*   **IAM Permissions**: Ensure the GCE instance's service account (or the service account key used) has `roles/storage.objectCreator` permission on the target GCS bucket.
*   **Monitoring**: Basic logging to Cloud Logging will be available by default if running on GCP. Custom metrics are post-MVP.
*   **Process Management**: Use a simple process manager like `supervisor` or rely on Docker's restart policies if running as a container on GCE. For GKE, Kubernetes handles this.

## 9. Future Enhancements (Post-MVP)

While not part of this MVP implementation, these are potential next steps:

*   Support for multiple mempool sources.
*   More sophisticated data transformation and enrichment.
*   Real-time data validation and schema enforcement.
*   Alternative storage backends (e.g., BigQuery, databases).
*   Advanced error handling, dead-letter queues.
*   Metrics and monitoring dashboards.
*   Scalability improvements (e.g., multiple instances, message queues like Pub/Sub).

---

This guide outlines the core aspects of implementing the Mempool Ingestion Service MVP. Developers should refer to the linked SSOT sections for authoritative details on requirements and specifications.
```
