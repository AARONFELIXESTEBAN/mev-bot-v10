# GCP Deployment Guide - MEV Bot V10 (Phase 2)

This guide covers deploying the `mempool-ingestion-service` and `mev-bot-v10` to Google Compute Engine (GCE) for Phase 2.

## Prerequisites
*   Terraform installed locally.
*   Google Cloud SDK installed and authenticated (`gcloud auth login`, `gcloud auth application-default login`).
*   A GCP Project created with billing enabled.
*   A Service Account created with necessary IAM roles (see Terraform `main.tf` comments for roles like Firestore User, KMS Signer/Verifier, Secret Manager Accessor, Logging Writer, Monitoring Metric Writer).
*   GCP APIs enabled for your project: Compute Engine API, Cloud Firestore API, Cloud KMS API, Secret Manager API, Cloud Logging API, Cloud Monitoring API.
*   Secrets (Production RPC URLs, Flashbots Signing Key, KMS Key Path if not just name) stored in GCP Secret Manager.

## 1. Infrastructure Provisioning (Terraform)
1.  Navigate to the `terraform` directory within the repository.
2.  **Initialize Variables:**
    *   Copy `terraform.tfvars.example` to `terraform.tfvars`:
        ```bash
        cp terraform.tfvars.example terraform.tfvars
        ```
    *   Edit `terraform.tfvars` and fill in your specific values:
        *   `gcp_project_id`: Your GCP project ID.
        *   `gcp_service_account_email`: The email of the pre-configured service account that the GCE VMs will use.
        *   Optionally, override defaults for region, zone, machine type, VM names, or publisher port if needed.
3.  **Initialize Terraform:**
    ```bash
    terraform init
    ```
4.  **Review the Plan:**
    ```bash
    terraform plan
    ```
    This command shows you what resources Terraform will create, modify, or delete. Review it carefully.
5.  **Apply the Configuration:**
    ```bash
    terraform apply
    ```
    Confirm by typing `yes` when prompted. This will provision the GCE VMs, firewall rules, and other specified resources.
    *   Note the output IPs (`mempool_ingestion_vm_ip` and `mev_bot_v10_vm_ip`) if you need to SSH using external IPs, though using IAP or internal IPs is recommended for better security.

## 2. Application Deployment to GCE VMs

The Terraform setup creates the VMs. The startup scripts (`startup-script-mempool.sh` and `startup-script-mevbot.sh`) handle basic OS setup (Node.js, PM2, Ops Agent). You have a few options for deploying your application code:

*   **Option A: Custom GCE Image (Recommended for Production):** Bake your application code, dependencies, and PM2 setup into a custom GCE image. Terraform would then use this image. This leads to faster, more consistent deployments. (This guide assumes startup scripts for initial setup if not using custom images).
*   **Option B: Manual Deployment (Covered Below):** SSH into the VMs and deploy the code manually or via a CI/CD pipeline.
*   **Option C: Enhanced Startup Scripts:** Modify the startup scripts to clone the specific version of your application, install dependencies, build, and start with PM2. This is simpler than custom images but slower on boot.

**The following steps assume Option C (enhanced startup scripts) or Option B (manual deployment after basic startup script execution).**

For each VM (`mempool-ingestion-vm` and `mev-bot-v10-vm`):

1.  **SSH into the VM:**
    ```bash
    gcloud compute ssh <vm-name> --zone <your-zone> --project <your-project-id>
    # Example for mev-bot-v10-vm (replace with actual name if changed in tfvars):
    # gcloud compute ssh mev-bot-v10-vm --zone us-central1-a --project your-gcp-project-id
    ```
2.  **Clone Application Code (if not done by startup script/custom image):**
    Set the deployment directory:
    ```bash
    export APP_NAME="mev-bot-v10" # Or "mempool-ingestion-service"
    export DEPLOY_DIR="/opt/app/${APP_NAME}" # Example directory
    sudo mkdir -p $DEPLOY_DIR
    sudo chown $(whoami):$(whoami) $DEPLOY_DIR
    cd $DEPLOY_DIR
    ```
    Clone your repository (ensure the VM/service account has access if private):
    ```bash
    git clone <your-repository-url> .
    # For subsequent deployments:
    # git pull
    # git checkout <tag/branch>
    ```
3.  **Navigate to Service Directory:**
    *   If you cloned the monorepo root:
        *   For mempool VM: `cd mempool-ingestion-service`
        *   For MEV bot VM: `cd mev-bot-v10`
4.  **Install Dependencies & Build:**
    ```bash
    npm install --production # Install only production dependencies
    npm run build            # Compile TypeScript
    ```
5.  **Configure Environment (`.env` file):**
    *   Create an `.env` file in the service's root directory (e.g., `/opt/app/mev-bot-v10/mev-bot-v10/.env`).
    *   **Populate from GCP Secret Manager (Recommended):**
        Use a helper script or commands to fetch secrets and populate the `.env` file. The VM's service account needs `Secret Manager Secret Accessor` role.
        ```bash
        # Example for creating .env on mev-bot-v10 VM (run these on the VM)
        # Ensure gcloud is available and authenticated (usually true for GCE VMs with service accounts)

        PROJECT_ID=$(gcloud config get-value project) # Or curl metadata server
        SERVICE_DIR=$(pwd) # Should be the specific service directory

        echo "LOG_LEVEL=info" > ${SERVICE_DIR}/.env
        echo "NODE_ENV=production" >> ${SERVICE_DIR}/.env
        echo "GCP_PROJECT_ID=${PROJECT_ID}" >> ${SERVICE_DIR}/.env

        # For mev-bot-v10 VM specific secrets:
        echo "RPC_URL_MAINNET_HTTP=$(gcloud secrets versions access latest --secret=RPC_URL_MAINNET_HTTP --project=${PROJECT_ID})" >> ${SERVICE_DIR}/.env
        echo "RPC_URL_MAINNET_WSS=$(gcloud secrets versions access latest --secret=RPC_URL_MAINNET_WSS --project=${PROJECT_ID})" >> ${SERVICE_DIR}/.env
        echo "GCP_KMS_KEY_PATH=$(gcloud secrets versions access latest --secret=GCP_KMS_KEY_PATH --project=${PROJECT_ID})" >> ${SERVICE_DIR}/.env
        # For MEMPOOL_PUBLISHER_URL, use the internal IP/DNS of the mempool-ingestion-vm.
        # This can be found via Terraform outputs or GCP console.
        echo "MEMPOOL_PUBLISHER_URL=ws://<INTERNAL_IP_OF_MEMPOOL_VM>:$(terraform output -raw mempool_publisher_port || echo 3001)" >> ${SERVICE_DIR}/.env
        # If using Flashbots for Phase 2:
        # echo "FLASHBOTS_SIGNING_KEY=$(gcloud secrets versions access latest --secret=FLASHBOTS_SIGNING_KEY --project=${PROJECT_ID})" >> ${SERVICE_DIR}/.env

        # For mempool-ingestion-service VM specific secrets:
        # echo "MEMPOOL_WS_URL=$(gcloud secrets versions access latest --secret=GCP_NBE_WSS_URL --project=${PROJECT_ID})" >> ${SERVICE_DIR}/.env # Assuming NBE URL is a secret
        # echo "PUBLISHER_PORT=$(terraform output -raw mempool_publisher_port || echo 3001)" >> ${SERVICE_DIR}/.env

        echo "Generated .env file from secrets."
        ```
        *   **Important:** For `MEMPOOL_PUBLISHER_URL` in `mev-bot-v10/.env`, use the **internal IP address** or internal DNS name of the `mempool-ingestion-vm` for secure and low-latency communication. The Terraform output for `mempool_ingestion_vm_ip` gives the external IP; find the internal IP in the GCP console or via `gcloud compute instances describe`.
6.  **Start with PM2:**
    Create an `ecosystem.config.js` in the service's root directory (examples provided in `MEV_BOT_V10_PHASE_1_FULL_GUIDE.md`, Part 4, or in the startup scripts).
    ```bash
    # In the service directory (e.g., /opt/app/mev-bot-v10/mev-bot-v10)
    pm2 start ecosystem.config.js
    pm2 startup # Follow instructions to enable PM2 to start on system boot
    pm2 save    # Save current PM2 process list
    ```

## 3. GCP Services Health Check (Initial Mode: Paper Trading)

1.  **Verify PM2 Processes:** `pm2 list` on each VM to ensure services are `online`.
2.  **Check Logs in Google Cloud Logging:**
    *   Go to the GCP Console -> Logging -> Logs Explorer.
    *   Filter logs by GCE VM instance for `mempool-ingestion-service` and `mev-bot-v10`.
    *   **Mempool Service:** Look for successful connection to your production mempool WebSocket (e.g., GCP NBE WSS URL if configured, or your third-party provider).
    *   **MEV Bot Service:**
        *   Confirm successful connection to the `mempool-ingestion-service` publisher.
        *   Look for logs indicating it's processing opportunities.
        *   Check for any errors during initialization of services like KMS, Firestore, RPC.
3.  **Verify Firestore Interaction (Paper Trading):**
    *   Set `PAPER_TRADING_CONFIG_ENABLED=true` and `EXECUTION_CONFIG_ENABLED=false` in `mev-bot-v10/.env` or `config.yaml`.
    *   Observe `mev-bot-v10` logs for identified profitable opportunities and paper trades being recorded.
    *   In the GCP Console, navigate to Firestore and check the configured collection for paper trades (e.g., `mevBotV10Data/paper_trades_v10_dex_arb`) to see if new trade documents are appearing.
4.  **Verify KMS Integration (Conceptual for Paper Trading):**
    *   The `KmsService` in `mev-bot-v10` should initialize without errors using the configured `GCP_KMS_KEY_PATH`. The bot should log its operating address derived from this KMS key. No actual signing occurs in paper trading mode.
5.  **End-to-End Flow:**
    *   Confirm mempool transactions are flowing from the ingestion service to the bot.
    *   Confirm the bot identifies opportunities, simulates them, and (if profitable) logs paper trades to Firestore.

## 4. Transitioning to Live Execution (Phase 2 - Caution!)
Transitioning to live execution (`EXECUTION_CONFIG_ENABLED=true`) requires extreme caution, thorough testing in paper/simulation modes, robust security for keys and infrastructure, and comprehensive monitoring. This guide focuses on setup; live execution implies significant additional operational responsibilities.

## Troubleshooting
*   **IAM Permissions:** Double-check that the GCE VM's service account has all necessary roles outlined in `terraform/main.tf` comments and the prerequisites.
*   **Firewall Rules:** Ensure the Terraform-applied firewall rule allows traffic from the mempool VM to the bot VM on the publisher port. Check GCP VPC firewall rules.
*   **Secret Manager Access:** If secrets are not loading, verify Secret Manager API is enabled and the service account has accessor roles for each specific secret.
*   **Internal vs. External IPs:** For inter-VM communication (e.g., bot connecting to mempool publisher), always prefer internal IP addresses or DNS names.
*   **PM2 Logs:** Use `pm2 logs <app-name>` extensively on the VMs for debugging.
*   **Node.js/npm versions:** Ensure consistency if facing build or runtime issues.
```
